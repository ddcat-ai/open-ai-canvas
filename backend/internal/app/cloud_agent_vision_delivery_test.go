package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func cloudAgentVisionFixture(t *testing.T) (*Service, *gorm.DB, []byte) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	capability.Text.References.MaxImages = 2
	capability.Text.References.MaxImageBytes = 1024 * 1024
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, capability)).Error; err != nil {
		t.Fatal(err)
	}
	img := image.NewRGBA(image.Rect(0, 0, 2, 2))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(s.dataDir, "resources"), 0700); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"ref-one", "ref-two"} {
		if err := os.WriteFile(filepath.Join(s.dataDir, "resources", id+".png"), encoded.Bytes(), 0600); err != nil {
			t.Fatal(err)
		}
		if err := db.Model(&model.Resource{}).Where("id = ?", id).Updates(map[string]any{"provider": "local", "object_key": id + ".png", "size": encoded.Len()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, db, encoded.Bytes()
}

func cloudAgentVisionInput(t *testing.T, s *Service, nodes ...string) canvasGenerationInput {
	t.Helper()
	state := cloudAgentRuntime{Request: agentTestRequest()}
	state.Request.VisionEnabled = true
	var inspections []cloudAgentImageInspection
	for _, node := range nodes {
		call := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-"+node, map[string]any{"nodeId": node})
		result, err := s.prepareCloudAgentImageInspection("user", "agent-canvas", &state, call)
		if err != nil {
			t.Fatal(err)
		}
		inspections = append(inspections, result.(cloudAgentImageInspection))
	}
	canonical := canonicalAgentRequest{ToolChoice: "auto", Messages: []map[string]any{{"role": "user", "content": cloudAgentImageContentParts(inspections...)}}}
	refs, err := s.cloudAgentImageReferences("user", state.Request, &canonical)
	if err != nil {
		t.Fatal(err)
	}
	limits, err := s.cloudAgentVisionReferences(state.Request)
	if err != nil {
		t.Fatal(err)
	}
	return canvasGenerationInput{Mode: "text", Prompt: "描述图片", ReferenceImages: refs, AgentRequests: &agentToolRequests{Canonical: &canonical}, Config: providerConfig{Model: "text-test", InterfaceType: string(model.ChannelInterfaceChatCompletion), APIKey: "test-only", CapabilityConfig: &ModelCapabilityConfig{Text: &TextCapabilityConfig{References: limits}}}}
}

func TestCloudAgentVisionWorkerSendsPixelsWithoutPublicURL(t *testing.T) {
	for _, publicURL := range []string{"", "https://bucket.example.invalid"} {
		t.Run("public-url-"+publicURL, func(t *testing.T) {
			t.Setenv("CANVAS_PUBLIC_BASE_URL", publicURL)
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
			s, _, pixels := cloudAgentVisionFixture(t)
			input := cloudAgentVisionInput(t, s, "cat")
			received := make(chan string, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Messages []map[string]any `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(400)
					return
				}
				var imageURL string
				for _, message := range body.Messages {
					parts, _ := message["content"].([]any)
					for _, value := range parts {
						part, _ := value.(map[string]any)
						if image, ok := part["image_url"].(map[string]any); ok {
							imageURL = stringField(image, "url")
						}
					}
				}
				received <- imageURL
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"mock accepted pixels","tool_calls":[]}}]}`))
			}))
			defer server.Close()
			input.Config.BaseURL = server.URL
			stream := false
			input.TextOptions.Stream = &stream
			raw, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(raw), "base64,") || strings.Contains(string(raw), "signature=") {
				t.Fatal("persistable task contains pixel bytes or signed URL")
			}
			result, err := s.processCanvasGenerationTask(context.Background(), "user", "agent-canvas", "canvas_text", "", string(raw))
			if err != nil {
				t.Fatal(err)
			}
			if result["text"] != "mock accepted pixels" {
				t.Fatalf("unexpected model response: %+v", result)
			}
			select {
			case imageURL := <-received:
				if imageURL != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(pixels) {
					t.Fatal("upstream did not receive exact stored image bytes")
				}
			default:
				t.Fatal("worker did not call mock upstream")
			}
			if input.ReferenceImages[0].DataURL != "" || !strings.Contains(string(raw), "resource:ref-one") {
				t.Fatal("worker mutated persistable resource placeholder")
			}
		})
	}
}

func TestCloudAgentVisionHydrationPreservesProtocolImages(t *testing.T) {
	s, _, pixels := cloudAgentVisionFixture(t)
	input := cloudAgentVisionInput(t, s, "cat", "hero")
	original, _ := json.Marshal(input.AgentRequests)
	if err := s.hydrateGenerationMedia("user", &input, providerMediaHydrationPolicy{preferURL: true}); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveAgentResourcePlaceholders(input, true)
	if err != nil {
		t.Fatal(err)
	}
	expanded, err := expandCanonicalAgentRequest(resolved.AgentRequests.Canonical, input.Config, true)
	if err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]any{"chat": expanded.ChatCompletion, "responses": expanded.Responses, "claude": expanded.Claude, "gemini": expanded.Gemini} {
		raw, _ := json.Marshal(body)
		if strings.Count(string(raw), base64.StdEncoding.EncodeToString(pixels)) != 2 || strings.Contains(string(raw), "resource:") {
			t.Errorf("%s lost image data or retained unresolved resource", name)
		}
	}
	after, _ := json.Marshal(input.AgentRequests)
	if !bytes.Equal(original, after) {
		t.Fatal("protocol expansion mutated persisted canonical")
	}
}

func TestCloudAgentVisionUsesStoredPixelsInsteadOfSuppliedData(t *testing.T) {
	s, _, pixels := cloudAgentVisionFixture(t)
	input := cloudAgentVisionInput(t, s, "cat")
	input.ReferenceImages[0].DataURL = "data:image/png;base64,bm90IHRoZSBzdG9yZWQgaW1hZ2U="
	if err := s.hydrateGenerationMedia("user", &input, providerMediaHydrationPolicy{}); err != nil {
		t.Fatal(err)
	}
	if input.ReferenceImages[0].DataURL != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(pixels) {
		t.Fatal("supplied data replaced the authorized resource's image bytes")
	}
}

// 对照本次反馈使用的 Chat Completions 渠道在真实 worker 中的两条分支，
// 而不是只验证协议转换 helper：相同资源、模型和端点必须收到相同像素。
func TestCloudAgentVisionMatchesConnectedTextNode(t *testing.T) {
	for _, tc := range []struct {
		protocol, endpoint, imageType, response string
	}{
		{"chat-completion", "/v1/chat/completions", "image_url", `{"choices":[{"message":{"content":"pixels received"}}]}`},
	} {
		t.Run(tc.protocol, func(t *testing.T) {
			t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://bucket.example.invalid")
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
			s, _, pixels := cloudAgentVisionFixture(t)
			type capturedRequest struct {
				path string
				body map[string]any
			}
			received := make(chan capturedRequest, 2)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				received <- capturedRequest{r.URL.Path, body}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(tc.response))
			}))
			defer server.Close()
			for _, agent := range []bool{false, true} {
				input := cloudAgentVisionInput(t, s, "cat")
				input.Config.InterfaceType = tc.protocol
				input.Config.BaseURL = server.URL
				stream := false
				input.TextOptions.Stream = &stream
				if !agent {
					input.AgentRequests = nil
				}
				raw, err := json.Marshal(input)
				if err != nil {
					t.Fatal(err)
				}
				result, err := s.processCanvasGenerationTask(context.Background(), "user", "agent-canvas", "canvas_text", "", string(raw))
				if err != nil {
					t.Fatalf("agent=%t: %v", agent, err)
				}
				if result["text"] != "pixels received" {
					t.Fatalf("agent=%t: unexpected mock response", agent)
				}
				select {
				case request := <-received:
					body, err := json.Marshal(request.body)
					if err != nil {
						t.Fatal(err)
					}
					if request.path != tc.endpoint || request.body["model"] != input.Config.Model {
						t.Fatalf("agent=%t: model or endpoint mismatch", agent)
					}
					if strings.Count(string(body), base64.StdEncoding.EncodeToString(pixels)) != 1 ||
						!strings.Contains(string(body), `"type":"`+tc.imageType+`"`) ||
						strings.Contains(string(body), "resource:") || strings.Contains(string(body), "bucket.example.invalid") {
						t.Fatalf("agent=%t: upstream did not receive the same image bytes and protocol image part", agent)
					}
				default:
					t.Fatalf("agent=%t: mock upstream was not called", agent)
				}
			}
		})
	}
}

func TestCloudAgentVisionRejectsInvalidResources(t *testing.T) {
	for _, tc := range []struct {
		name, field string
		value       any
	}{
		{"foreign", "user_id", "other"},
		{"not-ready", "status", "uploading"},
		{"not-image", "mime_type", "text/plain"},
		{"too-large", "size", int64(2 * 1024 * 1024)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _ := cloudAgentVisionFixture(t)
			input := cloudAgentVisionInput(t, s, "cat")
			if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update(tc.field, tc.value).Error; err != nil {
				t.Fatal(err)
			}
			state := cloudAgentRuntime{Request: agentTestRequest()}
			call := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect", map[string]any{"nodeId": "cat"})
			if _, err := s.prepareCloudAgentImageInspection("user", "agent-canvas", &state, call); err == nil {
				t.Fatal("inspection accepted invalid resource")
			}
			if _, err := s.cloudAgentImageReferences("user", state.Request, input.AgentRequests.Canonical); err == nil {
				t.Fatal("task assembly accepted invalid resource")
			}
			if err := s.hydrateGenerationMedia("user", &input, providerMediaHydrationPolicy{}); err == nil {
				t.Fatal("worker accepted resource changed after admission")
			}
		})
	}
}

func TestCloudAgentVisionLimitsAndUnconfirmedState(t *testing.T) {
	s, db, _ := cloudAgentVisionFixture(t)
	input := cloudAgentVisionInput(t, s, "cat", "hero")
	canonical := input.AgentRequests.Canonical
	original, _ := json.Marshal(canonical)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	capability.Text.References.MaxImages = 1
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, capability)).Error; err != nil {
		t.Fatal(err)
	}
	copy := *canonical
	refs, err := s.cloudAgentImageReferences("user", agentTestRequest(), &copy)
	if err != nil || len(refs) != 1 || refs[0].StorageKey != "resource:ref-two" {
		t.Fatalf("did not retain newest image within model limit: %+v %v", refs, err)
	}
	after, _ := json.Marshal(canonical)
	if !bytes.Equal(original, after) {
		t.Fatal("limit projection mutated durable canonical")
	}
	state := cloudAgentRuntime{Request: agentTestRequest(), CreativeAnchor: cloudAgentCreativeAnchor{ReferenceAssets: []cloudAgentReferenceAnchor{{NodeID: "cat", VisualIdentity: "inspected", VisualNote: "无法读取图片"}}}}
	state.markCanvasImageAttached("cat")
	asset := state.CreativeAnchor.ReferenceAssets[0]
	if asset.VisualIdentity != "unknown" || !asset.RequiresVisualInspection || asset.VisualNote != "" {
		t.Fatal("attachment was treated as recognition")
	}
	state.PendingImageInspections = []cloudAgentImageInspection{{}}
	call := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect", map[string]any{"nodeId": "hero"})
	if _, err := s.prepareCloudAgentImageInspection("user", "agent-canvas", &state, call); err == nil {
		t.Fatal("batch exceeded model image limit")
	}
	inherited := cloudAgentCreativeAnchor{ReferenceAssets: []cloudAgentReferenceAnchor{{NodeID: "cat", VisualIdentity: "inspected", VisualNote: "无法读取图片"}}}
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	anchor, err := cloudAgentCreativeAnchorForCanvas(s.repo, "user", canvas, "描述实际背景", &inherited)
	if err != nil {
		t.Fatal(err)
	}
	for _, asset := range anchor.ReferenceAssets {
		if asset.VisualIdentity != "unknown" || asset.VisualNote != "" {
			t.Fatal("inherited unconfirmed observation")
		}
	}
}

func TestCloudAgentVisionRefreshCannotBypassPerImageLimit(t *testing.T) {
	s, _, _ := cloudAgentVisionFixture(t)
	state := cloudAgentRuntime{Request: agentTestRequest()}
	state.Request.VisionEnabled = true

	firstCall := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-1", map[string]any{"nodeId": "cat"})
	first, err := s.prepareCloudAgentImageInspection("user", "agent-canvas", &state, firstCall)
	if err != nil {
		t.Fatal(err)
	}
	state.markCanvasImageInspection("cat", strings.TrimSpace(first.(cloudAgentImageInspection).ImageURL) != "")

	secondCall := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-2", map[string]any{"nodeId": "cat"})
	second, err := s.prepareCloudAgentImageInspection("user", "agent-canvas", &state, secondCall)
	if err != nil {
		t.Fatal(err)
	}
	state.markCanvasImageInspection("cat", strings.TrimSpace(second.(cloudAgentImageInspection).ImageURL) != "")

	refreshCall := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-refresh", map[string]any{"nodeId": "cat", "refresh": true})
	refreshed, err := s.prepareCloudAgentImageInspection("user", "agent-canvas", &state, refreshCall)
	if err != nil {
		t.Fatal(err)
	}
	inspection := refreshed.(cloudAgentImageInspection)
	if inspection.ImageURL != "" {
		t.Fatal("refresh=true bypassed the per-image inspection limit")
	}
	if inspection.Receipt["refreshIgnored"] != true || inspection.Receipt["repeat"] != true {
		t.Fatalf("refresh protection receipt is incomplete: %+v", inspection.Receipt)
	}
	state.markCanvasImageInspection("cat", false)
	if got := state.cloudAgentImageInspectionCount("cat"); got != 3 {
		t.Fatalf("expected all successful inspection calls to count, got %d", got)
	}
}

func TestCloudAgentVisionBlocksSameResourceInSameCanvasRevision(t *testing.T) {
	s, _, _ := cloudAgentVisionFixture(t)
	state := cloudAgentRuntime{Request: agentTestRequest()}
	state.Request.VisionEnabled = true

	firstCall := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-1", map[string]any{"nodeId": "cat"})
	first, err := s.prepareCloudAgentImageInspection("user", "agent-canvas", &state, firstCall)
	if err != nil {
		t.Fatal(err)
	}
	inspection := first.(cloudAgentImageInspection)
	if inspection.CacheKey == "" {
		t.Fatal("first inspection did not produce a stable cache key")
	}
	state.ImageInspectionReads = map[string]int{inspection.CacheKey: 1}

	refreshCall := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-refresh", map[string]any{"nodeId": "cat", "refresh": true})
	_, err = s.prepareCloudAgentImageInspection("user", "agent-canvas", &state, refreshCall)
	var loopErr *cloudAgentReadLoopError
	if !errors.As(err, &loopErr) {
		t.Fatalf("refresh should not re-read the same resource in the same revision: %v", err)
	}
}

func TestCloudAgentVisionHasPerRunInspectionBudget(t *testing.T) {
	s, _, _ := cloudAgentVisionFixture(t)
	state := cloudAgentRuntime{Request: agentTestRequest(), ImageInspectCalls: cloudAgentMaxImageInspectionCallsPerRun - 1}
	state.Request.VisionEnabled = true
	call := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-last", map[string]any{"nodeId": "cat", "refresh": true})
	result, err := s.prepareCloudAgentImageInspection("user", "agent-canvas", &state, call)
	if err != nil {
		t.Fatal(err)
	}
	state.markCanvasImageInspection("cat", strings.TrimSpace(result.(cloudAgentImageInspection).ImageURL) != "")
	if got := state.ImageInspectCalls; got != cloudAgentMaxImageInspectionCallsPerRun {
		t.Fatalf("expected budget to be consumed at the boundary, got %d", got)
	}

	blockedCall := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-blocked", map[string]any{"nodeId": "cat", "refresh": true})
	if _, err := s.prepareCloudAgentImageInspection("user", "agent-canvas", &state, blockedCall); !errors.Is(err, errCloudAgentImageInspectionBudget) {
		t.Fatalf("expected image inspection budget error, got %v", err)
	}
}

func TestCloudAgentVisionBudgetStopsRunBeforeAnotherModelStep(t *testing.T) {
	s, _, _ := cloudAgentVisionFixture(t)
	req := agentTestRequest()
	req.VisionEnabled = true
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = ""
	state.ImageInspectCalls = cloudAgentMaxImageInspectionCallsPerRun
	state.Calls = []cloudAgentCall{cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-blocked", map[string]any{"nodeId": "cat", "refresh": true})}
	state.CallIndex = 0
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, err = s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err = cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	output, err := s.CloudAgentRun("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if output.Status != "failed" || !strings.Contains(output.FailureMessage, "识图调用已达到安全上限") {
		t.Fatalf("inspection budget did not terminate the run: %+v", output)
	}
}

func TestCloudAgentVisionRejectsOversizedActualBytes(t *testing.T) {
	s, db, pixels := cloudAgentVisionFixture(t)
	input := cloudAgentVisionInput(t, s, "cat")
	input.Config.CapabilityConfig.Text.References.MaxImageBytes = int64(len(pixels) - 1)
	if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("size", 1).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.hydrateGenerationMedia("user", &input, providerMediaHydrationPolicy{}); err == nil {
		t.Fatal("worker trusted metadata instead of bounding actual bytes")
	}
}

func TestCloudAgentVisionRejectsMissingFileAndExternalURL(t *testing.T) {
	s, _, _ := cloudAgentVisionFixture(t)
	input := cloudAgentVisionInput(t, s, "cat")
	if err := os.Remove(filepath.Join(s.dataDir, "resources", "ref-one.png")); err != nil {
		t.Fatal(err)
	}
	if err := s.hydrateGenerationMedia("user", &input, providerMediaHydrationPolicy{}); err == nil {
		t.Fatal("missing pixels were treated as a successful inspection")
	}
	for _, url := range []string{"https://example.invalid/image.png", "http://127.0.0.1/private", "data:image/png;base64,YQ==", "resource:private"} {
		canonical := canonicalAgentRequest{Messages: []map[string]any{{"role": "user", "content": []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": url}}}}}}
		if _, err := s.cloudAgentImageReferences("user", agentTestRequest(), &canonical); err == nil {
			t.Errorf("accepted unapproved image source %q", url)
		}
	}
}

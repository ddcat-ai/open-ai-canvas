package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestCreationNativePiRuntimeUsesHomepageContractAndImages(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	if _, err := agentRuntimeDirForTest(); err != nil {
		t.Skip(err.Error())
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	s, db, pixels := cloudAgentVisionFixture(t)
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	received := make(chan map[string]any, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		received <- body
		writeSSE(w, sseDelta(map[string]any{"content": "已收到当前上传的商品图片，继续在首页创作。"}))
	}))
	t.Cleanup(server.Close)
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": server.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = s.ProcessNextTask()
			time.Sleep(20 * time.Millisecond)
		}
	}()
	req := creationAgentRequest()
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "商品"}}
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	execution := waitLiveAgentTerminal(t, s, run.ID)
	if execution.Status != "completed" {
		t.Fatalf("native creation failed: %s", execution.FailureMessage)
	}
	select {
	case body := <-received:
		encoded, _ := json.Marshal(body)
		for _, forbidden := range []string{"canvas_get_state", "canvas_inspect_image", "节点能力速查", "recall_lessons", "agent_profile_read"} {
			if strings.Contains(string(encoded), forbidden) {
				t.Fatalf("native upstream contract leaked canvas capability %s", forbidden)
			}
		}
		if !strings.Contains(string(encoded), base64.StdEncoding.EncodeToString(pixels)) || !strings.Contains(string(encoded), "首页创作 Agent") {
			t.Fatal("actual native upstream missed homepage contract or pixels")
		}
		if stringField(body, "model") != "text-test" {
			t.Fatal("native runtime changed dialogue model")
		}
	default:
		t.Fatal("native runtime did not call upstream")
	}
	if len(received) != 0 {
		t.Fatal("attachment understanding unexpectedly added another model call")
	}
	session, err := s.repo.CloudAgentPiSession("user", run.ID)
	if err != nil || session.SessionJSONL == "" {
		t.Fatalf("native snapshot missing: %v", err)
	}
	if strings.Contains(session.SessionJSONL, "base64,") {
		t.Fatal("native snapshot persisted attachment pixels")
	}

	// The next user message carries no upload. The direct parent's effective
	// resource must still reach the real worker as pixels, not just a filename
	// in Pi's restored TurnContext transcript.
	next := creationAgentRequest()
	next.IdempotencyKey = "creation-native-reference-continuation"
	next.Prompt = "帮我生成亚马逊美国站5张套图"
	continued, err := s.CreateCloudAgentRun("user", next, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if result := waitLiveAgentTerminal(t, s, continued.ID); result.Status != "completed" {
		t.Fatalf("native creation continuation failed: %s", result.FailureMessage)
	}
	select {
	case body := <-received:
		encoded, _ := json.Marshal(body)
		if !strings.Contains(string(encoded), base64.StdEncoding.EncodeToString(pixels)) || !strings.Contains(string(encoded), next.Prompt) {
			t.Fatal("second native turn sent filename/history without current attachment pixels")
		}
		if stringField(body, "model") != "text-test" {
			t.Fatal("continuation silently changed the selected dialogue model")
		}
	default:
		t.Fatal("native continuation did not call mock upstream")
	}
	if len(received) != 0 {
		t.Fatal("reference continuation unexpectedly added an extra model call")
	}
}

func TestCreationLogicalTextModelUsesOnlyVisionCapableActiveRoutes(t *testing.T) {
	s, db, _ := cloudAgentVisionFixture(t)
	logical := model.LogicalModel{ID: "logical-vision", Code: "logical-vision", Capability: "text", Enabled: true, ActiveRevisionID: "revision-vision"}
	if err := db.Create(&logical).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.LogicalModelRevision{ID: "revision-vision", LogicalModelID: logical.ID, Version: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.LogicalModelRoute{ID: "route-vision", LogicalModelRevisionID: "revision-vision", ChannelModelID: "cm", Enabled: true, Weight: 1}).Error; err != nil {
		t.Fatal(err)
	}
	req := creationAgentRequest()
	req.ChannelID, req.ChannelModelKey, req.Model, req.LogicalModelID = "", "", "", logical.ID
	limits, err := s.cloudAgentVisionReferences(req)
	if err != nil || limits.MaxImages != 2 {
		t.Fatalf("logical model lost actual route vision: %+v %v", limits, err)
	}
	if err := db.Model(&model.LogicalModelRoute{}).Where("id = ?", "route-vision").Update("enabled", false).Error; err != nil {
		t.Fatal(err)
	}
	if s.cloudAgentVisionEnabled(req) {
		t.Fatal("logical model with no active vision route advertised image input")
	}
}

func TestPiCreationModelStepDeliversOnlyAuthorizedAttachmentPixels(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s, db, pixels := cloudAgentVisionFixture(t)
	s.legacyCloudAgentRootTask = false
	req := creationAgentRequest()
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "商品图片"}}
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := s.cloudAgentPiModel(ctx, "user", run.ID, piEventForTest(t, map[string]any{"stepId": "creation-vision-step", "purpose": "dialogue", "messages": []map[string]any{{"role": "user", "content": req.Prompt}}}))
		done <- err
	}()
	var step *model.Task
	for ctx.Err() == nil {
		var candidate model.Task
		if db.Where("agent_run_id = ? AND operation = ?", run.ID, cloudAgentStepOperation).First(&candidate).Error == nil {
			step = &candidate
			break
		}
		select {
		case err := <-done:
			t.Fatalf("Pi did not schedule image-bearing step: %v", err)
		default:
		}
		time.Sleep(10 * time.Millisecond)
	}
	if step == nil {
		t.Fatal("Pi model step not queued")
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(step.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.ReferenceImages) != 1 || input.ReferenceImages[0].StorageKey != "resource:ref-one" {
		t.Fatalf("Pi step lost owned attachment: %+v", input.ReferenceImages)
	}
	if strings.Contains(step.InputJSON, "base64,") || strings.Contains(step.InputJSON, "ref-two") || strings.Contains(step.InputJSON, "must-not-expose.invalid") {
		t.Fatal("Pi persistable request leaked pixels or canvas assets")
	}
	if input.Config.Model != "text-test" || step.ProjectID != "" {
		t.Fatal("creation silently switched models or bound a canvas")
	}
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
			for _, part := range creationMaps(message["content"]) {
				if image, ok := part["image_url"].(map[string]any); ok {
					imageURL = stringField(image, "url")
				}
			}
		}
		received <- imageURL
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"mock inspected actual uploaded pixels","tool_calls":[]}}]}`))
	}))
	defer server.Close()
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": server.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	stream := false
	input.TextOptions.Stream = &stream
	raw, _ := json.Marshal(input)
	result, err := s.processCanvasGenerationTask(context.Background(), "user", "", "canvas_text", "", string(raw))
	if err != nil {
		t.Fatal(err)
	}
	if got := <-received; got != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(pixels) {
		t.Fatal("Pi downstream worker did not send exact authorized image bytes")
	}
	encoded, _ := json.Marshal(result)
	if err := db.Model(&model.Task{}).Where("id = ?", step.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestCreationImageInputHonorsModelScopeAndLimits(t *testing.T) {
	for _, test := range []struct {
		name      string
		vision    bool
		count     int
		maxImages int
		maxBytes  int64
		wanted    int
		note      string
	}{
		{"text-only", false, 1, 2, 1 << 20, 0, "has_no_image_input"},
		{"count-limit", true, 2, 1, 1 << 20, 1, "image_count_exceeds_model_limit"},
		{"size-limit", true, 1, 2, 1, 0, "image_size_exceeds_model_limit"},
	} {
		t.Run(test.name, func(t *testing.T) {
			s, db, _ := cloudAgentVisionFixture(t)
			capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
			capability.Text.References.MaxImages, capability.Text.References.MaxImageBytes = test.maxImages, test.maxBytes
			if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, capability)).Error; err != nil {
				t.Fatal(err)
			}
			req := creationAgentRequest()
			req.VisionEnabled = test.vision
			for _, id := range []string{"ref-one", "ref-two"}[:test.count] {
				req.Attachments = append(req.Attachments, CloudAgentAttachment{ResourceID: id, StorageKey: "resource:" + id, Kind: "image", Role: "product", Name: id})
			}
			canonical := canonicalAgentRequest{Messages: []map[string]any{{"role": "user", "content": "describe"}}}
			refs, err := s.attachCloudAgentCreationImages("user", req, &canonical)
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := json.Marshal(canonical)
			if len(refs) != test.wanted || !strings.Contains(string(raw), test.note) {
				t.Fatalf("model scope/limit not represented honestly: refs=%d %s", len(refs), raw)
			}
			config := s.buildModelConfig("text-test", &cloudAgentRuntime{Request: req})
			if !test.vision && len(config["input"].([]string)) != 1 {
				t.Fatal("text-only Pi model advertised images")
			}
			if req.ChannelModelKey != "text-test" {
				t.Fatal("silently switched dialogue model")
			}
		})
	}
}

func TestCreationImageInputRejectsForeignAndUnselectedResources(t *testing.T) {
	s, _, _ := cloudAgentVisionFixture(t)
	req := creationAgentRequest()
	req.VisionEnabled = true
	req.Attachments = []CloudAgentAttachment{{ResourceID: "private", StorageKey: "resource:private", Kind: "image", Role: "product"}}
	canonical := canonicalAgentRequest{Messages: []map[string]any{{"role": "user", "content": "describe"}}}
	if _, err := s.attachCloudAgentCreationImages("user", req, &canonical); err == nil {
		t.Fatal("foreign resource exposed to dialogue")
	}
	req.Attachments[0].ResourceID, req.Attachments[0].StorageKey = "ref-one", "resource:ref-one"
	for _, source := range []string{"resource:ref-two", "data:image/png;base64,dGVzdA==", "https://untrusted.invalid/x.png"} {
		request := canonicalAgentRequest{Messages: []map[string]any{{"role": "user", "content": []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": source}}}}}}
		if _, err := s.attachCloudAgentCreationImages("user", req, &request); err == nil {
			t.Fatalf("unselected image input accepted: %s", source)
		}
	}
}

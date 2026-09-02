package protocol

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const (
	manifestContractStart            = "<!-- YINGCE_MANIFEST_CONTRACT_START -->"
	manifestContractEnd              = "<!-- YINGCE_MANIFEST_CONTRACT_END -->"
	manifestDocumentationPlaceholder = "<当前插件的完整 documentation，由 README.md 与 docs/interface.md 拼接而成；为避免 JSON 递归，此处不重复展开正文。>"
)

func TestOfficialProtocolPackagesAreSelfContainedDeclarativePlugins(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "..", "plugin-packages", "*.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) < 70 {
		t.Fatalf("official protocol packages = %d, want at least 70", len(paths))
	}
	providerOwners := map[string]string{}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		pkg, err := ParsePluginPackage(data)
		if err != nil {
			t.Fatalf("parse %s: %v", filepath.Base(path), err)
		}
		if len(pkg.Manifest.Contributes.PaymentProviders) > 0 {
			// Payment packages use the yingce.payment/v1 executable ABI rather than
			// the declarative AI provider contract covered by this catalog test.
			continue
		}
		if pkg.Manifest.APIVersion != "yingce.plugin/v2" {
			t.Fatalf("%s apiVersion = %q", filepath.Base(path), pkg.Manifest.APIVersion)
		}
		if strings.HasPrefix(strings.TrimSpace(pkg.Manifest.Runtime.Backend), "host:") {
			t.Fatalf("%s depends on host runtime", filepath.Base(path))
		}
		if len(pkg.Files["README.md"]) == 0 || len(pkg.Files["docs/interface.md"]) == 0 {
			t.Fatalf("%s must contain README.md and docs/interface.md", filepath.Base(path))
		}
		interfaceDocs := string(pkg.Files["docs/interface.md"])
		expectedDocumentation := strings.TrimSpace(string(pkg.Files["README.md"])) + "\n\n---\n\n" + strings.TrimSpace(interfaceDocs)
		if strings.TrimSpace(pkg.Manifest.Metadata.Documentation) != expectedDocumentation {
			t.Fatalf("%s manifest.documentation does not contain the packaged README and interface document", filepath.Base(path))
		}
		assertManifestContractMatchesPackage(t, filepath.Base(path), pkg.ManifestRaw, interfaceDocs)
		if !strings.Contains(interfaceDocs, "响应") {
			t.Fatalf("%s interface documentation must describe response mapping", filepath.Base(path))
		}
		for _, field := range pkg.Manifest.Configuration.Fields {
			if !strings.Contains(interfaceDocs, field.Name) {
				t.Fatalf("%s interface documentation is missing configuration field %q", filepath.Base(path), field.Name)
			}
		}
		adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil)
		if err != nil {
			t.Fatalf("load %s: %v", filepath.Base(path), err)
		}
		if len(adapters) != len(pkg.Manifest.Contributes.Providers) {
			t.Fatalf("%s adapters = %d, providers = %d", filepath.Base(path), len(adapters), len(pkg.Manifest.Contributes.Providers))
		}
		for _, provider := range pkg.Manifest.Contributes.Providers {
			if owner, duplicate := providerOwners[provider.ID]; duplicate {
				t.Fatalf("provider id %q is shared by %s and %s", provider.ID, owner, filepath.Base(path))
			}
			providerOwners[provider.ID] = filepath.Base(path)
			for _, parameter := range provider.Parameters {
				if strings.TrimSpace(parameter.Name) == "" || strings.TrimSpace(parameter.Type) == "" || strings.TrimSpace(parameter.Mapping) == "" || strings.TrimSpace(parameter.Description) == "" {
					t.Fatalf("%s provider %s has incomplete parameter documentation: %#v", filepath.Base(path), provider.ID, parameter)
				}
				if !strings.Contains(interfaceDocs, parameter.Name) {
					t.Fatalf("%s interface documentation is missing provider parameter %q", filepath.Base(path), parameter.Name)
				}
			}
		}
	}
}

func assertManifestContractMatchesPackage(t *testing.T, packageName string, manifestRaw []byte, interfaceDocs string) {
	t.Helper()
	start := strings.Index(interfaceDocs, manifestContractStart)
	end := strings.Index(interfaceDocs, manifestContractEnd)
	if start < 0 || end < start {
		t.Fatalf("%s interface documentation has no complete manifest contract", packageName)
	}
	contractSection := interfaceDocs[start:end]
	jsonStart := strings.Index(contractSection, "```json\n")
	if jsonStart < 0 {
		t.Fatalf("%s manifest contract has no JSON block", packageName)
	}
	jsonStart += len("```json\n")
	jsonEnd := strings.Index(contractSection[jsonStart:], "\n```")
	if jsonEnd < 0 {
		t.Fatalf("%s manifest contract JSON block is not terminated", packageName)
	}

	var actual map[string]any
	if err := json.Unmarshal(manifestRaw, &actual); err != nil {
		t.Fatalf("decode %s manifest: %v", packageName, err)
	}
	actual["documentation"] = manifestDocumentationPlaceholder
	var documented map[string]any
	if err := json.Unmarshal([]byte(contractSection[jsonStart:jsonStart+jsonEnd]), &documented); err != nil {
		t.Fatalf("decode %s documented manifest contract: %v", packageName, err)
	}
	if !reflect.DeepEqual(documented, actual) {
		t.Fatalf("%s documented manifest contract does not exactly match manifest.json", packageName)
	}
}

func TestOfficialAgentProfilesMapToolRequestsAndResponses(t *testing.T) {
	requests := map[string]any{
		"chatCompletion": map[string]any{"messages": []any{map[string]any{"role": "user", "content": "inspect"}}, "tools": []any{map[string]any{"type": "function"}}, "tool_choice": "required", "marker": "chat"},
		"responses":      map[string]any{"input": []any{map[string]any{"role": "user", "content": "inspect"}}, "tools": []any{map[string]any{"type": "function"}}, "tool_choice": "required", "marker": "responses"},
		"claude":         map[string]any{"messages": []any{map[string]any{"role": "user", "content": "inspect"}}, "tools": []any{map[string]any{"name": "canvas_get_state"}}, "tool_choice": map[string]any{"type": "any"}, "max_tokens": 512, "marker": "claude"},
		"gemini":         map[string]any{"contents": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": "inspect"}}}}, "tools": []any{map[string]any{"functionDeclarations": []any{}}}, "toolConfig": map[string]any{"functionCallingConfig": map[string]any{"mode": "ANY"}}, "marker": "gemini"},
	}
	tests := []struct {
		name, packageName, providerID, marker, wantPath, response, wantID, wantSignature string
	}{
		{
			name: "openai-chat", packageName: "openai-chat-completions.yingce-plugin", providerID: "chat-completion", marker: "chat", wantPath: "/chat/completions", wantID: "call-chat",
			response: `{"choices":[{"message":{"content":"chat answer","tool_calls":[{"id":"call-chat","function":{"name":"canvas_get_state","arguments":"{\"scope\":\"all\"}"}}]}}]}`,
		},
		{
			name: "openai-responses", packageName: "openai-responses.yingce-plugin", providerID: "openai-response", marker: "responses", wantPath: "/responses", wantID: "call-responses",
			response: `{"output_text":"responses answer","output":[{"type":"message"},{"type":"function_call","call_id":"call-responses","name":"canvas_get_state","arguments":"{\"scope\":\"all\"}"}]}`,
		},
		{
			name: "anthropic", packageName: "anthropic-messages.yingce-plugin", providerID: "claude-api", marker: "claude", wantPath: "/v1/messages", wantID: "call-claude",
			response: `{"content":[{"type":"text","text":"claude answer"},{"type":"tool_use","id":"call-claude","name":"canvas_get_state","input":{"scope":"all"}}]}`,
		},
		{
			name: "gemini", packageName: "google-gemini-generate-content.yingce-plugin", providerID: "gemini-generate-content", marker: "gemini", wantPath: "/v1beta/models/gemini-test:generateContent", wantSignature: "signature-1",
			response: `{"candidates":[{"content":{"parts":[{"text":"gemini answer"},{"functionCall":{"name":"canvas_get_state","args":{"scope":"all"}},"thoughtSignature":"signature-1"}]}}]}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			adapter := officialPackageAdapter(t, test.packageName, test.providerID)
			capability, ok := adapter.(AgentCapability)
			if !ok || !capability.AgentAvailable() {
				t.Fatalf("%s does not expose its declared agent operation", test.providerID)
			}
			agent, ok := adapter.(AgentAdapter)
			if !ok {
				t.Fatalf("%s does not implement AgentAdapter", test.providerID)
			}
			spec, err := agent.BuildAgent(context.Background(), AgentRequestContext{Model: "gemini-test", Request: requests})
			if err != nil {
				t.Fatal(err)
			}
			if spec.Path != test.wantPath {
				t.Fatalf("request path = %q, want %q", spec.Path, test.wantPath)
			}
			body := manifestTestBody(t, spec)
			if body["marker"] != test.marker {
				t.Fatalf("request selected wrong protocol body: %#v", body)
			}
			if test.providerID != "gemini-generate-content" && body["model"] != "gemini-test" {
				t.Fatalf("request model = %#v", body["model"])
			}
			result, err := agent.ParseAgent(context.Background(), []byte(test.response))
			if err != nil {
				t.Fatal(err)
			}
			if len(result.ToolCalls) != 1 || result.ToolCalls[0].Name != "canvas_get_state" || result.ToolCalls[0].Arguments != `{"scope":"all"}` {
				t.Fatalf("agent result = %#v", result)
			}
			if test.wantID != "" && result.ToolCalls[0].ID != test.wantID {
				t.Fatalf("tool call id = %q, want %q", result.ToolCalls[0].ID, test.wantID)
			}
			if test.wantID == "" && !strings.HasPrefix(result.ToolCalls[0].ID, "call_") {
				t.Fatalf("provider omitted tool call id and no stable id was synthesized: %#v", result.ToolCalls[0])
			}
			if result.ToolCalls[0].ThoughtSignature != test.wantSignature {
				t.Fatalf("thought signature = %q, want %q", result.ToolCalls[0].ThoughtSignature, test.wantSignature)
			}
		})
	}
}

func TestOfficialVideoProfilesPreserveExplicitMediaRoles(t *testing.T) {
	tests := []struct {
		packageName string
		providerID  string
		model       string
		resolution  string
		assert      func(t *testing.T, spec RequestSpec)
	}{
		{
			packageName: "minimax-hailuo-video-v2.yingce-plugin", providerID: "minimax-video", model: "MiniMax-H3", resolution: "1080P",
			assert: func(t *testing.T, spec RequestSpec) {
				body := manifestTestBody(t, spec)
				content, _ := body["content"].([]any)
				if len(content) != 3 {
					t.Fatalf("MiniMax content = %#v", content)
				}
				first, _ := content[1].(map[string]any)
				last, _ := content[2].(map[string]any)
				if first["role"] != "first_frame" || last["role"] != "last_frame" || body["ratio"] != "adaptive" || body["resolution"] != "1080P" {
					t.Fatalf("MiniMax role payload = %#v", body)
				}
			},
		},
		{
			packageName: "newapi-media-task-v1.yingce-plugin", providerID: "newapi-channel-1", model: "minimax-h3", resolution: "720P",
			assert: func(t *testing.T, spec RequestSpec) {
				body := manifestTestBody(t, spec)
				input, _ := body["input"].(map[string]any)
				media, _ := input["media"].([]any)
				first, _ := media[0].(map[string]any)
				last, _ := media[1].(map[string]any)
				if first["type"] != "first_frame" || last["type"] != "last_frame" {
					t.Fatalf("NewAPI media = %#v", media)
				}
			},
		},
		{
			packageName: "agnes-video-25.yingce-plugin", providerID: "agnes-video", model: "agnes-video-2.5", resolution: "720P",
			assert: func(t *testing.T, spec RequestSpec) {
				body := manifestTestBody(t, spec)
				if body["mode"] != "keyframe" || body["first_frame"] != "https://cdn.example/first.png" || body["last_frame"] != "https://cdn.example/last.png" {
					t.Fatalf("Agnes keyframe payload = %#v", body)
				}
			},
		},
		{
			packageName: "dashscope-wan-video.yingce-plugin", providerID: "dashscope-wan-video", model: "wan2.2-kf2v-flash", resolution: "720P",
			assert: func(t *testing.T, spec RequestSpec) {
				body := manifestTestBody(t, spec)
				input, _ := body["input"].(map[string]any)
				if input["first_frame_url"] != "https://cdn.example/first.png" || input["last_frame_url"] != "https://cdn.example/last.png" {
					t.Fatalf("Wan keyframe input = %#v", input)
				}
				if _, duplicated := input["img_url"]; duplicated {
					t.Fatalf("Wan keyframe input must not also send img_url: %#v", input)
				}
			},
		},
	}
	for _, test := range tests {
		t.Run(test.providerID, func(t *testing.T) {
			adapter := officialPackageAdapter(t, test.packageName, test.providerID)
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Model: test.model, Prompt: "镜头推进", Duration: 6, AspectRatio: "16:9", Resolution: test.resolution,
				Images: []MediaReference{
					{URL: "https://cdn.example/last.png", Role: "last_frame", Order: 2},
					{URL: "https://cdn.example/first.png", Role: "first_frame", Order: 1},
				},
			}})
			if err != nil {
				t.Fatal(err)
			}
			test.assert(t, spec)
		})
	}
}

func TestOfficialWanProfilesUseMutuallyExclusiveReferenceFields(t *testing.T) {
	video := officialPackageAdapter(t, "dashscope-wan-video.yingce-plugin", "dashscope-wan-video")
	videoSpec, err := video.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "wan2.6-r2v", Prompt: "保持角色一致", Operation: "reference_to_video",
		Images: []MediaReference{
			{URL: "https://cdn.example/second.png", Role: "subject_reference", Order: 2},
			{URL: "https://cdn.example/first.png", Role: "reference_image", Order: 1},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	videoBody := manifestTestBody(t, videoSpec)
	videoInput, _ := videoBody["input"].(map[string]any)
	if _, duplicated := videoInput["img_url"]; duplicated {
		t.Fatalf("Wan reference mode must not also send img_url: %#v", videoInput)
	}
	references, _ := videoInput["reference_images"].([]any)
	if len(references) != 2 || references[0] != "https://cdn.example/first.png" || references[1] != "https://cdn.example/second.png" {
		t.Fatalf("Wan reference_images = %#v", references)
	}

	image := officialPackageAdapter(t, "dashscope-wanx-image.yingce-plugin", "dashscope-wanx-image")
	for _, test := range []struct {
		name   string
		images []MediaReference
		single bool
	}{
		{name: "single", images: []MediaReference{{URL: "https://cdn.example/one.png", Role: "reference_image", Order: 1}}, single: true},
		{name: "multiple", images: []MediaReference{{URL: "https://cdn.example/two.png", Role: "reference_image", Order: 2}, {URL: "https://cdn.example/one.png", Role: "reference_image", Order: 1}}},
	} {
		t.Run("wanx-"+test.name, func(t *testing.T) {
			spec, err := image.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "wanx2.1-t2i-turbo", Prompt: "角色设定", Images: test.images}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			input, _ := body["input"].(map[string]any)
			_, hasSingle := input["ref_img"]
			_, hasMultiple := input["ref_images"]
			if hasSingle != test.single || hasMultiple == test.single {
				t.Fatalf("Wanx reference fields are not mutually exclusive: %#v", input)
			}
		})
	}
}

func TestOfficialRollDekWanVideoUsesVideosLifecycle(t *testing.T) {
	adapter := officialPackageAdapter(t, "rolldek-wan-video.yingce-plugin", "rolldek-wan-video")
	request := GenerationRequest{
		Model: "wan3.0-video-prime-1080p", Prompt: "保持角色一致", Duration: 11, AspectRatio: "16:9", Resolution: "1080p",
		Images: []MediaReference{{URL: "https://cdn.example/character.png", Role: "reference_image"}},
		Videos: []MediaReference{{URL: "https://cdn.example/motion.mp4", Role: "reference_video", Metadata: map[string]any{"durationMs": 5250}}},
		Audios: []MediaReference{{URL: "https://cdn.example/voice.mp3", Role: "reference_audio"}},
	}
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/videos" || create.ContentType != "application/json" {
		t.Fatalf("RollDek create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if body["model"] != request.Model || body["seconds"] != "11" || body["size"] != "1080P" || body["aspect_ratio"] != "16:9" {
		t.Fatalf("RollDek create body = %#v", body)
	}
	images, _ := body["reference_images"].([]any)
	image, _ := images[0].(map[string]any)
	videos, _ := body["reference_videos"].([]any)
	video, _ := videos[0].(map[string]any)
	audios, _ := body["reference_audios"].([]any)
	audio, _ := audios[0].(map[string]any)
	if image["url"] != request.Images[0].URL || image["role"] != "reference_image" || video["url"] != request.Videos[0].URL || video["duration"] != 5.25 || audio["url"] != request.Audios[0].URL {
		t.Fatalf("RollDek references = images:%#v videos:%#v audios:%#v", images, videos, audios)
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task-roll-1","task_id":"task-roll-1","status":"queued"}`))
	if err != nil {
		t.Fatal(err)
	}
	if created.TaskID != "task-roll-1" || created.Status != StatusPending {
		t.Fatalf("RollDek create result = %#v", created)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{Request: request, TaskID: created.TaskID})
	if err != nil {
		t.Fatal(err)
	}
	if poll.Method != "GET" || poll.Path != "/v1/videos/task-roll-1" {
		t.Fatalf("RollDek poll = %#v", poll)
	}
	state, err := adapter.ParsePoll(context.Background(), PollContext{Request: request, TaskID: created.TaskID}, []byte(`{"id":"task-roll-1","status":"completed","metadata":{"url":"https://cdn.example/result.mp4"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 || state.Result.Videos[0].URL != "https://cdn.example/result.mp4" {
		t.Fatalf("RollDek poll result = %#v", state)
	}
	resultAdapter, ok := adapter.(ResultAdapter)
	if !ok {
		t.Fatal("RollDek adapter does not expose result download")
	}
	result, err := resultAdapter.BuildResult(context.Background(), PollContext{Request: request, TaskID: created.TaskID})
	if err != nil {
		t.Fatal(err)
	}
	if result.Method != "GET" || result.Path != "/v1/videos/task-roll-1/content" {
		t.Fatalf("RollDek result = %#v", result)
	}
}

func TestOfficialOpenAIVideosDeclaresAuthenticatedResultDownload(t *testing.T) {
	adapter := officialPackageAdapter(t, "openai-videos.yingce-plugin", "newapi")
	capability, ok := adapter.(ResultCapability)
	if !ok || !capability.ResultAvailable() {
		t.Fatal("OpenAI Videos result operation is unavailable")
	}
	resultAdapter, ok := adapter.(ResultAdapter)
	if !ok {
		t.Fatal("OpenAI Videos does not implement ResultAdapter")
	}
	spec, err := resultAdapter.BuildResult(context.Background(), PollContext{Model: "sora-2", TaskID: "video-1"})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Method != "GET" || spec.Path != "/v1/videos/video-1/content" || spec.Headers["Accept"] != "video/mp4" || spec.Auth.Type != "bearer" {
		t.Fatalf("result request = %#v", spec)
	}
}

func officialPackageAdapter(t *testing.T, packageName, providerID string) Adapter {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", packageName))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, adapter := range adapters {
		if adapter.Metadata().ID == providerID {
			return adapter
		}
	}
	t.Fatalf("provider %s is missing from %s", providerID, packageName)
	return nil
}

func manifestTestBody(t *testing.T, spec RequestSpec) map[string]any {
	t.Helper()
	data, err := json.Marshal(spec.Body)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		t.Fatal(err)
	}
	return body
}

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

func TestOfficialAtlasCloudChatProfile(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "atlascloud-chat.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	provider := pkg.Manifest.Contributes.Providers[0]
	if provider.ID != "atlascloud-chat" || provider.BaseURL != "https://api.atlascloud.ai" || provider.Auth.Type != "bearer" {
		t.Fatalf("Atlas Cloud provider metadata = %#v", provider)
	}

	adapter := officialPackageAdapter(t, "atlascloud-chat.yingce-plugin", "atlascloud-chat")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:    "openai/gpt-5.6-luna",
		Messages: []Message{{Role: "user", Content: "hello"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Method != "POST" || spec.Path != "/v1/chat/completions" || body["model"] != "openai/gpt-5.6-luna" {
		t.Fatalf("Atlas Cloud request = %#v, body = %#v", spec, body)
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"choices":[{"message":{"content":"atlas ok"}}],"usage":{"total_tokens":3}}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || result.Result.Text != "atlas ok" {
		t.Fatalf("Atlas Cloud response = %#v", result)
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

func TestNewAPIVideoGenerationsParsesNestedTaskIDs(t *testing.T) {
	adapter := officialPackageAdapter(t, "newapi-video-generations-v1.yingce-plugin", "newapi-channel-2")
	tests := []struct {
		name    string
		payload string
		wantID  string
	}{
		{name: "snake case", payload: `{"data":{"task_id":"task-snake","status":"queued"}}`, wantID: "task-snake"},
		{name: "camel case", payload: `{"data":{"taskId":"task-camel","status":"queued"}}`, wantID: "task-camel"},
		{name: "nested upstream id wins over wrapper id", payload: `{"id":"49137","data":{"task_id":"task-upstream","status":"queued"}}`, wantID: "task-upstream"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			created, err := adapter.ParseCreate(context.Background(), []byte(test.payload))
			if err != nil {
				t.Fatal(err)
			}
			if created.TaskID != test.wantID || created.Status != StatusPending {
				t.Fatalf("created = %#v, want task ID %q and pending status", created, test.wantID)
			}
		})
	}
}

func TestNewAPIVideoGenerationsParsesNestedVideoResults(t *testing.T) {
	adapter := officialPackageAdapter(t, "newapi-video-generations-v1.yingce-plugin", "newapi-channel-2")
	tests := []struct {
		name    string
		payload string
	}{
		{name: "channel result URL", payload: `{"code":"success","data":{"task_id":"task-upstream","status":"SUCCESS","result_url":"https://cdn.example/channel-result.mp4"}}`},
		{name: "provider nested video URL", payload: `{"code":"success","data":{"task_id":"task-upstream","status":"SUCCESS","data":{"status":"completed","video_url":"https://cdn.example/provider-result.mp4"}}}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task-upstream"}, []byte(test.payload))
			if err != nil {
				t.Fatal(err)
			}
			if state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 {
				t.Fatalf("state = %#v, want one completed video", state)
			}
			if state.Result.Videos[0].URL == "" {
				t.Fatalf("video = %#v, want a result URL", state.Result.Videos[0])
			}
		})
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

// 系统指令必须真正到达上游：只映射 messages 的协议要收到 system 消息，
// 有独立 system 字段的协议要用该字段且不能在消息数组里重复发送。
func TestOfficialTextProtocolsDeliverInstructions(t *testing.T) {
	tests := []struct {
		name, packageName, providerID, messagesField, instructionField string
	}{
		{name: "openai-chat", packageName: "openai-chat-completions.yingce-plugin", providerID: "chat-completion", messagesField: "messages"},
		{name: "deepseek", packageName: "deepseek-chat.yingce-plugin", providerID: "deepseek-chat", messagesField: "messages"},
		{name: "atlascloud", packageName: "atlascloud-chat.yingce-plugin", providerID: "atlascloud-chat", messagesField: "messages"},
		{name: "openai-responses", packageName: "openai-responses.yingce-plugin", providerID: "openai-response", messagesField: "input", instructionField: "instructions"},
		{name: "anthropic", packageName: "anthropic-messages.yingce-plugin", providerID: "claude-api", messagesField: "messages", instructionField: "system"},
		{name: "gemini", packageName: "google-gemini-generate-content.yingce-plugin", providerID: "gemini-generate-content", messagesField: "contents", instructionField: "systemInstruction"},
	}
	const instructions = "只输出一个 JSON 对象"
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			adapter := officialPackageAdapter(t, test.packageName, test.providerID)
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Capability: CapabilityText, Model: "model-test", Prompt: "一句话故事", Instructions: instructions,
			}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			encodedMessages, err := json.Marshal(body[test.messagesField])
			if err != nil {
				t.Fatal(err)
			}
			carriesInstructions := strings.Contains(string(encodedMessages), instructions)
			if test.instructionField == "" {
				if !carriesInstructions {
					t.Fatalf("%s dropped the system instruction: %s", test.providerID, encodedMessages)
				}
				return
			}
			if carriesInstructions {
				t.Fatalf("%s duplicated the system instruction into %s: %s", test.providerID, test.messagesField, encodedMessages)
			}
			encodedInstruction, err := json.Marshal(body[test.instructionField])
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(encodedInstruction), instructions) {
				t.Fatalf("%s did not map the system instruction to %s: %s", test.providerID, test.instructionField, encodedInstruction)
			}
		})
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

func TestOfficialArkSeedreamMapsAspectRatioToPixelSize(t *testing.T) {
	adapter := officialPackageAdapter(t, "volcengine-ark-seedream.yingce-plugin", "volcengine-ark-image")
	tests := []struct {
		name, aspectRatio, wantSize string
	}{
		{name: "ratio maps to 2K pixels", aspectRatio: "1:1", wantSize: "2048x2048"},
		{name: "landscape ratio", aspectRatio: "16:9", wantSize: "2560x1440"},
		{name: "auto maps to 2k tier", aspectRatio: "auto", wantSize: "2k"},
		{name: "pixel size passes through", aspectRatio: "1920x1080", wantSize: "1920x1080"},
		{name: "tier passes through", aspectRatio: "4k", wantSize: "4k"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "doubao-seedream-5-0-260128", Prompt: "circle", AspectRatio: tt.aspectRatio}})
			if err != nil {
				t.Fatal(err)
			}
			if create.Path != "/api/v3/images/generations" {
				t.Fatalf("Seedream create = %#v", create)
			}
			if body := manifestTestBody(t, create); body["size"] != tt.wantSize {
				t.Fatalf("Seedream size = %#v, want %q", body["size"], tt.wantSize)
			}
		})
	}
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "doubao-seedream-5-0-260128", Prompt: "circle"}})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := manifestTestBody(t, create)["size"]; ok {
		t.Fatalf("Seedream must omit size when no ratio is requested")
	}
}

func TestOfficialGeminiImageMapsQualityToImageSize(t *testing.T) {
	adapter := officialPackageAdapter(t, "google-gemini-image.yingce-plugin", "gemini-image")
	tests := []struct {
		name, quality, wantSize string
		wantOmitted             bool
	}{
		{name: "4k becomes 4K", quality: "4k", wantSize: "4K"},
		{name: "high becomes 4K", quality: "high", wantSize: "4K"},
		{name: "2k becomes 2K", quality: "2k", wantSize: "2K"},
		{name: "1k becomes 1K", quality: "1k", wantSize: "1K"},
		{name: "video 720 omitted", quality: "720", wantOmitted: true},
		{name: "auto omitted", quality: "auto", wantOmitted: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Model: "gemini-3-pro-image-preview", Prompt: "landscape", AspectRatio: "16:9", Quality: tt.quality,
			}})
			if err != nil {
				t.Fatal(err)
			}
			if create.Path != "/v1beta/models/gemini-3-pro-image-preview:generateContent" {
				t.Fatalf("create path = %q", create.Path)
			}
			body := manifestTestBody(t, create)
			generationConfig, _ := body["generationConfig"].(map[string]any)
			if _, ok := generationConfig["candidateCount"]; ok {
				t.Fatalf("candidateCount must not be mapped from imageCount, got %#v", generationConfig["candidateCount"])
			}
			imageConfig, _ := generationConfig["imageConfig"].(map[string]any)
			if imageConfig["aspectRatio"] != "16:9" {
				t.Fatalf("aspectRatio = %#v", imageConfig["aspectRatio"])
			}
			if tt.wantOmitted {
				if imageConfig["imageSize"] != nil {
					t.Fatalf("imageSize should be omitted, got %#v", imageConfig["imageSize"])
				}
				return
			}
			if imageConfig["imageSize"] != tt.wantSize {
				t.Fatalf("imageSize = %#v, want %q", imageConfig["imageSize"], tt.wantSize)
			}
		})
	}
}

func TestOfficialGeminiImagePrefersQualityOverVideoResolution(t *testing.T) {
	adapter := officialPackageAdapter(t, "google-gemini-image.yingce-plugin", "gemini-image")
	tests := []struct {
		name, quality, resolution, wantSize string
		wantOmitted                         bool
	}{
		{name: "canvas 4k keeps imageSize when vquality is 720", quality: "4k", resolution: "720", wantSize: "4K"},
		{name: "empty quality still maps resolution 4k", quality: "", resolution: "4k", wantSize: "4K"},
		{name: "video 720 alone is omitted", quality: "", resolution: "720", wantOmitted: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Model: "gemini-3-pro-image-preview", Prompt: "landscape", AspectRatio: "16:9", Quality: tt.quality, Resolution: tt.resolution,
			}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, create)
			generationConfig, _ := body["generationConfig"].(map[string]any)
			imageConfig, _ := generationConfig["imageConfig"].(map[string]any)
			if tt.wantOmitted {
				if imageConfig["imageSize"] != nil {
					t.Fatalf("imageSize should be omitted, got %#v", imageConfig["imageSize"])
				}
				return
			}
			if imageConfig["imageSize"] != tt.wantSize {
				t.Fatalf("imageSize = %#v, want %q", imageConfig["imageSize"], tt.wantSize)
			}
		})
	}
}

func TestOfficialGrokImageMapsAspectAndResolution(t *testing.T) {
	adapter := officialPackageAdapter(t, "xai-grok-images.yingce-plugin", "grok-image")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "grok-imagine-image", Prompt: "a cat", AspectRatio: "1280x720", Quality: "high",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Path != "/v1/images/generations" {
		t.Fatalf("path = %q", create.Path)
	}
	body := manifestTestBody(t, create)
	if body["aspect_ratio"] != "16:9" || body["resolution"] != "2k" {
		t.Fatalf("body = %#v", body)
	}
	if _, ok := body["size"]; ok {
		t.Fatalf("size must be omitted: %#v", body)
	}
}

func TestOfficialJimengImageSplitsPixelSize(t *testing.T) {
	adapter := officialPackageAdapter(t, "volcengine-jimeng-image.yingce-plugin", "volcengine-jimeng-image")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "jimeng_t2i_v40", Prompt: "still", AspectRatio: "1024x768",
		Images: []MediaReference{{DataURL: "data:image/png;base64,aGVsbG8="}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, create)
	if body["width"] != float64(1024) || body["height"] != float64(768) {
		t.Fatalf("dimensions = %#v %#v", body["width"], body["height"])
	}
	binary, ok := body["binary_data_base64"].([]any)
	if !ok || len(binary) != 1 || binary[0] != "aGVsbG8=" {
		t.Fatalf("binary_data_base64 = %#v", body["binary_data_base64"])
	}
}

func TestOfficialOpenAIAudioUsesBinaryPayload(t *testing.T) {
	adapter := officialPackageAdapter(t, "openai-audio.yingce-plugin", "openai-audio")
	result, err := adapter.ParseCreate(context.Background(), []byte("ID3fake-mp3"))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Audios) != 1 {
		t.Fatalf("result = %#v", result)
	}
}

func TestOfficialOpenAIAudioSpeedDefaultsInvalidAndZeroValues(t *testing.T) {
	adapter := officialPackageAdapter(t, "openai-audio.yingce-plugin", "openai-audio")
	for _, test := range []struct {
		name  string
		value any
		want  float64
	}{
		{name: "invalid", value: "not-a-number", want: 1},
		{name: "zero", value: "0", want: 1},
		{name: "valid", value: "1.25", want: 1.25},
	} {
		t.Run(test.name, func(t *testing.T) {
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Model: "gpt-4o-mini-tts", Prompt: "hello", Extra: map[string]any{"audioSpeed": test.value},
			}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			if got := body["speed"]; !reflect.DeepEqual(got, test.want) {
				t.Fatalf("speed = %#v, want %v", got, test.want)
			}
		})
	}
}

package protocol

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestBuiltinCatalogContainsRequestedProtocols(t *testing.T) {
	registry := Builtins()
	expected := []string{
		"chat-completion", "openai-response", "claude-api",
		"openai-image", "grok-image", "volcengine-ark-image", "volcengine-jimeng-image", "gemini-image",
		"newapi", "newapi-channel-2", "xai-video", "volcengine-ark-video", "volcengine-jimeng-video", "gemini-veo", "novita-video", "minimax-video", "agnes-video",
	}
	for _, id := range expected {
		if _, ok := registry.Get(id); !ok {
			t.Fatalf("missing builtin protocol %q", id)
		}
	}
	if _, ok := registry.Resolve("openai-video"); !ok {
		t.Fatal("legacy OpenAI video alias was not registered")
	}
	available := registry.List(SurfaceUserCustomChannel, CapabilityVideo, false)
	var agnesAvailable bool
	for _, item := range available {
		if item.ID == "agnes-video" {
			agnesAvailable = true
			if !item.Enabled || !item.Installable || item.UnavailableReason != "" {
				t.Fatalf("Agnes metadata must be enabled: %#v", item)
			}
		}
	}
	if !agnesAvailable {
		t.Fatal("Agnes adapter was not selectable")
	}
	all := registry.List(SurfaceAdminSystemChannel, CapabilityVideo, true)
	var found bool
	for _, item := range all {
		if item.ID == "agnes-video" {
			found = true
			if !item.Enabled || item.UnavailableReason != "" {
				t.Fatalf("Agnes metadata must stay enabled: %#v", item)
			}
		}
	}
	if !found {
		t.Fatal("Agnes metadata was omitted from the administrator catalog")
	}
	if _, ok := registry.Get("autodl-comfyui"); ok {
		t.Fatal("AutoDL must be provided by the uploaded plugin package, not the host registry")
	}
}

func TestTextAdaptersMapRequestsAndResponses(t *testing.T) {
	cases := []struct {
		id   string
		path string
		body map[string]any
		resp string
		want string
	}{
		{"chat-completion", "/v1/chat/completions", map[string]any{"model": "gpt-test", "messages": []any{map[string]any{"role": "user", "content": "hello"}}}, `{"choices":[{"message":{"content":"chat answer"}}]}`, "chat answer"},
		{"openai-response", "/v1/responses", map[string]any{"model": "o-test", "input": "hello"}, `{"output_text":"response answer"}`, "response answer"},
		{"claude-api", "/v1/messages", map[string]any{"model": "claude-test", "max_tokens": float64(4096)}, `{"content":[{"type":"text","text":"claude answer"}]}`, "claude answer"},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			adapter, ok := Builtins().Get(tc.id)
			if !ok {
				t.Fatal("adapter missing")
			}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: tc.body["model"].(string), Prompt: "hello"}})
			if err != nil {
				t.Fatal(err)
			}
			if spec.Method != http.MethodPost || spec.Path != tc.path {
				t.Fatalf("request = %#v", spec)
			}
			body, _ := json.Marshal(spec.Body)
			var got map[string]any
			if err := json.Unmarshal(body, &got); err != nil {
				t.Fatal(err)
			}
			for key, value := range tc.body {
				if key == "messages" {
					continue
				}
				if got[key] == nil {
					t.Fatalf("request missing %q: %#v", key, got)
				}
				_ = value
			}
			result, err := adapter.ParseCreate(context.Background(), []byte(tc.resp))
			if err != nil {
				t.Fatal(err)
			}
			if result.Status != StatusSucceeded || result.Result == nil || result.Result.Text != tc.want {
				t.Fatalf("result = %#v", result)
			}
		})
	}
}

func TestClaudeAdapterDeclaresAnthropicVersion(t *testing.T) {
	adapter, _ := Builtins().Get("claude-api")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "claude-test", Prompt: "hello"}})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Headers["anthropic-version"] != "2023-06-01" {
		t.Fatalf("headers = %#v", spec.Headers)
	}
}

func TestImageAndVideoAdaptersMapProviderShapes(t *testing.T) {
	cases := []struct {
		id, path, poll string
		request        GenerationRequest
	}{
		{"openai-image", "/v1/images/generations", "", GenerationRequest{Model: "dall-e-test", Prompt: "a still", ImageCount: 2, AspectRatio: "1024x1024"}},
		{"grok-image", "/v1/images/generations", "", GenerationRequest{Model: "grok-imagine-image", Prompt: "a still", AspectRatio: "16:9"}},
		{"volcengine-ark-image", "/api/v3/images/generations", "", GenerationRequest{Model: "doubao-image", Prompt: "a still"}},
		{"volcengine-jimeng-image", "/CVSync2AsyncSubmitTask", "/CVSync2AsyncGetResult", GenerationRequest{Model: "jimeng_t2i_v40", Prompt: "a still"}},
		{"gemini-image", "/v1beta/models/gemini-image:generateContent", "", GenerationRequest{Model: "gemini-image", Prompt: "a still"}},
		{"newapi", "/v1/videos", "/v1/videos/video-1", GenerationRequest{Model: "video-model", Prompt: "a clip", Duration: 6}},
		{"newapi-channel-2", "/v1/video/generations", "/v1/video/generations/video-1", GenerationRequest{Model: "video-model", Prompt: "a clip", Duration: 6, AspectRatio: "16:9"}},
		{"xai-video", "/v1/videos/generations", "/v1/videos/video-1", GenerationRequest{Model: "grok-video", Prompt: "a clip"}},
		{"volcengine-ark-video", "/api/v3/contents/generations/tasks", "/api/v3/contents/generations/tasks/video-1", GenerationRequest{Model: "seedance", Prompt: "a clip"}},
		{"volcengine-jimeng-video", "/CVSync2AsyncSubmitTask", "/CVSync2AsyncGetResult", GenerationRequest{Model: "jimeng_video", Prompt: "a clip"}},
		{"gemini-veo", "/v1beta/models/veo-test:predictLongRunning", "/v1beta/operations/video-1", GenerationRequest{Model: "veo-test", Prompt: "a clip"}},
		{"novita-video", "/v3/video/create", "/v3/async/task-result?task_id=video-1", GenerationRequest{Model: "novita", Prompt: "a clip"}},
		{"minimax-video", "/v2/video_generation", "/v2/query/video_generation/video-1", GenerationRequest{Model: "MiniMax-H3", Prompt: "a clip"}},
		{"agnes-video", "/v1/videos", "/agnesapi?video_id=video-1&model_name=agnes-video-2.5", GenerationRequest{Model: "agnes-video-2.5", Prompt: "a clip", Duration: 5}},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			adapter, ok := Builtins().Get(tc.id)
			if !ok {
				t.Fatal("adapter missing")
			}
			create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: tc.request})
			if err != nil {
				t.Fatal(err)
			}
			if create.Path != tc.path {
				t.Fatalf("create path = %q, want %q", create.Path, tc.path)
			}
			if tc.poll != "" {
				poll, err := adapter.BuildPoll(context.Background(), PollContext{Model: tc.request.Model, TaskID: "video-1"})
				if err != nil {
					t.Fatal(err)
				}
				if poll.Path != tc.poll {
					t.Fatalf("poll path = %q, want %q", poll.Path, tc.poll)
				}
			}
		})
	}
}

func TestArkVideoAdapterMapsFullModalReferences(t *testing.T) {
	adapter, ok := Builtins().Get("volcengine-ark-video")
	if !ok {
		t.Fatal("adapter missing")
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:  "doubao-seedance-2-0-260128",
		Prompt: "follow all references",
		Images: []MediaReference{{URL: "https://example.com/subject.png"}},
		Videos: []MediaReference{{URL: "https://example.com/motion.mp4"}},
		Audios: []MediaReference{{URL: "https://example.com/music.mp3"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	content := body["content"].([]any)
	want := []string{"text", "image_url", "video_url", "audio_url"}
	if len(content) != len(want) {
		t.Fatalf("content = %#v", content)
	}
	for index, item := range content {
		if item.(map[string]any)["type"] != want[index] {
			t.Fatalf("content[%d] = %#v, want type %q", index, item, want[index])
		}
	}

	_, err = adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "doubao-seedance-2-0-260128", Prompt: "follow the soundtrack", Audios: []MediaReference{{URL: "https://example.com/music.mp3"}},
	}})
	if err == nil || !strings.Contains(err.Error(), "文本+音频") {
		t.Fatalf("audio-only combination error = %v", err)
	}
}

func TestAsyncVideoResponseNormalizesStatusAndResult(t *testing.T) {
	adapter, _ := Builtins().Get("minimax-video")
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"task":{"id":"mm-1","status":"processing"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if created.TaskID != "mm-1" || created.Status != StatusProcessing {
		t.Fatalf("created = %#v", created)
	}
	polled, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"task":{"id":"mm-1","status":"succeeded","content":{"url":"https://cdn.example/video.mp4"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	if polled.Status != StatusSucceeded || polled.Result == nil || len(polled.Result.Videos) != 1 || polled.Result.Videos[0].URL != "https://cdn.example/video.mp4" {
		t.Fatalf("polled = %#v", polled)
	}
}

func TestAgnesMapsOfficialCreateAndPollContracts(t *testing.T) {
	adapter, _ := Builtins().Get("agnes-video")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "agnes-video-2.5", Prompt: "use the first frame", Duration: 5, Resolution: "960P", AspectRatio: "16:9",
		Images: []MediaReference{{URL: "https://cdn.example/first.png"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := create.Body.(map[string]any)
	if create.Path != "/v1/videos" || body["mode"] != "keyframe" || body["seconds"] != "5" || body["size"] != "960P" || body["first_frame"] != "https://cdn.example/first.png" {
		t.Fatalf("create = %#v", create)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{Model: "agnes-video-2.5", TaskID: "video/1"})
	if err != nil {
		t.Fatal(err)
	}
	if !poll.OriginPath || poll.Path != "/agnesapi?video_id=video%2F1&model_name=agnes-video-2.5" {
		t.Fatalf("poll = %#v", poll)
	}
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task-1","video_id":"video-1","status":"queued"}`))
	if err != nil || created.TaskID != "video-1" || created.Status != StatusPending {
		t.Fatalf("created = %#v, err = %v", created, err)
	}
	completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "video-1"}, []byte(`{"video_id":"video-1","status":"completed","metadata":{"url":"https://cdn.example/result.mp4"}}`))
	if err != nil || completed.Status != StatusSucceeded || completed.Result == nil || completed.Result.Videos[0].URL != "https://cdn.example/result.mp4" {
		t.Fatalf("completed = %#v, err = %v", completed, err)
	}
	failed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "video-1"}, []byte(`{"video_id":"video-1","status":"failed","error":{"message":"quota exceeded"}}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "quota exceeded" {
		t.Fatalf("failed = %#v, err = %v", failed, err)
	}
}

func TestAgnesVideo25SeparatesHistoricalPixelSizeFromResolutionTier(t *testing.T) {
	adapter, _ := Builtins().Get("agnes-video")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "agnes-video-2.5", Prompt: "test", Duration: 5, Resolution: "720", AspectRatio: "1280x720",
	}})
	if err != nil {
		t.Fatalf("BuildCreate() error = %v", err)
	}
	body := create.Body.(map[string]any)
	if body["size"] != "720P" || body["aspect_ratio"] != "16:9" {
		t.Fatalf("Agnes normalized body = %#v", body)
	}
	if body["size"] == "1280x720" {
		t.Fatalf("Agnes size must be a resolution tier: %#v", body)
	}
}

func TestAgnesFlashRejectsUnsupportedOfficialInputs(t *testing.T) {
	adapter, _ := Builtins().Get("agnes-video")
	_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "agnes-video-2.5-flash", Prompt: "test", Duration: 5, Resolution: "2K"}})
	if err == nil || !strings.Contains(err.Error(), "720P") {
		t.Fatalf("resolution error = %v", err)
	}
	_, err = adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "agnes-video-2.5-flash", Prompt: "test", Duration: 5, Videos: []MediaReference{{URL: "https://cdn.example/reference.mp4"}}}})
	if err == nil || !strings.Contains(err.Error(), "不支持参考视频") {
		t.Fatalf("video error = %v", err)
	}
}

func TestAgnesVideo25UsesRequestedReferenceOperationForSingleImage(t *testing.T) {
	adapter, _ := Builtins().Get("agnes-video")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "agnes-video-2.5", Prompt: "use it as a style reference", Duration: 5, Resolution: "720P", AspectRatio: "16:9",
		Operation: "reference_to_video", Images: []MediaReference{{URL: "https://cdn.example/reference.png"}},
	}})
	if err != nil {
		t.Fatalf("BuildCreate() error = %v", err)
	}
	body := spec.Body.(map[string]any)
	if body["mode"] != "reference" || body["images"] == nil || body["first_frame"] != nil {
		t.Fatalf("Agnes reference body = %#v", body)
	}
}

func TestDeclarativeManifestMapsFieldsAndResponses(t *testing.T) {
	manifest := []byte(`{
			"apiVersion":"yingce.plugin/v1",
			"id":"example-video","version":"1.0.0","name":"Example Video","author":"Example","documentation":"# Example Video",
		"contributes":{"providers":[{"id":"example-video","label":"Example Video","capabilities":["video"],"scopes":["admin.system-channel","user.custom-channel"],"create":{"method":"POST","path":"/v1/tasks","fields":{"model":"request.model","input.prompt":"request.prompt","input.seconds":"request.duration"}},"poll":{"method":"GET","path":"/v1/tasks/{{taskId}}"},"response":{"taskIdPaths":["id","data.id"],"statusPaths":["status","data.status"],"resultPaths":["result.video_url","data.result.video_url"],"resultKind":"video"}}]}
	}`)
	adapter, err := LoadManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "example", Prompt: "hello", Duration: 5}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Path != "/v1/tasks" || create.Method != http.MethodPost {
		t.Fatalf("create = %#v", create)
	}
	body, _ := json.Marshal(create.Body)
	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	input := got["input"].(map[string]any)
	if input["prompt"] != "hello" || input["seconds"].(float64) != 5 {
		t.Fatalf("body = %#v", got)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{Model: "example", TaskID: "task-1"})
	if err != nil {
		t.Fatal(err)
	}
	if poll.Path != "/v1/tasks/task-1" {
		t.Fatalf("poll = %#v", poll)
	}
	result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task-1"}, []byte(`{"data":{"id":"task-1","status":"succeeded","result":{"video_url":"https://cdn.example/clip.mp4"}}}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Videos) != 1 || result.Result.Videos[0].URL != "https://cdn.example/clip.mp4" {
		t.Fatalf("result = %#v", result)
	}
}

func TestDeclarativeManifestSupportsMediaPathsTransformsAndErrors(t *testing.T) {
	manifest := []byte(`{
		"apiVersion":"yingce.plugin/v1",
		"id":"declarative-expression-test","version":"1.0.0","name":"Declarative Expression Test","author":"Test","documentation":"# Declarative Expression Test",
		"contributes":{"providers":[{"id":"declarative-expression-test","label":"Declarative Expression Test","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","fields":{"resolution":"request.resolution|lower","ref_image_0":"request.images.0.url","ref_image_1":"request.images.1.url"}},"response":{"errorPaths":["code"],"messagePaths":["msg"]}}]}
	}`)
	adapter, err := LoadManifest(manifest)
	if err != nil {
		t.Fatal(err)
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Resolution: "768P", Images: []MediaReference{{URL: "https://cdn.example/one.png"}}}})
	if err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if body["resolution"] != "768p" || body["ref_image_0"] != "https://cdn.example/one.png" {
		t.Fatalf("mapped body = %#v", body)
	}
	if _, exists := body["ref_image_1"]; exists {
		t.Fatalf("empty media path was not omitted: %#v", body)
	}
	failed, err := adapter.ParseCreate(context.Background(), []byte(`{"code":"RequestParameterIsWrong","msg":"invalid resolution"}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "invalid resolution" {
		t.Fatalf("failed response = %#v, err = %v", failed, err)
	}
}

func TestDeclarativeManifestRequiresDocumentation(t *testing.T) {
	manifest := Manifest{
		APIVersion: "v1",
		Metadata: Metadata{
			ID: "missing-docs", Version: "1.0.0", Name: "Missing Docs",
			Categories: []Capability{CapabilityVideo},
			Scopes:     []Surface{SurfaceAdminSystemChannel},
		},
		Create: ManifestOperation{Method: http.MethodPost, Path: "/v1/tasks"},
	}
	if err := ValidateManifest(manifest); err == nil {
		t.Fatal("manifest without documentation was accepted")
	}
}

func TestBuiltinDocumentationMatchesTextRequestShape(t *testing.T) {
	cases := []struct {
		id, mapping, requestField string
	}{
		{"chat-completion", "messages[0].content", `"messages"`},
		{"openai-response", "input", `"input"`},
		{"claude-api", "messages[0].content", `"messages"`},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			adapter, ok := Builtins().Get(tc.id)
			if !ok {
				t.Fatal("adapter missing")
			}
			metadata := adapter.Metadata()
			AttachDocumentation(&metadata)
			if !strings.Contains(metadata.Documentation, tc.mapping) || !strings.Contains(metadata.Documentation, tc.requestField) {
				t.Fatalf("documentation does not match request shape:\n%s", metadata.Documentation)
			}
		})
	}
}

func TestEveryBuiltinHasDetailedDocumentation(t *testing.T) {
	requiredSections := []string{"## 接口", "## 模型", "## 参数", "## 官方", "## 影策运行时合同"}
	for _, metadata := range Builtins().List("", "", true) {
		t.Run(metadata.ID, func(t *testing.T) {
			AttachDocumentation(&metadata)
			document := metadata.Documentation
			if len([]rune(document)) < 900 {
				t.Fatalf("documentation is too short: %d runes", len([]rune(document)))
			}
			for _, section := range requiredSections {
				if !strings.Contains(document, section) {
					t.Errorf("documentation is missing section %q", section)
				}
			}
			for _, operation := range []string{metadata.Create, metadata.Poll} {
				parts := strings.SplitN(operation, " ", 2)
				if len(parts) == 2 && !strings.Contains(document, parts[1]) {
					t.Errorf("documentation is missing operation path %q", parts[1])
				}
			}
			for _, parameter := range metadata.Parameters {
				if !strings.Contains(document, "`"+parameter.Name+"`") {
					t.Errorf("documentation is missing parameter %q", parameter.Name)
				}
			}
			if strings.Contains(document, "{{") {
				t.Errorf("documentation contains an unresolved template marker")
			}
		})
	}
}

func TestImageResponseKeepsBase64AsDataURL(t *testing.T) {
	adapter, _ := Builtins().Get("openai-image")
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"data":[{"b64_json":"aW1hZ2U="}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Result == nil || len(result.Result.Images) != 1 || result.Result.Images[0].URL != "" || result.Result.Images[0].DataURL != "data:image/png;base64,aW1hZ2U=" {
		t.Fatalf("images = %#v", result.Result)
	}
}

func TestAsyncMediaPollKeepsResultKind(t *testing.T) {
	cases := []struct {
		id, payload, want string
	}{
		{"volcengine-jimeng-image", `{"data":{"status":"completed","images":["https://cdn.example/image.png"]}}`, "image"},
		{"async-audio", `{"task":{"id":"audio-1","status":"completed","audio_url":"https://cdn.example/audio.mp3"}}`, "audio"},
		{"minimax-video", `{"task":{"id":"video-1","status":"succeeded","content":{"url":"https://cdn.example/video.mp4"}}}`, "video"},
	}
	for _, tc := range cases {
		t.Run(tc.id, func(t *testing.T) {
			adapter, _ := Builtins().Get(tc.id)
			result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "fallback"}, []byte(tc.payload))
			if err != nil {
				t.Fatal(err)
			}
			if result.Status != StatusSucceeded || result.Result == nil {
				t.Fatalf("result = %#v", result)
			}
			switch tc.want {
			case "image":
				if len(result.Result.Images) != 1 || len(result.Result.Videos) != 0 || len(result.Result.Audios) != 0 {
					t.Fatalf("media = %#v", result.Result)
				}
			case "audio":
				if len(result.Result.Audios) != 1 || len(result.Result.Images) != 0 || len(result.Result.Videos) != 0 {
					t.Fatalf("media = %#v", result.Result)
				}
			case "video":
				if len(result.Result.Videos) != 1 || len(result.Result.Images) != 0 || len(result.Result.Audios) != 0 {
					t.Fatalf("media = %#v", result.Result)
				}
			}
		})
	}
}

func TestGeminiVeoParsesLongRunningOperation(t *testing.T) {
	adapter, _ := Builtins().Get("gemini-veo")
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"name":"operations/veo-1"}`))
	if err != nil {
		t.Fatal(err)
	}
	if created.TaskID != "operations/veo-1" || created.Status != StatusPending {
		t.Fatalf("created = %#v", created)
	}

	result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{
		"name":"operations/veo-1",
		"done":true,
		"response":{"generateVideoResponse":{"generatedSamples":[{"video":{"uri":"https://cdn.example/veo.mp4"}}]}}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Videos) != 1 || result.Result.Videos[0].URL != "https://cdn.example/veo.mp4" {
		t.Fatalf("result = %#v", result)
	}
}

func TestAsyncMediaPollRejectsUnsupportedCapability(t *testing.T) {
	if _, err := parseAsyncMediaPoll(PollContext{TaskID: "task-1"}, map[string]any{"status": "completed"}, CapabilityText); err == nil {
		t.Fatal("text capability was accepted by async media parser")
	}
}

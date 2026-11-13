package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func dramaReferenceProviderInput(interfaceType string, images []providerMedia, bindings ...dramaReferenceBinding) canvasGenerationInput {
	return canvasGenerationInput{
		Mode: "video", Prompt: "参考图1：人物\n参考图2：场景\n\n@参考图1走入参考图 2。",
		Config:          providerConfig{InterfaceType: interfaceType, Model: "seedance-2.0", VideoSeconds: "5", Size: "9:16", VQuality: "720p"},
		ReferenceImages: images,
		Metadata:        map[string]any{dramaReferenceBindingsKey: bindings, "videoEditOperation": "reference_to_video"},
	}
}

func buildDramaReferenceSpec(t *testing.T, input canvasGenerationInput, request protocol.GenerationRequest) protocol.RequestSpec {
	t.Helper()
	adapter, ok := loadOfficialFallbackRegistry().Resolve(input.Config.InterfaceType)
	if !ok {
		t.Fatalf("missing official adapter %s", input.Config.InterfaceType)
	}
	spec, err := adapter.BuildCreate(context.Background(), protocol.RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	return spec
}

func TestProviderDramaReferenceOfficialPayloads(t *testing.T) {
	for _, test := range []struct {
		protocol   string
		model      string
		first      bool
		shift      bool
		prefix     string
		resolution string
	}{
		{protocol: "newapi-channel-2", first: true, shift: true},
		{protocol: "volcengine-ark-video", first: true},
		{protocol: "volcengine-ark-agent-plan-video", first: true},
		{protocol: "newapi-channel-1", first: true},
		{protocol: "xai-video", model: "grok-imagine-video"},
		{protocol: "agnes-video", model: "agnes-video-2.5"},
		{protocol: "km-kemei-video"},
		{protocol: "dashscope-minimax-video", model: "MiniMax/MiniMax-H3", resolution: "768P"},
		{protocol: "minimax-video", model: "MiniMax-H3"},
		{protocol: "metaso-h3", model: "MiniMax-H3"},
		{protocol: "volcengine-jimeng-video"},
		{protocol: "dashscope-wan3-video", model: "wan3.0-video-prime"},
		{protocol: "dashscope-wan-video"},
		{protocol: "rolldek-wan-video"},
		{protocol: "lxmone-wan-videos"},
		{protocol: "lxmone-wan-channel-s"},
		{protocol: "lxmone-seedance-videos"},
		{protocol: "lxmone-h3-max-videos"},
		{protocol: "lxmone-sd-videos"},
		{protocol: "lxmone-grok-videos"},
		{protocol: "lxmone-h3-workflow"},
		{protocol: "seedance-videos-compatible"},
		{protocol: "maxforai-videos", prefix: "@image"},
		{protocol: "maxforai-video-generations", prefix: "@image"},
	} {
		t.Run(test.protocol, func(t *testing.T) {
			images := []providerMedia{{ID: "hero", URL: "https://media.example/hero.png"}, {ID: "scene", URL: "https://media.example/scene.png"}}
			if test.first {
				images = append([]providerMedia{{ID: "first-frame", Role: "first_frame", URL: "https://media.example/frame.png"}}, images...)
			}
			input := dramaReferenceProviderInput(test.protocol, images, dramaReferenceBinding{"参考图1", "hero"}, dramaReferenceBinding{"参考图2", "scene"})
			if test.model != "" {
				input.Config.Model = test.model
			}
			if test.resolution != "" {
				input.Config.VQuality = test.resolution
			}
			if test.first {
				input.Metadata["videoEditOperation"] = "image_to_video"
				input.Metadata["videoStartFrameNodeId"] = "first-frame"
			}
			request := protocolRequestFromInput(input)
			spec := buildDramaReferenceSpec(t, input, request)
			before, _ := json.Marshal(spec.Body)
			if err := compileDramaReferenceRequest(input, request, &spec, test.protocol); err != nil {
				t.Fatal(err)
			}
			body := spec.Body.(map[string]any)
			layout, err := dramaReferenceRequestLayout(body, spec.Files, test.protocol)
			if err != nil {
				t.Fatal(err)
			}
			prefix := firstNonEmpty(test.prefix, "参考图")
			first, second := 1, 2
			if test.shift {
				first, second = 2, 3
			}
			want := fmt.Sprintf("%s%d：人物\n%s%d：场景\n\n%s%d走入%s%d。", prefix, first, prefix, second, prefix, first, prefix, second)
			if got := layout.promptBody[layout.promptKey]; got != want {
				t.Fatalf("actual payload prompt = %q, want %q", got, want)
			}
			// 编译只能改正文；媒体、角色、时长、画幅与声音等字段原样保留。
			layout.promptBody[layout.promptKey] = input.Prompt
			after, _ := json.Marshal(spec.Body)
			if string(before) != string(after) {
				t.Fatalf("non-prompt payload changed: before=%s after=%s", before, after)
			}
		})
	}
}

func TestProviderDramaReferenceActualOrderAndMultiDigitReplacement(t *testing.T) {
	images := make([]providerMedia, 10)
	bindings := make([]dramaReferenceBinding, 10)
	for i := range images {
		id := fmt.Sprintf("asset-%d", i+1)
		images[i] = providerMedia{ID: id, URL: "https://media.example/" + id + ".png"}
		bindings[i] = dramaReferenceBinding{fmt.Sprintf("参考图%d", i+1), id}
	}
	input := dramaReferenceProviderInput("newapi-channel-2", images, bindings...)
	input.Prompt = "@参考图1牵着参考图 2，背景是参考图10。"
	request := protocolRequestFromInput(input)
	request.Images[0].Order, request.Images[1].Order, request.Images[9].Order = 10, 0, 1
	spec := buildDramaReferenceSpec(t, input, request)
	if err := compileDramaReferenceRequest(input, request, &spec, input.Config.InterfaceType); err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if body["prompt"] != "参考图10牵着参考图1，背景是参考图2。" {
		t.Fatalf("must rewrite once from actual adapter order: %+v", body)
	}
	urls := body["image_urls"].([]any)
	if urls[0] != images[1].URL || urls[1] != images[9].URL || urls[9] != images[0].URL {
		t.Fatalf("unexpected actual image order: %v", urls)
	}
}

func TestProviderDramaReferenceFramesAndMixedMediaDoNotConsumeArkNumbers(t *testing.T) {
	input := dramaReferenceProviderInput("volcengine-ark-video", []providerMedia{
		{ID: "tail", Role: "last_frame", URL: "https://media.example/tail.png"},
		{ID: "hero", URL: "https://media.example/shared.png"},
		{ID: "first-frame", Role: "first_frame", URL: "https://media.example/shared.png"},
		{ID: "scene", URL: "https://media.example/scene.png"},
	}, dramaReferenceBinding{"参考图1", "hero"}, dramaReferenceBinding{"参考图2", "scene"})
	input.Metadata["videoEditOperation"] = "image_to_video"
	input.Metadata["videoStartFrameNodeId"] = "first-frame"
	input.Metadata["videoEndFrameNodeId"] = "tail"
	input.ReferenceVideos = []providerMedia{{ID: "video", URL: "https://media.example/video.mp4"}}
	input.ReferenceAudios = []providerMedia{{ID: "audio", URL: "https://media.example/audio.mp3"}}
	request := protocolRequestFromInput(input)
	spec := buildDramaReferenceSpec(t, input, request)
	if err := compileDramaReferenceRequest(input, request, &spec, input.Config.InterfaceType); err != nil {
		t.Fatal(err)
	}
	content := spec.Body.(map[string]any)["content"].([]any)
	if content[0].(map[string]any)["text"] != "参考图1：人物\n参考图2：场景\n\n参考图1走入参考图2。" || len(content) != 7 {
		t.Fatalf("frame/video/audio numbering: %+v", content)
	}
}

func TestProviderDramaReferenceDuplicateURLsRequireEveryBoundImage(t *testing.T) {
	input := dramaReferenceProviderInput("newapi-channel-2", []providerMedia{
		{ID: "hero", URL: "https://media.example/shared.png"},
		{ID: "scene", URL: "https://media.example/shared.png"},
	}, dramaReferenceBinding{"参考图1", "hero"}, dramaReferenceBinding{"参考图2", "scene"})
	request := protocolRequestFromInput(input)
	spec := buildDramaReferenceSpec(t, input, request)
	if err := compileDramaReferenceRequest(input, request, &spec, input.Config.InterfaceType); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(spec.Body.(map[string]any)["prompt"].(string), "参考图1走入参考图2") {
		t.Fatalf("duplicate URLs collapsed asset identities: %+v", spec.Body)
	}
	spec = buildDramaReferenceSpec(t, input, request)
	body, _ := requestAsMap(spec.Body)
	body["image_urls"] = []any{input.ReferenceImages[0].URL}
	spec.Body = body
	if err := compileDramaReferenceRequest(input, request, &spec, input.Config.InterfaceType); err == nil || !strings.Contains(err.Error(), "参考图2 未包含") {
		t.Fatalf("dropping a duplicate must reject the missing binding: %v", err)
	}
}

func TestProviderDramaReferenceMini1UsesUploadedIDsAndProviderTokens(t *testing.T) {
	input := dramaReferenceProviderInput("seedance-mini1", []providerMedia{{ID: "hero", URL: "https://media.example/hero.png"}}, dramaReferenceBinding{"参考图2", "hero"})
	input.Prompt = "参考图2：人物\n@参考图2起身。"
	request := protocolRequestFromInput(input)
	request.Images[0].Metadata[protocol.MediaUploadIDKey] = "https://upload.example/hero-id.png"
	spec := buildDramaReferenceSpec(t, input, request)
	if err := compileDramaReferenceRequest(input, request, &spec, input.Config.InterfaceType); err != nil {
		t.Fatal(err)
	}
	body := spec.Body.(map[string]any)
	if body["prompt"] != "@Image1：人物\n@Image1起身。" || body["reference_images"].([]any)[0] != "https://upload.example/hero-id.png" {
		t.Fatalf("uploaded ID/token mapping = %+v", body)
	}
	input.VideoCapability = &VideoCapabilityConfig{References: VideoReferenceConfig{PromptMaxChars: utf8.RuneCountInString(input.Prompt)}}
	spec = buildDramaReferenceSpec(t, input, request)
	if err := compileDramaReferenceRequest(input, request, &spec, input.Config.InterfaceType); err == nil || !strings.Contains(err.Error(), "最多") {
		t.Fatalf("provider token expansion must obey prompt limit: %v", err)
	}
}

func TestProviderDramaReferenceLegacySeedanceCountsActualFrameArray(t *testing.T) {
	for _, first := range []bool{false, true} {
		input := dramaReferenceProviderInput("legacy", []providerMedia{{ID: "hero", URL: "https://media.example/hero.png"}}, dramaReferenceBinding{"参考图2", "hero"})
		input.Prompt = "参考图2起身。"
		want := "参考图1起身。"
		if first {
			input.ReferenceImages = append(input.ReferenceImages, providerMedia{ID: "first-frame", URL: "https://media.example/frame.png", Role: "first_frame"})
			input.Metadata["videoEditOperation"] = "image_to_video"
			input.Metadata["videoStartFrameNodeId"] = "first-frame"
			want = "参考图2起身。"
		}
		body, err := seedanceVideosRequestBody(input)
		if err != nil {
			t.Fatal(err)
		}
		if body.Prompt != want || (first && body.ImageURLs[0] != input.ReferenceImages[1].URL) {
			t.Fatalf("first=%v payload=%+v want prompt=%q", first, body, want)
		}
	}
}

func TestProviderDramaReferenceMissingOrUnknownLayoutRejectsBeforeCreate(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	input := dramaReferenceProviderInput("newapi", []providerMedia{
		{ID: "hero", URL: "https://media.example/hero.png"},
		{ID: "scene", URL: "https://media.example/scene.png"},
	}, dramaReferenceBinding{"参考图1", "hero"}, dramaReferenceBinding{"参考图2", "scene"})
	input.Config.BaseURL = server.URL
	if _, err := runVideoTaskForTest(context.Background(), input); err == nil || !strings.Contains(err.Error(), "参考图2 未包含") {
		t.Fatalf("official adapter silently dropping second image must fail: %v", err)
	}
	input.Config.InterfaceType = "seedance-mini1"
	input.ReferenceImages = input.ReferenceImages[:1]
	if _, err := runVideoTaskForTest(context.Background(), input); err == nil || !strings.Contains(err.Error(), "参考图2 没有") {
		t.Fatalf("missing input must fail before media upload: %v", err)
	}
	if requests != 0 {
		t.Fatalf("invalid references made %d upstream requests", requests)
	}
	input.Config.InterfaceType = "custom-unknown"
	input.Prompt = "参考图1起身。"
	uploader, ok := loadOfficialFallbackRegistry().Resolve("coolhs-wan3-relay")
	if !ok {
		t.Fatal("WAN adapter unavailable")
	}
	if _, err := runProtocolAdapterTaskWithPolicy(context.Background(), input, uploader, fastVideoPollPolicy()); err == nil || !strings.Contains(err.Error(), "更换协议") || requests != 0 {
		t.Fatalf("unknown numbering contract must fail before upload: requests=%d err=%v", requests, err)
	}
	request := protocolRequestFromInput(input)
	spec := protocol.RequestSpec{Body: map[string]any{"prompt": input.Prompt, "images": []any{input.ReferenceImages[0].URL}}}
	if err := compileDramaReferenceRequest(input, request, &spec, input.Config.InterfaceType); err == nil || !strings.Contains(err.Error(), "更换协议") {
		t.Fatalf("unknown layout must not guess numbering: %v", err)
	}
	delete(input.Metadata, dramaReferenceBindingsKey)
	before, _ := json.Marshal(spec)
	if err := compileDramaReferenceRequest(input, request, &spec, input.Config.InterfaceType); err != nil {
		t.Fatal(err)
	}
	after, _ := json.Marshal(spec)
	if string(before) != string(after) {
		t.Fatalf("ordinary canvas request changed: %s != %s", before, after)
	}
}

func TestProviderDramaReferenceHTTPPayloadUsesCompiledPrompt(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var captured map[string]any
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "POST /v1/video/generations":
			if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
				t.Error(err)
			}
			_, _ = w.Write([]byte(`{"task_id":"compiled-video","status":"queued"}`))
		case "GET /v1/video/generations/compiled-video":
			_, _ = fmt.Fprintf(w, `{"task_id":"compiled-video","status":"SUCCESS","result_url":%q}`, server.URL+"/video.mp4")
		case "GET /video.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			t.Errorf("unexpected upstream request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	input := dramaReferenceProviderInput("newapi-channel-2", []providerMedia{
		{ID: "first-frame", Role: "first_frame", URL: "https://media.example/frame.png"},
		{ID: "hero", URL: "https://media.example/hero.png"},
		{ID: "scene", URL: "https://media.example/scene.png"},
	}, dramaReferenceBinding{"参考图1", "hero"}, dramaReferenceBinding{"参考图2", "scene"})
	input.Config.BaseURL = server.URL
	input.Metadata["videoEditOperation"] = "image_to_video"
	input.Metadata["videoStartFrameNodeId"] = "first-frame"
	if _, err := runVideoTaskForTest(context.Background(), input); err != nil {
		t.Fatal(err)
	}
	if captured["prompt"] != "参考图2：人物\n参考图3：场景\n\n参考图2走入参考图3。" {
		t.Fatalf("HTTP received wrong prompt: %+v", captured)
	}
	want := []any{"https://media.example/frame.png", "https://media.example/hero.png", "https://media.example/scene.png"}
	if !reflect.DeepEqual(captured["image_urls"], want) {
		t.Fatalf("HTTP received wrong image order: %+v", captured)
	}
	if input.Prompt != "参考图1：人物\n参考图2：场景\n\n@参考图1走入参考图 2。" {
		t.Fatal("provider compilation mutated stored editing prompt")
	}
}

func TestProviderDramaReferenceWANUploadPreservesExplicitMediaToken(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var captured map[string]any
	uploads := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "POST /api/portal/media":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Error(err)
				w.WriteHeader(http.StatusBadRequest)
				return
			}
			defer r.MultipartForm.RemoveAll()
			kind := r.FormValue("kind")
			uploads = append(uploads, kind)
			_, _ = fmt.Fprintf(w, `{"id":%q}`, "uploaded-"+kind)
		case "POST /api/portal/jobs":
			if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
				t.Error(err)
			}
			_, _ = w.Write([]byte(`{"id":"wan-job","wait":{"phase":"queued","label":"候车"}}`))
		default:
			t.Errorf("unexpected WAN request %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	input := dramaReferenceProviderInput("coolhs-wan3-relay", []providerMedia{{ID: "cast:hero", Name: "参考图2", DataURL: testReferenceImageDataURL}}, dramaReferenceBinding{"参考图2", "cast:hero"})
	input.Prompt = "参考图2：人物\n@参考图2起身。"
	input.Config.BaseURL = server.URL
	input.ReferenceVideos = []providerMedia{{ID: "video", DataURL: "data:video/mp4;base64,dmlkZW8="}}
	input.ReferenceAudios = []providerMedia{{ID: "audio", DataURL: "data:audio/mpeg;base64,YXVkaW8="}}
	_, err := runVideoTaskForTest(context.Background(), input)
	if pending, ok := err.(providerStatePendingError); !ok || !pending.Detached || pending.TaskID != "wan-job" {
		t.Fatalf("WAN should submit once then wait for its original task: %v", err)
	}
	if !reflect.DeepEqual(uploads, []string{"image", "video", "audio"}) {
		t.Fatalf("media upload must not repeat for inputs: %v", uploads)
	}
	if captured["prompt"] != "参考图2：人物\n参考图2起身。" {
		t.Fatalf("explicit media token must survive positional compaction: %+v", captured)
	}
	media := captured["media"].([]any)
	image := media[0].(map[string]any)
	if image["id"] != "uploaded-image" || image["token"] != "参考图2" || image["role"] != "ref" || len(media) != 3 {
		t.Fatalf("actual uploaded media binding = %+v", media)
	}
}

func TestDramaReferencePreviewNamesUnsentImageAndKeepsLogicalLabels(t *testing.T) {
	svc, fake := newDramaTestService(t)
	settings := DramaSettings{Models: fakeDramaModels}
	settings.AspectRatio = "9:16"
	casts := map[string]model.DramaCast{
		"missing": {ID: "missing", Name: "甲", Kind: "character", Appearance: "黑发", ImageStatus: model.DramaMediaFailed},
		"ready":   {ID: "ready", Name: "乙", Kind: "character", ImageStatus: model.DramaMediaReady, ImageResourceID: fake.resource("usr-drama", "image", "image/png")},
	}
	draft := dramaSegmentDraft{view: DramaSegmentView{DurationMs: 5000, Request: DramaSegmentRequest{References: []DramaSegmentReference{
		{Label: "参考图1", CastID: "missing", Name: "甲"},
		{Label: "参考图2", CastID: "ready", Name: "乙"},
	}}}}
	segment := model.DramaSegment{VideoPrompt: "@参考图2起身。"}
	preview, refs, _, err := svc.prepareDramaSegment(settings, draft, segment, nil, casts)
	if err != nil {
		t.Fatal(err)
	}
	if len(refs) != 1 || refs[0].(map[string]any)["id"] != "cast:ready" || preview.References[1].Label != "参考图2" || !preview.References[1].Sent {
		t.Fatalf("stable logical labels and media identity: preview=%+v refs=%+v", preview, refs)
	}
	if strings.Contains(preview.Header, "参考图1") || !strings.Contains(preview.Header, "参考图2：乙") {
		t.Fatalf("unsent image cannot create a provider reference label: %q", preview.Header)
	}
	input := dramaReferenceProviderInput("newapi-channel-2", []providerMedia{{ID: "cast:ready", URL: "https://media.example/ready.png"}}, dramaReferenceBindings(preview.References)...)
	input.Prompt = preview.Header + "\n\n" + segment.VideoPrompt
	request := protocolRequestFromInput(input)
	spec := buildDramaReferenceSpec(t, input, request)
	if err := compileDramaReferenceRequest(input, request, &spec, input.Config.InterfaceType); err != nil {
		t.Fatal(err)
	}
	compiled := spec.Body.(map[string]any)["prompt"].(string)
	if !strings.Contains(compiled, "参考图1：乙") || !strings.Contains(compiled, "参考图1起身") || strings.Contains(compiled, "参考图2") {
		t.Fatalf("missing image did not compact provider numbering: %q", compiled)
	}
	segment.VideoPromptOverride = "@参考图1和参考图2一起起身。"
	preview, _, _, err = svc.prepareDramaSegment(settings, draft, segment, nil, casts)
	if err == nil || !strings.Contains(err.Error(), "参考图1（甲）") || !strings.Contains(preview.Warning, "未附图") {
		t.Fatalf("preview and submission must reject the named missing image: warning=%q err=%v", preview.Warning, err)
	}
}

func TestDramaReferenceSubmissionCarriesBindingsAndRejectsMissingImages(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, project, 24)
	requests := dramaVideoRequests(fake)
	if len(requests) == 0 {
		t.Fatal("fixture did not submit any video")
	}
	for _, request := range requests {
		metadata := request.Input["metadata"].(map[string]any)
		data, err := json.Marshal(metadata[dramaReferenceBindingsKey])
		if err != nil {
			t.Fatal(err)
		}
		var bindings []dramaReferenceBinding
		if err := json.Unmarshal(data, &bindings); err != nil || len(bindings) == 0 {
			t.Fatalf("submission lost reference bindings: %s %v", data, err)
		}
		images := request.Input["referenceImages"].([]any)
		for _, binding := range bindings {
			found := false
			for _, raw := range images {
				image := raw.(map[string]any)
				if image["id"] == binding.MediaID && image["name"] == binding.Label && strings.HasPrefix(binding.MediaID, "cast:") {
					found = true
				}
			}
			if !found {
				t.Fatalf("binding does not follow submitted media identity: %+v %+v", binding, images)
			}
		}
	}
	summary, err := svc.DramaSummary("usr-drama", project)
	if err != nil {
		t.Fatal(err)
	}
	episode := summary.Episodes[0].ID
	detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode)
	if err != nil {
		t.Fatal(err)
	}
	reference := detail.Segments[0].Request.References[0]
	if err := fake.db.Model(&model.DramaCast{}).Where("id = ?", reference.CastID).Updates(map[string]any{"image_status": model.DramaMediaFailed, "image_resource_id": ""}).Error; err != nil {
		t.Fatal(err)
	}
	prompt := reference.Label + "起身。"
	if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{VideoPromptOverride: &prompt}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.GenerateDramaSegments("usr-drama", project, episode, GenerateDramaSegmentsRequest{Segments: []int{0}}); err != nil {
		t.Fatal(err)
	}
	before := fake.byKind["video"]
	runDramaTicks(t, svc, project, 4)
	detail, err = svc.DramaEpisodeDetail("usr-drama", project, episode)
	if err != nil {
		t.Fatal(err)
	}
	if fake.byKind["video"] != before || !strings.Contains(detail.Segments[0].Request.Warning, reference.Label+"（"+reference.Name+"）") {
		t.Fatalf("missing image was silently submitted: before=%d after=%d warning=%q", before, fake.byKind["video"], detail.Segments[0].Request.Warning)
	}
}

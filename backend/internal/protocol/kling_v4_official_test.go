package protocol

import (
	"slices"
	"strings"
	"testing"
)

func TestKlingV4OfficialRoutesAndReceipts(t *testing.T) {
	const provider = "kling-v4-official"
	adapter := officialPackageAdapter(t, provider+".yingce-plugin", provider)
	image := MediaReference{URL: "https://cdn.example.org/image.jpg", Kind: "image", MIMEType: "image/jpeg", Role: "first_frame", Metadata: map[string]any{"bytes": 120000, "width": 1280, "height": 720}}
	reference, last := image, image
	reference.Role, last.Role = "reference_image", "last_frame"
	for _, tc := range []struct {
		model, path, resolution string
		images                  []MediaReference
		valid                   bool
	}{
		{"kling-4.0", "text-to-video", "1080p", nil, true},
		{"kling-4.0", "image-to-video", "1080p", []MediaReference{image, last}, true},
		{"kling-4.0", "omni-video", "1080p", []MediaReference{reference}, true},
		{"kling-4.0-flash", "image-to-video", "720p", []MediaReference{image}, true},
		{"kling-4.0-flash", "omni-video", "720p", []MediaReference{reference}, true},
		{"kling-4.0-flash", "image-to-video", "720p", []MediaReference{image, last}, false},
		{"kling-4.0-flash", "text-to-video", "1080p", nil, false},
	} {
		request, err := adapter.BuildCreate(t.Context(), RequestContext{Request: GenerationRequest{Model: tc.model, Images: tc.images, Prompt: "全景", Duration: 10, Resolution: tc.resolution, AspectRatio: "16:9"}})
		if !tc.valid {
			if err == nil {
				t.Errorf("accepted invalid %s %s", tc.model, tc.path)
			}
			continue
		}
		if err != nil {
			t.Fatalf("%s/%s: %v", tc.path, tc.model, err)
		}
		if request.Method != "POST" || request.Path != "/"+tc.path+"/"+tc.model {
			t.Errorf("unexpected route: %s %s", request.Method, request.Path)
		}
		settings := manifestTestBody(t, request)["settings"].(map[string]any)
		if _, ok := settings["aspect_ratio"]; ok == (tc.path == "image-to-video") {
			t.Errorf("%s settings: %v", tc.path, settings)
		}
	}
	created, err := adapter.ParseCreate(t.Context(), []byte(`{"code":0,"request_id":"trace","data":{"id":"video-1","status":"submitted"}}`))
	if err != nil || created.TaskID != "video-1" || created.Status != StatusPending {
		t.Fatalf("receipt=%v error=%v", created, err)
	}
	missing, err := adapter.ParseCreate(t.Context(), []byte(`{"code":0,"request_id":"trace","data":{"status":"submitted"}}`))
	if err == nil && (missing.TaskID != "" || missing.Status != StatusFailed) {
		t.Fatalf("accepted tracing ID: %v", missing)
	}
	state, err := adapter.ParsePoll(t.Context(), PollContext{TaskID: created.TaskID}, []byte(`{"code":0,"request_id":"poll-trace","data":[{"id":"other","status":"failed"},{"id":"video-1","status":"succeeded","outputs":[{"type":"video","url":"https://cdn.example.org/result.mp4"}]}]}`))
	if err != nil || state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 || state.Result.Videos[0].URL != "https://cdn.example.org/result.mp4" || !state.Result.Videos[0].Ephemeral {
		t.Fatalf("poll=%v err=%v", state, err)
	}
}

func TestKlingV4DocumentedCreateBodies(t *testing.T) {
	const provider = "kling-v4-official"
	adapter := officialPackageAdapter(t, provider+".yingce-plugin", provider)
	image := MediaReference{Kind: "image", MIMEType: "image/jpeg", URL: "https://cdn.example.org/first.jpg", Role: "first_frame", Metadata: map[string]any{"bytes": 180000, "width": 1280, "height": 720}}
	middle, last, reference := image, image, image
	middle.Role, last.Role, reference.Role = "middle_frame", "last_frame", "reference_image"
	middle.URL, last.URL, reference.URL = "https://cdn.example.org/middle.jpg", "https://cdn.example.org/last.jpg", "https://cdn.example.org/reference.jpg"
	video := MediaReference{Kind: "video", Role: "reference_video", MIMEType: "video/mp4", URL: "https://cdn.example.org/feature.mp4", Metadata: map[string]any{"bytes": 1100000, "width": 1280, "height": 720, "fps": 24, "durationMs": 8000}}
	base := video
	base.Role, base.URL = "base_video", "https://cdn.example.org/base.mp4"
	element := map[string]any{"element_id": "upstream-element", "id": "actor", "elementType": "multi_image_elements"}
	voice := map[string]any{"voice_id": "upstream-voice", "id": "speaker"}
	for _, model := range []string{"kling-4.0", "kling-4.0-flash"} {
		t.Run(model, func(t *testing.T) {
			for _, ratio := range []string{"21:9", "16:9", "9:16", "1:1", "4:3", "3:4"} {
				request := GenerationRequest{Model: model, Operation: "text_to_video", Prompt: "生成 15 秒的海边日出", AspectRatio: ratio}
				post, err := adapter.BuildCreate(t.Context(), RequestContext{Request: request})
				if err != nil {
					t.Fatal(err)
				}
				body := manifestTestBody(t, post)
				settings := body["settings"].(map[string]any)
				if post.Path != "/text-to-video/"+model || post.Auth.Type != "bearer" || body["prompt"] != request.Prompt || body["contents"] != nil || settings["aspect_ratio"] != ratio || settings["duration"] != nil {
					t.Fatalf("%s: %v", post.Path, body)
				}
			}
			frames := []MediaReference{last, image, middle}
			wantTypes := []string{"prompt", "first_frame", "middle_frame", "last_frame"}
			if model == "kling-4.0-flash" {
				frames, wantTypes = []MediaReference{image}, []string{"prompt", "first_frame"}
			}
			post, err := adapter.BuildCreate(t.Context(), RequestContext{Request: GenerationRequest{Model: model, Operation: "image_to_video", Prompt: "关键帧", Images: frames, AspectRatio: "3:4", Duration: 12}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, post)
			settings := body["settings"].(map[string]any)
			contents := body["contents"].([]any)
			if post.Path != "/image-to-video/"+model || len(contents) != len(wantTypes) || settings["aspect_ratio"] != nil || settings["audio"] != nil || manifestInt(settings["duration"]) != 12 {
				t.Fatal(body)
			}
			for index, item := range contents {
				if item.(map[string]any)["type"] != wantTypes[index] {
					t.Fatal(contents)
				}
			}
			if model == "kling-4.0-flash" && contents[1].(map[string]any)["id"] != nil {
				t.Fatal(contents)
			}
			options := map[string]any{"audio": "original", "imageIds": []string{"frame", "scene"}, "videoIds": []string{"motion", "edit"}, "elements": []any{element}}
			wantTypes = []string{"prompt", "first_frame", "refer_image", "feature_video", "base_video", "element"}
			if model == "kling-4.0" {
				options["voices"], options["audio"] = []any{voice}, "native"
				wantTypes = append(wantTypes, "voice")
			}
			post, err = adapter.BuildCreate(t.Context(), RequestContext{Request: GenerationRequest{Model: model, Operation: "reference_to_video", Prompt: "参考 @scene、@motion 与 @actor", Images: []MediaReference{image, reference}, Videos: []MediaReference{video, base}, ProviderOptions: map[string]map[string]any{provider: options}, AspectRatio: "adaptive"}})
			if err != nil {
				t.Fatal(err)
			}
			body = manifestTestBody(t, post)
			contents = body["contents"].([]any)
			settings = body["settings"].(map[string]any)
			if post.Path != "/omni-video/"+model || len(contents) != len(wantTypes) || settings["audio"] != options["audio"] || settings["aspect_ratio"] != "adaptive" || settings["duration"] != nil {
				t.Fatal(body)
			}
			for index, item := range contents {
				if item.(map[string]any)["type"] != wantTypes[index] {
					t.Fatal(contents)
				}
			}
			if contents[2].(map[string]any)["id"] != "scene" || contents[3].(map[string]any)["url"] != video.URL || contents[4].(map[string]any)["id"] != "edit" || contents[5].(map[string]any)["element_id"] != "upstream-element" || contents[5].(map[string]any)["elementType"] != nil {
				t.Fatal(contents)
			}
		})
	}
	invalid := []GenerationRequest{
		{Operation: "text_to_video", Images: []MediaReference{reference}}, {Operation: "image_to_video", Videos: []MediaReference{video}}, {Operation: "reference_to_video"},
		{AspectRatio: "adaptive"}, {Prompt: strings.Repeat("英", 5501) + strings.Repeat("a", 13000)}, {Model: "kling-4.0-flash", Duration: 21},
		{Model: "kling-4.0-flash", Images: []MediaReference{middle}}, {Model: "kling-4.0-flash", Videos: []MediaReference{video, video, video}},
		{Images: slices.Repeat([]MediaReference{reference}, 11)}, {Videos: []MediaReference{base, base}},
		{ProviderOptions: map[string]map[string]any{provider: {"audio": "original", "voices": []any{voice}}}, Videos: []MediaReference{video}},
		{Model: "kling-4.0-flash", ProviderOptions: map[string]map[string]any{provider: {"voices": []any{voice}}}},
		{Images: []MediaReference{reference, reference}, ProviderOptions: map[string]map[string]any{provider: {"imageIds": []string{"duplicate", "duplicate"}}}},
		{Videos: []MediaReference{video}, ProviderOptions: map[string]map[string]any{provider: {"contents": []any{}}}},
		{Audios: []MediaReference{{Kind: "audio", URL: "https://cdn.example.org/audio.mp3"}}},
	}
	for index, request := range invalid {
		if request.Model == "" {
			request.Model = "kling-4.0"
		}
		if request.Prompt == "" {
			request.Prompt = "校验"
		}
		if _, err := adapter.BuildCreate(t.Context(), RequestContext{Request: request}); err == nil {
			t.Errorf("accepted invalid case %d", index)
		}
	}
}

func TestKlingV4PollMatchesTaskAndUsage(t *testing.T) {
	adapter := officialPackageAdapter(t, "kling-v4-official.yingce-plugin", "kling-v4-official")
	poll := PollContext{TaskID: "task-2", Request: GenerationRequest{Watermark: true}}
	spec, err := adapter.BuildPoll(t.Context(), poll)
	if err != nil || spec.Method != "GET" || spec.Path != "/tasks" || !slices.Equal(spec.Query["task_ids"], []string{poll.TaskID}) {
		t.Fatalf("%+v, %v", spec, err)
	}
	payload := `{"code":0,"request_id":"trace","data":[{"id":"other","status":"failed"},{"id":"task-2","status":"succeeded","usage":{"input_duration":"8.03","output_duration":"15"},"outputs":[{"type":"image","url":"https://cdn.example.org/poster.png"},{"type":"video","url":"https://cdn.example.org/plain.mp4","watermark_url":"https://cdn.example.org/marked.mp4"}]}]}`
	state, err := adapter.ParsePoll(t.Context(), poll, []byte(payload))
	if err != nil || state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 || state.Result.Videos[0].URL != "https://cdn.example.org/marked.mp4" || state.Result.Usage["input_duration"] != "8.03" || state.Result.Usage["output_duration"] != "15" {
		t.Fatalf("%+v %v", state, err)
	}
	for _, broken := range []string{`{"code":0,"data":[]}`, `{"code":0,"data":[{"id":"other","status":"succeeded"}]}`, `{"code":0,"data":[{"id":"task-2","status":"succeeded","outputs":[]}]}`, `{"code":0,"data":[{"id":"task-2","status":"unknown"}]}`, `{"code":123,"message":"quota","data":[]}`} {
		state, err := adapter.ParsePoll(t.Context(), poll, []byte(broken))
		if err == nil && state.Status != StatusFailed {
			t.Fatalf("accepted response: %s", broken)
		}
	}
}

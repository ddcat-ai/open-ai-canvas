package protocol

import (
	"context"
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"
)

func heyrouteAdapter(t *testing.T) Adapter {
	return heyrouteAdapterFor(t, "heyroute-video")
}

func heyrouteAdapterFor(t *testing.T, id string) Adapter {
	t.Helper()
	data, err := os.ReadFile("../../../plugin-packages/heyroute-video-v1.yingce-plugin")
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
	if len(adapters) != 2 {
		t.Fatalf("unexpected providers: %#v", adapters)
	}
	for _, adapter := range adapters {
		if adapter.Metadata().ID == id {
			return adapter
		}
	}
	t.Fatalf("missing provider %s", id)
	return nil
}

func heyrouteBody(t *testing.T, adapter Adapter, request GenerationRequest) map[string]any {
	t.Helper()
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://heyroute.ai/v1", Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if err := spec.Validate(); err != nil {
		t.Fatal(err)
	}
	if spec.Method != "POST" || spec.Path != "/v1/videos" || spec.ContentType != "application/json" || spec.Auth.Type != "bearer" || spec.Auth.Field != "apiKey" {
		t.Fatalf("wrong transport contract: %#v", spec)
	}
	encoded, err := json.Marshal(spec.Body)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(encoded, &body); err != nil {
		t.Fatal(err)
	}
	return body
}

func heyrouteRequest(model string) GenerationRequest {
	return GenerationRequest{Capability: CapabilityVideo, Model: model, Prompt: "A paper boat floating in a pond"}
}

func heyrouteOptions(values map[string]any) map[string]map[string]any {
	return map[string]map[string]any{"heyroute-video": values}
}

func TestHeyrouteAllModels(t *testing.T) {
	adapter := heyrouteAdapter(t)
	for _, tc := range []struct {
		model, seconds, resolution string
		minimal                    bool
	}{
		{"grok-imagine-video", "8", "480p", false},
		{"grok-imagine-video-1.5", "8", "480p", false},
		{"grok-video", "6", "", true},
		{"minimax-h3-quantized-768p", "4", "", true},
		{"minimax-h3-original-768p", "4", "", true},
		{"minimax-h3-original-1080p", "4", "", true},
		{"minimax-h3-original-cf-2k", "4", "", true},
		{"MiniMax-H3", "4", "480p", false},
		{"seedance-2.5", "4", "720p", false},
		{"seedance-2.0", "15", "480p", false},
		{"seedance-2.0-fast", "15", "480p", false},
	} {
		t.Run(tc.model, func(t *testing.T) {
			body := heyrouteBody(t, adapter, heyrouteRequest(tc.model))
			if body["model"] != tc.model || body["seconds"] != tc.seconds {
				t.Fatalf("wrong model or duration: %#v", body)
			}
			if tc.minimal && len(body) != 3 {
				t.Fatalf("fixed line must only send model/prompt/seconds: %#v", body)
			}
			if !tc.minimal && (body["resolution"] != tc.resolution || body["ratio"] != "auto" || body["generate_audio"] != false) {
				t.Fatalf("wrong options: %#v", body)
			}
			if _, ok := body["duration"]; ok {
				t.Fatal("must send seconds, not duration")
			}
		})
	}
}

func TestHeyrouteReferencesAndExplicitFalse(t *testing.T) {
	adapter := heyrouteAdapter(t)
	t.Run("single scalar data URI", func(t *testing.T) {
		r := heyrouteRequest("grok-imagine-video")
		r.Images = []MediaReference{{DataURL: "data:image/png;base64,AA==", Role: "first_frame"}}
		body := heyrouteBody(t, adapter, r)
		if body["input_reference"] != r.Images[0].DataURL || body["generate_audio"] != false {
			t.Fatalf("wrong reference or false lost: %#v", body)
		}
	})
	t.Run("one original video scalar", func(t *testing.T) {
		r := heyrouteRequest("minimax-h3-original-1080p")
		r.Videos = []MediaReference{{URL: "https://example.com/source.mp4"}}
		body := heyrouteBody(t, adapter, r)
		if body["input_reference"] != r.Videos[0].URL || len(body) != 4 {
			t.Fatalf("wrong scalar: %#v", body)
		}
	})
	t.Run("reference roles", func(t *testing.T) {
		r := heyrouteRequest("MiniMax-H3")
		r.Images = []MediaReference{{URL: "https://example.com/person.png", Role: "subject_reference"}}
		r.Videos = []MediaReference{{URL: "https://example.com/motion.mp4"}}
		r.Audios = []MediaReference{{URL: "https://example.com/music.mp3"}}
		body := heyrouteBody(t, adapter, r)
		for kind, role := range map[string]string{"images": "reference_image", "videos": "reference_video", "audios": "reference_audio"} {
			items := body[kind].([]any)
			if items[0].(map[string]any)["role"] != role {
				t.Fatalf("wrong %s role: %#v", kind, items)
			}
		}
		if _, ok := body["input_reference"]; ok {
			t.Fatal("typed references must not be duplicated")
		}
	})
	t.Run("ordered transitions", func(t *testing.T) {
		r := heyrouteRequest("seedance-2.5")
		r.Images = []MediaReference{{URL: "https://example.com/b.png", Order: 2}, {URL: "https://example.com/a.png", Order: 1}}
		body := heyrouteBody(t, heyrouteAdapterFor(t, "heyroute-video-sequential"), r)
		if !reflect.DeepEqual(body["input_reference"], []any{"https://example.com/a.png", "https://example.com/b.png"}) {
			t.Fatalf("wrong ordering: %#v", body)
		}
		if _, ok := body["images"]; ok {
			t.Fatal("sequential references duplicated in images")
		}
	})
	t.Run("first last adaptive", func(t *testing.T) {
		r := heyrouteRequest("seedance-2.5")
		r.Images = []MediaReference{{URL: "https://example.com/start.png", Role: "first_frame"}, {URL: "https://example.com/end.png", Role: "last_frame"}}
		body := heyrouteBody(t, adapter, r)
		if _, ok := body["ratio"]; ok {
			t.Fatal("frame ratio must be left to upstream")
		}
		if body["images"].([]any)[1].(map[string]any)["role"] != "last_frame" {
			t.Fatal("last frame role lost")
		}
	})
	t.Run("explicit audio true", func(t *testing.T) {
		r := heyrouteRequest("seedance-2.0")
		r.GenerateAudio = true
		body := heyrouteBody(t, adapter, r)
		if body["generate_audio"] != true {
			t.Fatalf("lost explicit values: %#v", body)
		}
	})
	t.Run("seed zero and shots", func(t *testing.T) {
		r := heyrouteRequest("seedance-2.0")
		r.ProviderOptions = heyrouteOptions(map[string]any{"seed": 0, "negative_prompt": "blur", "shots": []any{map[string]any{"prompt": "wide", "duration": 6}, map[string]any{"prompt": "close", "duration": 9}}})
		body := heyrouteBody(t, adapter, r)
		if body["seed"] != float64(0) || len(body["shots"].([]any)) != 2 {
			t.Fatalf("advanced values lost: %#v", body)
		}
	})
}

func TestHeyrouteRejectsInvalidOrUnimplementedCombinations(t *testing.T) {
	adapter := heyrouteAdapter(t)
	image := MediaReference{URL: "https://example.com/i.png"}
	video := MediaReference{URL: "https://example.com/v.mp4"}
	audio := MediaReference{URL: "https://example.com/a.mp3"}
	for _, tc := range []struct {
		name, model string
		change      func(*GenerationRequest)
	}{
		{"unknown model", "minimax-h3", func(r *GenerationRequest) {}},
		{"empty prompt", "grok-video", func(r *GenerationRequest) { r.Prompt = " " }},
		{"negative duration", "grok-video", func(r *GenerationRequest) { r.Duration = -1 }},
		{"grok unsupported duration", "grok-video", func(r *GenerationRequest) { r.Duration = 8 }},
		{"grok image", "grok-video", func(r *GenerationRequest) { r.Images = []MediaReference{image} }},
		{"grok 1080 downgrade", "grok-imagine-video", func(r *GenerationRequest) { r.Resolution = "1080p" }},
		{"grok unsupported ratio", "grok-imagine-video", func(r *GenerationRequest) { r.AspectRatio = "21:9" }},
		{"grok reference video", "grok-imagine-video", func(r *GenerationRequest) { r.Videos = []MediaReference{video} }},
		{"grok seed", "grok-imagine-video", func(r *GenerationRequest) { r.ProviderOptions = heyrouteOptions(map[string]any{"seed": 0}) }},
		{"quantized over 10", "minimax-h3-quantized-768p", func(r *GenerationRequest) { r.Duration = 11 }},
		{"quantized video", "minimax-h3-quantized-768p", func(r *GenerationRequest) { r.Videos = []MediaReference{video} }},
		{"original mixed input", "minimax-h3-original-768p", func(r *GenerationRequest) { r.Images = []MediaReference{image}; r.Videos = []MediaReference{video} }},
		{"fixed 2k landscape", "minimax-h3-original-cf-2k", func(r *GenerationRequest) { r.AspectRatio = "16:9" }},
		{"unverified audio switch", "minimax-h3-original-768p", func(r *GenerationRequest) { r.GenerateAudio = true }},
		{"h3 audio only", "MiniMax-H3", func(r *GenerationRequest) { r.Audios = []MediaReference{audio} }},
		{"h3 >9 images", "MiniMax-H3", func(r *GenerationRequest) {
			for i := 0; i < 10; i++ {
				r.Images = append(r.Images, image)
			}
		}},
		{"last without first", "seedance-2.5", func(r *GenerationRequest) {
			image.Role = "last_frame"
			r.Images = []MediaReference{image}
			image.Role = ""
		}},
		{"frames mixed with audio", "seedance-2.5", func(r *GenerationRequest) {
			image.Role = "first_frame"
			r.Images = []MediaReference{image}
			image.Role = ""
			r.Audios = []MediaReference{audio}
		}},
		{"frame forced ratio", "seedance-2.5", func(r *GenerationRequest) {
			image.Role = "first_frame"
			r.Images = []MediaReference{image}
			image.Role = ""
			r.AspectRatio = "16:9"
		}},
		{"seedance 2.0 duration", "seedance-2.0", func(r *GenerationRequest) { r.Duration = 8 }},
		{"seedance 2.0 combined >15", "seedance-2.0", func(r *GenerationRequest) {
			for i := 0; i < 8; i++ {
				r.Images = append(r.Images, image)
				r.Videos = append(r.Videos, video)
			}
		}},
		{"seedance 2.0 negative seed", "seedance-2.0-fast", func(r *GenerationRequest) { r.ProviderOptions = heyrouteOptions(map[string]any{"seed": -1}) }},
		{"fractional seed", "seedance-2.5", func(r *GenerationRequest) { r.ProviderOptions = heyrouteOptions(map[string]any{"seed": 1.5}) }},
		{"bad shot total", "seedance-2.0", func(r *GenerationRequest) {
			r.ProviderOptions = heyrouteOptions(map[string]any{"shots": []any{map[string]any{"prompt": "one", "duration": 5}, map[string]any{"prompt": "two", "duration": 5}}})
		}},
		{"wrong negative prompt model", "seedance-2.5", func(r *GenerationRequest) {
			r.ProviderOptions = heyrouteOptions(map[string]any{"negative_prompt": "blur"})
		}},
		{"unknown option", "seedance-2.5", func(r *GenerationRequest) { r.ProviderOptions = heyrouteOptions(map[string]any{"model": "grok-video"}) }},
		{"raw body bypass", "seedance-2.5", func(r *GenerationRequest) {
			r.ProviderOptions = heyrouteOptions(map[string]any{"body": map[string]any{"seconds": 100}})
		}},
		{"edit pending billing integration", "seedance-2.5", func(r *GenerationRequest) { r.Operation = "edit"; r.Videos = []MediaReference{video} }},
		{"extend pending billing integration", "seedance-2.5", func(r *GenerationRequest) {
			r.ProviderOptions = heyrouteOptions(map[string]any{"omni_reference_task_type": "extend"})
		}},
		{"sequential mixed video", "seedance-2.5", func(r *GenerationRequest) {
			r.ProviderOptions = heyrouteOptions(map[string]any{"inputMode": "sequential"})
			r.Images = []MediaReference{image}
			r.Videos = []MediaReference{video}
		}},
		{"watermark", "seedance-2.5", func(r *GenerationRequest) { r.Watermark = true }},
		{"mask", "seedance-2.5", func(r *GenerationRequest) { image.Role = "mask"; r.Images = []MediaReference{image}; image.Role = "" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := heyrouteRequest(tc.model)
			tc.change(&r)
			_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r})
			if err == nil || !strings.Contains(err.Error(), "Heyroute") {
				t.Fatalf("expected actionable validation failure, got %v", err)
			}
		})
	}
}

func TestHeyrouteAsyncLifecycle(t *testing.T) {
	adapter := heyrouteAdapter(t)
	ctx := context.Background()
	created, err := adapter.ParseCreate(ctx, []byte(`{"task_id":"task_example","status":"queued"}`))
	if err != nil || created.TaskID != "task_example" || created.Status != StatusPending {
		t.Fatalf("create: %#v %v", created, err)
	}
	poll := PollContext{TaskID: created.TaskID, Model: "seedance-2.5", Request: heyrouteRequest("seedance-2.5")}
	spec, err := adapter.BuildPoll(ctx, poll)
	if err != nil || spec.Path != "/v1/videos/task_example" || spec.Auth.Type != "bearer" || spec.Body != nil {
		t.Fatalf("poll: %#v %v", spec, err)
	}
	for _, tc := range []struct {
		name, data string
		status     Status
		outputs    int
	}{
		{"pending URL not complete", `{"status":"in_progress","video_url":"https://example.com/not-ready.mp4"}`, StatusProcessing, 0},
		{"success", `{"status":"completed","video_url":"https://example.com/result.mp4"}`, StatusSucceeded, 1},
		{"success without URL needs content", `{"status":"completed"}`, StatusSucceeded, 0},
		{"failed", `{"status":"failed","error":{"message":"moderated"}}`, StatusFailed, 0},
		{"business error", `{"status":"queued","error":{"code":"denied","message":"not enabled"}}`, StatusFailed, 0},
		{"unknown status", `{"status":"unexpected"}`, StatusFailed, 0},
		{"missing status", `{}`, StatusFailed, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r, err := adapter.ParsePoll(ctx, poll, []byte(tc.data))
			if err != nil || r.Status != tc.status || r.TaskID != "task_example" {
				t.Fatalf("poll parse: %#v %v", r, err)
			}
			n := 0
			if r.Result != nil {
				n = len(r.Result.Videos)
			}
			if n != tc.outputs {
				t.Fatalf("unexpected result: %#v", r)
			}
			if n > 0 && !r.Result.Videos[0].Ephemeral {
				t.Fatal("signed result must be ephemeral")
			}
		})
	}
	result, err := adapter.(ResultAdapter).BuildResult(ctx, poll)
	if err != nil || result.Path != "/v1/videos/task_example/content" || result.Auth.Type != "bearer" {
		t.Fatalf("content: %#v %v", result, err)
	}
	if adapter.Metadata().Cancel != "" {
		t.Fatal("must not advertise unsupported cancellation")
	}
	if _, err := adapter.ParseCreate(ctx, []byte("event: completed\ndata: {\"data\":[{\"b64_json\":\"AA==\"}]}\n\n")); err == nil {
		t.Fatal("baseline host unexpectedly accepts image SSE: reassess image compatibility")
	}
}

func TestHeyrouteModelCapabilityExamples(t *testing.T) {
	data, err := os.ReadFile("../../../plugin-packages/heyroute-video/model-capabilities.json")
	if err != nil {
		t.Fatal(err)
	}
	var config struct {
		Models []struct {
			Model            string `json:"model"`
			CapabilityConfig struct {
				Video struct {
					Duration struct {
						Min, Max, Default int
						Values            []int
					} `json:"duration"`
					DefaultRatio      string                 `json:"defaultRatio"`
					DefaultResolution string                 `json:"defaultResolution"`
					Resolutions       []string               `json:"resolutions"`
					GenerateAudio     struct{ Default bool } `json:"generateAudio"`
				} `json:"video"`
			} `json:"capabilityConfig"`
		} `json:"models"`
	}
	if err := json.Unmarshal(data, &config); err != nil {
		t.Fatal(err)
	}
	if len(config.Models) != 11 {
		t.Fatalf("expected 11 model configs, got %d", len(config.Models))
	}
	adapter := heyrouteAdapter(t)
	for _, m := range config.Models {
		t.Run(m.Model, func(t *testing.T) {
			v := m.CapabilityConfig.Video
			r := heyrouteRequest(m.Model)
			r.Duration = v.Duration.Default
			r.AspectRatio = v.DefaultRatio
			r.Resolution = v.DefaultResolution
			r.GenerateAudio = v.GenerateAudio.Default
			heyrouteBody(t, adapter, r)
			boundaries := v.Duration.Values
			if len(boundaries) == 0 {
				boundaries = []int{v.Duration.Min, v.Duration.Max}
			}
			for _, seconds := range boundaries {
				r.Duration = seconds
				heyrouteBody(t, adapter, r)
			}
			for _, resolution := range v.Resolutions {
				r.Resolution = resolution
				heyrouteBody(t, adapter, r)
			}
		})
	}
}

func TestHeyrouteSequentialProtocolLimits(t *testing.T) {
	adapter := heyrouteAdapterFor(t, "heyroute-video-sequential")
	for _, model := range []string{"seedance-2.5", "seedance-2.0", "seedance-2.0-fast"} {
		t.Run(model, func(t *testing.T) {
			r := heyrouteRequest(model)
			r.Images = []MediaReference{{URL: "https://example.com/a.png"}, {URL: "https://example.com/b.png"}}
			body := heyrouteBody(t, adapter, r)
			if len(body["input_reference"].([]any)) != 2 {
				t.Fatalf("wrong images: %#v", body)
			}
			r.Videos = []MediaReference{{URL: "https://example.com/video.mp4"}}
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
				t.Fatal("mixed video must fail")
			}
		})
	}
	for _, model := range []string{"seedance-2.5", "MiniMax-H3"} {
		r := heyrouteRequest(model)
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
			t.Fatal("empty sequence or unsupported model must fail")
		}
	}
}

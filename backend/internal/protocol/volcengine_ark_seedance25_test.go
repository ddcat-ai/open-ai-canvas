package protocol

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

const seedance25Package = "volcengine-ark-seedance-25.yingce-plugin"
const seedance25Provider = "volcengine-ark-seedance-25"

func TestOfficialVolcengineArkSeedance25PackageIdentity(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", seedance25Package))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	if pkg.Manifest.Metadata.ID != seedance25Provider || pkg.Manifest.Metadata.Name != "火山方舟 Seedance 2.5 官方视频生成" {
		t.Fatalf("metadata = %#v", pkg.Manifest.Metadata)
	}
	provider := pkg.Manifest.Contributes.Providers[0]
	if provider.ID != seedance25Provider || provider.BaseURL != "https://ark.cn-beijing.volces.com" || provider.Auth.Type != "bearer" || provider.Auth.Field != "apiKey" {
		t.Fatalf("provider = %#v", provider)
	}
	if !provider.RequiresPublicMediaURLs {
		t.Fatal("Seedance 2.5 must require public media URLs")
	}
}

func TestOfficialVolcengineArkSeedance25BuildsOfficialRequest(t *testing.T) {
	adapter := officialPackageAdapter(t, seedance25Package, seedance25Provider)
	request := GenerationRequest{
		Model:         "doubao-seedance-2-5-260628",
		Prompt:        "让参考音频主导节奏",
		Images:        []MediaReference{{URL: "https://cdn.example/second.png", Role: "reference_image", Order: 2}, {URL: "https://cdn.example/first.png", Role: "reference_image", Order: 1}},
		Videos:        []MediaReference{{URL: "https://cdn.example/source.mp4", Role: "reference_video", Order: 1}},
		Audios:        []MediaReference{{URL: "https://cdn.example/music.mp3", Role: "reference_audio", Order: 1}},
		GenerateAudio: true,
		Watermark:     false,
		ProviderOptions: map[string]map[string]any{seedance25Provider: {
			"omni_reference_task_type": "reference",
			"output_format":            "mov",
			"return_last_frame":        true,
			"draft":                    false,
			"priority":                 3,
		}},
	}
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/api/v3/contents/generations/tasks" || create.ContentType != "application/json" {
		t.Fatalf("create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if body["model"] != request.Model || body["ratio"] != "adaptive" || body["resolution"] != "720p" || body["duration"] != float64(-1) || body["generate_audio"] != true {
		t.Fatalf("defaults = %#v", body)
	}
	content, ok := body["content"].([]any)
	if !ok || len(content) != 5 {
		t.Fatalf("content = %#v", body["content"])
	}
	if content[0].(map[string]any)["type"] != "text" || content[1].(map[string]any)["role"] != "reference_image" || content[2].(map[string]any)["role"] != "reference_image" || content[3].(map[string]any)["role"] != "reference_video" || content[4].(map[string]any)["role"] != "reference_audio" {
		t.Fatalf("content roles = %#v", content)
	}
	for key, want := range map[string]any{"omni_reference_task_type": "reference", "output_format": "mov", "return_last_frame": true, "draft": false, "priority": float64(3)} {
		if body[key] != want {
			t.Fatalf("body[%s] = %#v, want %#v; body=%#v", key, body[key], want, body)
		}
	}
}

func TestOfficialVolcengineArkSeedance25SupportsAudioOnlyAndLimits(t *testing.T) {
	adapter := officialPackageAdapter(t, seedance25Package, seedance25Provider)
	audioOnly := GenerationRequest{Model: "doubao-seedance-2-5-260628", Audios: []MediaReference{{URL: "https://cdn.example/music.mp3"}}}
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: audioOnly})
	if err != nil {
		t.Fatalf("audio-only request rejected: %v", err)
	}
	content := manifestTestBody(t, create)["content"]
	if got := len(content.([]any)); got != 1 || content.([]any)[0].(map[string]any)["type"] != "audio_url" {
		t.Fatalf("audio-only content = %#v", content)
	}

	tooMany := audioOnly
	tooMany.Images = make([]MediaReference, 31)
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: tooMany}); err == nil || !strings.Contains(err.Error(), "30") {
		t.Fatalf("31 images error = %v", err)
	}
	tooLong := audioOnly
	tooLong.Duration = 31
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: tooLong}); err == nil || !strings.Contains(err.Error(), "4-30") {
		t.Fatalf("31 seconds error = %v", err)
	}
}

func TestOfficialVolcengineArkSeedance25SceneConstraints(t *testing.T) {
	adapter := officialPackageAdapter(t, seedance25Package, seedance25Provider)
	frame := MediaReference{URL: "https://cdn.example/first.png", Role: "first_frame"}
	last := MediaReference{URL: "https://cdn.example/last.png", Role: "last_frame"}
	regular := MediaReference{URL: "https://cdn.example/ref.png", Role: "reference_image"}
	video := MediaReference{URL: "https://cdn.example/ref.mp4"}
	for _, test := range []struct {
		name    string
		request GenerationRequest
		invalid bool
	}{
		{"first frame", GenerationRequest{Images: []MediaReference{frame}}, false},
		{"keyframes", GenerationRequest{Images: []MediaReference{last, frame}}, false},
		{"duplicate first", GenerationRequest{Images: []MediaReference{frame, frame}}, true},
		{"duplicate last", GenerationRequest{Images: []MediaReference{frame, last, last}}, true},
		{"last without first", GenerationRequest{Images: []MediaReference{last}}, true},
		{"mixed image", GenerationRequest{Images: []MediaReference{frame, regular}}, true},
		{"mixed video", GenerationRequest{Images: []MediaReference{frame}, Videos: []MediaReference{video}}, true},
		{"mixed audio", GenerationRequest{Images: []MediaReference{frame}, Audios: []MediaReference{{URL: "https://cdn.example/music.mp3"}}}, true},
		{"keyframe ratio", GenerationRequest{Images: []MediaReference{frame}, AspectRatio: "16:9"}, true},
		{"unknown role", GenerationRequest{Images: []MediaReference{{URL: regular.URL, Role: "unknown"}}}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			test.request.Model = "doubao-seedance-2-5-260628"
			create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: test.request})
			if (err != nil) != test.invalid {
				t.Fatalf("invalid=%v, err=%v", test.invalid, err)
			}
			if !test.invalid {
				body := manifestTestBody(t, create)
				if body["ratio"] != "adaptive" {
					t.Fatalf("keyframe ratio = %v", body["ratio"])
				}
				content := body["content"].([]any)
				for index, image := range test.request.Images {
					if content[index].(map[string]any)["role"] != image.Role {
						t.Fatalf("keyframe role not preserved: %v", content)
					}
				}
			}
		})
	}
	for _, kind := range []string{"edit", "extend"} {
		t.Run(kind, func(t *testing.T) {
			request := GenerationRequest{Model: "doubao-seedance-2-5-260628", Duration: 5, AspectRatio: "16:9", ProviderOptions: map[string]map[string]any{seedance25Provider: {"omni_reference_task_type": kind}}}
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("missing video accepted")
			}
			request.Videos = []MediaReference{video}
			create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, create)
			wantDuration := float64(5)
			if kind == "edit" {
				wantDuration = -1
			}
			if body["ratio"] != "adaptive" || body["duration"] != wantDuration {
				t.Fatalf("task defaults = %#v", body)
			}
		})
	}
	for key, value := range map[string]any{"body": map[string]any{"model": "other", "duration": 50, "content": []any{}}, "extra_body": map[string]any{"duration": 50}, "seed": 1, "camera_fixed": false, "frames": 57, "service_tier": "flex"} {
		t.Run(key, func(t *testing.T) {
			request := GenerationRequest{Model: "doubao-seedance-2-5-260628", Prompt: "test", ProviderOptions: map[string]map[string]any{seedance25Provider: {key: value}}}
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatalf("unsupported option %s accepted", key)
			}
		})
	}
}

func TestOfficialVolcengineArkSeedance25ParsesTaskAndLastFrame(t *testing.T) {
	adapter := officialPackageAdapter(t, seedance25Package, seedance25Provider)
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"cgt-25-1"}`))
	if err != nil || created.TaskID != "cgt-25-1" || created.Status != StatusPending {
		t.Fatalf("created = %#v, err=%v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Method != "GET" || poll.Path != "/api/v3/contents/generations/tasks/cgt-25-1" {
		t.Fatalf("poll = %#v, err=%v", poll, err)
	}
	state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"id":"cgt-25-1","status":"succeeded","content":{"video_url":"https://cdn.example/result.mov","last_frame_url":"https://cdn.example/last.jpg"},"usage":{"total_tokens":123}}`))
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 || len(state.Result.Images) != 1 {
		t.Fatalf("state = %#v", state)
	}
	if state.Result.Videos[0].URL != "https://cdn.example/result.mov" || state.Result.Images[0].URL != "https://cdn.example/last.jpg" || !state.Result.Videos[0].Ephemeral || !state.Result.Images[0].Ephemeral {
		t.Fatalf("media = %#v", state.Result)
	}
	if !reflect.DeepEqual(state.Result.Usage, map[string]any{"total_tokens": float64(123)}) {
		t.Fatalf("usage = %#v", state.Result.Usage)
	}
	failed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"id":"cgt-25-1","status":"failed","error":{"code":"InvalidParameter","message":"bad task"}}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "bad task" {
		t.Fatalf("failed = %#v, err=%v", failed, err)
	}
}

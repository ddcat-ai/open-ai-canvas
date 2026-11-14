package protocol

import (
	"context"
	"reflect"
	"strings"
	"testing"
)

func TestWeNewH3VideoBuildsTaskRequestAndPolls(t *testing.T) {
	adapter := officialPackageAdapter(t, "wenew-h3-video.yingce-plugin", "wenew-h3-video")
	request := GenerationRequest{
		Model: "MiniMax-H3", Prompt: "<Picture 1>中的人物说话", Duration: 6, AspectRatio: "9:16", Resolution: "1080P", GenerateAudio: true,
		Images: []MediaReference{{URL: "https://cdn.example/second.png", Order: 2}, {URL: "https://cdn.example/first.png", Role: "reference_image", Order: 1}},
		Audios: []MediaReference{{URL: "https://cdn.example/voice.mp3", Role: "reference_audio", Metadata: map[string]any{"durationMs": 6000}}},
		ProviderOptions: map[string]map[string]any{"wenew-h3-video": {
			"callback_url": "https://callback.example/wenew", "params": map[string]any{"seed": 0, "martial_arts": true, "motion_speed": 0},
		}},
	}
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/api/v1/tasks" || !create.OriginPath || create.Auth.Type != "bearer" {
		t.Fatalf("create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if body["product"] != "h3_video" || body["callback_url"] != "https://callback.example/wenew" {
		t.Fatalf("body = %#v", body)
	}
	wantParams := map[string]any{"prompt": request.Prompt, "quality": "1080p", "ratio": "9:16", "seconds": float64(6), "seed": float64(0), "martial_arts": true, "motion_speed": float64(0)}
	if !reflect.DeepEqual(body["params"], wantParams) {
		t.Fatalf("params = %#v", body["params"])
	}
	wantInputs := map[string]any{
		"images": []any{map[string]any{"url": "https://cdn.example/first.png"}, map[string]any{"url": "https://cdn.example/second.png"}},
		"audios": []any{map[string]any{"url": "https://cdn.example/voice.mp3"}},
	}
	if !reflect.DeepEqual(body["inputs"], wantInputs) {
		t.Fatalf("inputs = %#v", body["inputs"])
	}
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"wenew-task-1","status":"queued"}`))
	if err != nil || created.TaskID != "wenew-task-1" || created.Status != StatusPending {
		t.Fatalf("created = %#v err=%v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Method != "GET" || poll.Path != "/api/v1/tasks/wenew-task-1" || !poll.OriginPath {
		t.Fatalf("poll = %#v err=%v", poll, err)
	}
	state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"id":"wenew-task-1","status":"succeeded","result":{"download_url":"https://cdn.example/h3.mp4?signature=example","expires_at":"2026-11-14T15:00:00Z","retained_until":"2026-11-15T13:00:00Z"},"billing":{"amount_li":150}}`))
	if err != nil || state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 || !state.Result.Videos[0].Ephemeral {
		t.Fatalf("state = %#v err=%v", state, err)
	}
	if state.Result.Videos[0].URL != "https://cdn.example/h3.mp4?signature=example" || !reflect.DeepEqual(state.Result.Usage, map[string]any{"amount_li": float64(150)}) {
		t.Fatalf("result = %#v", state.Result)
	}
	failed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"status":"failed","error":{"code":"insufficient_balance","message":"余额不足"}}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "余额不足" {
		t.Fatalf("failed = %#v err=%v", failed, err)
	}
}

func TestWeNewH3VideoFramesAndTextDefaults(t *testing.T) {
	adapter := officialPackageAdapter(t, "wenew-h3-video.yingce-plugin", "wenew-h3-video")
	for _, roles := range [][]string{nil, {"first_frame"}, {"last_frame"}, {"last_frame", "first_frame"}} {
		t.Run(strings.Join(roles, "+"), func(t *testing.T) {
			req := GenerationRequest{Model: "h3_video", Prompt: "清晨到日落"}
			expected := map[string]any{}
			for _, role := range roles {
				url := "https://cdn.example/" + role + ".png"
				req.Images = append(req.Images, MediaReference{URL: url, Role: role})
				expected[role] = map[string]any{"url": url}
			}
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: req})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			if !reflect.DeepEqual(body["params"], map[string]any{"prompt": req.Prompt, "seconds": float64(5), "ratio": "16:9", "quality": "768p"}) {
				t.Fatalf("params = %#v", body["params"])
			}
			if len(roles) == 0 {
				if _, ok := body["inputs"]; ok {
					t.Fatalf("text inputs = %#v", body["inputs"])
				}
			} else if !reflect.DeepEqual(body["inputs"], expected) {
				t.Fatalf("frame inputs = %#v", body["inputs"])
			}
		})
	}
}

func TestWeNewH3VideoValidatesContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "wenew-h3-video.yingce-plugin", "wenew-h3-video")
	image := MediaReference{URL: "https://cdn.example/image.png"}
	frame := MediaReference{URL: "https://cdn.example/frame.png", Role: "first_frame"}
	audio := func(ms int) MediaReference {
		return MediaReference{URL: "https://cdn.example/audio.mp3", Metadata: map[string]any{"durationMs": ms}}
	}
	cases := []struct {
		name    string
		change  func(*GenerationRequest)
		message string
	}{
		{"duration", func(r *GenerationRequest) { r.Duration = 16 }, "4-15"},
		{"negative duration", func(r *GenerationRequest) { r.Duration = -1 }, "4-15"},
		{"quality", func(r *GenerationRequest) { r.Resolution = "4k" }, "画质"},
		{"ratio", func(r *GenerationRequest) { r.AspectRatio = "auto" }, "比例"},
		{"video", func(r *GenerationRequest) { r.Videos = []MediaReference{{URL: "https://cdn.example/video.mp4"}} }, "参考视频"},
		{"too many images", func(r *GenerationRequest) {
			for i := 0; i < 10; i++ {
				r.Images = append(r.Images, image)
			}
		}, "9张"},
		{"too many audios", func(r *GenerationRequest) {
			r.Images = []MediaReference{image}
			r.Audios = []MediaReference{audio(2000), audio(2000), audio(2000), audio(2000)}
		}, "3段"},
		{"frame and reference", func(r *GenerationRequest) { r.Images = []MediaReference{frame, image} }, "混用"},
		{"frame and audio", func(r *GenerationRequest) {
			r.Images = []MediaReference{frame}
			r.Audios = []MediaReference{audio(2000)}
		}, "混用"},
		{"duplicate frame", func(r *GenerationRequest) { r.Images = []MediaReference{frame, frame} }, "各最多1张"},
		{"audio without image", func(r *GenerationRequest) { r.Audios = []MediaReference{audio(2000)} }, "至少需要"},
		{"short audio", func(r *GenerationRequest) {
			r.Images = []MediaReference{image}
			r.Audios = []MediaReference{audio(1999)}
		}, "每段"},
		{"long audio", func(r *GenerationRequest) {
			r.Images = []MediaReference{image}
			r.Audios = []MediaReference{audio(15001)}
		}, "每段"},
		{"total audio", func(r *GenerationRequest) {
			r.Images = []MediaReference{image}
			r.Audios = []MediaReference{audio(8000), audio(8000)}
		}, "合计"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := GenerationRequest{Model: "h3_video", Prompt: "test"}
			tc.change(&r)
			_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r})
			if err == nil || !strings.Contains(err.Error(), tc.message) {
				t.Fatalf("error = %v, want %s", err, tc.message)
			}
		})
	}
	for _, options := range []map[string]any{
		{"product": "remove_watermark"}, {"body": map[string]any{"product": "remove_watermark"}}, {"extra_body": map[string]any{"product": "remove_watermark"}},
		{"inputs": map[string]any{"images": []any{map[string]any{"file_id": "upload-1"}}}},
		{"params": map[string]any{"seconds": 100}}, {"params": map[string]any{"quality": "4k"}}, {"params": map[string]any{"audio": false}},
		{"params": map[string]any{"seed": -1}}, {"params": map[string]any{"seed": 0.5}}, {"params": map[string]any{"seed": 9007199254740992.0}}, {"params": map[string]any{"seed": "7"}},
		{"params": map[string]any{"martial_arts": "true"}}, {"params": map[string]any{"motion_speed": 0}}, {"params": map[string]any{"martial_arts": true, "motion_speed": 8.5}}, {"params": map[string]any{"martial_arts": true, "motion_speed": 0.25}},
	} {
		t.Run("reject options", func(t *testing.T) {
			r := GenerationRequest{Model: "h3_video", Prompt: "test", ProviderOptions: map[string]map[string]any{"wenew-h3-video": options}}
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r}); err == nil {
				t.Fatalf("accepted options %#v", options)
			}
		})
	}
	for _, ms := range [][]int{{2000}, {15000}, {5000, 5000, 5000}} {
		r := GenerationRequest{Model: "h3_video", Prompt: "test", Images: []MediaReference{image}}
		for _, value := range ms {
			r.Audios = append(r.Audios, audio(value))
		}
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: r}); err != nil {
			t.Fatalf("rejected boundary %v: %v", ms, err)
		}
	}
}

package protocol

import (
	"context"
	"strings"
	"testing"
)

func TestDashscopeWan3VideoCreateAndLifecycle(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-wan3-video.yingce-plugin", "dashscope-wan3-video")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "wan3.0-video-prime", Prompt: "一只猫在海边奔跑", Duration: 6, AspectRatio: "16:9", Resolution: "1080p",
		GenerateAudio: true, Watermark: true,
		Inputs: []MediaReference{
			{URL: "https://cdn.example/audio.mp3", Kind: "audio", Role: "reference_audio", Order: 3},
			{URL: "https://cdn.example/image.png", Kind: "image", Role: "reference_image", Order: 1},
			{URL: "https://cdn.example/video.mp4", Kind: "video", Role: "reference_video", Order: 2},
		},
		ProviderOptions: map[string]map[string]any{"dashscope-wan3-video": {"seed": 42, "prompt_extend": false}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/api/v1/services/aigc/video-generation/video-synthesis" || !create.OriginPath || create.Headers["X-DashScope-Async"] != "enable" {
		t.Fatalf("create = %#v", create)
	}
	body := manifestTestBody(t, create)
	input, _ := body["input"].(map[string]any)
	media, _ := input["media"].([]any)
	if input["prompt"] != "一只猫在海边奔跑" || len(media) != 3 {
		t.Fatalf("input = %#v", input)
	}
	first, _ := media[0].(map[string]any)
	if first["type"] != "reference_image" || first["url"] != "https://cdn.example/image.png" {
		t.Fatalf("media[0] = %#v", first)
	}
	parameters, _ := body["parameters"].(map[string]any)
	if parameters["resolution"] != "1080P" || parameters["ratio"] != "16:9" || parameters["duration"] != float64(6) || parameters["audio"] != true || parameters["seed"] != float64(42) || parameters["prompt_extend"] != false {
		t.Fatalf("parameters = %#v", parameters)
	}

	keyframes, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "wan3.0-video", Prompt: "首尾帧",
		Images: []MediaReference{
			{URL: "https://cdn.example/last.png", Role: "last_frame", Order: 2},
			{URL: "https://cdn.example/first.png", Role: "first_frame", Order: 1},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	keyMedia, _ := manifestTestBody(t, keyframes)["input"].(map[string]any)["media"].([]any)
	if len(keyMedia) != 2 || keyMedia[0].(map[string]any)["type"] != "first_frame" || keyMedia[1].(map[string]any)["type"] != "last_frame" {
		t.Fatalf("keyframes = %#v", keyMedia)
	}

	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "wan2.2-kf2v-flash", Prompt: "x"}}); err == nil {
		t.Fatal("unsupported model accepted")
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"output":{"task_id":"wan3-task-1","task_status":"PENDING"}}`))
	if err != nil || created.TaskID != "wan3-task-1" || created.Status != StatusPending {
		t.Fatalf("create result = %#v err=%v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Path != "/api/v1/tasks/wan3-task-1" || !poll.OriginPath {
		t.Fatalf("poll = %#v err=%v", poll, err)
	}
	succeeded, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"output":{"task_id":"wan3-task-1","task_status":"SUCCEEDED","video_url":"https://dashscope-result.example/wan3.mp4"},"usage":{"video_count":1}}`))
	if err != nil || succeeded.Status != StatusSucceeded || len(succeeded.Result.Videos) != 1 || !succeeded.Result.Videos[0].Ephemeral {
		t.Fatalf("success = %#v err=%v", succeeded, err)
	}
	unknown, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"output":{"task_id":"wan3-task-1","task_status":"UNKNOWN"}}`))
	if err != nil || unknown.Status != StatusFailed {
		t.Fatalf("unknown = %#v err=%v", unknown, err)
	}
}

func TestDashscopeWan3OfficialInputModes(t *testing.T) {
	const provider = "dashscope-wan3-video"
	adapter := officialPackageAdapter(t, provider+".yingce-plugin", provider)
	image := MediaReference{Kind: "image", Role: "subject_reference", URL: "https://media.example/item.jpg"}
	first, last := image, image
	first.Role, last.Role = "first_frame", "last_frame"
	audio := MediaReference{Kind: "audio", Role: "reference_audio", URL: "https://media.example/sound.mp3", Metadata: map[string]any{"durationMs": 8000}}
	video := MediaReference{Kind: "video", Role: "reference_video", URL: "https://media.example/clip.mp4", Metadata: map[string]any{"durationMs": 10000}}
	file := map[string]any{"type": "file", "url": "https://media.example/story.pdf"}
	link := map[string]any{"type": "link", "url": "https://media.example/story"}
	for _, tc := range []struct {
		name      string
		inputs    []MediaReference
		extra     map[string]any
		duration  int
		wantError string
	}{
		{"tail alone", []MediaReference{last}, nil, 5, "尾帧"},
		{"wrong kind", []MediaReference{{Kind: "audio", Role: "first_frame", URL: audio.URL}}, nil, 5, "角色不匹配"},
		{"frame with audio", []MediaReference{first, audio}, nil, 5, "不能"},
		{"too many images", []MediaReference{image, image, image, image, image, image, image, image, image, image, image}, nil, 5, "上限"},
		{"audio too long", []MediaReference{audio, audio}, nil, 5, "总时长"},
		{"video plus output", []MediaReference{video}, nil, 21, "之和"},
		{"raw media", []MediaReference{image}, map[string]any{"media": []any{map[string]any{"type": "reference_image", "url": file["url"]}}}, 5, "媒体扩展"},
		{"file and link", nil, map[string]any{"media": []any{file, link}}, 5, "媒体扩展"},
		{"file without prompt extension", nil, map[string]any{"media": []any{file}, "prompt_extend": false}, 5, "prompt_extend"},
		{"only audio", []MediaReference{audio}, nil, 5, ""},
		{"file plus image", []MediaReference{image}, map[string]any{"media": []any{file}}, 5, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			create, err := adapter.BuildCreate(t.Context(), RequestContext{Request: GenerationRequest{Model: "wan3.0-video", Inputs: tc.inputs, Duration: tc.duration, ProviderOptions: map[string]map[string]any{provider: tc.extra}}})
			if tc.wantError != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantError) {
					t.Fatalf("got %v; want %s", err, tc.wantError)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, create)
			media := body["input"].(map[string]any)["media"].([]any)
			if tc.extra == nil {
				if len(media) != 1 || media[0].(map[string]any)["type"] != "reference_audio" || body["parameters"].(map[string]any)["audio"] != false {
					t.Fatalf("input audio unexpectedly changed output: %v", body)
				}
			} else if len(media) != 2 || media[0].(map[string]any)["type"] != "reference_image" || media[0].(map[string]any)["url"] != image.URL || media[1].(map[string]any)["type"] != "file" {
				t.Fatalf("file replaced host media: %v", media)
			}
		})
	}
}

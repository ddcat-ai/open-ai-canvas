package protocol

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func dashscopeMiniMaxRequest() GenerationRequest {
	return GenerationRequest{Model: "MiniMax/MiniMax-H3", Prompt: "海边的猫", Duration: 5, AspectRatio: "16:9", Resolution: "768p"}
}

func TestDashscopeMiniMaxVideoCreate(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "dashscope-minimax-video.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	provider := pkg.Manifest.Contributes.Providers[0]
	if provider.ID != "dashscope-minimax-video" || provider.BaseURL != "" || !provider.RequiresPublicMediaURLs || provider.Auth.Type != "bearer" || provider.Auth.Field != "apiKey" {
		t.Fatalf("provider = %#v", provider)
	}
	adapter := officialPackageAdapter(t, "dashscope-minimax-video.yingce-plugin", "dashscope-minimax-video")
	request := dashscopeMiniMaxRequest()
	request.Watermark = true
	request.GenerateAudio = true
	request.ProviderOptions = map[string]map[string]any{"dashscope-minimax-video": {"seed": 42, "media": []any{map[string]any{"type": "feature", "url": "https://cdn.example/ignored.mp4"}}}}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://workspace.cn-beijing.maas.aliyuncs.com", Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Method != "POST" || spec.Path != "/api/v1/services/aigc/video-generation/video-synthesis" || !spec.OriginPath || spec.ContentType != "application/json" || spec.Headers["X-DashScope-Async"] != "enable" || spec.Auth.Type != "bearer" {
		t.Fatalf("spec = %#v", spec)
	}
	want := map[string]any{
		"model":      "MiniMax/MiniMax-H3",
		"input":      map[string]any{"prompt": "海边的猫"},
		"parameters": map[string]any{"resolution": "768P", "ratio": "16:9", "duration": float64(5), "watermark": true},
	}
	if body := manifestTestBody(t, spec); !reflect.DeepEqual(body, want) {
		t.Fatalf("body = %#v, want %#v", body, want)
	}
}

func TestDashscopeMiniMaxVideoMediaRoles(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-minimax-video.yingce-plugin", "dashscope-minimax-video")
	for _, tc := range []struct {
		name   string
		inputs []MediaReference
		types  []string
		ratio  string
	}{
		{"first frame", []MediaReference{{Kind: "image", Role: "first_frame", URL: "https://cdn.example/first.png"}}, []string{"first_frame"}, "adaptive"},
		{"last frame only", []MediaReference{{Kind: "image", Role: "last_frame", URL: "https://cdn.example/last.png"}}, []string{"last_frame"}, "adaptive"},
		{"keyframes ordered", []MediaReference{{Kind: "image", Role: "last_frame", URL: "https://cdn.example/last.png", Order: 2}, {Kind: "image", Role: "first_frame", URL: "https://cdn.example/first.png", Order: 1}}, []string{"first_frame", "last_frame"}, "adaptive"},
		{"multimodal ordered", []MediaReference{{Kind: "audio", Role: "reference_voice", URL: "https://cdn.example/audio.mp3", Order: 3}, {Kind: "video", Role: "reference_video", URL: "https://cdn.example/video.mp4", Order: 2}, {Kind: "image", Role: "reference_image", URL: "https://cdn.example/image.png", Order: 1}}, []string{"image_url", "feature", "driving_audio"}, "16:9"},
		{"subject and style", []MediaReference{{Kind: "image", Role: "subject_reference", URL: "https://cdn.example/subject.png"}, {Kind: "image", Role: "style_reference", URL: "https://cdn.example/style.png"}}, []string{"image_url", "image_url"}, "16:9"},
		{"audio only", []MediaReference{{Kind: "audio", URL: "https://cdn.example/audio.mp3"}}, []string{"driving_audio"}, "16:9"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := dashscopeMiniMaxRequest()
			request.Inputs = tc.inputs
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			media := body["input"].(map[string]any)["media"].([]any)
			var types []string
			for _, value := range media {
				item := value.(map[string]any)
				types = append(types, item["type"].(string))
				if !strings.HasPrefix(item["url"].(string), "https://cdn.example/") || len(item) != 2 {
					t.Fatalf("media = %#v", item)
				}
			}
			if !reflect.DeepEqual(types, tc.types) || body["parameters"].(map[string]any)["ratio"] != tc.ratio {
				t.Fatalf("body = %#v", body)
			}
		})
	}
	request := GenerationRequest{Model: "MiniMax/MiniMax-H3", Prompt: "参考生成", Output: OutputOptions{Duration: 15, Resolution: "2k"}}
	wantMedia := make([]any, 0, 15)
	for _, media := range []struct {
		items *[]MediaReference
		kind  string
		count int
	}{
		{&request.Images, "image_url", 9},
		{&request.Videos, "feature", 3},
		{&request.Audios, "driving_audio", 3},
	} {
		for index := 0; index < media.count; index++ {
			url := fmt.Sprintf("http://cdn.example/%s/%d", media.kind, index)
			*media.items = append(*media.items, MediaReference{URL: url, Order: len(wantMedia) + 1})
			wantMedia = append(wantMedia, map[string]any{"type": media.kind, "url": url})
		}
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	parameters := body["parameters"].(map[string]any)
	if parameters["resolution"] != "2K" || parameters["duration"] != float64(15) || parameters["ratio"] != "adaptive" || parameters["watermark"] != false {
		t.Fatalf("parameters = %#v", parameters)
	}
	if media := body["input"].(map[string]any)["media"]; !reflect.DeepEqual(media, wantMedia) {
		t.Fatalf("media = %#v, want %#v", media, wantMedia)
	}
}

func TestDashscopeMiniMaxVideoPositiveBoundaries(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-minimax-video.yingce-plugin", "dashscope-minimax-video")
	request := dashscopeMiniMaxRequest()
	request.Prompt = strings.Repeat("镜\U00020000", 3500)
	request.Duration, request.Resolution, request.AspectRatio = 30, "1080p", "2:3"
	request.Output = OutputOptions{Duration: 15, Resolution: "2k", AspectRatio: "9:16", Watermark: true}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	want := map[string]any{"duration": float64(15), "resolution": "2K", "ratio": "9:16", "watermark": true}
	if body["input"].(map[string]any)["prompt"] != request.Prompt || !reflect.DeepEqual(body["parameters"], want) {
		t.Fatal("7000-character prompt or Output precedence was not preserved")
	}
	for _, ratio := range []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"} {
		request := dashscopeMiniMaxRequest()
		request.AspectRatio = ratio
		spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatalf("ratio %s: %v", ratio, err)
		}
		if parameters := manifestTestBody(t, spec)["parameters"].(map[string]any); parameters["ratio"] != ratio {
			t.Fatalf("ratio %s: parameters = %#v", ratio, parameters)
		}
	}
	for seconds := 4; seconds <= 15; seconds++ {
		request := dashscopeMiniMaxRequest()
		request.Duration = seconds
		spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
		if err != nil {
			t.Fatalf("duration %d: %v", seconds, err)
		}
		if parameters := manifestTestBody(t, spec)["parameters"].(map[string]any); parameters["duration"] != float64(seconds) {
			t.Fatalf("duration %d: parameters = %#v", seconds, parameters)
		}
	}
}

func TestDashscopeMiniMaxVideoValidation(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-minimax-video.yingce-plugin", "dashscope-minimax-video")
	tests := []struct {
		name   string
		change func(*GenerationRequest)
	}{
		{"native model", func(r *GenerationRequest) { r.Model = "MiniMax-H3" }},
		{"missing prompt", func(r *GenerationRequest) { r.Prompt = " " }},
		{"long prompt", func(r *GenerationRequest) { r.Prompt = strings.Repeat("镜", 7001) }},
		{"short duration", func(r *GenerationRequest) { r.Duration = 3 }},
		{"long duration", func(r *GenerationRequest) { r.Duration = 16 }},
		{"missing duration", func(r *GenerationRequest) { r.Duration = 0 }},
		{"resolution", func(r *GenerationRequest) { r.Resolution = "1080p" }},
		{"missing resolution", func(r *GenerationRequest) { r.Resolution = "" }},
		{"text adaptive", func(r *GenerationRequest) { r.AspectRatio = "adaptive" }},
		{"text missing ratio", func(r *GenerationRequest) { r.AspectRatio = "" }},
		{"Output duration overrides valid top-level", func(r *GenerationRequest) { r.Output.Duration = 16 }},
		{"Output ratio overrides valid top-level", func(r *GenerationRequest) { r.Output.AspectRatio = "2:3" }},
		{"reference ratio", func(r *GenerationRequest) {
			r.AspectRatio = "2:3"
			r.Images = []MediaReference{{URL: "https://cdn.example/a.png"}}
		}},
		{"duplicate first", func(r *GenerationRequest) {
			r.Inputs = []MediaReference{{Kind: "image", Role: "first_frame", URL: "https://cdn.example/a.png"}, {Kind: "image", Role: "first_frame", URL: "https://cdn.example/b.png"}}
		}},
		{"duplicate last", func(r *GenerationRequest) {
			r.Images = []MediaReference{{Role: "last_frame", URL: "https://cdn.example/a.png"}, {Role: "last_frame", URL: "https://cdn.example/b.png"}}
		}},
		{"keyframe with image", func(r *GenerationRequest) {
			r.Images = []MediaReference{{Role: "first_frame", URL: "https://cdn.example/a.png"}, {Role: "reference_image", URL: "https://cdn.example/b.png"}}
		}},
		{"keyframe with video", func(r *GenerationRequest) {
			r.Images = []MediaReference{{Role: "first_frame", URL: "https://cdn.example/a.png"}}
			r.Videos = []MediaReference{{URL: "https://cdn.example/a.mp4"}}
		}},
		{"keyframe with audio", func(r *GenerationRequest) {
			r.Images = []MediaReference{{Role: "last_frame", URL: "https://cdn.example/a.png"}}
			r.Audios = []MediaReference{{URL: "https://cdn.example/a.mp3"}}
		}},
		{"image with video role", func(r *GenerationRequest) {
			r.Images = []MediaReference{{Role: "reference_video", URL: "https://cdn.example/a.png"}}
		}},
		{"video with keyframe role", func(r *GenerationRequest) {
			r.Inputs = []MediaReference{{Kind: "video", Role: "first_frame", URL: "https://cdn.example/a.mp4"}}
		}},
		{"audio with image role", func(r *GenerationRequest) {
			r.Audios = []MediaReference{{Role: "reference_image", URL: "https://cdn.example/a.mp3"}}
		}},
		{"invalid role", func(r *GenerationRequest) {
			r.Images = []MediaReference{{Role: "mask", URL: "https://cdn.example/a.png"}}
		}},
		{"invalid kind", func(r *GenerationRequest) {
			r.Inputs = []MediaReference{{Kind: "file", URL: "https://cdn.example/a.png"}}
		}},
		{"data URL", func(r *GenerationRequest) { r.Images = []MediaReference{{DataURL: "data:image/png;base64,AA=="}} }},
		{"missing URL", func(r *GenerationRequest) { r.Images = []MediaReference{{Role: "first_frame"}} }},
	}
	for _, kind := range []string{"image", "video", "audio"} {
		kind := kind
		tests = append(tests, struct {
			name   string
			change func(*GenerationRequest)
		}{"too many " + kind, func(r *GenerationRequest) {
			count := 4
			if kind == "image" {
				count = 10
			}
			for index := 0; index < count; index++ {
				r.Inputs = append(r.Inputs, MediaReference{Kind: kind, URL: fmt.Sprintf("https://cdn.example/%d", index)})
			}
		}})
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			request := dashscopeMiniMaxRequest()
			tc.change(&request)
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
}

func TestDashscopeMiniMaxVideoLifecycle(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-minimax-video.yingce-plugin", "dashscope-minimax-video")
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"output":{"task_id":"minimax-task","task_status":"PENDING"}}`))
	if err != nil || created.TaskID != "minimax-task" || created.Status != StatusPending {
		t.Fatalf("create = %#v err=%v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Method != "GET" || poll.Path != "/api/v1/tasks/minimax-task" || !poll.OriginPath || poll.Auth.Type != "bearer" {
		t.Fatalf("poll = %#v err=%v", poll, err)
	}
	for _, tc := range []struct {
		payload string
		status  Status
		message string
	}{
		{`{"output":{"task_status":"PENDING"}}`, StatusPending, ""},
		{`{"output":{"task_status":"RUNNING"}}`, StatusProcessing, ""},
		{`{"output":{"task_status":"CANCELED"}}`, StatusCancelled, ""},
		{`{"output":{"task_status":"UNKNOWN"}}`, StatusFailed, "百炼 MiniMax 任务不存在或已超过 24 小时查询有效期"},
		{`{"output":{"task_status":"FAILED","code":"InvalidParameter","message":"invalid media"}}`, StatusFailed, "invalid media"},
		{`{"code":"InvalidApiKey","message":"No API-key provided."}`, StatusFailed, "No API-key provided."},
		{`{"code":"InvalidApiKey","message":"invalid key","output":{"task_status":"RUNNING"}}`, StatusFailed, "invalid key"},
		{`{"code":0,"message":"top-level message","output":{"task_status":"SUCCEEDED","code":"InvalidParameter","message":"nested message"}}`, StatusFailed, "nested message"},
		{`{"code":0,"output":{"task_status":"PENDING","code":"0"}}`, StatusPending, ""},
		{`{"output":{"task_status":"SUCCEEDED"},"usage":{"output_seconds":5}}`, StatusSucceeded, ""},
	} {
		for _, parse := range []func() (CreateResult, error){
			func() (CreateResult, error) { return adapter.ParseCreate(context.Background(), []byte(tc.payload)) },
			func() (CreateResult, error) {
				result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(tc.payload))
				if result.TaskID != created.TaskID {
					t.Fatalf("poll lost task ID: %#v", result)
				}
				return CreateResult{Status: result.Status, Result: result.Result, Message: result.Message}, err
			},
		} {
			result, err := parse()
			if err != nil || result.Status != tc.status || result.Message != tc.message || result.Result != nil {
				t.Fatalf("payload %s result=%#v err=%v", tc.payload, result, err)
			}
		}
	}
	success, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"output":{"task_status":"SUCCEEDED","video_url":"https://cdn.example/result.mp4"},"usage":{"SR":"768","duration":12,"image_count":2,"input_seconds":7,"output_seconds":5,"total_seconds":12,"video_count":1}}`))
	if err != nil || success.Status != StatusSucceeded || success.Result == nil || len(success.Result.Videos) != 1 || success.Result.Videos[0].URL != "https://cdn.example/result.mp4" || !success.Result.Videos[0].Ephemeral || success.Result.Usage["input_seconds"] != float64(7) || success.Result.Usage["image_count"] != float64(2) {
		t.Fatalf("success = %#v err=%v", success, err)
	}
}

package protocol

import (
	"context"
	"fmt"
	"testing"
)

func TestGrsaiMinimaxH3VideoContract(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai-api.yingce-plugin", "grsai-minimax-h3")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "minimax-h3",
		Prompt:      "一只猫在海边奔跑",
		Images:      []MediaReference{{URL: "https://cdn.example/image.png", Order: 1}},
		Audios:      []MediaReference{{URL: "https://cdn.example/audio.mp3", Order: 2}},
		AspectRatio: "portrait",
		Resolution:  "480p",
		Duration:    10,
		ProviderOptions: map[string]map[string]any{
			"grsai-minimax-h3": {"seed": 1000},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/api/generate" || create.ContentType != "application/json" {
		t.Fatalf("create = %#v", create)
	}
	if create.Auth.Type != "bearer" || create.Auth.Field != "apiKey" {
		t.Fatalf("auth = %#v", create.Auth)
	}
	body := manifestTestBody(t, create)
	if body["model"] != "minimax-h3" || body["prompt"] != "一只猫在海边奔跑" || body["aspectRatio"] != "portrait" || body["resolution"] != "480p" || body["duration"] != float64(10) || body["seed"] != float64(1000) || body["replyType"] != "async" {
		t.Fatalf("body = %#v", body)
	}
	if got := body["images"].([]any); len(got) != 1 || got[0] != "https://cdn.example/image.png" {
		t.Fatalf("images = %#v", body["images"])
	}
	if got := body["audios"].([]any); len(got) != 1 || got[0] != "https://cdn.example/audio.mp3" {
		t.Fatalf("audios = %#v", body["audios"])
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"grsai-task-1","status":"queued"}`))
	if err != nil || created.TaskID != "grsai-task-1" || created.Status != StatusPending {
		t.Fatalf("created = %#v err=%v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Method != "GET" || poll.Path != "/v1/api/result" || poll.Query["id"][0] != created.TaskID {
		t.Fatalf("poll = %#v err=%v", poll, err)
	}
	succeeded, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"id":"grsai-task-1","status":"succeeded","results":[{"url":"https://cdn.example/result.mp4"}]}`))
	if err != nil || succeeded.Status != StatusSucceeded || succeeded.Result == nil || len(succeeded.Result.Videos) != 1 || succeeded.Result.Videos[0].URL != "https://cdn.example/result.mp4" || !succeeded.Result.Videos[0].Ephemeral {
		t.Fatalf("succeeded = %#v err=%v", succeeded, err)
	}
	failed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"id":"grsai-task-1","status":"failed","message":"provider rejected request"}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "provider rejected request" {
		t.Fatalf("failed = %#v err=%v", failed, err)
	}
	if _, err := adapter.BuildCancel(context.Background(), PollContext{TaskID: created.TaskID}); err == nil {
		t.Fatal("cancel unexpectedly supported by a profile without an upstream cancel endpoint")
	}
}

func TestGrsaiMediaProfilesAllowInlineMediaReferences(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai-api.yingce-plugin", "grsai-minimax-h3")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:       "minimax-h3",
		Prompt:      "一只猫在海边奔跑",
		Images:      []MediaReference{{DataURL: "data:image/png;base64,AAAA", Order: 1}},
		Audios:      []MediaReference{{DataURL: "data:audio/mpeg;base64,BBBB", Order: 1}},
		AspectRatio: "portrait",
		Resolution:  "480p",
		Duration:    5,
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, create)
	if got := body["images"].([]any); len(got) != 1 || got[0] != "data:image/png;base64,AAAA" {
		t.Fatalf("images = %#v", body["images"])
	}
	if got := body["audios"].([]any); len(got) != 1 || got[0] != "data:audio/mpeg;base64,BBBB" {
		t.Fatalf("audios = %#v", body["audios"])
	}
}

func TestGrsaiMediaProfilesDoNotRequirePublicMediaURLs(t *testing.T) {
	for _, providerID := range []string{"grsai-minimax-h3", "grsai-nano-banana-image", "grsai-gpt-image"} {
		t.Run(providerID, func(t *testing.T) {
			adapter := officialPackageAdapter(t, "grsai-api.yingce-plugin", providerID)
			if adapter.Metadata().RequiresPublicMediaURLs {
				t.Fatal("provider unexpectedly requires public media URLs")
			}
		})
	}
}

func TestGrsaiImageProfilesMapTopLevelError(t *testing.T) {
	for _, providerID := range []string{"grsai-nano-banana-image", "grsai-gpt-image"} {
		t.Run(providerID, func(t *testing.T) {
			adapter := officialPackageAdapter(t, "grsai-api.yingce-plugin", providerID)
			result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "grsai-image-task"}, []byte(`{"id":"grsai-image-task","status":"failed","error":"generate failed"}`))
			if err != nil {
				t.Fatal(err)
			}
			if result.Status != StatusFailed || result.Message != "generate failed" {
				t.Fatalf("result = %#v, want failed status with top-level error", result)
			}
		})
	}
}

func TestGrsaiProviderAdvertisesOfficialCapabilityValues(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai-api.yingce-plugin", "grsai-minimax-h3")
	if adapter.Metadata().Version != "1.2.3" {
		t.Fatalf("Grsai plugin version = %q, want 1.2.3", adapter.Metadata().Version)
	}
	tests := []struct {
		providerID string
		parameter  string
		want       []string
	}{
		{providerID: "grsai-minimax-h3", parameter: "resolution", want: []string{"480p", "768p", "1080p"}},
		{providerID: "grsai-gpt-image", parameter: "quality", want: []string{"auto", "low", "medium", "high", "xhigh", "max"}},
	}

	for _, tt := range tests {
		t.Run(tt.providerID, func(t *testing.T) {
			adapter := officialPackageAdapter(t, "grsai-api.yingce-plugin", tt.providerID)
			metadata := adapter.Metadata()
			for _, parameter := range metadata.Parameters {
				if parameter.Name == tt.parameter {
					if fmt.Sprint(parameter.Values) != fmt.Sprint(tt.want) {
						t.Fatalf("%s values = %v, want %v", tt.parameter, parameter.Values, tt.want)
					}
					return
				}
			}
			t.Fatalf("parameter %q not found in %#v", tt.parameter, metadata.Parameters)
		})
	}
}

func TestGrsaiMinimaxH3MapsDocumentedViolationAndError(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai-api.yingce-plugin", "grsai-minimax-h3")
	for _, payload := range []string{
		`{"id":"grsai-task-1","status":"violation","error":"内容违规"}`,
		`{"id":"grsai-task-1","status":"failed","error":"generate failed"}`,
	} {
		result, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "grsai-task-1"}, []byte(payload))
		if err != nil {
			t.Fatal(err)
		}
		if result.Status != StatusFailed || result.Message == "" {
			t.Fatalf("result = %#v, want failed status with provider error", result)
		}
	}
}

func TestGrsaiMinimaxH3RejectsUndocumentedVideoValues(t *testing.T) {
	adapter := officialPackageAdapter(t, "grsai-api.yingce-plugin", "grsai-minimax-h3")
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "minimax-h3", Prompt: "test", AspectRatio: "square", Resolution: "480p", Duration: 5,
	}}); err != nil {
		t.Fatalf("square aspect ratio rejected: %v", err)
	}
	for name, request := range map[string]GenerationRequest{
		"unsupported aspect ratio": {
			Model: "minimax-h3", Prompt: "test", AspectRatio: "panorama", Resolution: "480p", Duration: 5,
		},
		"unsupported resolution": {
			Model: "minimax-h3", Prompt: "test", AspectRatio: "portrait", Resolution: "720p", Duration: 5,
		},
		"duration below minimum": {
			Model: "minimax-h3", Prompt: "test", AspectRatio: "portrait", Resolution: "480p", Duration: 0,
		},
		"1080p duration over limit": {
			Model: "minimax-h3", Prompt: "test", AspectRatio: "portrait", Resolution: "1080p", Duration: 11,
		},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("BuildCreate unexpectedly accepted undocumented video value")
			}
		})
	}
}

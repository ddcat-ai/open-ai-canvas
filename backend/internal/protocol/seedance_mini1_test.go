package protocol

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func seedanceMini1Request() GenerationRequest {
	return GenerationRequest{
		Capability: CapabilityVideo, Model: "seedance20Mini", Prompt: "海边日落，镜头缓慢推进",
		Duration: 5, AspectRatio: "16:9", Resolution: "720p",
		Extra: map[string]any{"idempotencyKey": "seedance-mini1-request-1"},
	}
}

func TestSeedanceMini1PackageIdentity(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "seedance-mini1.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	if pkg.Manifest.Metadata.ID != "seedance-mini1" || pkg.Manifest.Metadata.Name != "SeedanceMINI1" {
		t.Fatalf("plugin identity = %#v", pkg.Manifest.Metadata)
	}
	provider := pkg.Manifest.Contributes.Providers[0]
	if provider.Label != "SeedanceMINI1" || provider.BaseURL != "" || !provider.IdempotentCreate || provider.Auth.Type != "bearer" {
		t.Fatalf("provider identity = %#v", provider)
	}
	for name, content := range pkg.Files {
		text := strings.ToLower(string(content))
		if strings.Contains(text, "http://") || strings.Contains(text, "https://") || strings.Contains(text, ".shop") {
			t.Errorf("package file %s contains a fixed service address", name)
		}
	}
}

func TestSeedanceMini1CreateAndDefaults(t *testing.T) {
	adapter := officialPackageAdapter(t, "seedance-mini1.yingce-plugin", "seedance-mini1")
	request := seedanceMini1Request()
	request.Resolution = " 2K "
	request.ProviderOptions = map[string]map[string]any{"seedance-mini1": {"face_mode": " SHEET "}}
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/videos" || create.ContentType != "application/json" || create.Headers["Idempotency-Key"] != request.Extra["idempotencyKey"] {
		t.Fatalf("create = %#v", create)
	}
	body := manifestTestBody(t, create)
	want := map[string]any{"model": request.Model, "prompt": request.Prompt, "seconds": float64(5), "size": "16:9", "enhance": "2k", "face_mode": "sheet"}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("body = %#v, want %#v", body, want)
	}
	defaults, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Prompt: "a clip"}})
	if err != nil {
		t.Fatal(err)
	}
	want = map[string]any{"prompt": "a clip", "seconds": float64(5), "size": "16:9", "enhance": "720p", "face_mode": "off"}
	if got := manifestTestBody(t, defaults); !reflect.DeepEqual(got, want) {
		t.Fatalf("defaults = %#v, want %#v", got, want)
	}
}

func TestSeedanceMini1UploadsAndOrdersReferences(t *testing.T) {
	adapter := officialPackageAdapter(t, "seedance-mini1.yingce-plugin", "seedance-mini1")
	uploader, ok := adapter.(MediaUploadAdapter)
	if !ok || !reflect.DeepEqual(uploader.UploadKinds(), []string{"image"}) {
		t.Fatal("image upload contract is missing")
	}
	media := MediaReference{Kind: "image", DataURL: "data:image/png;base64,aW1hZ2U=", Name: "reference.png"}
	upload, err := uploader.BuildUpload(context.Background(), RequestContext{Request: seedanceMini1Request()}, media)
	if err != nil {
		t.Fatal(err)
	}
	if upload.Method != "POST" || upload.Path != "/v1/uploads/images" || upload.ContentType != "multipart/form-data" || len(upload.Files) != 1 || upload.Files[0].Name != "image" {
		t.Fatalf("upload = %#v", upload)
	}
	firstURL := "https://upstream.example/files/first.png"
	url, err := uploader.ParseUpload(context.Background(), []byte(`{"data":[{"url":"`+firstURL+`"}]}`))
	if err != nil || url != firstURL {
		t.Fatalf("upload result = %q, err=%v", url, err)
	}
	if _, err := uploader.ParseUpload(context.Background(), []byte(`{"data":[]}`)); err == nil {
		t.Fatal("empty upload response must fail")
	}
	request := seedanceMini1Request()
	request.Prompt = "@Image1 and @图2"
	request.Images = []MediaReference{
		{Kind: "image", URL: "https://input.example/second.png", Order: 2, Metadata: map[string]any{MediaUploadIDKey: "https://upstream.example/files/second.png"}},
		{Kind: "image", URL: "https://input.example/first.png", Order: 1, Metadata: map[string]any{MediaUploadIDKey: firstURL}},
	}
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	want := []any{firstURL, "https://upstream.example/files/second.png"}
	if got := manifestTestBody(t, create)["reference_images"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("reference_images = %#v, want %#v", got, want)
	}
}

func TestSeedanceMini1Validation(t *testing.T) {
	adapter := officialPackageAdapter(t, "seedance-mini1.yingce-plugin", "seedance-mini1")
	tests := []struct {
		name    string
		change  func(*GenerationRequest)
		wantErr bool
	}{
		{"minimum duration", func(r *GenerationRequest) { r.Duration = 3 }, false},
		{"maximum duration", func(r *GenerationRequest) { r.Duration = 15 }, false},
		{"short duration", func(r *GenerationRequest) { r.Duration = 2 }, true},
		{"long duration", func(r *GenerationRequest) { r.Duration = 16 }, true},
		{"negative duration", func(r *GenerationRequest) { r.Duration = -1 }, true},
		{"blank prompt", func(r *GenerationRequest) { r.Prompt = " \t\n" }, true},
		{"max unicode prompt", func(r *GenerationRequest) { r.Prompt = strings.Repeat("图", 5000) }, false},
		{"long unicode prompt", func(r *GenerationRequest) { r.Prompt = strings.Repeat("图", 5001) }, true},
		{"ratio", func(r *GenerationRequest) { r.AspectRatio = "21:9" }, false},
		{"unsupported ratio", func(r *GenerationRequest) { r.AspectRatio = "2:3" }, true},
		{"unsupported resolution", func(r *GenerationRequest) { r.Resolution = "480p" }, true},
		{"nine images", func(r *GenerationRequest) { r.Images = make([]MediaReference, 9) }, false},
		{"ten images", func(r *GenerationRequest) { r.Images = make([]MediaReference, 10) }, true},
		{"audio", func(r *GenerationRequest) { r.Audios = []MediaReference{{Kind: "audio"}} }, true},
		{"video", func(r *GenerationRequest) { r.Videos = []MediaReference{{Kind: "video"}} }, true},
		{"audio marker", func(r *GenerationRequest) { r.Prompt = "@Audio1" }, true},
		{"localized audio marker", func(r *GenerationRequest) { r.Prompt = "@音频1" }, true},
		{"unknown face mode", func(r *GenerationRequest) {
			r.ProviderOptions = map[string]map[string]any{"seedance-mini1": {"face_mode": "unknown"}}
		}, true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := seedanceMini1Request()
			test.change(&request)
			_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
			if (err != nil) != test.wantErr {
				t.Fatalf("BuildCreate() error=%v, wantErr=%v", err, test.wantErr)
			}
		})
	}
}

func TestSeedanceMini1LifecycleAndActualResolution(t *testing.T) {
	adapter := officialPackageAdapter(t, "seedance-mini1.yingce-plugin", "seedance-mini1")
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task-mini1","status":"queued"}`))
	if err != nil || created.TaskID != "task-mini1" || created.Status != StatusPending {
		t.Fatalf("created = %#v, err=%v", created, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || poll.Method != "GET" || poll.Path != "/v1/videos/task-mini1" {
		t.Fatalf("poll = %#v, err=%v", poll, err)
	}
	for _, test := range []struct {
		name, payload string
		status        Status
	}{
		{"queued", `{"status":"queued","stage":"排队中","queue_position":2}`, StatusPending},
		{"running", `{"status":"in_progress","stage":"生成中 32s","queue_position":0,"error_code":"UPSTREAM_RISK"}`, StatusProcessing},
		{"completed", `{"status":"completed","url":"https://upstream.example/v1/videos/task-mini1/content","enhance":"4k","enhanced":"","width":1280,"height":720,"duration":6,"enhance_note":"保留原片"}`, StatusSucceeded},
		{"failed", `{"status":"failed","error":{"message":"参考图处理失败"},"error_code":"MATERIAL_BLOCKED","retriable":false}`, StatusFailed},
	} {
		t.Run(test.name, func(t *testing.T) {
			state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(test.payload))
			if err != nil || state.Status != test.status || state.TaskID != created.TaskID {
				t.Fatalf("state = %#v, err=%v", state, err)
			}
			if test.status == StatusProcessing && (state.Stage != "生成中 32s" || state.QueueAhead != 0) {
				t.Fatalf("progress = %#v", state)
			}
			if test.status == StatusFailed && state.Message != "参考图处理失败" {
				t.Fatalf("failure reason = %q", state.Message)
			}
			if test.status == StatusSucceeded {
				if state.Result == nil || len(state.Result.Videos) != 1 || !state.Result.Videos[0].Ephemeral {
					t.Fatalf("result = %#v", state.Result)
				}
				usage := state.Result.Usage
				if usage["enhanced"] != "" || usage["width"] != float64(1280) || usage["height"] != float64(720) || usage["outputDurationSeconds"] != float64(6) {
					t.Fatalf("actual output usage = %#v", usage)
				}
			}
		})
	}
	resultAdapter, ok := adapter.(ResultAdapter)
	if !ok {
		t.Fatal("binary result contract is missing")
	}
	result, err := resultAdapter.BuildResult(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil || result.Method != "GET" || result.Path != "/v1/videos/task-mini1/content" || result.Headers["Accept"] != "video/mp4" {
		t.Fatalf("result spec = %#v, err=%v", result, err)
	}
}

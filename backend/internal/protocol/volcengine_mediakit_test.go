package protocol

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

const mediaKitEnhanceProvider = "volcengine-mediakit-enhance-video"

func TestVolcengineMediaKitEnhanceVideoBuildsCreateRequest(t *testing.T) {
	adapter := officialPackageAdapter(t, "volcengine-mediakit.yingce-plugin", mediaKitEnhanceProvider)
	metadata := adapter.Metadata()
	if !metadata.Kind.IsProcessing() || !metadata.RequiresPublicMediaURLs {
		t.Fatalf("metadata = %#v", metadata)
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Resolution: "1080P",
		Videos:     []MediaReference{{URL: "https://cdn.example/source.mp4"}},
		ProviderOptions: map[string]map[string]any{
			mediaKitEnhanceProvider: {"fps": "60", "bitrate_level": "high"},
		},
		Extra: map[string]any{"idempotencyKey": "task-key-1"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Method != "POST" || spec.Path != "/api/v1/tools/enhance-video-generative" {
		t.Fatalf("create spec = %#v", spec)
	}
	body := manifestTestBody(t, spec)
	if body["video_url"] != "https://cdn.example/source.mp4" || body["resolution"] != "1080p" || body["fps"] != float64(60) || body["bitrate_level"] != "high" || body["client_token"] != "task-key-1" {
		t.Fatalf("create body = %#v", body)
	}
	if _, exists := body["bitrate"]; exists {
		t.Fatalf("empty bitrate must be omitted: %#v", body)
	}
}

func TestVolcengineMediaKitDepthPackage(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "volcengine-mediakit-depth.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	if pkg.Manifest.Metadata.Enabled {
		t.Fatal("depth plugin must be disabled by default")
	}
	adapter := officialPackageAdapter(t, "volcengine-mediakit-depth.yingce-plugin", "volcengine-mediakit-video-depth")
	if !adapter.Metadata().Kind.IsProcessing() || !adapter.Metadata().RequiresPublicMediaURLs {
		t.Fatalf("metadata = %#v", adapter.Metadata())
	}
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "local-model-alias", Resolution: "4k",
		Videos:          []MediaReference{{URL: "https://cdn.example/source.mp4"}},
		ProviderOptions: map[string]map[string]any{"volcengine-mediakit-video-depth": {"model": "other", "fps": 120, "callback_url": "https://ignored.example"}},
		Extra:           map[string]any{"idempotencyKey": "depth-key"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Method != "POST" || spec.Path != "/api/v1/tools/video-depth" || len(body) != 3 || body["video_url"] != "https://cdn.example/source.mp4" || body["model"] != "standard" || body["client_token"] != "depth-key" {
		t.Fatalf("create = %#v, body = %#v", spec, body)
	}
	for _, videos := range [][]MediaReference{nil, {{URL: "https://cdn.example/a"}, {URL: "https://cdn.example/b"}}} {
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Videos: videos}}); err == nil {
			t.Fatalf("accepted %d source videos", len(videos))
		}
	}
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"success":true,"task_id":"depth-1"}`))
	if err != nil || created.TaskID != "depth-1" || created.Status == StatusFailed {
		t.Fatalf("created=%#v err=%v", created, err)
	}
	poll := PollContext{TaskID: "depth-1"}
	spec, err = adapter.BuildPoll(context.Background(), poll)
	if err != nil || spec.Method != "GET" || spec.Path != "/api/v1/tasks/depth-1" {
		t.Fatalf("poll=%#v err=%v", spec, err)
	}
	running, err := adapter.ParsePoll(context.Background(), poll, []byte(`{"success":true,"status":"running"}`))
	if err != nil || running.Status != StatusProcessing {
		t.Fatalf("running=%#v err=%v", running, err)
	}
	done, err := adapter.ParsePoll(context.Background(), poll, []byte(`{"success":true,"status":"completed","result":{"video_url":"https://out.example/depth.mp4?auth_key=temporary","duration":18.6}}`))
	if err != nil || done.Status != StatusSucceeded || done.Result == nil || len(done.Result.Videos) != 1 || !done.Result.Videos[0].Ephemeral || done.Result.Usage["outputDurationSeconds"] != 18.6 {
		t.Fatalf("done=%#v err=%v", done, err)
	}
	for _, body := range []string{`{"success":false,"error":{"code":"InvalidParameter","message":"invalid source"}}`, `{"success":true,"status":"failed","error":{"code":"DownloadFailed","message":"invalid source"}}`} {
		failed, err := adapter.ParsePoll(context.Background(), poll, []byte(body))
		if err != nil || failed.Status != StatusFailed || failed.Message != "invalid source" {
			t.Fatalf("failed=%#v err=%v", failed, err)
		}
	}
}

func TestVolcengineMediaKitEnhanceVideoKeepsSourceFpsByDefault(t *testing.T) {
	adapter := officialPackageAdapter(t, "volcengine-mediakit.yingce-plugin", mediaKitEnhanceProvider)
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Videos: []MediaReference{{URL: "https://cdn.example/source.mp4"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if body["resolution"] != "720p" {
		t.Fatalf("default resolution = %#v", body["resolution"])
	}
	for _, key := range []string{"fps", "bitrate", "bitrate_level"} {
		if _, exists := body[key]; exists {
			t.Fatalf("%s must be omitted when unset: %#v", key, body)
		}
	}
}

func TestVolcengineMediaKitEnhanceVideoRequiresSourceVideo(t *testing.T) {
	adapter := officialPackageAdapter(t, "volcengine-mediakit.yingce-plugin", mediaKitEnhanceProvider)
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{}}); err == nil {
		t.Fatal("create without source video was accepted")
	}
}

func TestVolcengineMediaKitEnhanceVideoParsesResponses(t *testing.T) {
	adapter := officialPackageAdapter(t, "volcengine-mediakit.yingce-plugin", mediaKitEnhanceProvider)
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"success":true,"task_id":"amk-1","request_id":"r"}`))
	if err != nil || created.TaskID != "amk-1" || created.Status == StatusFailed {
		t.Fatalf("created = %#v, err = %v", created, err)
	}
	rejected, err := adapter.ParseCreate(context.Background(), []byte(`{"success":false,"task_id":"","error":{"code":"InvalidParameter","message":"bad resolution","param":"resolution"}}`))
	if err != nil || rejected.Status != StatusFailed || rejected.Message != "bad resolution" {
		t.Fatalf("rejected = %#v, err = %v", rejected, err)
	}
	poll := PollContext{TaskID: "amk-1"}
	spec, err := adapter.BuildPoll(context.Background(), poll)
	if err != nil || spec.Method != "GET" || spec.Path != "/api/v1/tasks/amk-1" {
		t.Fatalf("poll spec = %#v, err = %v", spec, err)
	}
	running, err := adapter.ParsePoll(context.Background(), poll, []byte(`{"success":true,"task_id":"amk-1","status":"running"}`))
	if err != nil || running.Status != StatusProcessing {
		t.Fatalf("running = %#v, err = %v", running, err)
	}
	done, err := adapter.ParsePoll(context.Background(), poll, []byte(`{"success":true,"task_id":"amk-1","status":"completed","result":{"video_url":"https://out.example/v.mp4?auth_key=x","duration":65.5,"resolution":"1080p","fps":30}}`))
	if err != nil || done.Status != StatusSucceeded || done.Result == nil || len(done.Result.Videos) != 1 || done.Result.Videos[0].URL != "https://out.example/v.mp4?auth_key=x" {
		t.Fatalf("done = %#v, err = %v", done, err)
	}
	if done.Result.Usage["outputDurationSeconds"] != 65.5 || done.Result.Usage["outputFps"] != float64(30) {
		t.Fatalf("usage = %#v", done.Result.Usage)
	}
	failed, err := adapter.ParsePoll(context.Background(), poll, []byte(`{"success":true,"task_id":"amk-1","status":"failed","error":{"code":"DownloadFailed","message":"cannot download"}}`))
	if err != nil || failed.Status != StatusFailed || failed.Message != "cannot download" {
		t.Fatalf("failed = %#v, err = %v", failed, err)
	}
}

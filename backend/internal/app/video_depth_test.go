package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func TestVideoDepthCapabilityAndPricing(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(VolcengineMediaKitVideoDepthProtocol, "depth-alias")
	if err := validateVideoCapabilityConfig(profile.Video); err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
	if err != nil || len(spec.Operations) != 1 || spec.Operations[0] != "depth" || spec.Options["videoSeconds"].Max == nil || *spec.Options["videoSeconds"].Max != 600 {
		t.Fatalf("spec=%#v err=%v", spec, err)
	}
	for _, key := range []string{"fpsBand", "vquality", "size"} {
		if _, exists := spec.Options[key]; exists {
			t.Fatalf("depth must not use enhance option %s", key)
		}
	}
	for _, bad := range []*VideoProcessingConfig{
		{FPSPolicy: VideoProcessingFPSKeepSource, MaxSourceSeconds: 601},
		{FPSPolicy: VideoProcessingFPSUserSelect, FPSOptions: []int{30}},
	} {
		if err := validateVideoProcessingConfig(bad, VideoProcessingOperationDepth); err == nil {
			t.Fatalf("accepted %#v", bad)
		}
	}
	profile.Video.Processing.MaxSourceSeconds = 0
	if videoProcessingMaxSourceSeconds(profile.Video) != 600 {
		t.Fatal("depth default source duration must be 600 seconds")
	}
	intent := ModelRequestIntent{Capability: "video", Operation: "depth", Inputs: map[string]int{"video": 1}, Options: map[string]any{"videoSeconds": 300}}
	selector := skuSelectorForIntent(intent)
	if selector["operation"] != "depth" || selector["vquality"] != "" || selector["fpsBand"] != "" {
		t.Fatalf("selector=%#v", selector)
	}
	cm := model.ChannelModel{PriceTiers: []model.ChannelModelPriceTier{
		newSelectionPriceTier("enhance", `{"operation":"enhance"}`, "", "per_second"),
		newSelectionPriceTier("depth", `{"operation":"depth"}`, "", "per_second"),
	}}
	if tier := channelModelPriceTierForIntent(cm, intent); tier == nil || tier.ID != "depth" {
		t.Fatalf("depth price tier=%#v", tier)
	}
}

func TestVideoDepthAdmissionUsesOwnedSourceAndServerMeasurements(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel(VolcengineMediaKitVideoDepthProtocol, "depth-alias")
	s, db, channel, cm := createSystemChannelSelectionFixture(t, "video", model.ChannelInterfaceType(VolcengineMediaKitVideoDepthProtocol), profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("depth", `{"operation":"depth"}`, "standard", "per_second"),
	})
	if err := db.AutoMigrate(&model.Resource{}); err != nil {
		t.Fatal(err)
	}
	center, err := newPluginRuntime(s.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	s.pluginRuntime = center
	if metadata, ok := s.protocolMetadata(VolcengineMediaKitVideoDepthProtocol); !ok || metadata.Enabled {
		t.Fatalf("new plugin must be disabled: %#v", metadata)
	}
	if _, err := center.setEnabled("volcengine-mediakit-depth", true); err != nil {
		t.Fatal(err)
	}
	owner := testGroupUserID(s)
	resources := []model.Resource{
		{ID: "source", UserID: owner, Status: "ready", MimeType: "video/mp4", Width: 2560, Height: 1440, DurationMs: 300_500},
		{ID: "foreign", UserID: "other", Status: "ready", MimeType: "video/mp4", DurationMs: 1000},
		{ID: "long", UserID: owner, Status: "ready", MimeType: "video/mp4", DurationMs: 600_001},
		{ID: "unknown", UserID: owner, Status: "ready", MimeType: "video/mp4"},
		{ID: "image", UserID: owner, Status: "ready", MimeType: "image/png", DurationMs: 1000},
		{ID: "uploading", UserID: owner, Status: "uploading", MimeType: "video/mp4", DurationMs: 1000},
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}
	inputFor := func(key string) map[string]any {
		return map[string]any{
			"mode":              "video",
			"config":            map[string]any{"channelId": channel.ID, "model": cm.ModelKey, "videoSeconds": "1", "vquality": "4k", "size": "1:1", "fpsBand": "le120", "videoGenerateAudio": "true"},
			"capabilityOptions": map[string]any{"videoSeconds": 1, "vquality": "4k", "fpsBand": "le120"},
			"referenceVideos":   []any{map[string]any{"storageKey": key, "durationMs": 1}},
			"metadata":          map[string]any{"videoEditOperation": "enhance", "providerOptions": map[string]any{VolcengineMediaKitVideoDepthProtocol: map[string]any{"fps": 120, "model": "other"}, "other": map[string]any{"ignored": true}}},
		}
	}
	input := inputFor("resource:source")
	admission, err := s.prepareVideoProcessingTask(owner, input)
	if err != nil || admission == nil {
		t.Fatalf("admission=%#v err=%v", admission, err)
	}
	config := input["config"].(map[string]any)
	metadata := input["metadata"].(map[string]any)
	options := metadata["providerOptions"].(map[string]any)
	if config["videoSeconds"] != "301" || metadata["videoEditOperation"] != "depth" || metadata[videoProcessingMetadataKey] != true || len(options) != 1 || len(options[VolcengineMediaKitVideoDepthProtocol].(map[string]any)) != 0 {
		t.Fatalf("server input=%#v", input)
	}
	for _, key := range []string{"vquality", "fpsBand", "size", "videoGenerateAudio"} {
		if _, exists := config[key]; exists {
			t.Fatalf("stale generation option %s remained", key)
		}
	}
	if _, err := s.resolveSystemChannelModelSelection(testGroupAccess(s), input, "canvas_video", "depth"); err != nil {
		t.Fatalf("real system channel selection failed: %v", err)
	}
	for _, key := range []string{"resource:foreign", "resource:missing", "resource:long", "resource:unknown", "resource:image", "resource:uploading", "https://outside.example/source.mp4"} {
		if _, err := s.prepareVideoProcessingTask(owner, inputFor(key)); err == nil {
			t.Fatalf("accepted source %q", key)
		}
	}
	multiple := inputFor("resource:source")
	multiple["referenceVideos"] = append(multiple["referenceVideos"].([]any), map[string]any{"storageKey": "resource:source"})
	if _, err := s.prepareVideoProcessingTask(owner, multiple); err == nil {
		t.Fatal("accepted multiple source videos")
	}
}

func TestVideoDepthStubPersistsTemporaryResultAndMeasuresDuration(t *testing.T) {
	allowLoopbackProviderTest(t)
	s, db := newMediaRecoveryTestService(t)
	s.coordinator = platform.NewCoordinatorWithRedis(nil, "video-depth-test")
	s.platform = platform.New(s.repo, s.coordinator, platformHost{svc: s})
	center, err := newPluginRuntime(s.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := center.setEnabled("volcengine-mediakit-depth", true); err != nil {
		t.Fatal(err)
	}
	adapter, ok := center.registrySnapshot().Resolve(VolcengineMediaKitVideoDepthProtocol)
	if !ok {
		t.Fatal("missing depth adapter")
	}
	var server *httptest.Server
	creates, polls, downloads := 0, 0, 0
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/tools/video-depth":
			creates++
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			if r.Method != "POST" || body["model"] != "standard" || body["video_url"] != "https://cdn.example/source.mp4" || r.Header.Get("Authorization") != "Bearer stub-key" {
				t.Errorf("create request=%#v", body)
			}
			_, _ = w.Write([]byte(`{"success":true,"task_id":"depth-stub"}`))
		case "/api/v1/tasks/depth-stub":
			polls++
			_, _ = fmt.Fprintf(w, `{"success":true,"task_id":"depth-stub","status":"completed","result":{"video_url":%q,"duration":18.6}}`, server.URL+"/result.mp4?auth_key=temporary")
		case "/result.mp4":
			downloads++
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("stub transport bytes"))
		default:
			t.Errorf("unexpected request: %s", r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	config := providerConfig{BaseURL: server.URL, APIKey: "stub-key", InterfaceType: VolcengineMediaKitVideoDepthProtocol, Model: "depth-alias"}
	task := seedMediaTask(t, db, config)
	task.Type = "canvas_video"
	task.InputJSON = `{"mode":"video","metadata":{"videoProcessing":true}}`
	if err := db.Save(task).Error; err != nil {
		t.Fatal(err)
	}
	ctx := context.WithValue(withProviderAnalytics(context.Background(), s, *task), mediaExecutionTaskKey{}, *task)
	result, err := runProtocolAdapterTaskWithPolicy(ctx, canvasGenerationInput{Mode: "video", Config: config, ReferenceVideos: []providerMedia{{URL: "https://cdn.example/source.mp4"}}}, adapter, fastVideoPollPolicy())
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if creates != 1 || polls != 1 || downloads != 1 || strings.Contains(string(encoded), "auth_key") || strings.Contains(string(encoded), server.URL) {
		t.Fatalf("requests=%d/%d/%d result=%s", creates, polls, downloads, encoded)
	}
	task.ResultJSON = string(encoded)
	id, _ := taskOutputResource(task.ResultJSON, task.Type)
	resource, err := s.repo.ResourceForUser(task.UserID, id)
	if err != nil || resource.Status != "ready" || resource.Provider != "local" {
		t.Fatalf("persisted resource=%#v err=%v", resource, err)
	}
	if _, err := s.repo.ResourceForUser("other", id); err == nil {
		t.Fatal("persisted result readable by another user")
	}
	duration, handled, err := s.VideoProcessingOutputDurationMs(*task)
	if err != nil || !handled || duration != 18_600 {
		t.Fatalf("provider duration=%d handled=%v err=%v", duration, handled, err)
	}
	if err := db.Model(resource).Update("duration_ms", 18_550).Error; err != nil {
		t.Fatal(err)
	}
	if duration, _, err := s.VideoProcessingOutputDurationMs(*task); err != nil || duration != 18_550 {
		t.Fatalf("measured duration=%d err=%v", duration, err)
	}
	task.ResultJSON = `{"mode":"video"}`
	if _, handled, err := s.VideoProcessingOutputDurationMs(*task); !handled || err == nil {
		t.Fatal("missing output duration must require review")
	}
}

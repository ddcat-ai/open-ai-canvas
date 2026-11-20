package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
)

func TestAdminChannelModelSendsDeclaredVideoDefaults(t *testing.T) {
	allowLoopbackProviderTest(t)
	t.Setenv("REDIS_URL", "")
	service, db := newMediaRecoveryTestService(t)
	var err error
	service.coordinator, err = platform.NewCoordinator("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	var requests []map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		requests = append(requests, body)
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{"status":"succeeded","video_url":"data:video/mp4;base64,dmlkZW8="}`))
	}))
	defer upstream.Close()
	channel := model.ModelChannel{ID: "admin-test", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstream.URL, APIKey: "fixture"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	req := ChannelModelRequest{ModelKey: "doubao-seedance-2-0-mini-260615", Capability: "video", Protocol: "volcengine-ark-video"}
	if _, err := service.TestAdminChannelModel(t.Context(), admin, channel.ID, req); err == nil {
		t.Fatal("missing video profile accepted")
	}
	req.CapabilityConfig = DefaultModelCapabilityConfigForModel(req.Protocol, req.ModelKey)
	video := req.CapabilityConfig.Video
	video.DefaultRatio, video.DefaultResolution, video.Duration.Default = "9:16", "480p", 8
	if _, err := service.TestAdminChannelModel(t.Context(), admin, channel.ID, req); err != nil {
		t.Fatal(err)
	}
	if len(requests) != 1 || requests[0]["ratio"] != "9:16" || requests[0]["resolution"] != "480p" || requests[0]["duration"] != float64(8) {
		t.Fatalf("upstream requests: %v", requests)
	}
}

package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestChannelFromRequestStoresInterfaceType(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()

	channel, err := channelFromRequest(ChannelRequest{
		Name:             "NewAPI 渠道 1",
		BaseURL:          server.URL + "/v1",
		APIKey:           "secret",
		InterfaceType:    "newapi-channel-1",
		ConcurrencyLimit: intPtr(6),
		Models:           []string{"seedance-2.0"},
	}, model.ModelChannel{})
	if err != nil {
		t.Fatalf("channelFromRequest() error = %v", err)
	}
	if channel.InterfaceType != model.ChannelInterfaceNewAPIChannel1 {
		t.Fatalf("InterfaceType = %q", channel.InterfaceType)
	}
	if channel.APIFormat != "openai" {
		t.Fatalf("APIFormat = %q, want openai", channel.APIFormat)
	}
	if channel.ConcurrencyLimit != 6 {
		t.Fatalf("ConcurrencyLimit = %d, want 6", channel.ConcurrencyLimit)
	}
}

func TestChannelFromRequestStoresXAIVideoInterfaceType(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	server := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	defer server.Close()

	channel, err := channelFromRequest(ChannelRequest{
		Name:          "xAI Video",
		BaseURL:       server.URL + "/v1",
		APIKey:        "secret",
		InterfaceType: "xai-video",
		Models:        []string{"grok-imagine-video-1.5"},
	}, model.ModelChannel{})
	if err != nil {
		t.Fatalf("channelFromRequest() error = %v", err)
	}
	if channel.InterfaceType != model.ChannelInterfaceXAIVideo {
		t.Fatalf("InterfaceType = %q", channel.InterfaceType)
	}
}

func TestMergeChannelRequestSupportsEnabledOnlyPatch(t *testing.T) {
	enabled := false
	req := mergeChannelRequest(ChannelRequest{Enabled: &enabled}, model.ModelChannel{
		Name:       "Video",
		BaseURL:    "https://example.com/v1",
		APIFormat:  "openai",
		ModelsJSON: `["custom-video"]`,
	})
	if req.Name != "Video" || req.BaseURL != "https://example.com/v1" || req.InterfaceType != "newapi" || len(req.Models) != 1 {
		t.Fatalf("mergeChannelRequest() = %#v", req)
	}
}

func TestChannelFromRequestRejectsUnknownInterfaceType(t *testing.T) {
	_, err := channelFromRequest(ChannelRequest{Name: "Bad", BaseURL: "https://example.com/v1", InterfaceType: "unknown"}, model.ModelChannel{})
	if err == nil {
		t.Fatal("channelFromRequest() error = nil")
	}
}

func TestChannelFromRequestRejectsInvalidConcurrencyLimit(t *testing.T) {
	for _, limit := range []int{0, 1000} {
		_, err := channelFromRequest(ChannelRequest{Name: "Bad", BaseURL: "https://example.com/v1", InterfaceType: "newapi", ConcurrencyLimit: &limit}, model.ModelChannel{})
		if err == nil {
			t.Fatalf("channelFromRequest() concurrencyLimit = %d, error = nil", limit)
		}
	}
}

func TestRuntimeConcurrencyUsesEnvironmentFallback(t *testing.T) {
	t.Setenv("CANVAS_CHANNEL_CONCURRENCY", "7")
	t.Setenv("CANVAS_WORKER_CONCURRENCY", "9")
	setting := defaultRuntimePolicy().Task
	if setting.ChannelConcurrency != 7 || setting.WorkerConcurrency != 9 {
		t.Fatalf("runtimeConcurrencyFromEnvironment() = %#v", setting)
	}

	useGlobal := true
	channel, err := channelFromRequest(ChannelRequest{Name: "Global", BaseURL: "https://example.com/v1", InterfaceType: "newapi", UseGlobalConcurrency: &useGlobal}, model.ModelChannel{ConcurrencyLimit: 4})
	if err != nil || channel.ConcurrencyLimit != 0 {
		t.Fatalf("global concurrency channel = %#v, error = %v", channel, err)
	}
}

func intPtr(value int) *int { return &value }

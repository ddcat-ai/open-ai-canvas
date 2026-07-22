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
		Name:          "NewAPI 渠道 1",
		BaseURL:       server.URL + "/v1",
		APIKey:        "secret",
		InterfaceType: "newapi-channel-1",
		Models:        []string{"seedance-2.0"},
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

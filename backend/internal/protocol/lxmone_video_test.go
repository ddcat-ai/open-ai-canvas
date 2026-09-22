package protocol

import (
	"context"
	"encoding/json"
	"testing"
)

func TestOfficialLxmoneVideoResultURLs(t *testing.T) {
	providers := []string{
		"lxmone-wan-videos", "lxmone-wan-channel-s", "lxmone-seedance-videos", "lxmone-h3-max-videos",
		"lxmone-sd-videos", "lxmone-sd-mini-videos", "lxmone-grok-videos", "lxmone-h3-workflow",
	}
	const directURL = "https://cdn.example.com/generated.mp4?signature=test"
	for _, provider := range providers {
		t.Run(provider, func(t *testing.T) {
			adapter := officialPackageAdapter(t, "lxmone-video-suite.yingce-plugin", provider)
			for _, tc := range []struct {
				name    string
				payload map[string]any
			}{
				{"direct_over_relative", map[string]any{"id": "video-test", "status": "completed", "metadata": map[string]any{"url": "/v1/videos/video-test/content", "direct_url": directURL}}},
				{"nested_direct_over_relative", map[string]any{"metadata": map[string]any{"url": "/v1/videos/video-test/content"}, "data": map[string]any{"id": "video-test", "status": "completed", "metadata": map[string]any{"url": "/v1/videos/video-test/content", "direct_url": directURL}}}},
				{"absolute_url_without_direct", map[string]any{"id": "video-test", "status": "completed", "metadata": map[string]any{"url": directURL}}},
			} {
				t.Run(tc.name, func(t *testing.T) {
					body, err := json.Marshal(tc.payload)
					if err != nil {
						t.Fatal(err)
					}
					created, err := adapter.ParseCreate(context.Background(), body)
					if err != nil {
						t.Fatal(err)
					}
					polled, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "video-test"}, body)
					if err != nil {
						t.Fatal(err)
					}
					if created.Status != StatusSucceeded || polled.Status != StatusSucceeded || created.TaskID != "video-test" || polled.TaskID != "video-test" {
						t.Fatalf("unexpected completion: create=%#v poll=%#v", created, polled)
					}
					for _, result := range []*Result{created.Result, polled.Result} {
						if result == nil || len(result.Videos) != 1 || result.Videos[0].URL != directURL {
							t.Fatalf("expected direct download URL, got %#v", result)
						}
					}
				})
			}
		})
	}
}

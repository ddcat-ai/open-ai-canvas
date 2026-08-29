package service

import "testing"

func TestProviderProgressFromResponse(t *testing.T) {
	tests := []struct {
		name string
		body string
		want int
		ok   bool
	}{
		{name: "direct number", body: `{"progress":35}`, want: 35, ok: true},
		{name: "nested percent string", body: `{"data":{"task":{"progress_percent":"68%"}}}`, want: 68, ok: true},
		{name: "fraction", body: `{"result":{"progress":0.42}}`, want: 42, ok: true},
		{name: "fractional explicit percent", body: `{"progress":"0.5%"}`, want: 1, ok: true},
		{name: "camel case", body: `{"operation":{"progressPercentage":87.6}}`, want: 88, ok: true},
		{name: "unrelated completion tokens", body: `{"usage":{"completion_tokens":120}}`, ok: false},
		{name: "invalid range", body: `{"progress":140}`, ok: false},
		{name: "not json", body: `not-json`, ok: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := providerProgressFromResponse([]byte(tt.body))
			if got != tt.want || ok != tt.ok {
				t.Fatalf("providerProgressFromResponse() = (%d, %v), want (%d, %v)", got, ok, tt.want, tt.ok)
			}
		})
	}
}

func TestTaskUsesUpstreamReportedProgress(t *testing.T) {
	for _, taskType := range []string{"canvas_image", "canvas_video", "video_shot"} {
		if !taskUsesUpstreamReportedProgress(taskType) {
			t.Fatalf("task type %q should use upstream progress", taskType)
		}
	}
	for _, taskType := range []string{"canvas_text", "canvas_audio", "agent_storyboard"} {
		if taskUsesUpstreamReportedProgress(taskType) {
			t.Fatalf("task type %q should keep internal progress", taskType)
		}
	}
}

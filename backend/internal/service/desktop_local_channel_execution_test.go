package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestLocalExecutionPathsApplyLoopbackPolicyBeyondConfigResolution(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "false")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "")
	requests := map[string]int{}
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests[r.URL.Path]++
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodDelete && r.URL.Path == "/api/v3/contents/generations/tasks/cancel-task":
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && r.URL.Path == "/v1/video/generations/recovery-task":
			_, _ = w.Write([]byte(`{"data":{"status":"IN_PROGRESS"}}`))
		case r.Method == http.MethodPost && r.URL.Path == "/v1/chat/completions":
			_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"storyboard-ok"}}]}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer upstream.Close()

	open := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}
	closed := &Service{}
	tests := []struct {
		name       string
		config     providerConfig
		path       string
		runRequest func(context.Context, providerConfig) error
	}{
		{
			name:   "cancel",
			config: providerConfig{BaseURL: upstream.URL + "/api/v3", APIKey: "key", Model: "video-model", InterfaceType: string(model.ChannelInterfaceVolcengineArkVideo), AllowLocalChannel: true},
			path:   "/api/v3/contents/generations/tasks/cancel-task",
			runRequest: func(ctx context.Context, config providerConfig) error {
				return cancelProviderTask(ctx, config, "cancel-task")
			},
		},
		{
			name:   "recovery",
			config: providerConfig{BaseURL: upstream.URL + "/v1", APIKey: "key", Model: "video-model", InterfaceType: string(model.ChannelInterfaceNewAPIChannel2), AllowLocalChannel: true},
			path:   "/v1/video/generations/recovery-task",
			runRequest: func(ctx context.Context, config providerConfig) error {
				_, _, err := queryNewAPIChannel2VideoTask(ctx, canvasGenerationInput{Mode: "video", Config: config}, "recovery-task")
				return err
			},
		},
		{
			name:   "storyboard",
			config: providerConfig{BaseURL: upstream.URL + "/v1", APIKey: "key", Model: "text-model", InterfaceType: string(model.ChannelInterfaceChatCompletion), AllowLocalChannel: true},
			path:   "/v1/chat/completions",
			runRequest: func(ctx context.Context, config providerConfig) error {
				result, err := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: "storyboard", Config: config})
				if err != nil {
					return err
				}
				if result["text"] != "storyboard-ok" {
					return fmt.Errorf("storyboard text = %v", result["text"])
				}
				return nil
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := closed.resolveProviderConfig(test.config); err == nil {
				t.Fatal("capability=false must reject local execution before any outbound request")
			}
			before := requests[test.path]
			resolved, err := open.resolveProviderConfig(test.config)
			if err != nil {
				t.Fatalf("resolveProviderConfig() error = %v", err)
			}
			if err := test.runRequest(context.Background(), resolved); err == nil {
				t.Fatal("local request without loopback policy context must still fail SSRF validation")
			}
			if requests[test.path] != before {
				t.Fatal("request without loopback policy must not reach upstream")
			}
			ctx := withProviderOutboundPolicy(context.Background(), resolved)
			if err := test.runRequest(ctx, resolved); err != nil {
				t.Fatalf("local request with loopback policy error = %v", err)
			}
			if requests[test.path] != before+1 {
				t.Fatalf("upstream requests = %d, want %d", requests[test.path], before+1)
			}
		})
	}
}

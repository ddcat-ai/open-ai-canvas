package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestRunningHubVideoPollRecoversFromTransientGatewayFailure(t *testing.T) {
	pollCalls := 0
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/task/openapi/outputs":
			pollCalls++
			w.Header().Set("Content-Type", "application/json")
			if pollCalls == 1 {
				w.WriteHeader(http.StatusBadGateway)
				return
			}
			_, _ = w.Write([]byte(`{"code":0,"data":[{"fileUrl":"` + server.URL + `/result.mp4"}]}`))
		case "/result.mp4":
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("video"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	config := providerConfig{BaseURL: server.URL, APIKey: "test-key", AllowLocalChannel: true}
	ctx := withProviderOutboundPolicy(context.Background(), config)
	result, err := (&Service{}).pollRunningHubVideoWorkflowWithPolicy(ctx, config, server.URL, "provider-task-1", fastVideoPollPolicy())
	if err != nil {
		t.Fatal(err)
	}
	if result["mode"] != "video" || pollCalls != 2 {
		t.Fatalf("result = %#v, poll calls = %d", result, pollCalls)
	}
}

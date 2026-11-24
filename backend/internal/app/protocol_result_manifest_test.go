package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"yingce/backend/internal/protocol"
)

func TestProtocolJSONResultDownloadsReferencedMedia(t *testing.T) {
	allowLoopbackProviderTest(t)
	raw := []byte(`{"apiVersion":"yingce.plugin/v2","id":"example-results","version":"1.0.0","name":"Example","author":"Test","documentation":"# Example","contributes":{"providers":[{"id":"example-results","label":"Example","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/jobs"},"poll":{"method":"GET","path":"/jobs/{{taskId}}"},"result":{"method":"GET","path":"/jobs/{{taskId}}/outputs"},"response":{"videos":{"$map":{"from":{"$ref":"response.outputs"},"as":"output","in":{"url":{"$ref":"output.url"}}}}}}]}}`)
	adapters, err := protocol.LoadInstalledProviders(raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{"job_id":"job-1","outputs":[{"url":"/view?filename=result.mp4"}]}`, `{"job_id":"job-1","outputs":[{"url":"media/result.mp4"}]}`, `{"job_id":"job-1","outputs":[]}`} {
		downloads := 0
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch r.URL.Path {
			case "/v1/jobs/job-1/outputs":
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(body))
			case "/view", "/v1/jobs/job-1/media/result.mp4":
				downloads++
				w.Header().Set("Content-Type", "video/mp4")
				_, _ = w.Write([]byte("video bytes"))
			default:
				t.Errorf("unexpected upstream request: %s", r.URL.Path)
				http.NotFound(w, r)
			}
		}))
		result, err := finishProtocolAdapterResult(context.Background(), canvasGenerationInput{Mode: "video", Config: providerConfig{BaseURL: server.URL}}, adapters[0], protocol.GenerationRequest{}, "job-1", nil, fastVideoPollPolicy())
		server.Close()
		if body == `{"job_id":"job-1","outputs":[]}` {
			if err == nil || downloads != 0 {
				t.Fatalf("empty manifest: result=%v error=%v downloads=%d", result, err, downloads)
			}
		} else if err != nil || downloads != 1 || result["mode"] != "video" {
			t.Fatalf("download: result=%v error=%v downloads=%d", result, err, downloads)
		}
	}
}

func TestProtocolPollResultDownloadsRootRelativeMedia(t *testing.T) {
	allowLoopbackProviderTest(t)
	raw := []byte(`{"apiVersion":"yingce.plugin/v2","id":"example-relative-result","version":"1.0.0","name":"Example Relative Result","author":"Test","documentation":"# Example","contributes":{"providers":[{"id":"example-relative-result","label":"Example Relative Result","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/v1/videos"},"poll":{"method":"GET","path":"/v1/videos/{{taskId}}"},"response":{"taskId":{"$ref":"response.id"},"status":{"$ref":"response.status"},"videos":{"$ref":"response.result.url"},"resultEphemeral":true}}]}}`)
	adapters, err := protocol.LoadInstalledProviders(raw, nil)
	if err != nil {
		t.Fatal(err)
	}
	downloads := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/media/clip.mp4" {
			t.Errorf("unexpected media path: %s", r.URL.Path)
			http.NotFound(w, r)
			return
		}
		downloads++
		w.Header().Set("Content-Type", "video/mp4")
		_, _ = w.Write([]byte("video bytes"))
	}))
	defer server.Close()

	request := protocol.GenerationRequest{Capability: protocol.CapabilityVideo, Model: "muse2-model"}
	state, err := adapters[0].ParsePoll(context.Background(), protocol.PollContext{
		BaseURL: server.URL,
		Model:   request.Model,
		Request: request,
		TaskID:  "task-1",
	}, []byte(`{"id":"task-1","status":"succeeded","result":{"url":"/v1/media/clip.mp4"}}`))
	if err != nil {
		t.Fatal(err)
	}
	result, err := finishProtocolAdapterResult(
		context.Background(),
		canvasGenerationInput{Mode: "video", Config: providerConfig{BaseURL: server.URL}},
		adapters[0], request, "task-1", state.Result, fastVideoPollPolicy(),
	)
	if err != nil || result["mode"] != "video" || downloads != 1 {
		t.Fatalf("result=%v error=%v downloads=%d", result, err, downloads)
	}
}

func TestResolveProtocolMediaURL(t *testing.T) {
	tests := []struct {
		name, baseURL, rawURL, want string
		wantErr                     bool
	}{
		{name: "root-relative", baseURL: "http://upstream.example:18610", rawURL: "/v1/media/clip.mp4", want: "http://upstream.example:18610/v1/media/clip.mp4"},
		{name: "absolute CDN", baseURL: "http://upstream.example:18610", rawURL: "https://cdn.example/clip.mp4", want: "https://cdn.example/clip.mp4"},
		{name: "scheme-relative", baseURL: "http://upstream.example:18610", rawURL: "//cdn.example/clip.mp4", wantErr: true},
		{name: "unsupported scheme", baseURL: "http://upstream.example:18610", rawURL: "javascript:alert(1)", wantErr: true},
		{name: "invalid base", baseURL: "/v1", rawURL: "/v1/media/clip.mp4", wantErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := resolveProtocolMediaURL(test.baseURL, test.rawURL)
			if (err != nil) != test.wantErr {
				t.Fatalf("resolveProtocolMediaURL() error=%v, wantErr=%v", err, test.wantErr)
			}
			if err == nil && got != test.want {
				t.Fatalf("resolveProtocolMediaURL()=%q, want %q", got, test.want)
			}
		})
	}
}

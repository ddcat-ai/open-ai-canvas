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

package app

import (
	"context"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/protocol"
)

func TestProtocolMediaDownloadValidatesContentAndKeepsOrigin(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7j8AAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, mime string
		data       []byte
		valid      bool
	}{
		{"png", "image/png", png, true},
		{"unknown MIME", "application/octet-stream", png, true},
		{"HTML gateway page", "text/html", []byte("<!doctype html><html>gateway</html>"), false},
		{"HTML mislabeled as PNG", "image/png", []byte("<!doctype html><html>gateway</html>"), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.URL.Path != "/r2/images/result" {
					t.Errorf("unexpected path: %s", r.URL.Path)
				}
				if r.Header.Get("Authorization") != "" {
					t.Error("provider credential leaked to download host")
				}
				w.Header().Set("Content-Type", tc.mime)
				_, _ = w.Write(tc.data)
			}))
			defer server.Close()
			data, _, err := protocolMediaBytes(context.Background(), providerConfig{BaseURL: "https://api.example.com/v1", APIKey: "private-key"}, protocol.MediaReference{URL: server.URL + "/r2/images/result"}, "image")
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, err=%v", tc.valid, err)
			}
			if tc.valid && len(data) != len(png) {
				t.Fatal("image bytes changed")
			}
			if calls != 1 {
				t.Fatalf("unexpected requests: %d", calls)
			}
		})
	}
}


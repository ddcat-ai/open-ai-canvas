package updaterclient

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"yingce/backend/internal/hostupdate"
)

func TestSourceRequestsPreserveProtocolAndConflict(t *testing.T) {
	sources := hostupdate.Sources{GitHubSource: "gh_proxy", ImageSource: "nju"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer updater-test-token" {
			t.Error("missing updater authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/sources" {
			if r.Method != http.MethodPut {
				t.Error("wrong source save method")
			}
			var received hostupdate.Sources
			if err := json.NewDecoder(r.Body).Decode(&received); err != nil || received != sources {
				t.Error("wrong source payload", err)
			}
			_ = json.NewEncoder(w).Encode(hostupdate.Status{Sources: &sources})
			return
		}
		if r.URL.Path != "/v1/sources/test" || r.Method != http.MethodPost {
			t.Error("wrong source test endpoint")
		}
		w.WriteHeader(http.StatusConflict)
		_ = json.NewEncoder(w).Encode(map[string]any{"error": "busy", "data": hostupdate.Status{Sources: &sources}})
	}))
	defer server.Close()
	client := &Client{baseURL: server.URL, token: "updater-test-token", http: server.Client()}
	status, err := client.SaveSources(context.Background(), sources)
	if err != nil || status.Sources == nil || *status.Sources != sources {
		t.Fatal("source save contract failed", err)
	}
	status, err = client.TestSources(context.Background())
	var responseErr *ResponseError
	if !errors.As(err, &responseErr) || responseErr.HTTPStatus() != http.StatusConflict || status.Sources == nil {
		t.Fatal("updater conflict lost", err)
	}
}

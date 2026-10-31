package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestBackendPrivateShutdown(t *testing.T) {
	token := strings.Repeat("t", 64)
	for _, status := range []int{202, 404, 403, 307, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "POST" || r.URL.Path != "/_yingce_launcher/shutdown" || r.URL.RawQuery != "" {
					t.Errorf("unexpected request %s %s", r.Method, r.URL)
				}
				if r.Header.Get("X-Yingce-Shutdown-Token") != token {
					t.Error("missing management credential")
				}
				w.Header().Set("Location", "http://127.0.0.1:1/do-not-follow")
				w.WriteHeader(status)
			}))
			defer backend.Close()
			u, _ := url.Parse(backend.URL + "/old?remove=query")
			err := requestBackendShutdown(u, token)
			if (err == nil) != (status == 202) {
				t.Fatalf("status %d: %v", status, err)
			}
			if err != nil && strings.Contains(err.Error(), token) {
				t.Fatal("credential in error")
			}
		})
	}
}

func TestBackendPrivateShutdownMissingCredentialAndUnavailable(t *testing.T) {
	u, _ := url.Parse("http://127.0.0.1:1")
	if err := requestBackendShutdown(u, ""); err == nil {
		t.Fatal("accepted empty credential")
	}
	if err := requestBackendShutdown(u, strings.Repeat("t", 64)); err == nil {
		t.Fatal("accepted unavailable backend")
	}
}

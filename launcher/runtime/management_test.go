package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
)

func TestPrivateManagementBoundaries(t *testing.T) {
	token := strings.Repeat("t", 64)
	for _, tc := range []struct {
		name, method, path, host, remote, origin, fetch, credential string
		want                                                        int
	}{
		{"valid", "POST", "/_launcher/stop", "127.0.0.1:33123", "127.0.0.1:1234", "", "", token, 202},
		{"same-origin", "POST", "/_launcher/stop", "127.0.0.1:33123", "127.0.0.1:1234", "http://127.0.0.1:33123", "", token, 202},
		{"wrong-host", "POST", "/_launcher/stop", "localhost:33123", "127.0.0.1:1234", "", "", token, 403},
		{"remote", "POST", "/_launcher/stop", "127.0.0.1:33123", "192.0.2.1:1234", "", "", token, 403},
		{"bad-remote", "POST", "/_launcher/stop", "127.0.0.1:33123", "127.0.0.1", "", "", token, 403},
		{"origin", "POST", "/_launcher/stop", "127.0.0.1:33123", "127.0.0.1:1234", "https://evil.test", "", token, 403},
		{"null-origin", "POST", "/_launcher/stop", "127.0.0.1:33123", "127.0.0.1:1234", "null", "", token, 403},
		{"cross-site", "POST", "/_launcher/stop", "127.0.0.1:33123", "127.0.0.1:1234", "", "cross-site", token, 403},
		{"get", "GET", "/_launcher/stop", "127.0.0.1:33123", "127.0.0.1:1234", "", "", token, 405},
		{"missing-token", "POST", "/_launcher/stop", "127.0.0.1:33123", "127.0.0.1:1234", "", "", "", 403},
		{"wrong-token", "POST", "/_launcher/stop", "127.0.0.1:33123", "127.0.0.1:1234", "", "", strings.Repeat("x", 64), 403},
		{"query-token", "POST", "/_launcher/stop?token=" + token, "127.0.0.1:33123", "127.0.0.1:1234", "", "", "", 403},
		{"other-route", "GET", "/_launcher/unknown", "127.0.0.1:33123", "127.0.0.1:1234", "", "", token, 404},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var stopped int
			h := privateManagement(http.NotFoundHandler(), 33123, token, func() { stopped++ })
			r := httptest.NewRequest(tc.method, "http://"+tc.host+tc.path, nil)
			r.RemoteAddr = tc.remote
			if tc.origin != "" {
				r.Header.Set("Origin", tc.origin)
			}
			r.Header.Set("Sec-Fetch-Site", tc.fetch)
			if tc.credential != "" {
				r.Header.Set("X-Yingce-Runtime-Token", tc.credential)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != tc.want {
				t.Fatalf("status=%d want %d", w.Code, tc.want)
			}
			if (stopped == 1) != (tc.want == 202) {
				t.Fatalf("unexpected stop count %d", stopped)
			}
			if strings.Contains(w.Body.String(), token) {
				t.Fatal("credential in response")
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("management response is cacheable")
			}
		})
	}
}

func TestPrivateManagementConcurrentStops(t *testing.T) {
	var calls atomic.Int32
	token := strings.Repeat("t", 64)
	h := privateManagement(http.NotFoundHandler(), 33123, token, func() { calls.Add(1) })
	var group sync.WaitGroup
	for i := 0; i < 64; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			r := httptest.NewRequest("POST", "http://127.0.0.1:33123/_launcher/stop", nil)
			r.RemoteAddr = "127.0.0.1:1234"
			r.Header.Set("X-Yingce-Runtime-Token", token)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != 202 || !w.Flushed {
				t.Errorf("stop acknowledgement: %d flushed=%v", w.Code, w.Flushed)
			}
		}()
	}
	group.Wait()
	if calls.Load() != 1 {
		t.Fatalf("stop called %d times", calls.Load())
	}
}

func TestPrivateManagementDisabledAndDuplicateHeaders(t *testing.T) {
	token := strings.Repeat("t", 64)
	for _, kind := range []string{"disabled", "duplicate-token", "duplicate-origin"} {
		t.Run(kind, func(t *testing.T) {
			configured := token
			if kind == "disabled" {
				configured = ""
			}
			h := privateManagement(http.NotFoundHandler(), 33123, configured, func() { t.Error("unexpected stop") })
			r := httptest.NewRequest("POST", "http://127.0.0.1:33123/_launcher/stop", nil)
			r.RemoteAddr = "127.0.0.1:1234"
			r.Header.Set("X-Yingce-Runtime-Token", token)
			if kind == "duplicate-token" {
				r.Header.Add("X-Yingce-Runtime-Token", token)
			}
			if kind == "duplicate-origin" {
				r.Header.Add("Origin", "http://127.0.0.1:33123")
				r.Header.Add("Origin", "https://evil.test")
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			want := 403
			if kind == "disabled" {
				want = 404
			}
			if w.Code != want {
				t.Fatalf("status %d", w.Code)
			}
		})
	}
}

func TestPrivateManagementPassesNormalRequests(t *testing.T) {
	h := privateManagement(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(201)
	}), 33123, strings.Repeat("t", 64), func() { t.Fatal("stop called") })
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "http://127.0.0.1:33123/api/health/ready", nil))
	if w.Code != 201 {
		t.Fatalf("status %d", w.Code)
	}
}

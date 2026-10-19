package outbound

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestOutboundRedirectSafetySocket(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, status := range []int{307, 308} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var calls atomic.Int32
			sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				_, _ = io.Copy(io.Discard, r.Body)
			}))
			defer sink.Close()
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, sink.URL, status)
			}))
			defer source.Close()
			resp, err := ModelMediaHTTPClient(time.Second).Post(source.URL, "application/json", strings.NewReader(`{"prompt":"private"}`))
			if resp != nil {
				resp.Body.Close()
			}
			if err == nil || calls.Load() != 0 {
				t.Fatalf("POST redirect replay: error=%v destination calls=%d", err, calls.Load())
			}
		})
	}
	t.Run("cross_origin_credentials", func(t *testing.T) {
		keys := []string{"Authorization", "X-Api-Key", "X-Goog-Api-Key", "Api-Key", "X-Private-Credential", "Cookie"}
		sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			for _, key := range keys {
				if r.Header.Get(key) != "" {
					t.Errorf("cross-origin credential leaked: %s", key)
				}
			}
		}))
		defer sink.Close()
		source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, sink.URL, http.StatusFound)
		}))
		defer source.Close()
		req, _ := http.NewRequest(http.MethodGet, source.URL, nil)
		for _, key := range keys {
			req.Header.Set(key, "test-secret")
		}
		resp, err := ModelMediaHTTPClient(time.Second).Do(req)
		if err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
	})
}

func TestRedirectOriginComparison(t *testing.T) {
	for _, tc := range []struct {
		a, b string
		same bool
	}{
		{"https://EXAMPLE.com/a", "https://example.com:443/b", true},
		{"http://example.com", "http://example.com:80", true},
		{"https://example.com", "http://example.com", false},
		{"https://example.com", "https://sub.example.com", false},
		{"http://127.0.0.1:1234", "http://127.0.0.1:5678", false},
	} {
		a, _ := url.Parse(tc.a)
		b, _ := url.Parse(tc.b)
		if sameRedirectOrigin(a, b) != tc.same {
			t.Errorf("origin comparison: %s %s", tc.a, tc.b)
		}
	}
}

func TestOutboundRedirectScope(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	first, _ := http.NewRequest(http.MethodPost, "http://127.0.0.1/start", nil)
	next, _ := http.NewRequest(http.MethodPost, "http://127.0.0.1/end", nil)
	if err := OutboundHTTPClient(time.Second).CheckRedirect(next, []*http.Request{first}); err != nil {
		t.Fatalf("unrelated client policy changed: %v", err)
	}
	first.Method, next.Method = http.MethodGet, http.MethodGet
	if err := CustomRelayHTTPClient(time.Second).CheckRedirect(next, []*http.Request{first}); err == nil {
		t.Fatal("custom relay allowed a redirect")
	}
	client := ModelMediaHTTPClient(time.Second)
	next.URL.Host = "169.254.169.254"
	if err := client.CheckRedirect(next, []*http.Request{first}); err == nil {
		t.Fatal("redirect bypassed private address validation")
	}
	next.URL.Host = "127.0.0.1"
	if err := client.CheckRedirect(next, []*http.Request{first, first, first, first, first}); err == nil {
		t.Fatal("redirect limit bypassed")
	}
}

type redirectTestTransport struct{ handler http.Handler }

func (rt redirectTestTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	w := httptest.NewRecorder()
	rt.handler.ServeHTTP(w, req)
	response := w.Result()
	response.Request = req
	return response, nil
}

// Exercise net/http's real redirect loop without requiring a listening socket.
func TestOutboundRedirectSafety(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, status := range []int{307, 308} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			calls := 0
			client := ModelMediaHTTPClient(time.Second)
			client.Transport = redirectTestTransport{http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/start" {
					http.Redirect(w, r, "/sink", status)
					return
				}
				calls++
			})}
			resp, err := client.Post("http://127.0.0.1/start", "application/json", strings.NewReader(`{"prompt":"private"}`))
			if resp != nil {
				resp.Body.Close()
			}
			if err == nil || calls != 0 {
				t.Fatalf("POST redirect replay: error=%v destination calls=%d", err, calls)
			}
		})
	}
	for _, path := range []string{"/same", "/cross", "/return"} {
		t.Run(path, func(t *testing.T) {
			keys := []string{"Authorization", "X-Api-Key", "X-Goog-Api-Key", "Api-Key", "X-Private-Credential", "Cookie"}
			client := ModelMediaHTTPClient(time.Second)
			client.Transport = redirectTestTransport{http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch r.URL.Path {
				case "/same":
					http.Redirect(w, r, "/sink", 302)
					return
				case "/cross":
					http.Redirect(w, r, "http://127.0.0.1:8081/sink", 302)
					return
				case "/return":
					http.Redirect(w, r, "http://127.0.0.1:8081/back", 302)
					return
				case "/back":
					http.Redirect(w, r, "http://127.0.0.1/sink", 302)
				}
				for _, key := range keys {
					want := ""
					if path == "/same" {
						want = "test-secret"
					}
					if r.Header.Get(key) != want {
						t.Errorf("credential %s: got %q want %q", key, r.Header.Get(key), want)
					}
				}
			})}
			req, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1"+path, nil)
			for _, key := range keys {
				req.Header.Set(key, "test-secret")
			}
			resp, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			resp.Body.Close()
		})
	}
}

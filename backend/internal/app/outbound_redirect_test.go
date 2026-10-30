package app

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestModelMediaRedirectSockets(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, proxied := range []bool{false, true} {
		t.Run(fmt.Sprintf("proxy_%t", proxied), func(t *testing.T) {
			var proxyCalls, sinkCalls atomic.Int32
			proxyURL := ""
			if proxied {
				transport := &http.Transport{}
				defer transport.CloseIdleConnections()
				proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					proxyCalls.Add(1)
					next := r.Clone(r.Context())
					next.RequestURI = ""
					resp, err := transport.RoundTrip(next)
					if err != nil {
						t.Error(err)
						w.WriteHeader(502)
						return
					}
					defer resp.Body.Close()
					for key, values := range resp.Header {
						w.Header()[key] = values
					}
					w.WriteHeader(resp.StatusCode)
					_, _ = io.Copy(w, resp.Body)
				}))
				defer proxy.Close()
				proxyURL = proxy.URL
			}
			s, _ := newMediaRecoveryTestService(t)
			picture := mediaTestPNG(t)
			sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				sinkCalls.Add(1)
				for _, key := range []string{"Authorization", "X-Private-Credential"} {
					if r.Header.Get(key) != "" {
						t.Errorf("download leaked %s", key)
					}
				}
				w.Header().Set("Content-Type", "image/png")
				_, _ = w.Write(picture)
			}))
			defer sink.Close()
			source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodGet && r.Header.Get("X-Private-Credential") != "test-secret" {
					t.Error("initial media request lost its provider credentials")
				}
				http.Redirect(w, r, sink.URL, http.StatusTemporaryRedirect)
			}))
			defer source.Close()
			client := s.OutboundHTTPClientForChannel(time.Second, nil, proxyURL)
			defer client.CloseIdleConnections()
			resp, err := client.Post(source.URL, "application/json", strings.NewReader("{}"))
			if resp != nil {
				resp.Body.Close()
			}
			if err == nil || sinkCalls.Load() != 0 {
				t.Errorf("model replay: err=%v calls=%d", err, sinkCalls.Load())
			}
			ctx := context.WithValue(context.Background(), providerAnalyticsKey{}, providerAnalyticsContext{ProxyURL: proxyURL})
			config := providerConfig{BaseURL: source.URL, APIKey: "test-key", Headers: []OutboundHeader{{Name: "X-Private-Credential", Value: "test-secret"}}}
			name, mimeType, err := s.downloadTaskMedia(ctx, config, source.URL, "image")
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(s.mediaTempPath(name))
			if err != nil || !bytes.Equal(data, picture) || mimeType != "image/png" {
				t.Fatalf("download mismatch: mime=%s err=%v", mimeType, err)
			}
			if proxied && proxyCalls.Load() != 3 {
				t.Errorf("proxy calls=%d, want POST + GET + redirected GET", proxyCalls.Load())
			}
		})
	}
}

type redirectPolicyTransport struct{ handler http.Handler }

func (rt redirectPolicyTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	w := httptest.NewRecorder()
	rt.handler.ServeHTTP(w, req)
	response := w.Result()
	response.Request = req
	return response, nil
}

// Use net/http's redirect loop, including its restoration of initial headers
// on each hop and its POST-to-GET conversion for 301/302/303.
func TestProviderAndMediaRedirectPolicy(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s := &Service{}
	clients := map[string]func() *http.Client{
		"general":       func() *http.Client { return OutboundHTTPClient(time.Second) },
		"empty_proxy":   func() *http.Client { return OutboundHTTPClientWithProxy(time.Second, "") },
		"proxy":         func() *http.Client { return OutboundHTTPClientWithProxy(time.Second, "http://127.0.0.1:3128") },
		"channel":       func() *http.Client { return s.OutboundHTTPClientForChannel(time.Second, nil, "") },
		"channel_proxy": func() *http.Client { return s.OutboundHTTPClientForChannel(time.Second, nil, "http://127.0.0.1:3128") },
	}
	for name, newClient := range clients {
		t.Run(name, func(t *testing.T) {
			for _, method := range []string{"POST", "PUT", "PATCH", "DELETE"} {
				for _, status := range []int{301, 302, 303, 307, 308} {
					t.Run(fmt.Sprintf("%s_%d", method, status), func(t *testing.T) {
						calls := 0
						client := newClient()
						client.Transport = redirectPolicyTransport{http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
							if r.URL.Path == "/start" {
								http.Redirect(w, r, "/sink", status)
								return
							}
							calls++
						})}
						req, _ := http.NewRequest(method, "http://127.0.0.1/start", strings.NewReader("private body"))
						resp, err := client.Do(req)
						if resp != nil {
							resp.Body.Close()
						}
						if err == nil || calls != 0 {
							t.Fatalf("write redirect: error=%v destination calls=%d", err, calls)
						}
					})
				}
			}
			for _, method := range []string{"GET", "HEAD"} {
				for _, path := range []string{"/same", "/cross", "/return"} {
					t.Run(method+path, func(t *testing.T) {
						keys := []string{"Authorization", "X-Api-Key", "X-Goog-Api-Key", "Api-Key", "X-Private-Credential", "Cookie"}
						client := newClient()
						sinks := 0
						client.Transport = redirectPolicyTransport{http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
							default:
								sinks++
							}
							for _, key := range keys {
								want := ""
								if path == "/same" {
									want = "test-secret"
								}
								if r.Header.Get(key) != want {
									t.Errorf("header %s: got %q want %q", key, r.Header.Get(key), want)
								}
							}
						})}
						req, _ := http.NewRequest(method, "http://127.0.0.1"+path, nil)
						for _, key := range keys {
							req.Header.Set(key, "test-secret")
						}
						resp, err := client.Do(req)
						if err != nil {
							t.Fatal(err)
						}
						resp.Body.Close()
						if sinks != 1 {
							t.Fatalf("destination calls=%d", sinks)
						}
					})
				}
			}
		})
	}
}

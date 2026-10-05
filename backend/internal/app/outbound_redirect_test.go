package app

import (
	"net/http"
	"testing"
	"time"
)

func TestProviderAndMediaRedirectPolicy(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	s := &Service{}
	for name, client := range map[string]*http.Client{
		"provider_and_media": OutboundHTTPClient(time.Second),
		"system_relay":       s.OutboundHTTPClientForChannel(time.Second, nil),
	} {
		t.Run(name, func(t *testing.T) {
			first, _ := http.NewRequest(http.MethodPost, "http://127.0.0.1/start", nil)
			next, _ := http.NewRequest(http.MethodPost, "http://127.0.0.1/end", nil)
			if err := client.CheckRedirect(next, []*http.Request{first}); err == nil {
				t.Fatal("provider POST redirect accepted")
			}
			first.Method, next.Method = http.MethodGet, http.MethodGet
			next.URL.Host = "127.0.0.1:8081"
			next.Header.Set("X-Api-Key", "test-secret")
			if err := client.CheckRedirect(next, []*http.Request{first}); err != nil {
				t.Fatal(err)
			}
			if next.Header.Get("X-Api-Key") != "" {
				t.Fatal("media redirect retained credentials")
			}
		})
	}
}

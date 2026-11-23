package outbound

import (
	"net/http"
	"net/url"
	"testing"
	"time"
)

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
	if err := OutboundHTTPClientWithProxy(time.Second, "http://127.0.0.1:3128").CheckRedirect(next, []*http.Request{first}); err != nil {
		t.Fatalf("unrelated proxy client policy changed: %v", err)
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

func TestModelMediaProxyFailsClosed(t *testing.T) {
	client := ModelMediaHTTPClientWithProxy(time.Second, "ftp://127.0.0.1:1080")
	req, _ := http.NewRequest(http.MethodGet, "https://example.com", nil)
	if _, err := client.Do(req); err == nil {
		t.Fatal("invalid proxy accepted")
	}
}

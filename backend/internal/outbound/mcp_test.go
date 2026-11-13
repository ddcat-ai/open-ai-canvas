package outbound

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMCPPrivateEgressDoesNotInheritModelAllowlist(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1,localhost")
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_MCP_ALLOWED_PRIVATE_HOSTS", "")
	for _, raw := range []string{"http://127.0.0.1/mcp", "https://127.0.0.1/mcp", "https://169.254.169.254/mcp", "https://[::1]/mcp", "https://100.64.0.1/mcp"} {
		if _, err := ValidateMCPURL(t.Context(), raw); err == nil {
			t.Fatalf("MCP accepted private target %s through another service's allowlist", raw)
		}
	}
	t.Setenv("CANVAS_MCP_ALLOWED_PRIVATE_HOSTS", "127.0.0.1")
	if _, err := ValidateMCPURL(t.Context(), "http://127.0.0.1/mcp"); err != nil {
		t.Fatal(err)
	}
	if allowedPrivateMCPHost("127.0.0.1.example.com") {
		t.Fatal("MCP allowlist accepted a suffix match")
	}
}

func TestMCPTransportIgnoresProxyAndRejectsRedirect(t *testing.T) {
	t.Setenv("CANVAS_MCP_ALLOWED_PRIVATE_HOSTS", "127.0.0.1")
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:1")
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	transport := newMCPTransport()
	defer transport.CloseIdleConnections()
	if transport.Proxy != nil {
		t.Fatal("MCP must not use environment proxy resolution")
	}
	remote := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/private", http.StatusTemporaryRedirect)
	}))
	defer remote.Close()
	client := MCPHTTPClient(time.Second)
	client.Transport = transport
	if _, err := client.Get(remote.URL); err == nil {
		t.Fatal("MCP followed a redirect")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := transport.DialContext(ctx, "tcp", "127.0.0.1:1"); err == nil {
		t.Fatal("MCP dial ignored cancellation")
	}
}

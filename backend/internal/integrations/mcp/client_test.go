package mcpintegration

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return fn(r) }

func TestMCPTransportDoesNotForwardCredentialsAcrossOrigins(t *testing.T) {
	origin, _ := url.Parse("https://mcp.example.com/rpc")
	var calls atomic.Int32
	transport := guardedTransport{origin: origin, headers: map[string]string{"Authorization": "Bearer private-token"}, base: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls.Add(1)
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader("{}"))}, nil
	})}
	for _, raw := range []string{"https://other.example.com/rpc", "http://mcp.example.com/rpc", "https://mcp.example.com.evil.test/rpc", "https://127.0.0.1/rpc"} {
		req, _ := http.NewRequest("POST", raw, nil)
		if _, err := transport.RoundTrip(req); err == nil {
			t.Fatalf("unexpected credential forwarding to %s", raw)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("cross-origin requests reached network transport")
	}
}

func TestMCPDiscoveryBoundsAggregateDefinitions(t *testing.T) {
	t.Setenv("CANVAS_MCP_ALLOWED_PRIVATE_HOSTS", "127.0.0.1")
	server := mcp.NewServer(&mcp.Implementation{Name: "large-tools", Version: "1"}, nil)
	for i := 0; i < 10; i++ {
		server.AddTool(&mcp.Tool{Name: fmt.Sprintf("tool_%d", i), InputSchema: map[string]any{"type": "object", "properties": map[string]any{"value": map[string]any{"type": "string", "description": strings.Repeat("x", 28000)}}}}, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
			return &mcp.CallToolResult{}, nil
		})
	}
	remote := httptest.NewServer(mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, nil))
	defer remote.Close()
	if _, err := discover(t.Context(), remoteConfig{URL: remote.URL, Transport: "streamable_http"}); err == nil || !strings.Contains(err.Error(), "256 KiB") {
		t.Fatalf("aggregate tool schemas were not bounded: %v", err)
	}
}

func TestMCPMarketCustomAuthHeadersRequireSecretParameters(t *testing.T) {
	for _, name := range []string{"X-Auth", "Authentication", "X-Signature", "Authorization"} {
		input := TemplateInput{Name: "authentication", Transport: "streamable_http", Headers: map[string]string{name: "literal-credential"}}
		if err := validateTemplate(&input); err == nil {
			t.Fatalf("market exposed literal header %s", name)
		}
		input.Headers[name] = "{{credential}}"
		input.Parameters = []Parameter{{Name: "credential", Type: "string"}}
		if err := validateTemplate(&input); err == nil {
			t.Fatalf("market exposed string credential %s", name)
		}
		input.Parameters[0].Type = "secret"
		if err := validateTemplate(&input); err != nil {
			t.Fatalf("valid secret header %s: %v", name, err)
		}
	}
}

func TestMCPInputSchemaCannotLoadExternalReferences(t *testing.T) {
	if _, err := resolveSchema([]byte(`{"type":"object","properties":{"token":{"$ref":"http://127.0.0.1/private"}}}`)); err == nil {
		t.Fatal("external schema reference was accepted")
	}
	schema, err := resolveSchema([]byte(`{"type":"object","properties":{"value":{"$ref":"#/$defs/value"}},"$defs":{"value":{"type":"string"}}}`))
	if err != nil || schema.Validate(map[string]any{"value": "valid"}) != nil {
		t.Fatalf("local schema references should work: %v", err)
	}
}

func TestMCPLegacySSEDiscoveryAndInvocation(t *testing.T) {
	t.Setenv("CANVAS_MCP_ALLOWED_PRIVATE_HOSTS", "127.0.0.1")
	server := mcp.NewServer(&mcp.Implementation{Name: "sse-test", Version: "1"}, nil)
	mcp.AddTool(server, &mcp.Tool{Name: "echo", Description: "Echo"}, func(_ context.Context, _ *mcp.CallToolRequest, args struct {
		Text string `json:"text"`
	}) (*mcp.CallToolResult, any, error) {
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: args.Text}}}, nil, nil
	})
	handler := mcp.NewSSEHandler(func(*http.Request) *mcp.Server { return server }, nil)
	remote := httptest.NewServer(handler)
	defer remote.Close()
	cfg := remoteConfig{URL: remote.URL, Transport: "sse", Headers: map[string]string{}}
	tools, err := discover(context.Background(), cfg)
	if err != nil || len(tools) != 1 || tools[0].Name != "echo" {
		t.Fatalf("SSE discovery: %+v %v", tools, err)
	}
	result, err := invoke(context.Background(), cfg, "echo", map[string]any{"text": "hello"})
	if err != nil {
		t.Fatal(err)
	}
	content, ok := result["content"].([]any)
	if !ok || len(content) != 1 || content[0].(map[string]any)["text"] != "hello" {
		t.Fatalf("SSE invocation: %#v", result)
	}
}

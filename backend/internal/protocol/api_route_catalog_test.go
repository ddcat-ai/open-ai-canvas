package protocol

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestOfficialAPIRouteChatProfile(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "api-route-chat.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	provider := pkg.Manifest.Contributes.Providers[0]
	if provider.ID != "api-route-chat" || provider.BaseURL != "https://global.api-route.com" || provider.Auth.Type != "bearer" {
		t.Fatalf("API Route provider metadata = %#v", provider)
	}

	adapter := officialPackageAdapter(t, "api-route-chat.yingce-plugin", "api-route-chat")
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model:    "gpt-6.1-sol",
		Messages: []Message{{Role: "user", Content: "hello"}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	body := manifestTestBody(t, spec)
	if spec.Method != "POST" || spec.Path != "/v1/chat/completions" || body["model"] != "gpt-6.1-sol" {
		t.Fatalf("API Route request = %#v, body = %#v", spec, body)
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"choices":[{"message":{"content":"api route ok"}}],"usage":{"total_tokens":3}}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || result.Result.Text != "api route ok" {
		t.Fatalf("API Route response = %#v", result)
	}
	result, err = adapter.ParseCreate(context.Background(), []byte(`{"error":{"code":"invalid_api_key","message":"Invalid API key"}}`))
	if err == nil && result.Status == StatusSucceeded {
		t.Fatalf("API Route error was parsed as success: %#v", result)
	}
}

func TestOfficialAPIRouteAgentProfile(t *testing.T) {
	adapter := officialPackageAdapter(t, "api-route-chat.yingce-plugin", "api-route-chat")
	agent := adapter.(AgentAdapter)
	spec, err := agent.BuildAgent(context.Background(), AgentRequestContext{
		Model: "gpt-6.1-sol",
		Request: map[string]any{"chatCompletion": map[string]any{
			"model":    "stale-model",
			"messages": []map[string]any{{"role": "user", "content": "hello"}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/v1/chat/completions" || manifestTestBody(t, spec)["model"] != "gpt-6.1-sol" {
		t.Fatalf("API Route agent request = %#v", spec)
	}
	result, err := agent.ParseAgent(context.Background(), []byte(`{"choices":[{"message":{"content":"","tool_calls":[{"id":"call_1","type":"function","function":{"name":"inspect","arguments":"{}"}}]}}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(result.ToolCalls) != 1 || result.ToolCalls[0].Name != "inspect" || result.ToolCalls[0].Arguments != "{}" {
		t.Fatalf("API Route agent response = %#v", result)
	}
}

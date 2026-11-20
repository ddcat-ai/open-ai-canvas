package protocol

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTextWireForPath(t *testing.T) {
	tests := map[string]string{
		"/v1/chat/completions":                           TextWireChatCompletion,
		"/chat/completions":                              TextWireChatCompletion,
		"/openai/deployments/{{model}}/chat/completions": TextWireChatCompletion,
		"/v1/chat/completions/?api-version=2024-10-21":   TextWireChatCompletion,
		"/v1/responses":                                  TextWireResponses,
		"/v1/messages":                                   TextWireClaude,
		"/v2/chat":                                       "",
		"/api/chat":                                      "",
		"/v1/text/chatcompletion_v2":                     "",
		"/v1beta/models/{{model}}:generateContent":       "",
		"": "",
	}
	for path, want := range tests {
		if got := TextWireForPath(path); got != want {
			t.Errorf("TextWireForPath(%q) = %q, want %q", path, got, want)
		}
	}
	if got := TextWireForOperation("POST /v1/chat/completions"); got != TextWireChatCompletion {
		t.Fatalf("TextWireForOperation(POST) = %q", got)
	}
	if got := TextWireForOperation("GET /v1/chat/completions"); got != "" {
		t.Fatalf("TextWireForOperation(GET) = %q, want empty", got)
	}
}

// 官方文本插件的 ID 大多不是 chat-completion；宿主必须按声明路径识别线格式，
// 而不是按协议 ID。识别不出的非标准路径保持空值，继续完全按插件映射执行。
func TestOfficialTextProvidersDeclareTextWireByPath(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "..", "plugin-packages", "*.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	wires := map[string]string{}
	agentWires := map[string]string{}
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		pkg, err := ParsePluginPackage(data)
		if err != nil {
			continue
		}
		adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil)
		if err != nil {
			continue
		}
		for _, adapter := range adapters {
			metadata := adapter.Metadata()
			if !hasCapability(metadata.Categories, CapabilityText) {
				if metadata.TextWire != "" || metadata.AgentWire != "" {
					t.Errorf("non-text provider %s has text wire %q/%q", metadata.ID, metadata.TextWire, metadata.AgentWire)
				}
				continue
			}
			wires[metadata.ID] = metadata.TextWire
			agentWires[metadata.ID] = metadata.AgentWire
			if metadata.TextWire != TextWireForOperation(metadata.Create) && !strings.Contains(metadata.Create, "{") {
				t.Errorf("%s text wire %q does not match create %q", metadata.ID, metadata.TextWire, metadata.Create)
			}
		}
	}
	for _, id := range []string{"chat-completion", "deepseek-chat", "kimi-chat", "openrouter-chat", "zhipu-glm-chat", "xai-grok-chat", "mistral-chat", "azure-openai", "a6api-chat"} {
		if wires[id] != TextWireChatCompletion {
			t.Errorf("%s text wire = %q, want chat-completion", id, wires[id])
		}
	}
	if wires["openai-response"] != TextWireResponses || agentWires["openai-response"] != TextWireResponses {
		t.Errorf("openai-response wires = %q/%q", wires["openai-response"], agentWires["openai-response"])
	}
	if wires["claude-api"] != TextWireClaude || agentWires["claude-api"] != TextWireClaude {
		t.Errorf("claude-api wires = %q/%q", wires["claude-api"], agentWires["claude-api"])
	}
	if agentWires["deepseek-chat"] != TextWireChatCompletion {
		t.Errorf("deepseek-chat agent wire = %q", agentWires["deepseek-chat"])
	}
	for _, id := range []string{"cohere-chat-v2", "ollama-chat", "minimax-text-native", "gemini-generate-content", "aws-bedrock-converse"} {
		if _, ok := wires[id]; !ok {
			t.Errorf("official text provider %s is missing from the package catalog", id)
			continue
		}
		if wires[id] != "" || agentWires[id] != "" {
			t.Errorf("%s must keep its plugin-defined wire, got %q/%q", id, wires[id], agentWires[id])
		}
	}
}

func TestBuiltinTextAdaptersDeclareTextWire(t *testing.T) {
	for id, want := range map[string]string{"chat-completion": TextWireChatCompletion, "openai-response": TextWireResponses, "claude-api": TextWireClaude} {
		adapter, ok := Builtins().Get(id)
		if !ok {
			t.Fatalf("builtin %s missing", id)
		}
		if got := adapter.Metadata().TextWire; got != want {
			t.Errorf("builtin %s text wire = %q, want %q", id, got, want)
		}
	}
}

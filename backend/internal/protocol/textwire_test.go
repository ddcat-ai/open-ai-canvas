package protocol

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTextWireForCreatePath(t *testing.T) {
	cases := []struct {
		name   string
		create string
		want   TextWire
	}{
		// 官方 chat 类插件：协议 ID 不叫 chat-completion，但地址是 chat 格式。
		{name: "official deepseek-chat", create: "POST /v1/chat/completions", want: TextWireChatCompletion},
		{name: "official kimi-chat", create: "/v1/chat/completions", want: TextWireChatCompletion},
		{name: "official a6api-chat", create: "POST /chat/completions", want: TextWireChatCompletion},
		{name: "azure deployment path", create: "POST /openai/deployments/{{model}}/chat/completions", want: TextWireChatCompletion},
		{name: "vendor-chat", create: "POST /chat/completions", want: TextWireChatCompletion},
		// 内置的三个协议 ID 对应的地址。
		{name: "builtin chat-completion", create: "POST /chat/completions", want: TextWireChatCompletion},
		{name: "builtin openai-response", create: "POST /responses", want: TextWireResponses},
		{name: "builtin claude-api", create: "POST /v1/messages", want: TextWireClaudeAPI},
		// 宿主不认识的请求形状：保持插件自己解析。
		{name: "gemini generateContent", create: "POST /v1beta/models/{{model}}:generateContent", want: TextWireUnknown},
		{name: "cohere v2 chat", create: "POST /v2/chat", want: TextWireUnknown},
		{name: "ollama chat", create: "POST /api/chat", want: TextWireUnknown},
		{name: "empty", create: "  ", want: TextWireUnknown},
		// 只有 /completions 不算 chat 形态。
		{name: "legacy completions", create: "POST /v1/completions", want: TextWireUnknown},
		// 尾斜杠与查询串不影响推导。
		{name: "trailing slash", create: "POST /v1/chat/completions/", want: TextWireChatCompletion},
		{name: "query string", create: "POST /v1/responses?beta=true", want: TextWireResponses},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			if got := TextWireForCreatePath(test.create); got != test.want {
				t.Fatalf("TextWireForCreatePath(%q) = %q, want %q", test.create, got, test.want)
			}
		})
	}
}

func TestTextWireFieldNames(t *testing.T) {
	if got := TextOutputLimitField(TextWireChatCompletion); got != "max_tokens" {
		t.Fatalf("chat output limit field = %q", got)
	}
	if got := TextOutputLimitField(TextWireClaudeAPI); got != "max_tokens" {
		t.Fatalf("claude output limit field = %q", got)
	}
	if got := TextOutputLimitField(TextWireResponses); got != "max_output_tokens" {
		t.Fatalf("responses output limit field = %q", got)
	}
	if !TextWireRequiresChatStreamUsage(TextWireChatCompletion) {
		t.Fatal("chat wire must request stream usage")
	}
	if TextWireRequiresChatStreamUsage(TextWireResponses) || TextWireRequiresChatStreamUsage(TextWireClaudeAPI) {
		t.Fatal("only chat wire uses stream_options.include_usage")
	}
}

// 官方 chat 类插件必须能从已安装的插件包里推出 chat 格式。
func TestOfficialChatPluginsDeriveChatWire(t *testing.T) {
	paths, err := filepath.Glob(filepath.Join("..", "..", "..", "plugin-packages", "*.yingce-plugin"))
	if err != nil || len(paths) == 0 {
		t.Fatalf("official plugin packages: %v", err)
	}
	creates := map[string]string{}
	for _, path := range paths {
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			t.Fatalf("read %s: %v", filepath.Base(path), readErr)
		}
		pkg, parseErr := ParsePluginPackage(data)
		if parseErr != nil {
			t.Fatalf("parse %s: %v", filepath.Base(path), parseErr)
		}
		for _, provider := range pkg.Manifest.Contributes.Providers {
			creates[provider.ID] = provider.Create.Method + " " + provider.Create.Path
		}
	}

	cases := map[string]TextWire{
		// 官方 chat 类插件：地址是 chat 格式，协议 ID 不是 chat-completion。
		"deepseek-chat":   TextWireChatCompletion,
		"kimi-chat":       TextWireChatCompletion,
		"openrouter-chat": TextWireChatCompletion,
		"xai-grok-chat":   TextWireChatCompletion,
		"zhipu-glm-chat":  TextWireChatCompletion,
		"baichuan-chat":   TextWireChatCompletion,
		"azure-openai":    TextWireChatCompletion,
		// 内置三个协议 ID 对应的地址。
		"chat-completion": TextWireChatCompletion,
		"openai-response": TextWireResponses,
		"claude-api":      TextWireClaudeAPI,
		// 宿主不认识的请求形状：保持插件自己解析。
		"gemini-generate-content": TextWireUnknown,
		"vertex-gemini":           TextWireUnknown,
		"cohere-chat-v2":          TextWireUnknown,
		"ollama-chat":             TextWireUnknown,
		"dashscope-qwen-native":   TextWireUnknown,
		"minimax-text-native":     TextWireUnknown,
	}
	for id, want := range cases {
		create, ok := creates[id]
		if !ok {
			t.Fatalf("official provider %q missing from packages", id)
		}
		if got := TextWireForCreatePath(create); got != want {
			t.Fatalf("%s declared create %q, wire = %q, want %q", id, create, got, want)
		}
	}
}

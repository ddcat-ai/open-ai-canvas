package protocol

import (
	"encoding/json"
	"strings"
	"testing"
)

// Anthropic Messages 等协议拒绝 OpenAI image_url 内容块（HTTP 422 unknown variant）。
// 声明式插件宿主在 InterfaceType 为 claude-api 时必须把参考图组 type=image + source 块。
func TestManifestRequestClaudeWireImageBlocks(t *testing.T) {
	request := GenerationRequest{
		Capability:    CapabilityText,
		Model:         "deepseek-flash",
		Prompt:        "describe the product",
		InterfaceType: TextWireClaude,
		Images: []MediaReference{
			{DataURL: "data:image/png;base64,QUJD", Kind: "image"},
			{URL: "https://example.com/p.jpg", Kind: "image"},
		},
	}
	values := manifestRequestValues(request)
	messages, _ := values["messages"].([]any)
	if len(messages) == 0 {
		t.Fatal("no messages built")
	}
	last, _ := messages[len(messages)-1].(map[string]any)
	content, _ := last["content"].([]any)
	if len(content) != 3 {
		t.Fatalf("content blocks = %d, want 3 (text + 2 images)", len(content))
	}
	first, _ := content[1].(map[string]any)
	if first["type"] != "image" {
		t.Fatalf("first image block type = %v, want image", first["type"])
	}
	source, _ := first["source"].(map[string]any)
	if source["type"] != "base64" || source["media_type"] != "image/png" || source["data"] != "QUJD" {
		t.Fatalf("base64 source = %#v", source)
	}
	second, _ := content[2].(map[string]any)
	if second["type"] != "image" {
		t.Fatalf("second image block type = %v, want image", second["type"])
	}
	source2, _ := second["source"].(map[string]any)
	if source2["type"] != "url" || source2["url"] != "https://example.com/p.jpg" {
		t.Fatalf("url source = %#v", source2)
	}
	encoded, _ := json.Marshal(content)
	if strings.Contains(string(encoded), "image_url") {
		t.Fatalf("claude wire content must not contain image_url: %s", encoded)
	}
}

// 非 Claude 线保持 OpenAI image_url 内容块不变。
func TestManifestRequestOpenAIWireImageBlocks(t *testing.T) {
	request := GenerationRequest{
		Capability:    CapabilityText,
		Model:         "gpt-4o",
		Prompt:        "describe",
		InterfaceType: TextWireChatCompletion,
		Images:        []MediaReference{{DataURL: "data:image/png;base64,QUJD", Kind: "image"}},
	}
	values := manifestRequestValues(request)
	messages, _ := values["messages"].([]any)
	last, _ := messages[len(messages)-1].(map[string]any)
	content, _ := last["content"].([]any)
	image, _ := content[1].(map[string]any)
	if image["type"] != "image_url" {
		t.Fatalf("openai wire image block type = %v, want image_url", image["type"])
	}
}

func TestAnthropicWireForBaseURL(t *testing.T) {
	cases := map[string]bool{
		"https://api.anthropic.com":                true,
		"https://api.deepseek.com/anthropic":       true,
		"https://gateway.example.com/anthropic/v1": true,
		"https://gateway.example.com/claude":       true,
		"https://api.openai.com/v1":                false,
		"https://api.deepseek.com/v1":              false,
		"https://openai.example.com/openai":        false,
		"":                                         false,
	}
	for url, want := range cases {
		if got := AnthropicWireForBaseURL(url); got != want {
			t.Errorf("AnthropicWireForBaseURL(%q) = %v, want %v", url, got, want)
		}
	}
}

// 接口 id 缺失但 BaseURL/端点形态是 Anthropic 时，也组 image 块（渠道 api_format 标错的兼容）。
func TestManifestRequestClaudeWireByBaseURLFallback(t *testing.T) {
	request := GenerationRequest{
		Capability: CapabilityText,
		Model:      "some-model",
		Prompt:     "describe",
		BaseURL:    "https://api.deepseek.com/anthropic",
		Images:     []MediaReference{{DataURL: "data:image/png;base64,QUJD", Kind: "image"}},
	}
	values := manifestRequestValues(request)
	messages, _ := values["messages"].([]any)
	last, _ := messages[len(messages)-1].(map[string]any)
	content, _ := last["content"].([]any)
	image, _ := content[1].(map[string]any)
	if image["type"] != "image" {
		t.Fatalf("fallback claude wire image block type = %v, want image", image["type"])
	}
}

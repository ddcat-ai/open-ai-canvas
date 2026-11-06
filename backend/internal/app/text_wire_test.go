package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"yingce/backend/internal/protocol"
)

// 官方 deepseek-chat 插件的协议 ID 不是 chat-completion，但 create 声明的是 /v1/chat/completions：
// 宿主必须按声明路径逐字流式输出、补思考参数和用量统计；上游按严格 schema 拒收
// stream_options 时去掉该字段重试一次，而不是让整次生成失败。
func TestDeclarativeChatPluginStreamsByDeclaredPath(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var mu sync.Mutex
	var bodies []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			t.Errorf("path = %q, want the plugin's declared create path", r.URL.Path)
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
			return
		}
		mu.Lock()
		bodies = append(bodies, body)
		mu.Unlock()
		if _, exists := body["stream_options"]; exists {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnprocessableEntity)
			fmt.Fprint(w, `{"object":"error","message":{"detail":[{"type":"extra_forbidden","loc":["body","stream_options"],"msg":"Extra inputs are not permitted"}]}}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"think\"}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var deltas strings.Builder
	result, err := runTextTask(withProtocolRegistry(ctx, loadOfficialFallbackRegistry()), canvasGenerationInput{
		Mode: "text", Prompt: "hello", StreamText: true,
		TextOptions: canvasTextOptions{ThinkingLevel: "medium"},
		Config:      providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "deepseek-reasoner", InterfaceType: "deepseek-chat"},
		OnTextDelta: func(delta string) { deltas.WriteString(delta) },
	})
	if err != nil {
		t.Fatalf("runTextTask() error = %v", err)
	}
	if result["text"] != "hello" || result["reasoning"] != "think" || deltas.String() != "hello" {
		t.Fatalf("result = %#v, deltas = %q", result, deltas.String())
	}
	if len(bodies) != 2 {
		t.Fatalf("upstream calls = %d, want the rejected attempt plus one retry", len(bodies))
	}
	for index, body := range bodies {
		if body["stream"] != true || body["reasoning_effort"] != "medium" || body["model"] != "deepseek-reasoner" {
			t.Fatalf("request %d did not use the chat wire contract: %#v", index, body)
		}
	}
	options, _ := bodies[0]["stream_options"].(map[string]any)
	if options["include_usage"] != true {
		t.Fatalf("first request must ask for stream usage: %#v", bodies[0])
	}
	if _, exists := bodies[1]["stream_options"]; exists {
		t.Fatalf("retry must drop the rejected stream_options: %#v", bodies[1])
	}
}

// 非流式创作请求也要带上思考参数；没有可识别线格式的插件保持插件自己的请求体。
func TestDeclarativeTextThinkingFollowsDeclaredWire(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var body map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body = nil
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/chat/completions" {
			fmt.Fprint(w, `{"choices":[{"message":{"content":"hello"}}]}`)
			return
		}
		fmt.Fprint(w, `{"message":{"content":[{"type":"text","text":"hello"}]}}`)
	}))
	defer server.Close()
	ctx := withProtocolRegistry(context.Background(), loadOfficialFallbackRegistry())

	result, err := runTextTask(ctx, canvasGenerationInput{
		Mode: "text", Prompt: "hello", TextOptions: canvasTextOptions{ThinkingLevel: "medium"},
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "kimi-k2", InterfaceType: "kimi-chat"},
	})
	if err != nil || result["text"] != "hello" {
		t.Fatalf("kimi-chat result = %#v, err = %v", result, err)
	}
	if body["reasoning_effort"] != "medium" {
		t.Fatalf("chat-wire plugin thinking was dropped: %#v", body)
	}
	if _, exists := body["stream"]; exists {
		t.Fatalf("non-streaming request must not enable stream: %#v", body)
	}

	if _, err := runTextTask(ctx, canvasGenerationInput{
		Mode: "text", Prompt: "hello", TextOptions: canvasTextOptions{ThinkingLevel: "medium"},
		Config: providerConfig{BaseURL: server.URL, APIKey: "test-key", Model: "command-a", InterfaceType: "cohere-chat-v2"},
	}); err != nil {
		t.Fatalf("cohere-chat-v2 error = %v", err)
	}
	if _, exists := body["reasoning_effort"]; exists {
		t.Fatalf("plugin-defined wire must not receive chat thinking parameters: %#v", body)
	}
}

func TestDeclarativeAgentWireFollowsDeclaredAgentPath(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var body map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body = nil
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"完成","tool_calls":[]}}]}`))
	}))
	defer server.Close()
	manifest := func(id, agentPath string) protocol.Adapter {
		adapter, err := protocol.LoadManifest([]byte(`{
			"apiVersion":"yingce.plugin/v2","id":"` + id + `","version":"1.0.0","name":"Agent Wire Test","author":"Test","documentation":"# Test",
			"contributes":{"providers":[{"id":"` + id + `","label":"Agent Wire Test","capabilities":["text"],"scopes":["agent"],
			"create":{"method":"POST","path":"/create"},
			"agent":{"method":"POST","path":"` + agentPath + `","body":{"$merge":[{"$ref":"request.extra.agent.chatCompletion"},{"model":{"$ref":"request.model"}}]}},
			"agentResponse":{"textPaths":["choices.0.message.content"],"toolCallsPath":"choices.0.message.tool_calls","toolCallIdPaths":["id"],"toolCallNamePaths":["function.name"],"toolCallArgumentsPaths":["function.arguments"]},"response":{}}]}
		}`))
		if err != nil {
			t.Fatal(err)
		}
		return adapter
	}
	registry, err := protocol.NewRegistry(manifest("vendor-chat", "/v1/chat/completions"), manifest("vendor-native", "/v2/chat"))
	if err != nil {
		t.Fatal(err)
	}
	ctx := withProtocolRegistry(context.Background(), registry)
	input := func(interfaceType string) canvasGenerationInput {
		return canvasGenerationInput{
			Config:      providerConfig{BaseURL: server.URL, APIKey: "key", Model: "thinking-model", InterfaceType: interfaceType},
			TextOptions: canvasTextOptions{ThinkingLevel: "medium", MaxOutputTokens: 2048},
			AgentRequests: &agentToolRequests{ChatCompletion: map[string]interface{}{
				"messages": []interface{}{}, "tools": []interface{}{}, "tool_choice": "required",
			}},
		}
	}

	result, err := runAgentToolTask(ctx, input("vendor-chat"))
	if err != nil || result["text"] != "完成" {
		t.Fatalf("chat-wire agent result = %#v, err = %v", result, err)
	}
	if body["reasoning_effort"] != "medium" || body["max_tokens"] != float64(2048) {
		t.Fatalf("chat-wire agent body = %#v", body)
	}
	if _, exists := body["tool_choice"]; exists {
		t.Fatalf("thinking request retained tool_choice: %#v", body)
	}

	// 宿主不认识的插件线格式视为不支持思考：照常请求，不写任何思考参数。
	if _, err := runAgentToolTask(ctx, input("vendor-native")); err != nil {
		t.Fatalf("plugin-defined agent wire error = %v", err)
	}
	for _, key := range []string{"reasoning_effort", "reasoning", "thinking", "enable_thinking"} {
		if _, exists := body[key]; exists {
			t.Fatalf("plugin-defined agent wire received host thinking parameter %q: %#v", key, body)
		}
	}
}

func TestStreamUsageOptionRejectedOnlyMatchesSchemaRejections(t *testing.T) {
	tests := []struct {
		status int
		body   string
		want   bool
	}{
		{http.StatusUnprocessableEntity, `{"detail":[{"loc":["body","stream_options"],"msg":"Extra inputs are not permitted"}]}`, true},
		{http.StatusBadRequest, `{"error":{"message":"Unrecognized request argument supplied: stream_options"}}`, true},
		{http.StatusBadRequest, `{"error":{"message":"invalid model"}}`, false},
		{http.StatusInternalServerError, `stream_options`, false},
	}
	for _, test := range tests {
		if got := StreamUsageOptionRejectedResponse(test.status, []byte(test.body)); got != test.want {
			t.Errorf("StreamUsageOptionRejectedResponse(%d, %s) = %v, want %v", test.status, test.body, got, test.want)
		}
	}
}

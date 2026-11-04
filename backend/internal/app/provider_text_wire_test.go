package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

// 声明式文字插件（协议 ID vendor-chat，create.path=/chat/completions）。
const vendorChatManifest = `{
	"apiVersion":"yingce.plugin/v1",
	"id":"vendor-chat","version":"1.0.0","name":"Vendor Chat","author":"Test","documentation":"# Test",
	"contributes":{"providers":[{"id":"vendor-chat","label":"Vendor Chat","capabilities":["text"],"scopes":["canvas","agent"],
	"create":{"method":"POST","path":"/chat/completions","contentType":"application/json","body":{"model":{"$ref":"request.model"},"messages":{"$ref":"request.messages"},"max_tokens":{"$omitEmpty":{"$ref":"request.extra.max_tokens"}}}},
	"agent":{"method":"POST","path":"/chat/completions","contentType":"application/json","body":{"$merge":[{"$ref":"request.extra.agent.chatCompletion"},{"model":{"$ref":"request.model"}}]}},
	"agentResponse":{"textPaths":["choices.0.message.content"],"toolCallsPath":"choices.0.message.tool_calls","toolCallIdPaths":["id"],"toolCallNamePaths":["function.name"],"toolCallArgumentsPaths":["function.arguments"]},
	"response":{"textPaths":["choices.0.message.content"]},
	"auth":{"type":"bearer","field":"apiKey"}}]}
}`

// 作者官方 chat 类插件：请求地址是 /v1/chat/completions，协议 ID 不是 chat-completion。
const officialVendorChatManifest = `{
	"apiVersion":"yingce.plugin/v1",
	"id":"vendor-official-chat","version":"1.0.0","name":"Vendor Official Chat","author":"Test","documentation":"# Test",
	"contributes":{"providers":[{"id":"vendor-official-chat","label":"Vendor Official Chat","capabilities":["text"],"scopes":["canvas","agent"],
	"create":{"method":"POST","path":"/v1/chat/completions","contentType":"application/json","body":{"model":{"$ref":"request.model"},"messages":{"$ref":"request.messages"}}},
	"agent":{"method":"POST","path":"/v1/chat/completions","contentType":"application/json","body":{"$merge":[{"$ref":"request.extra.agent.chatCompletion"},{"model":{"$ref":"request.model"}}]}},
	"agentResponse":{"textPaths":["choices.0.message.content"],"toolCallsPath":"choices.0.message.tool_calls","toolCallIdPaths":["id"],"toolCallNamePaths":["function.name"],"toolCallArgumentsPaths":["function.arguments"]},
	"response":{"textPaths":["choices.0.message.content"]},
	"auth":{"type":"bearer","field":"apiKey"}}]}
}`

// 请求形状不是宿主认识的三家（Cohere 风格 /v2/chat）：保持插件自己解析，宿主不接管流式与思考。
const nonOpenAIShapeManifest = `{
	"apiVersion":"yingce.plugin/v1",
	"id":"cohere-like","version":"1.0.0","name":"Cohere Like","author":"Test","documentation":"# Test",
	"contributes":{"providers":[{"id":"cohere-like","label":"Cohere Like","capabilities":["text"],"scopes":["canvas"],
	"create":{"method":"POST","path":"/v2/chat","contentType":"application/json","body":{"model":{"$ref":"request.model"},"messages":{"$ref":"request.messages"}}},
	"response":{"textPaths":["text"]},
	"auth":{"type":"bearer","field":"apiKey"}}]}
}`

func registryWithManifests(t *testing.T, manifests ...string) context.Context {
	t.Helper()
	adapters := make([]protocol.Adapter, 0, len(manifests))
	for _, raw := range manifests {
		adapter, err := protocol.LoadManifest([]byte(raw))
		if err != nil {
			t.Fatalf("load manifest: %v", err)
		}
		adapters = append(adapters, adapter)
	}
	registry, err := protocol.NewRegistry(adapters...)
	if err != nil {
		t.Fatalf("new registry: %v", err)
	}
	return withProtocolRegistry(context.Background(), registry)
}

// 插件声明的 create 路径决定 wire：内置 chat 类插件与声明式 vendor-chat 插件都要推出 chat 格式。
func TestTextWireForConfigFollowsDeclaredCreatePath(t *testing.T) {
	ctx := registryWithManifests(t, officialVendorChatManifest, vendorChatManifest, nonOpenAIShapeManifest)
	cases := []struct {
		interfaceType string
		want          protocol.TextWire
	}{
		{"vendor-official-chat", protocol.TextWireChatCompletion},
		{"vendor-chat", protocol.TextWireChatCompletion},
		{"cohere-like", protocol.TextWireUnknown},
		// 作者内置协议 ID 照旧映射。
		{"chat-completion", protocol.TextWireChatCompletion},
		{"openai-response", protocol.TextWireResponses},
		{"claude-api", protocol.TextWireClaudeAPI},
	}
	for _, test := range cases {
		got := textWireForConfig(ctx, providerConfig{InterfaceType: test.interfaceType})
		if got != test.want {
			t.Fatalf("textWireForConfig(%q) = %q, want %q", test.interfaceType, got, test.want)
		}
	}
	// resolveProviderConfig 推出的 RequestFormat 与上面一致（未经过 Service 时也能用）。
	if got := textWireForConfig(context.Background(), providerConfig{InterfaceType: "vendor-chat", RequestFormat: "chat-completion"}); got != protocol.TextWireChatCompletion {
		t.Fatalf("RequestFormat 未生效：%q", got)
	}
}

func readJSONBody(t *testing.T, r *http.Request) map[string]interface{} {
	t.Helper()
	var body map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		t.Fatalf("decode request body: %v", err)
	}
	return body
}

// 作者官方 chat 类插件（协议 ID 不是 chat-completion）现在能流式、能带思考参数。
func TestDeclarativeTextTaskStreamsForOfficialChatStylePlugin(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var seen map[string]interface{}
	var seenPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		seen = readJSONBody(t, r)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"你\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	ctx := registryWithManifests(t, officialVendorChatManifest)
	var deltas []string
	result, err := runTextTask(ctx, canvasGenerationInput{
		Mode:            "text",
		Prompt:          "写一句话",
		StreamText:      true,
		TextOptions:     canvasTextOptions{Thinking: true},
		Config:          providerConfig{BaseURL: server.URL, APIKey: "key", Model: "vendor-model", InterfaceType: "vendor-official-chat"},
		MaxOutputTokens: 512,
		OnTextDelta: func(delta string) {
			deltas = append(deltas, delta)
		},
	})
	if err != nil {
		t.Fatalf("runTextTask() error = %v", err)
	}
	if seenPath != "/v1/chat/completions" {
		t.Fatalf("upstream path = %q, want /v1/chat/completions", seenPath)
	}
	if seen["stream"] != true {
		t.Fatalf("stream not set: %#v", seen)
	}
	options, _ := seen["stream_options"].(map[string]interface{})
	if options["include_usage"] != true {
		t.Fatalf("stream_options.include_usage missing: %#v", seen["stream_options"])
	}
	if seen["reasoning_effort"] != "medium" {
		t.Fatalf("thinking not applied: %#v", seen["reasoning_effort"])
	}
	if seen["max_tokens"] != float64(512) {
		t.Fatalf("output limit not applied: %#v", seen["max_tokens"])
	}
	if strings.Join(deltas, "") != "你好" {
		t.Fatalf("deltas = %#v", deltas)
	}
	if result["text"] != "你好" {
		t.Fatalf("result = %#v", result)
	}
}

// vendor-chat 同一条路：流式 + 思考 + 用量 + 输出上限。
func TestDeclarativeTextTaskStreamsForDeclaredChat(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var seen map[string]interface{}
	var seenPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		seen = readJSONBody(t, r)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	ctx := registryWithManifests(t, vendorChatManifest)
	result, err := runTextTask(ctx, canvasGenerationInput{
		Mode:            "text",
		Prompt:          "你好",
		StreamText:      true,
		TextOptions:     canvasTextOptions{Thinking: true},
		Config:          providerConfig{BaseURL: server.URL, APIKey: "key", Model: "vendor-model", InterfaceType: "vendor-chat"},
		MaxOutputTokens: 256,
	})
	if err != nil {
		t.Fatalf("runTextTask() error = %v", err)
	}
	if !strings.HasSuffix(seenPath, "/chat/completions") {
		t.Fatalf("upstream path = %q, want .../chat/completions", seenPath)
	}
	if seen["stream"] != true || seen["reasoning_effort"] != "medium" || seen["max_tokens"] != float64(256) {
		t.Fatalf("chat request body = %#v", seen)
	}
	options, _ := seen["stream_options"].(map[string]interface{})
	if options["include_usage"] != true {
		t.Fatalf("stream_options.include_usage missing: %#v", seen["stream_options"])
	}
	if result["text"] != "ok" {
		t.Fatalf("result = %#v", result)
	}
}

// 画布 Agent：vendor-chat 开思考不再报错，并按 chat 格式注入思考参数与归一化 tool_choice。
func TestDeclarativeAgentThinkingWorksForDeclaredChat(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var seen map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = readJSONBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"完成","tool_calls":[]}}]}`))
	}))
	defer server.Close()

	ctx := registryWithManifests(t, vendorChatManifest)
	result, err := runAgentToolTask(ctx, canvasGenerationInput{
		Config:      providerConfig{BaseURL: server.URL, APIKey: "key", Model: "vendor-model", InterfaceType: "vendor-chat"},
		TextOptions: canvasTextOptions{Thinking: true},
		AgentRequests: &agentToolRequests{ChatCompletion: map[string]interface{}{
			"messages": []interface{}{}, "tools": []interface{}{}, "tool_choice": "required",
		}},
	})
	if err != nil {
		t.Fatalf("runAgentToolTask() error = %v", err)
	}
	if result["text"] != "完成" {
		t.Fatalf("result = %#v", result)
	}
	if seen["reasoning_effort"] != "medium" {
		t.Fatalf("thinking not applied: %#v", seen)
	}
	if _, exists := seen["tool_choice"]; exists {
		t.Fatalf("tool_choice 应被归一化删除：%#v", seen["tool_choice"])
	}
}

// 请求形状不是宿主认识的三家时，宿主不接管流式与思考，保持插件自己解析。
func TestDeclarativeTextTaskKeepsPluginParsingForUnknownShape(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	var seen map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = readJSONBody(t, r)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"text":"插件自己的响应"}`))
	}))
	defer server.Close()

	ctx := registryWithManifests(t, nonOpenAIShapeManifest)
	result, err := runTextTask(ctx, canvasGenerationInput{
		Mode:        "text",
		Prompt:      "你好",
		StreamText:  true,
		TextOptions: canvasTextOptions{Thinking: true},
		Config:      providerConfig{BaseURL: server.URL, APIKey: "key", Model: "cohere-model", InterfaceType: "cohere-like"},
	})
	if err != nil {
		t.Fatalf("runTextTask() error = %v", err)
	}
	if _, exists := seen["stream"]; exists {
		t.Fatalf("未知形状不应由宿主开启流式：%#v", seen["stream"])
	}
	if _, exists := seen["reasoning_effort"]; exists {
		t.Fatalf("未知形状不应由宿主写思考参数：%#v", seen["reasoning_effort"])
	}
	if result["text"] != "插件自己的响应" {
		t.Fatalf("result = %#v", result)
	}
}

// 作者内置三个协议的请求地址与参数不变。
func TestBuiltinTextProtocolsKeepAuthorBehavior(t *testing.T) {
	cases := []struct {
		interfaceType string
		path          string
		thinking      string
		limitField    string
	}{
		{"chat-completion", "/chat/completions", "reasoning_effort", "max_tokens"},
		{"openai-response", "/responses", "reasoning", "max_output_tokens"},
		{"claude-api", "/messages", "thinking", "max_tokens"},
	}
	for _, test := range cases {
		t.Run(test.interfaceType, func(t *testing.T) {
			t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
			var seen map[string]interface{}
			var seenPath string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				seenPath = r.URL.Path
				seen = readJSONBody(t, r)
				w.Header().Set("Content-Type", "application/json")
				switch test.interfaceType {
				case "openai-response":
					_, _ = w.Write([]byte(`{"output":[{"type":"message","content":[{"type":"output_text","text":"ok"}]}]}`))
				case "claude-api":
					_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"ok"}]}`))
				default:
					_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"ok"}}]}`))
				}
			}))
			defer server.Close()

			_, err := runTextTask(context.Background(), canvasGenerationInput{
				Mode:            "text",
				Prompt:          "你好",
				TextOptions:     canvasTextOptions{Thinking: true},
				Config:          providerConfig{BaseURL: server.URL, APIKey: "key", Model: "builtin-model", InterfaceType: test.interfaceType},
				MaxOutputTokens: 128,
			})
			if err != nil {
				t.Fatalf("runTextTask() error = %v", err)
			}
			if !strings.HasSuffix(seenPath, test.path) {
				t.Fatalf("upstream path = %q, want ...%q", seenPath, test.path)
			}
			if _, exists := seen[test.thinking]; !exists {
				t.Fatalf("thinking field %q missing: %#v", test.thinking, seen)
			}
			if seen[test.limitField] != float64(128) {
				t.Fatalf("limit field %q = %#v", test.limitField, seen[test.limitField])
			}
		})
	}
}

// 系统代理补用量：token 计费文字模型按插件声明的 create 路径判定（chat 形状才补）。
func TestProtocolRequestsChatStreamUsageFollowsDeclaration(t *testing.T) {
	svc := &Service{}
	for protocolID, want := range map[model.ChannelInterfaceType]bool{
		model.ChannelInterfaceChatCompletion: true,
		"deepseek-chat":                      true,
		model.ChannelInterfaceOpenAIResponse: false,
		model.ChannelInterfaceClaudeAPI:      false,
		"gemini-generate-content":            false,
		"cohere-chat-v2":                     false,
	} {
		if got := svc.ProtocolRequestsChatStreamUsage(string(protocolID)); got != want {
			t.Fatalf("ProtocolRequestsChatStreamUsage(%q) = %v, want %v", protocolID, got, want)
		}
	}
}

// 插件声明的操作路径匹配（系统代理白名单用）。
func TestDeclaredOperationMatchesDeclaredPaths(t *testing.T) {
	operations := DeclaredProtocolOperations{
		Declared: true,
		Create:   "POST /chat/completions",
		Poll:     "GET /v1/videos/{{taskId}}",
	}
	if _, matched := DeclaredOperationMatch(operations, http.MethodPost, "/chat/completions"); !matched {
		t.Fatal("声明的 create 路径应放行")
	}
	if _, matched := DeclaredOperationMatch(operations, http.MethodPost, "/responses"); matched {
		t.Fatal("未声明的路径不应放行")
	}
	if _, matched := DeclaredOperationMatch(operations, http.MethodPost, "/v1/videos/video-1"); matched {
		t.Fatal("轮询路径不应放行 POST")
	}
	if create, matched := DeclaredOperationMatch(operations, http.MethodGet, "/v1/videos/video-1"); !matched || create {
		t.Fatal("声明的 poll 模板应按单段通配匹配且不是 create")
	}
	if _, matched := DeclaredOperationMatch(DeclaredProtocolOperations{}, http.MethodPost, "/chat/completions"); matched {
		t.Fatal("未安装插件时不应命中声明")
	}
}

// 内置 Agent 请求是否强制 function_call item id：有声明看声明，没声明保留作者内置判断。
func TestAgentRequestUsesFunctionCallItemID(t *testing.T) {
	if !agentRequestUsesFunctionCallItemID(providerConfig{InterfaceType: "openai-response"}, false) {
		t.Fatal("内置 openai-response 仍应要求 item id")
	}
	if agentRequestUsesFunctionCallItemID(providerConfig{InterfaceType: "chat-completion"}, false) {
		t.Fatal("内置 chat-completion 不应要求 item id")
	}
	if agentRequestUsesFunctionCallItemID(providerConfig{InterfaceType: "openai-response", RequestFormat: "chat-completion"}, true) {
		t.Fatal("插件声明 chat 格式时不应要求 item id")
	}
	if !agentRequestUsesFunctionCallItemID(providerConfig{InterfaceType: "vendor-responses", RequestFormat: "responses"}, true) {
		t.Fatal("插件声明 responses 格式时应要求 item id")
	}
}

// 系统代理补用量：vendor-chat 声明的是 chat 格式，token 计费时必须补 include_usage。
func TestDeclaredChatRequestsChatStreamUsage(t *testing.T) {
	adapter, err := protocol.LoadManifest([]byte(vendorChatManifest))
	if err != nil {
		t.Fatal(err)
	}
	registry, err := protocol.NewRegistry(adapter)
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{pluginRuntime: &pluginRuntime{plugins: map[string]pluginRecord{}, registry: registry}}
	for protocolID, want := range map[string]bool{
		"vendor-chat":     true,
		"chat-completion": false, // 这里只有声明式插件，内置协议由 auth.go 的协议名分支处理
	} {
		if got := svc.ProtocolRequestsChatStreamUsage(protocolID); got != want {
			t.Fatalf("ProtocolRequestsChatStreamUsage(%q) = %v, want %v", protocolID, got, want)
		}
	}
	if wire := svc.declaredTextRequestFormat("vendor-chat"); wire != protocol.TextWireChatCompletion {
		t.Fatalf("vendor-chat wire = %q", wire)
	}
}

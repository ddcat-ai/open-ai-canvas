package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	protocolcontract "yingce/backend/internal/protocol"
)

func mustThinkingPreset(t *testing.T, preset, wire string) *TextThinkingConfig {
	t.Helper()
	config, err := normalizeTextThinkingConfig(&TextThinkingConfig{Preset: preset}, wire, 16384)
	if err != nil {
		t.Fatalf("preset %s on %s: %v", preset, wire, err)
	}
	return config
}

func TestResolveThinkingLevel(t *testing.T) {
	levels := &TextThinkingConfig{Mode: ThinkingModeLevels, Levels: []string{"off", "low", "high", "max"}, Default: "high"}
	always := &TextThinkingConfig{Mode: ThinkingModeAlways, Levels: []string{"low", "high"}}
	noDefault := &TextThinkingConfig{Mode: ThinkingModeLevels, Levels: []string{"off", "low", "medium"}}
	tests := []struct {
		name      string
		config    *TextThinkingConfig
		requested string
		want      string
	}{
		{"auto uses model default", levels, "auto", "high"},
		{"empty equals auto", levels, "", "high"},
		{"auto without default sends nothing", noDefault, "auto", ""},
		{"deep skips max", levels, "deep", "high"},
		{"exact level", levels, "low", "low"},
		{"nearest tie goes lower", levels, "medium", "low"},
		{"minimal snaps to low", levels, "minimal", "low"},
		{"off kept when supported", levels, "off", "off"},
		{"off on always model becomes lowest", always, "off", "low"},
		{"max on always model snaps down", always, "max", "high"},
		{"none model sends nothing", &TextThinkingConfig{Mode: ThinkingModeNone}, "high", ""},
		{"nil config sends nothing", nil, "high", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveThinkingLevel(tt.config, tt.requested)
			if err != nil || got != tt.want {
				t.Fatalf("resolveThinkingLevel(%q) = %q, %v; want %q", tt.requested, got, err, tt.want)
			}
		})
	}
	if _, err := resolveThinkingLevel(levels, "ultra"); err == nil {
		t.Fatal("unknown level must be rejected")
	}
}

func TestNormalizeTextThinkingConfigValidation(t *testing.T) {
	bad := []struct {
		name   string
		config TextThinkingConfig
		wire   string
	}{
		{"unknown level", TextThinkingConfig{Mode: ThinkingModeLevels, Levels: []string{"off", "huge"}, Switch: ThinkingSwitchConfig{Kind: "omit"}, Intensity: ThinkingIntensityConfig{Kind: "effort"}}, ""},
		{"default outside levels", TextThinkingConfig{Mode: ThinkingModeLevels, Levels: []string{"off", "low"}, Default: "high", Switch: ThinkingSwitchConfig{Kind: "omit"}, Intensity: ThinkingIntensityConfig{Kind: "effort"}}, ""},
		{"always with off", TextThinkingConfig{Mode: ThinkingModeAlways, Levels: []string{"off", "low"}, Switch: ThinkingSwitchConfig{Kind: "none"}, Intensity: ThinkingIntensityConfig{Kind: "effort"}}, ""},
		{"toggle with three levels", TextThinkingConfig{Mode: ThinkingModeToggle, Levels: []string{"off", "low", "high"}, Switch: ThinkingSwitchConfig{Kind: "enable-flag"}, Intensity: ThinkingIntensityConfig{Kind: "none"}}, ""},
		{"field outside whitelist", TextThinkingConfig{Mode: ThinkingModeLevels, Levels: []string{"off", "low"}, Switch: ThinkingSwitchConfig{Kind: "omit"}, Intensity: ThinkingIntensityConfig{Kind: "effort", Field: "model"}}, ""},
		{"budget not below max output", TextThinkingConfig{Mode: ThinkingModeLevels, Levels: []string{"off", "high"}, Switch: ThinkingSwitchConfig{Kind: "omit"}, Intensity: ThinkingIntensityConfig{Kind: "budget", Budgets: map[string]int{"high": 16384}}}, ""},
		{"enable flag on claude", TextThinkingConfig{Mode: ThinkingModeToggle, Levels: []string{"off", "medium"}, Switch: ThinkingSwitchConfig{Kind: "enable-flag"}, Intensity: ThinkingIntensityConfig{Kind: "none"}}, protocolcontract.TextWireClaude},
		{"gemini level on chat", TextThinkingConfig{Mode: ThinkingModeAlways, Levels: []string{"low", "high"}, Switch: ThinkingSwitchConfig{Kind: "none"}, Intensity: ThinkingIntensityConfig{Kind: "gemini-level"}}, protocolcontract.TextWireChatCompletion},
		{"effort-none needs effort", TextThinkingConfig{Mode: ThinkingModeLevels, Levels: []string{"off", "low"}, Switch: ThinkingSwitchConfig{Kind: "effort-none"}, Intensity: ThinkingIntensityConfig{Kind: "budget"}}, ""},
	}
	for _, tt := range bad {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := normalizeTextThinkingConfig(&tt.config, tt.wire, 16384); err == nil {
				t.Fatalf("expected validation error")
			}
		})
	}
	for preset, wire := range map[string]string{
		"openai-gpt5": protocolcontract.TextWireResponses, "openai-o": protocolcontract.TextWireChatCompletion,
		"claude-adaptive": protocolcontract.TextWireClaude, "claude-budget": protocolcontract.TextWireClaude,
		"gemini-3-pro": thinkingWireGemini, "gemini-3-flash": thinkingWireGemini, "gemini-2.5": thinkingWireGemini,
		"deepseek": protocolcontract.TextWireChatCompletion, "qwen-hybrid": protocolcontract.TextWireChatCompletion,
		"qwen-budget": protocolcontract.TextWireChatCompletion, "thinking-type-toggle": protocolcontract.TextWireChatCompletion,
		"openrouter": protocolcontract.TextWireChatCompletion, "model-suffix": protocolcontract.TextWireChatCompletion,
	} {
		config := mustThinkingPreset(t, preset, wire)
		if config.Preset != preset || config.Mode == "" || config.Switch.Kind == "" || config.Intensity.Kind == "" {
			t.Fatalf("preset %s did not expand: %#v", preset, config)
		}
	}
	// Preset values are copied on save, so later preset edits never change stored models.
	config := mustThinkingPreset(t, "openai-gpt5", protocolcontract.TextWireChatCompletion)
	config.Intensity.Values["max"] = "changed"
	if textThinkingPresets["openai-gpt5"].Intensity.Values["max"] != "xhigh" {
		t.Fatal("normalized config must not alias preset maps")
	}
}

func TestAlwaysThinkingKeepsRequiredEnableSwitch(t *testing.T) {
	config, err := normalizeTextThinkingConfig(&TextThinkingConfig{
		Mode: ThinkingModeAlways, Levels: []string{"low", "high"},
		Switch:    ThinkingSwitchConfig{Kind: ThinkingSwitchEnableFlag},
		Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityBudget, Field: "thinking_budget"},
	}, protocolcontract.TextWireChatCompletion, 16384)
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]interface{}{}
	writeTextThinking(body, textThinkingPlan{Config: config, Level: "high"}, protocolcontract.TextWireChatCompletion, 16384)
	if body["enable_thinking"] != true || body["thinking_budget"] == nil {
		t.Fatalf("required enable flag lost when model cannot turn thinking off: %#v", body)
	}
}

func TestWriteTextThinkingPerDialect(t *testing.T) {
	tests := []struct {
		name   string
		preset string
		wire   string
		level  string
		body   map[string]interface{}
		want   map[string]interface{}
	}{
		{"openai chat effort", "openai-gpt5", protocolcontract.TextWireChatCompletion, "high", map[string]interface{}{},
			map[string]interface{}{"reasoning_effort": "high"}},
		{"openai max maps to xhigh", "openai-gpt5", protocolcontract.TextWireChatCompletion, "max", map[string]interface{}{},
			map[string]interface{}{"reasoning_effort": "xhigh"}},
		{"openai off sends none", "openai-gpt5", protocolcontract.TextWireChatCompletion, "off", map[string]interface{}{},
			map[string]interface{}{"reasoning_effort": "none"}},
		{"responses effort with summary", "openai-gpt5", protocolcontract.TextWireResponses, "low", map[string]interface{}{},
			map[string]interface{}{"reasoning": map[string]interface{}{"effort": "low", "summary": "auto"}}},
		{"claude adaptive", "claude-adaptive", protocolcontract.TextWireClaude, "medium", map[string]interface{}{"max_tokens": 8000},
			map[string]interface{}{"max_tokens": 8000, "thinking": map[string]interface{}{"type": "adaptive"}, "output_config": map[string]interface{}{"effort": "medium"}}},
		{"claude off omits thinking", "claude-adaptive", protocolcontract.TextWireClaude, "off", map[string]interface{}{"max_tokens": 8000},
			map[string]interface{}{"max_tokens": 8000}},
		{"claude budget raises max tokens", "claude-budget", protocolcontract.TextWireClaude, "low", map[string]interface{}{"max_tokens": 2000},
			map[string]interface{}{"max_tokens": 2000, "thinking": map[string]interface{}{"type": "enabled", "budget_tokens": 1024}}},
		{"gemini 3 level", "gemini-3-pro", thinkingWireGemini, "high", map[string]interface{}{},
			map[string]interface{}{"generationConfig": map[string]interface{}{"thinkingConfig": map[string]interface{}{"thinkingLevel": "high"}}}},
		{"gemini 2.5 off sends zero", "gemini-2.5", thinkingWireGemini, "off", map[string]interface{}{},
			map[string]interface{}{"generationConfig": map[string]interface{}{"thinkingConfig": map[string]interface{}{"thinkingBudget": 0}}}},
		{"gemini 2.5 budget ratio", "gemini-2.5", thinkingWireGemini, "medium", map[string]interface{}{"generationConfig": map[string]interface{}{"maxOutputTokens": 10000}},
			map[string]interface{}{"generationConfig": map[string]interface{}{"maxOutputTokens": 10000, "thinkingConfig": map[string]interface{}{"thinkingBudget": 4000}}}},
		{"deepseek enabled with effort", "deepseek", protocolcontract.TextWireChatCompletion, "max", map[string]interface{}{},
			map[string]interface{}{"thinking": map[string]interface{}{"type": "enabled"}, "reasoning_effort": "max"}},
		{"deepseek off", "deepseek", protocolcontract.TextWireChatCompletion, "off", map[string]interface{}{},
			map[string]interface{}{"thinking": map[string]interface{}{"type": "disabled"}}},
		{"qwen toggle on", "qwen-hybrid", protocolcontract.TextWireChatCompletion, "medium", map[string]interface{}{},
			map[string]interface{}{"enable_thinking": true}},
		{"qwen toggle off", "qwen-hybrid", protocolcontract.TextWireChatCompletion, "off", map[string]interface{}{},
			map[string]interface{}{"enable_thinking": false}},
		{"qwen budget", "qwen-budget", protocolcontract.TextWireChatCompletion, "high", map[string]interface{}{"max_tokens": 10000},
			map[string]interface{}{"max_tokens": 10000, "enable_thinking": true, "thinking_budget": 6000}},
		{"openrouter nested effort", "openrouter", protocolcontract.TextWireChatCompletion, "minimal", map[string]interface{}{},
			map[string]interface{}{"reasoning": map[string]interface{}{"effort": "minimal"}}},
		{"model suffix", "model-suffix", protocolcontract.TextWireChatCompletion, "medium", map[string]interface{}{"model": "glm-5"},
			map[string]interface{}{"model": "glm-5-thinking"}},
		{"model suffix off keeps name", "model-suffix", protocolcontract.TextWireChatCompletion, "off", map[string]interface{}{"model": "glm-5"},
			map[string]interface{}{"model": "glm-5"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plan := textThinkingPlan{Config: mustThinkingPreset(t, tt.preset, tt.wire), Level: tt.level}
			enabled := writeTextThinking(tt.body, plan, tt.wire, 16384)
			if enabled != (tt.level != ThinkingLevelOff) {
				t.Fatalf("enabled = %v for level %s", enabled, tt.level)
			}
			if !reflect.DeepEqual(normalizeJSONForCompare(t, tt.body), normalizeJSONForCompare(t, tt.want)) {
				t.Fatalf("body = %#v\nwant %#v", tt.body, tt.want)
			}
		})
	}
}

func TestApplyTextThinkingClaudeRemovesSamplingControls(t *testing.T) {
	for _, request := range []string{"auto", "high", "off"} {
		t.Run(request, func(t *testing.T) {
			body := map[string]interface{}{"model": "claude-test", "max_tokens": 8000, "temperature": 0.7, "top_p": 0.98, "top_k": 10}
			input := canvasGenerationInput{
				Config:      providerConfig{CapabilityConfig: &ModelCapabilityConfig{Text: &TextCapabilityConfig{Thinking: mustThinkingPreset(t, "claude-adaptive", protocolcontract.TextWireClaude)}}},
				TextOptions: canvasTextOptions{ThinkingLevel: request},
			}
			applyTextThinking(body, input, protocolcontract.TextWireClaude)
			for _, field := range []string{"temperature", "top_p", "top_k"} {
				if _, exists := body[field]; exists {
					t.Fatalf("%s survived Claude request preparation: %#v", field, body)
				}
			}
			if body["model"] != "claude-test" || body["max_tokens"] != 8000 {
				t.Fatalf("unrelated request fields changed: %#v", body)
			}
			if request == "auto" {
				if _, exists := body["thinking"]; exists {
					t.Fatalf("model default should omit thinking: %#v", body)
				}
			} else {
				effort := "high"
				if request == "off" {
					effort = "low"
				}
				if body["thinking"].(map[string]interface{})["type"] != "adaptive" || body["output_config"].(map[string]interface{})["effort"] != effort {
					t.Fatalf("adaptive intent not normalized: %#v", body)
				}
			}
		})
	}
}

func normalizeJSONForCompare(t *testing.T, value interface{}) interface{} {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var decoded interface{}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded
}

// 未声明思考能力时开 = medium；关闭时 Claude 显式 disabled，其他协议不发参数。
func TestApplyTextThinkingLegacyFallback(t *testing.T) {
	on := canvasGenerationInput{TextOptions: canvasTextOptions{ThinkingLevel: "high"}}
	body := map[string]interface{}{}
	if !applyTextThinking(body, on, protocolcontract.TextWireChatCompletion) || body["reasoning_effort"] != "medium" {
		t.Fatalf("legacy chat thinking = %#v", body)
	}
	body = map[string]interface{}{}
	if applyTextThinking(body, canvasGenerationInput{}, protocolcontract.TextWireChatCompletion) || len(body) != 0 {
		t.Fatalf("default request must not send thinking: %#v", body)
	}
	body = map[string]interface{}{}
	if applyTextThinking(body, on, thinkingWireGemini) || len(body) != 0 {
		t.Fatalf("undeclared gemini must not send thinking: %#v", body)
	}
	body = map[string]interface{}{"max_tokens": 4096}
	applyTextThinking(body, on, protocolcontract.TextWireClaude)
	thinking, _ := body["thinking"].(map[string]interface{})
	if thinking["type"] != "enabled" || thinking["budget_tokens"] != 1024 {
		t.Fatalf("legacy claude thinking = %#v", body)
	}
	for _, level := range []string{"", "auto", "off"} {
		body = map[string]interface{}{"max_tokens": 4096}
		input := canvasGenerationInput{TextOptions: canvasTextOptions{ThinkingLevel: level}}
		if applyTextThinking(body, input, protocolcontract.TextWireClaude) {
			t.Fatalf("legacy claude %q must disable thinking", level)
		}
		want := map[string]interface{}{"max_tokens": 4096, "thinking": map[string]interface{}{"type": "disabled"}}
		if !reflect.DeepEqual(body, want) {
			t.Fatalf("legacy claude %q = %#v, want %#v", level, body, want)
		}
	}
}

func TestCanonicalAgentReasoningPassback(t *testing.T) {
	calls := []interface{}{map[string]interface{}{"id": "call-1", "function": map[string]interface{}{"name": "canvas_snapshot", "arguments": "{}"}}}
	deepseek := map[string]any{"role": "assistant", "content": "", "tool_calls": calls}
	canonicalAssistantReasoning(deepseek, "先看画布", protocolcontract.TextWireChatCompletion, nil)
	claudeBlocks := []interface{}{map[string]interface{}{"type": "thinking", "thinking": "想一想", "signature": "sig"}}
	claude := map[string]any{"role": "assistant", "content": "", "tool_calls": calls}
	canonicalAssistantReasoning(claude, "想一想", protocolcontract.TextWireClaude, claudeBlocks)
	plain := map[string]any{"role": "assistant", "content": "好的"}
	canonicalAssistantReasoning(plain, "无工具调用", protocolcontract.TextWireChatCompletion, nil)
	if plain["reasoning_content"] != "无工具调用" {
		t.Fatal("assistant messages without tool calls must retain reasoning for the next user turn")
	}
	longReasoning := strings.Repeat("完整推理 ", 9000)
	canonicalAssistantReasoning(plain, longReasoning, protocolcontract.TextWireChatCompletion, nil)
	continued := canonicalAgentRequest{PassReasoning: true, Messages: []map[string]interface{}{plain, {"role": "user", "content": "继续"}}}
	continuedBody := canonicalAgentChatBody(&continued, false)
	if got := interfaceSlice(continuedBody["messages"])[0].(map[string]interface{})["reasoning_content"]; got != longReasoning {
		t.Fatal("reasoning must remain byte-exact across user turns, including long no-tool responses")
	}
	passback := cloudAgentPiReasoningPassback(cloudAgentStepReasoning{Text: longReasoning, Wire: protocolcontract.TextWireChatCompletion}, 0)
	if passback == "" {
		t.Fatal("Pi must retain reasoning even when the response has no tool calls")
	}
	runtime, err := canonicalFromRuntimeMessages([]map[string]any{{"role": "assistant", "content": []interface{}{
		map[string]interface{}{"type": "thinking", "thinking": longReasoning, "thinkingSignature": passback},
		map[string]interface{}{"type": "text", "text": "好的"},
	}}}, nil, "")
	if err != nil || len(runtime.Messages) != 1 || runtime.Messages[0]["reasoning_content"] != longReasoning {
		t.Fatalf("Pi final-answer replay lost raw reasoning: %v", err)
	}

	request := func(message map[string]any, pass bool) canonicalAgentRequest {
		return canonicalAgentRequest{PassReasoning: pass, ToolChoice: "auto", Messages: []map[string]interface{}{
			{"role": "user", "content": "整理画布"}, message,
			{"role": "tool", "tool_call_id": "call-1", "content": "{}"},
		}}
	}
	chat := canonicalAgentChatBody(&[]canonicalAgentRequest{request(deepseek, true)}[0], false)
	if got := interfaceSlice(chat["messages"])[1].(map[string]interface{})["reasoning_content"]; got != "先看画布" {
		t.Fatalf("chat reasoning_content passback = %#v", got)
	}
	chat = canonicalAgentChatBody(&[]canonicalAgentRequest{request(deepseek, false)}[0], false)
	if _, exists := interfaceSlice(chat["messages"])[1].(map[string]interface{})["reasoning_content"]; exists {
		t.Fatal("reasoning must not be sent when thinking is off")
	}
	// 签名只回传给产生它的协议。
	chat = canonicalAgentChatBody(&[]canonicalAgentRequest{request(claude, true)}[0], false)
	if _, exists := interfaceSlice(chat["messages"])[1].(map[string]interface{})["reasoning_content"]; exists {
		t.Fatal("claude reasoning leaked into chat wire")
	}
	body := claudeAgentBody(canonicalAgentChatBody(&[]canonicalAgentRequest{request(claude, true)}[0], true))
	assistant := interfaceSlice(body["messages"])[1].(map[string]interface{})
	blocks := interfaceSlice(assistant["content"])
	if len(blocks) != 2 || blocks[0].(map[string]interface{})["signature"] != "sig" || blocks[1].(map[string]interface{})["type"] != "tool_use" {
		t.Fatalf("claude thinking block passback = %#v", blocks)
	}
	body = claudeAgentBody(canonicalAgentChatBody(&[]canonicalAgentRequest{request(deepseek, true)}[0], true))
	if blocks := interfaceSlice(interfaceSlice(body["messages"])[1].(map[string]interface{})["content"]); len(blocks) != 1 {
		t.Fatalf("chat reasoning leaked into claude wire: %#v", blocks)
	}
}

func TestAgentThinkingAutoReplayAndAdaptiveContinuation(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var received map[string]interface{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/messages") {
			_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"done"}]}`))
			return
		}
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"done"}}]}`))
	}))
	defer server.Close()
	for _, test := range []struct{ preset, wire, level string }{
		{"deepseek", protocolcontract.TextWireChatCompletion, "auto"},
		{"claude-adaptive", protocolcontract.TextWireClaude, "high"},
	} {
		t.Run(test.preset, func(t *testing.T) {
			previous := map[string]interface{}{"role": "assistant", "content": "", "tool_calls": []interface{}{map[string]interface{}{"id": "call-1", "function": map[string]interface{}{"name": "lookup", "arguments": "{}"}}}}
			if test.preset == "deepseek" {
				canonicalAssistantReasoning(previous, "原始完整推理", test.wire, nil)
			}
			source := &canonicalAgentRequest{ToolChoice: "auto", Messages: []map[string]interface{}{
				{"role": "user", "content": "lookup"}, previous, {"role": "tool", "tool_call_id": "call-1", "content": "{}"},
			}}
			_, err := runAgentToolTask(withProtocolRegistry(context.Background(), emptyProtocolRegistry), canvasGenerationInput{
				Config:      providerConfig{BaseURL: server.URL, Model: "test-model", InterfaceType: test.wire, CapabilityConfig: &ModelCapabilityConfig{Text: &TextCapabilityConfig{Thinking: mustThinkingPreset(t, test.preset, test.wire)}}},
				TextOptions: canvasTextOptions{ThinkingLevel: test.level}, AgentRequests: &agentToolRequests{Canonical: source},
			})
			if err != nil {
				t.Fatal(err)
			}
			if test.preset == "deepseek" {
				if _, exists := received["reasoning_effort"]; exists {
					t.Fatalf("auto must not force explicit effort: %#v", received)
				}
				messages := interfaceSlice(received["messages"])
				if messages[1].(map[string]interface{})["reasoning_content"] != "原始完整推理" {
					t.Fatalf("auto lost reasoning replay: %#v", messages)
				}
			} else if received["output_config"].(map[string]interface{})["effort"] != "high" {
				t.Fatalf("adaptive no-thinking tool response must not lower requested effort: %#v", received)
			}
		})
	}
}

func TestClaudeToolLoopMissingThinking(t *testing.T) {
	calls := []interface{}{map[string]interface{}{"id": "call-1"}}
	withBlocks := map[string]interface{}{"role": "assistant", "tool_calls": calls, "reasoning_wire": protocolcontract.TextWireClaude, "reasoning_blocks": []interface{}{map[string]interface{}{"type": "thinking"}}}
	without := map[string]interface{}{"role": "assistant", "tool_calls": calls}
	tool := map[string]interface{}{"role": "tool", "tool_call_id": "call-1"}
	user := map[string]interface{}{"role": "user", "content": "继续"}
	cases := []struct {
		name     string
		messages []map[string]interface{}
		want     bool
	}{
		{"fresh user turn", []map[string]interface{}{user}, false},
		{"loop with signed thinking", []map[string]interface{}{user, withBlocks, tool}, false},
		{"loop without thinking", []map[string]interface{}{user, without, tool}, true},
		{"new user turn after loop", []map[string]interface{}{without, tool, user}, false},
	}
	for _, tt := range cases {
		if got := claudeToolLoopMissingThinking(&canonicalAgentRequest{Messages: tt.messages}); got != tt.want {
			t.Fatalf("%s: got %v want %v", tt.name, got, tt.want)
		}
	}
}

func TestStreamingClaudeParserKeepsSignedThinkingBlocks(t *testing.T) {
	parser := newStreamingAgentParser("claude-api", nil)
	stream := "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n" +
		"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"先读\"}}\n\n" +
		"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"signature_delta\",\"signature\":\"abc\"}}\n\n" +
		"event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"canvas_snapshot\",\"input\":{}}}\n\n" +
		"event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{}\"}}\n\n" +
		"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
	parser.consume("text/event-stream", []byte(stream))
	parser.flush()
	result, err := parser.result()
	if err != nil {
		t.Fatal(err)
	}
	blocks := interfaceSlice(result["reasoningBlocks"])
	if result["reasoningWire"] != "claude-api" || len(blocks) != 1 {
		t.Fatalf("result = %#v", result)
	}
	block := blocks[0].(map[string]interface{})
	if block["thinking"] != "先读" || block["signature"] != "abc" {
		t.Fatalf("thinking block = %#v", block)
	}
}

func TestCloudAgentThinkingLevelIntent(t *testing.T) {
	cases := map[string]string{"off": "off", "auto": "auto", "deep": "deep", "": "off", "minimal": "minimal", "low": "low", "medium": "medium", "high": "high", "max": "max"}
	for mode, want := range cases {
		if got := cloudAgentThinkingLevel(mode, false); got != want {
			t.Fatalf("mode %q = %q want %q", mode, got, want)
		}
		if got := cloudAgentPiStepThinkingLevel("medium", mode, false); got != want {
			t.Fatalf("Pi step mode %q = %q want %q", mode, got, want)
		}
		if cloudAgentThinkingLevel(mode, true) != ThinkingLevelOff || cloudAgentPiStepThinkingLevel("off", mode, false) != ThinkingLevelOff {
			t.Fatalf("forced off lost for mode %q", mode)
		}
		req := agentTestRequest()
		req.ReasoningMode = mode
		if err := validateCloudAgentRequest(&req); err != nil {
			t.Fatalf("mode %q rejected at admission: %v", mode, err)
		}
		if got := cloudAgentReasoningMode(req); got != want {
			t.Fatalf("policy mode = %q, want %q", got, want)
		}
		if cloudAgentReasoningEnabled(mode) != (want != ThinkingLevelOff) {
			t.Fatalf("Pi reasoning support lost for mode %q", mode)
		}
		_, snapshot, err := compileCloudAgentPolicies(req, "test", nil, "", cloudAgentProfileSnapshot{Revision: agentProfileRevision(nil), Hash: agentProfileHash("")})
		if err != nil {
			t.Fatal(err)
		}
		if err := validateCloudAgentPolicySnapshot(snapshot); err != nil {
			t.Fatalf("mode %q rejected on resume: %v", mode, err)
		}
	}
	req := agentTestRequest()
	req.ReasoningMode = "ultra"
	if err := validateCloudAgentRequest(&req); err == nil {
		t.Fatal("invalid explicit level accepted")
	}
}

func TestSystemTextThinkingSurvivesAdmissionAndProviderResolution(t *testing.T) {
	profile := &ModelCapabilityConfig{Version: 1, Text: &TextCapabilityConfig{
		ContextWindowTokens: 128000, MaxOutputTokens: 16384,
		References: TextReferenceConfig{PromptMaxChars: 32000},
		Thinking:   mustThinkingPreset(t, "deepseek", protocolcontract.TextWireChatCompletion),
	}}
	svc, db, channel, channelModel := createSystemChannelSelectionFixture(t, "text", model.ChannelInterfaceChatCompletion, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("text-tier", `{}`, "provider-text", "fixed_request"),
	})
	// A public literal address needs neither DNS nor an upstream connection.
	if err := db.Model(&channel).Update("base_url", "https://8.8.8.8/v1").Error; err != nil {
		t.Fatal(err)
	}
	input, err := svc.resolveSystemChannelModelSelection(testGroupAccess(svc), map[string]any{
		"mode": "text", "prompt": "test", "textOptions": map[string]any{"thinkingLevel": "max"},
		"config": map[string]any{"channelId": channel.ID, "model": channelModel.ModelKey,
			"capabilityConfig": &ModelCapabilityConfig{Text: &TextCapabilityConfig{Thinking: legacyTextThinkingConfig(protocolcontract.TextWireChatCompletion)}},
		},
	}, "canvas_text", "")
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var taskInput canvasGenerationInput
	if err := json.Unmarshal(encoded, &taskInput); err != nil {
		t.Fatal(err)
	}
	if taskInput.Config.CapabilityConfig != nil {
		t.Fatal("admission must discard caller capability config")
	}
	resolved, err := svc.resolveProviderConfig(taskInput.Config)
	if err != nil {
		t.Fatal(err)
	}
	taskInput.Config = resolved
	for _, agent := range []bool{false, true} {
		body := map[string]interface{}{}
		if agent {
			taskInput.TextOptions.ThinkingLevel = cloudAgentPiStepThinkingLevel("medium", "max", false)
			applyAgentThinking(body, taskInput, protocolcontract.TextWireChatCompletion)
		} else {
			applyTextThinking(body, taskInput, protocolcontract.TextWireChatCompletion)
		}
		if body["reasoning_effort"] != "max" || body["thinking"].(map[string]interface{})["type"] != "enabled" {
			t.Fatalf("agent=%v: explicit max lost after provider resolution: %#v", agent, body)
		}
	}
	spoofed := taskInput.Config
	spoofed.CapabilityConfig = &ModelCapabilityConfig{Text: &TextCapabilityConfig{Thinking: legacyTextThinkingConfig(protocolcontract.TextWireChatCompletion)}}
	resolved, err = svc.resolveProviderConfig(spoofed)
	if err != nil || resolved.CapabilityConfig.Text.Thinking.Preset != "deepseek" {
		t.Fatalf("runtime failed to replace caller capability with server contract: %v", err)
	}
	if err := db.Model(&channelModel).Update("capability_config_json", `{}`).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.resolveProviderConfig(taskInput.Config); err == nil {
		t.Fatal("invalid server text capability must fail closed, not fall back to medium")
	}
}

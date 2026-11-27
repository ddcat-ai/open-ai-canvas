package protocol

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func senseNovaTextSourceAdapter(t *testing.T) Adapter {
	t.Helper()
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "sensenova-chat", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := LoadManifest(source)
	if err != nil {
		t.Fatal(err)
	}
	return adapter
}

func senseNovaTextRequest(model string, options map[string]any) GenerationRequest {
	return GenerationRequest{
		Capability: CapabilityText, Model: model, Prompt: "inspect", Instructions: "system",
		ProviderOptions: map[string]map[string]any{"sensenova-chat": options},
	}
}

func senseNovaTextCreateBody(t *testing.T, adapter Adapter, request GenerationRequest) map[string]any {
	t.Helper()
	spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if spec.Path != "/chat/completions" || spec.Method != "POST" || spec.Auth.Type != "bearer" || spec.Auth.Field != "apiKey" {
		t.Fatalf("SenseNova create contract = %#v", spec)
	}
	return manifestTestBody(t, spec)
}

func senseNovaTextTools() []any {
	return []any{map[string]any{
		"type":     "function",
		"function": map[string]any{"name": "inspect_canvas", "description": "Inspect canvas", "parameters": map[string]any{"type": "object"}},
	}}
}

func TestSenseNovaTextModelsAndMetadata(t *testing.T) {
	adapter := senseNovaTextSourceAdapter(t)
	info := adapter.Metadata()
	if info.ID != "sensenova-chat" || info.Version != "1.0.0" || info.TextWire != TextWireChatCompletion || info.AgentWire != TextWireChatCompletion || !reflect.DeepEqual(info.Categories, []Capability{CapabilityText}) {
		t.Fatalf("SenseNova metadata = %#v", info)
	}
	for _, model := range []string{"sensenova-6.8-flash", "sensenova-6.8-flash-lite", "deepseek-flash", "glm-5.3", "kimi-k3"} {
		t.Run(model, func(t *testing.T) {
			request := senseNovaTextRequest(model, nil)
			request.Extra = map[string]any{"max_tokens": 2048}
			body := senseNovaTextCreateBody(t, adapter, request)
			if body["model"] != model || len(body["messages"].([]any)) != 2 {
				t.Fatalf("model/system/current input lost: %#v", body)
			}
			field, absentField, effort := "max_tokens", "max_completion_tokens", "high"
			if model == "kimi-k3" {
				field, absentField, effort = "max_completion_tokens", "max_tokens", "max"
			} else if model == "glm-5.3" {
				effort = "max"
			}
			if body[field] != float64(2048) || body[absentField] != nil || body["reasoning_effort"] != effort {
				t.Fatalf("model output/thinking mapping = %#v", body)
			}
			if body["thinking"].(map[string]any)["type"] != "enabled" {
				t.Fatalf("default thinking = %#v", body["thinking"])
			}
		})
	}
}

func TestSenseNovaTextUnconfiguredAndEmptyOptions(t *testing.T) {
	adapter := senseNovaTextSourceAdapter(t)
	for _, options := range []struct {
		name  string
		value map[string]map[string]any
	}{
		{"unconfigured", nil},
		{"empty-options", map[string]map[string]any{}},
		{"nil-namespace", map[string]map[string]any{"sensenova-chat": nil}},
		{"empty-namespace", map[string]map[string]any{"sensenova-chat": {}}},
	} {
		t.Run(options.name, func(t *testing.T) {
			request := senseNovaTextRequest("sensenova-6.8-flash", nil)
			request.ProviderOptions = options.value
			body := senseNovaTextCreateBody(t, adapter, request)
			if body["reasoning_effort"] != "high" || body["model"] != request.Model {
				t.Fatalf("empty options changed defaults: %#v", body)
			}
		})
	}
	request := senseNovaTextRequest("sensenova-6.8-flash", map[string]any{"extra_body": map[string]any{}})
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("an empty but undeclared extension key bypassed the whitelist")
	}
}

func TestSenseNovaTextFinalHostPolicyAndStreamUsage(t *testing.T) {
	source, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "sensenova-chat", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest struct {
		Contributes struct {
			Providers []struct {
				HostTextPolicy string `json:"hostTextPolicy"`
			} `json:"providers"`
		} `json:"contributes"`
	}
	if err := json.Unmarshal(source, &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Contributes.Providers) != 1 || manifest.Contributes.Providers[0].HostTextPolicy != "before_mapping" {
		t.Fatal("SenseNova must own the final text request mapping")
	}
	adapter := senseNovaTextSourceAdapter(t)
	for _, model := range []string{"sensenova-6.8-flash", "sensenova-6.8-flash-lite", "deepseek-flash", "glm-5.3", "kimi-k3"} {
		t.Run(model, func(t *testing.T) {
			body := senseNovaTextCreateBody(t, adapter, senseNovaTextRequest(model, map[string]any{"stream": true}))
			if model == "glm-5.3" {
				if _, exists := body["stream_options"]; exists {
					t.Fatalf("GLM received unsupported stream_options: %#v", body)
				}
			} else {
				options, ok := body["stream_options"].(map[string]any)
				if !ok || options["include_usage"] != true || len(options) != 1 {
					t.Fatalf("final mapping must request usage for local settlement: %#v", body)
				}
			}
			body = senseNovaTextCreateBody(t, adapter, senseNovaTextRequest(model, map[string]any{"stream": false}))
			if _, exists := body["stream_options"]; exists {
				t.Fatalf("non-streaming request retained stream_options: %#v", body)
			}
			request := senseNovaTextRequest(model, map[string]any{"stream": true, "stream_options": map[string]any{"include_usage": false}})
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("local settlement cannot accept include_usage=false")
			}
		})
	}
}

func TestSenseNovaTextModelSpecificParameters(t *testing.T) {
	adapter := senseNovaTextSourceAdapter(t)
	tests := []struct {
		name, model string
		options     map[string]any
		want        map[string]any
		absent      []string
	}{
		{"flash", "sensenova-6.8-flash", map[string]any{"temperature": 0, "top_p": 0.5, "n": 7, "seed": 0, "repetition_penalty": 2, "reasoning_effort": "xhigh", "stream": false}, map[string]any{"temperature": float64(0), "seed": float64(0), "n": float64(7), "reasoning_effort": "xhigh", "stream": false}, nil},
		{"lite-off", "sensenova-6.8-flash-lite", map[string]any{"thinking": map[string]any{"type": "disabled"}, "parallel_tool_calls": false, "temperature": 2}, map[string]any{"parallel_tool_calls": false, "temperature": float64(2)}, []string{"reasoning_effort"}},
		{"deepseek-thinking", "deepseek-flash", map[string]any{"reasoning_effort": "xhigh", "temperature": 2, "top_p": 0.2, "presence_penalty": -1, "frequency_penalty": 2, "n": 1, "logprobs": true, "top_logprobs": 20}, map[string]any{"reasoning_effort": "high", "top_p": 0.95, "n": float64(1), "logprobs": true, "top_logprobs": float64(20)}, []string{"temperature", "presence_penalty", "frequency_penalty"}},
		{"deepseek-off", "deepseek-flash", map[string]any{"reasoning_effort": "none", "temperature": 0.5, "top_p": 0.2, "presence_penalty": -2}, map[string]any{"temperature": 0.5, "top_p": float64(1), "presence_penalty": float64(-2)}, []string{"reasoning_effort"}},
		{"glm-tools", "glm-5.3", map[string]any{"do_sample": false, "temperature": 0.3, "top_p": 0.5, "stream": true, "tools": senseNovaTextTools(), "tool_choice": "required", "thinking": map[string]any{"type": "enabled", "clear_thinking": false}}, map[string]any{"do_sample": false, "tool_stream": true, "tool_choice": "required", "reasoning_effort": "max"}, []string{"temperature", "top_p", "stream_options"}},
		{"kimi-fixed", "kimi-k3", map[string]any{"max_completion_tokens": 4096, "temperature": 1, "top_p": 0.95, "presence_penalty": 0, "frequency_penalty": 0, "parallel_tool_calls": true}, map[string]any{"max_completion_tokens": float64(4096), "temperature": float64(1), "top_p": 0.95, "presence_penalty": float64(0), "parallel_tool_calls": true}, []string{"max_tokens"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body := senseNovaTextCreateBody(t, adapter, senseNovaTextRequest(test.model, test.options))
			for key, value := range test.want {
				if !reflect.DeepEqual(body[key], value) {
					t.Fatalf("%s = %#v, want %#v; body = %#v", key, body[key], value, body)
				}
			}
			for _, key := range test.absent {
				if _, exists := body[key]; exists {
					t.Fatalf("unexpected %s: %#v", key, body)
				}
			}
		})
	}
	for _, effort := range []struct{ input, output string }{{"minimal", "low"}, {"medium", "high"}, {"ultra", "max"}} {
		body := senseNovaTextCreateBody(t, adapter, senseNovaTextRequest("deepseek-flash", map[string]any{"reasoning_effort": effort.input}))
		if body["reasoning_effort"] != effort.output {
			t.Fatalf("DeepSeek %s = %#v", effort.input, body["reasoning_effort"])
		}
	}
	format := map[string]any{"type": "json_schema", "json_schema": map[string]any{"name": "result", "schema": map[string]any{"type": "object"}}}
	body := senseNovaTextCreateBody(t, adapter, senseNovaTextRequest("deepseek-flash", map[string]any{"response_format": format}))
	if !reflect.DeepEqual(body["response_format"], format) {
		t.Fatalf("documented DeepSeek schema object lost: %#v", body)
	}
}

func TestSenseNovaTextVisualInput(t *testing.T) {
	adapter := senseNovaTextSourceAdapter(t)
	for _, model := range []string{"sensenova-6.8-flash", "sensenova-6.8-flash-lite", "deepseek-flash", "kimi-k3"} {
		t.Run(model, func(t *testing.T) {
			request := senseNovaTextRequest(model, nil)
			request.Images = []MediaReference{{DataURL: "data:image/png;base64,QUJD"}}
			if model != "kimi-k3" {
				request.Images = append(request.Images, MediaReference{URL: "https://example.test/reference.png"})
			}
			body := senseNovaTextCreateBody(t, adapter, request)
			messages := body["messages"].([]any)
			parts := messages[1].(map[string]any)["content"].([]any)
			if len(parts) != 1+len(request.Images) || parts[0].(map[string]any)["text"] != request.Prompt {
				t.Fatalf("visual content = %#v", parts)
			}
			for index, image := range request.Images {
				want := defaultValue(image.URL, image.DataURL)
				if parts[index+1].(map[string]any)["image_url"].(map[string]any)["url"] != want {
					t.Fatalf("image lost: %#v", parts[index+1])
				}
			}
		})
	}
}

func TestSenseNovaTextPrecomputedHostPolicy(t *testing.T) {
	adapter := senseNovaTextSourceAdapter(t)
	request := senseNovaTextRequest("deepseek-flash", map[string]any{
		"thinking": map[string]any{"type": "enabled"}, "reasoning_effort": "high",
		"temperature": 0.5, "top_p": 0.2, "presence_penalty": -1,
	})
	request.Extra = map[string]any{"thinking": map[string]any{"type": "disabled"}, "stream": true}
	body := senseNovaTextCreateBody(t, adapter, request)
	if body["reasoning_effort"] != nil || body["temperature"] != 0.5 || body["top_p"] != float64(1) || body["presence_penalty"] != float64(-1) || body["stream"] != true {
		t.Fatalf("host disabled thinking must precede DeepSeek sampling mapping: %#v", body)
	}
	request = senseNovaTextRequest("glm-5.3", map[string]any{"stream": false, "tools": senseNovaTextTools()})
	request.Extra = map[string]any{"stream": true, "thinking": map[string]any{"type": "enabled"}, "reasoning_effort": "low"}
	body = senseNovaTextCreateBody(t, adapter, request)
	if body["stream"] != true || body["tool_stream"] != true || body["reasoning_effort"] != "low" {
		t.Fatalf("GLM host stream/thinking mapping = %#v", body)
	}
	request = senseNovaTextRequest("kimi-k3", map[string]any{"reasoning_effort": "high"})
	request.Extra = map[string]any{"thinking": map[string]any{"type": "disabled"}}
	body = senseNovaTextCreateBody(t, adapter, request)
	if body["reasoning_effort"] != nil || body["thinking"].(map[string]any)["type"] != "disabled" {
		t.Fatalf("host off must clear inherited effort without relying on Kimi none: %#v", body)
	}
	request = senseNovaTextRequest("sensenova-6.8-flash", map[string]any{"max_tokens": -1})
	request.Extra = map[string]any{"max_tokens": 2048}
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("valid host limit hid an invalid explicit output parameter")
	}
}

func TestSenseNovaTextRejectsUndeclaredAndInvalidRequests(t *testing.T) {
	adapter := senseNovaTextSourceAdapter(t)
	for _, test := range []struct {
		name, model string
		options     map[string]any
	}{
		{"unknown-model", "sensenova-6.8", nil},
		{"case-sensitive-model", "SenseNova-6.8-Flash", nil},
		{"body-bypass", "sensenova-6.8-flash", map[string]any{"body": map[string]any{"model": "other"}}},
		{"extra-body-bypass", "sensenova-6.8-flash", map[string]any{"extra_body": map[string]any{"temperature": 4}}},
		{"unknown-field", "sensenova-6.8-flash", map[string]any{"provider": "other"}},
		{"flash-off", "sensenova-6.8-flash", map[string]any{"thinking": map[string]any{"type": "disabled"}}},
		{"glm-off", "glm-5.3", map[string]any{"reasoning_effort": "none"}},
		{"kimi-none", "kimi-k3", map[string]any{"reasoning_effort": "none"}},
		{"conflicting-thinking", "sensenova-6.8-flash-lite", map[string]any{"thinking": map[string]any{"type": "disabled"}, "reasoning_effort": "high"}},
		{"unknown-thinking-field", "sensenova-6.8-flash-lite", map[string]any{"thinking": map[string]any{"type": "enabled", "budget_tokens": 1}}},
		{"flash-temperature", "sensenova-6.8-flash", map[string]any{"temperature": 1.5}},
		{"temperature-type", "sensenova-6.8-flash-lite", map[string]any{"temperature": "1"}},
		{"kimi-temperature", "kimi-k3", map[string]any{"temperature": 0.5}},
		{"kimi-top-p", "kimi-k3", map[string]any{"top_p": 1}},
		{"glm-top-p", "glm-5.3", map[string]any{"top_p": 0}},
		{"fractional-budget", "sensenova-6.8-flash", map[string]any{"max_tokens": 1.5}},
		{"negative-budget", "sensenova-6.8-flash", map[string]any{"max_tokens": -1}},
		{"lite-budget", "sensenova-6.8-flash-lite", map[string]any{"max_tokens": 65537}},
		{"kimi-undocumented-alias", "kimi-k3", map[string]any{"max_tokens": 1000}},
		{"non-kimi-field", "glm-5.3", map[string]any{"max_completion_tokens": 1000}},
		{"deepseek-n", "deepseek-flash", map[string]any{"n": 2}},
		{"kimi-n", "kimi-k3", map[string]any{"n": 1}},
		{"glm-stop-string", "glm-5.3", map[string]any{"stop": "stop"}},
		{"glm-stop-limit", "glm-5.3", map[string]any{"stop": []any{"a", "b", "c", "d", "e"}}},
		{"seed-boundary", "kimi-k3", map[string]any{"seed": 9999999}},
		{"glm-penalty", "glm-5.3", map[string]any{"presence_penalty": 0}},
		{"unsupported-parallel", "deepseek-flash", map[string]any{"parallel_tool_calls": true}},
		{"unsupported-tool-stream", "sensenova-6.8-flash", map[string]any{"tool_stream": true}},
		{"glm-stream-options", "glm-5.3", map[string]any{"stream_options": map[string]any{"include_usage": true}}},
		{"stream-option-bypass", "sensenova-6.8-flash", map[string]any{"stream_options": map[string]any{"include_usage": true, "other": true}}},
		{"glm-json-schema", "glm-5.3", map[string]any{"response_format": map[string]any{"type": "json_schema", "json_schema": map[string]any{"type": "object"}}}},
		{"glm-named-tool", "glm-5.3", map[string]any{"tool_choice": map[string]any{"type": "function", "function": map[string]any{"name": "inspect"}}}},
		{"top-logprobs-needs-switch", "deepseek-flash", map[string]any{"top_logprobs": 1}},
		{"top-logprobs-limit", "deepseek-flash", map[string]any{"logprobs": true, "top_logprobs": 21}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := adapter.BuildCreate(context.Background(), RequestContext{Request: senseNovaTextRequest(test.model, test.options)})
			if err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
	for _, test := range []struct {
		name, model, image string
	}{
		{"glm-image", "glm-5.3", "data:image/png;base64,QUJD"},
		{"kimi-remote", "kimi-k3", "https://example.test/reference.png"},
		{"invalid-base64", "sensenova-6.8-flash", "data:image/png;base64,not base64"},
		{"flash-gif", "sensenova-6.8-flash", "data:image/gif;base64,QUJD"},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := senseNovaTextRequest(test.model, nil)
			request.Images = []MediaReference{{DataURL: test.image}}
			if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
				t.Fatal("invalid image accepted")
			}
		})
	}
	request := senseNovaTextRequest("deepseek-flash", nil)
	request.Videos = []MediaReference{{URL: "https://example.test/reference.mp4"}}
	if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
		t.Fatal("undocumented video payload accepted")
	}
}

func TestSenseNovaTextAgentToolHistoryAndModelFields(t *testing.T) {
	adapter := senseNovaTextSourceAdapter(t).(AgentAdapter)
	reasoning := strings.Repeat("完整推理 ", 9000)
	for _, model := range []string{"sensenova-6.8-flash", "sensenova-6.8-flash-lite", "deepseek-flash", "glm-5.3", "kimi-k3"} {
		t.Run(model, func(t *testing.T) {
			calls := []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "inspect_canvas", "arguments": "{}"}}}
			history := []any{
				map[string]any{"role": "user", "content": "inspect"},
				map[string]any{"role": "assistant", "content": nil, "tool_calls": calls, "reasoning_content": reasoning},
				map[string]any{"role": "tool", "tool_call_id": "call-1", "content": "{}"},
				map[string]any{"role": "assistant", "content": "checked", "reasoning_content": reasoning},
				map[string]any{"role": "user", "content": "continue"},
			}
			source := map[string]any{"messages": history, "tools": senseNovaTextTools(), "tool_choice": "required", "parallel_tool_calls": false, "prompt_cache_key": "host-only", "max_tokens": 2048, "stream": true}
			spec, err := adapter.BuildAgent(context.Background(), AgentRequestContext{Model: model, Request: map[string]any{"chatCompletion": source}})
			if err != nil {
				t.Fatal(err)
			}
			if spec.Path != "/chat/completions" {
				t.Fatalf("agent path = %q", spec.Path)
			}
			body := manifestTestBody(t, spec)
			messages := body["messages"].([]any)
			field, absentField := "reasoning_content", "reasoning"
			if strings.HasPrefix(model, "sensenova-") {
				field, absentField = "reasoning", "reasoning_content"
			}
			for _, index := range []int{1, 3} {
				assistant := messages[index].(map[string]any)
				if assistant[field] != reasoning || assistant[absentField] != nil {
					t.Fatalf("full %s reasoning history lost: %#v", model, assistant)
				}
			}
			if !reflect.DeepEqual(messages[1].(map[string]any)["tool_calls"], calls) || messages[2].(map[string]any)["tool_call_id"] != "call-1" {
				t.Fatalf("tool IDs/arguments lost: %#v", messages)
			}
			if body["tool_choice"] != "required" || body["prompt_cache_key"] != nil {
				t.Fatalf("tool choice or undeclared cache mapping = %#v", body)
			}
			if model == "glm-5.3" && (body["tool_stream"] != true || body["parallel_tool_calls"] != nil) {
				t.Fatalf("GLM tool stream = %#v", body)
			}
			if model == "kimi-k3" && (body["max_completion_tokens"] != float64(2048) || body["max_tokens"] != nil) {
				t.Fatalf("Kimi Agent token field = %#v", body)
			}
		})
	}
	for _, source := range []map[string]any{
		{"messages": []any{map[string]any{"role": "user", "content": "hello"}}, "extra_body": map[string]any{"model": "other"}},
		{"messages": []any{map[string]any{"role": "user", "content": "hello"}}, "model": "other"},
	} {
		if _, err := adapter.BuildAgent(context.Background(), AgentRequestContext{Model: "sensenova-6.8-flash", Request: map[string]any{"chatCompletion": source}}); err == nil {
			t.Fatal("Agent bypassed shared model/field validation")
		}
	}
	if _, err := adapter.BuildAgent(context.Background(), AgentRequestContext{Model: "unknown", Request: map[string]any{"chatCompletion": map[string]any{"messages": []any{map[string]any{"role": "user", "content": "hello"}}}}}); err == nil {
		t.Fatal("Agent accepted unknown model")
	}
}

func TestSenseNovaTextResponseReasoningToolsAndUsage(t *testing.T) {
	adapter := senseNovaTextSourceAdapter(t)
	reasoning := " \nthink\n "
	for _, field := range []string{"reasoning", "reasoning_content"} {
		payload := map[string]any{
			"choices": []any{map[string]any{"message": map[string]any{"content": "answer", field: reasoning, "tool_calls": []any{map[string]any{"id": "call-1", "type": "function", "function": map[string]any{"name": "inspect_canvas", "arguments": "{}"}}}}, "finish_reason": "stop"}},
			"usage":   map[string]any{"prompt_tokens": 64, "completion_tokens": 196, "total_tokens": 260, "completion_tokens_details": map[string]any{"reasoning_tokens": 193}},
		}
		data, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		result, err := adapter.ParseCreate(context.Background(), data)
		if err != nil || result.Status != StatusSucceeded || result.Result == nil || result.Result.Text != "answer" || result.Result.Reasoning != reasoning || result.Result.Usage["total_tokens"] != float64(260) || len(result.Result.Images)+len(result.Result.Videos)+len(result.Result.Audios) != 0 {
			t.Fatalf("%s response = %#v, error = %v", field, result, err)
		}
		agent, err := adapter.(AgentAdapter).ParseAgent(context.Background(), data)
		if err != nil || agent.Text != "answer" || agent.Reasoning != reasoning || len(agent.ToolCalls) != 1 || agent.ToolCalls[0].ID != "call-1" || agent.ToolCalls[0].Arguments != "{}" {
			t.Fatalf("%s Agent response = %#v, error = %v", field, agent, err)
		}
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"error":{"code":"invalid_request","message":"invalid request"}}`))
	if err != nil || result.Status != StatusFailed || result.Message != "invalid request" {
		t.Fatalf("upstream error became success: %#v, %v", result, err)
	}
	for _, payload := range []string{
		`{"error":{"message":"invalid request"}}`,
		`{"error":{"message":"invalid request"},"choices":[{"message":{"content":"partial answer"}}]}`,
		`{"error":{}}`,
	} {
		if parsed, err := adapter.(AgentAdapter).ParseAgent(context.Background(), []byte(payload)); err == nil || parsed.Text != "" || len(parsed.ToolCalls) != 0 {
			t.Fatalf("Agent accepted an upstream error: %#v, %v", parsed, err)
		}
	}
}

func TestSenseNovaTextTruncationAndFilteringAreFailures(t *testing.T) {
	adapter := senseNovaTextSourceAdapter(t)
	for _, test := range []struct{ finish, message string }{
		{"length", "截断"},
		{"content_filter", "安全过滤"},
	} {
		t.Run(test.finish, func(t *testing.T) {
			data, err := json.Marshal(map[string]any{
				"choices": []any{map[string]any{
					"message": map[string]any{"content": "partial answer", "reasoning": "partial reasoning"}, "finish_reason": test.finish,
				}},
				"usage": map[string]any{"total_tokens": 12},
			})
			if err != nil {
				t.Fatal(err)
			}
			result, err := adapter.ParseCreate(context.Background(), data)
			if err != nil || result.Status != StatusFailed || !strings.Contains(result.Message, test.message) {
				t.Fatalf("2xx-style partial output became success: %#v, %v", result, err)
			}
			if _, err := adapter.(AgentAdapter).ParseAgent(context.Background(), data); err == nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("Agent mapped %s partial output as success: %v", test.finish, err)
			}
		})
	}
}

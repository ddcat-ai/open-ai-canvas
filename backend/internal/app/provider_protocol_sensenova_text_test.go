package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

var senseNovaHostTextModels = []string{"sensenova-6.8-flash", "sensenova-6.8-flash-lite", "deepseek-flash", "glm-5.3", "kimi-k3"}

func senseNovaHostTextRegistry(t *testing.T) *protocol.Registry {
	t.Helper()
	allowLoopbackProviderTest(t)
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	registry := center.registrySnapshot()
	if _, ok := registry.Resolve("sensenova-chat"); !ok {
		t.Fatal("official SenseNova text package was not installed")
	}
	return registry
}

func senseNovaHostTextInput(baseURL, modelName string, stream bool) canvasGenerationInput {
	return canvasGenerationInput{
		Mode: "text", Prompt: "current prompt", StreamText: stream, MaxOutputTokens: 2048,
		Config: providerConfig{
			BaseURL: baseURL, APIKey: "fixture-key", Model: modelName, InterfaceType: "sensenova-chat", SystemPrompt: "fixture system",
			CapabilityConfig: DefaultModelCapabilityConfigForModel("sensenova-chat", modelName),
		},
		TextOptions: canvasTextOptions{ThinkingLevel: "auto", MaxOutputTokens: 3072},
		TextHistory: []providerTextMessage{{Role: "user", Content: "history user"}, {Role: "assistant", Content: "history assistant"}},
	}
}

func senseNovaHostReasoningField(modelName string) string {
	if strings.HasPrefix(modelName, "sensenova-") {
		return "reasoning"
	}
	return "reasoning_content"
}

func senseNovaHostTextReply(modelName string, stream, tool bool) []byte {
	reasoning := "  first reasoning\n" + strings.Repeat("unaltered reason ", 100) + " second reasoning\n"
	usage := map[string]any{"prompt_tokens": 17, "completion_tokens": 5, "total_tokens": 22, "prompt_tokens_details": map[string]any{"cached_tokens": 7}}
	call := map[string]any{"id": "call-fixture-1", "type": "function", "function": map[string]any{"name": "inspect_canvas", "arguments": `{"target":"canvas"}`}}
	if !stream {
		message := map[string]any{"role": "assistant", "content": "hello", senseNovaHostReasoningField(modelName): reasoning}
		if tool {
			message["tool_calls"] = []any{call}
		}
		data, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": message, "finish_reason": "stop"}}, "usage": usage})
		return data
	}
	var out bytes.Buffer
	frame := func(payload any) {
		data, _ := json.Marshal(payload)
		fmt.Fprintf(&out, "data: %s\n\n", data)
	}
	frame(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{senseNovaHostReasoningField(modelName): reasoning}}}})
	frame(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": "hel"}}}})
	frame(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"content": "lo"}}}})
	if tool {
		frame(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "call-fixture-1", "type": "function", "function": map[string]any{"name": "inspect_canvas", "arguments": `{"target":`}}}}}}})
		frame(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{"tool_calls": []any{map[string]any{"index": 0, "function": map[string]any{"arguments": `"canvas"}`}}}}}}})
	}
	frame(map[string]any{"choices": []any{map[string]any{"delta": map[string]any{}, "finish_reason": "stop"}}, "usage": usage})
	out.WriteString("data: [DONE]\n\n")
	return out.Bytes()
}

func senseNovaHostAssertRequest(t *testing.T, r *http.Request, body map[string]any, modelName string, stream bool, level string, agent bool) {
	t.Helper()
	if r.URL.Path != "/v1/chat/completions" || r.Method != http.MethodPost || r.Header.Get("Authorization") != "Bearer fixture-key" {
		t.Errorf("wrong local request: %s %s, fixture auth present=%t", r.Method, r.URL.Path, r.Header.Get("Authorization") == "Bearer fixture-key")
	}
	if body["model"] != modelName || body["stream"] != stream {
		t.Errorf("model/stream contract = %#v", body)
	}
	field, absentField := "max_tokens", "max_completion_tokens"
	if modelName == "kimi-k3" {
		field, absentField = absentField, field
	}
	if body[field] != float64(2048) {
		t.Errorf("output budget %s = %#v, want 2048", field, body[field])
	}
	if _, exists := body[absentField]; exists {
		t.Errorf("wrong output budget field %s was emitted", absentField)
	}
	thinking, _ := body["thinking"].(map[string]any)
	if level == "off" {
		if thinking["type"] != "disabled" {
			t.Errorf("thinking off = %#v", thinking)
		}
		if _, exists := body["reasoning_effort"]; exists {
			t.Errorf("off must not add an incompatible effort: %#v", body["reasoning_effort"])
		}
	} else {
		effort := "high"
		if modelName == "glm-5.3" || modelName == "kimi-k3" {
			effort = "max"
		}
		if thinking["type"] != "enabled" || body["reasoning_effort"] != effort {
			t.Errorf("model-specific thinking policy = %#v / %#v", thinking, body["reasoning_effort"])
		}
	}
	if modelName == "deepseek-flash" {
		if level == "off" {
			if body["top_p"] != float64(1) || body["temperature"] != 0.4 {
				t.Errorf("DeepSeek off sampling = %#v", body)
			}
		} else {
			// top_p is optional. If supplied, DeepSeek thinking normalizes the
			// configured value to at least 0.95; omission uses upstream defaults.
			if value, present := body["top_p"]; present && value != 0.95 {
				t.Errorf("DeepSeek thinking top_p = %#v", body["top_p"])
			}
			for _, name := range []string{"temperature", "presence_penalty", "frequency_penalty"} {
				if _, exists := body[name]; exists {
					t.Errorf("DeepSeek thinking emitted %s", name)
				}
			}
		}
	}
	if modelName == "glm-5.3" && stream && agent && body["tool_stream"] != true {
		t.Error("GLM streaming tools did not enable tool_stream")
	}
	if modelName == "glm-5.3" {
		if _, exists := body["stream_options"]; exists {
			t.Error("GLM does not document stream_options; host injection bypassed the plugin contract")
		}
	}
	if modelName == "kimi-k3" {
		// These optional parameters may be omitted. Configured values are
		// fixed by the documented model contract, not injected host defaults.
		for name, want := range map[string]any{"temperature": float64(1), "top_p": 0.95} {
			if value, present := body[name]; present && value != want {
				t.Errorf("Kimi fixed %s = %#v, want %#v", name, value, want)
			}
		}
	}
	if _, exists := body["prompt_cache_key"]; exists {
		t.Error("host-only prompt cache key leaked into the vendor body")
	}
}

func senseNovaHostRunCreate(ctx context.Context, input canvasGenerationInput, direct bool) (map[string]any, error) {
	if direct {
		adapter, _ := declarativeProtocolAdapterForContext(ctx, "sensenova-chat")
		return runProtocolAdapterTask(ctx, input, adapter)
	}
	return runTextTask(ctx, input)
}

func TestSenseNovaTextHostCreatePolicyAndReasoning(t *testing.T) {
	registry := senseNovaHostTextRegistry(t)
	for _, modelName := range senseNovaHostTextModels {
		for _, stream := range []bool{false, true} {
			for _, direct := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/stream=%t/direct=%t", modelName, stream, direct), func(t *testing.T) {
					var calls atomic.Int32
					reply := senseNovaHostTextReply(modelName, stream, false)
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						calls.Add(1)
						var body map[string]any
						if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
							t.Error(err)
							return
						}
						senseNovaHostAssertRequest(t, r, body, modelName, stream, "auto", false)
						if modelName == "deepseek-flash" && body["top_p"] != 0.95 {
							t.Error("explicit DeepSeek top_p was lost before model-specific normalization")
						}
						messages := interfaceSlice(body["messages"])
						if len(messages) != 4 || stringField(messages[0].(map[string]any), "content") != "fixture system" {
							t.Errorf("system/history/current prompt lost: %#v", messages)
						}
						mime := "application/json"
						if stream {
							mime = "text/event-stream"
						}
						w.Header().Set("Content-Type", mime)
						_, _ = w.Write(reply)
					}))
					defer server.Close()
					ctx, cancel := context.WithTimeout(withProtocolRegistry(context.Background(), registry), 5*time.Second)
					defer cancel()
					input := senseNovaHostTextInput(server.URL+"/v1", modelName, stream)
					if modelName == "deepseek-flash" {
						input.Metadata = map[string]any{"providerOptions": map[string]any{"sensenova-chat": map[string]any{"temperature": 0.4, "top_p": 0.2, "presence_penalty": -1}}}
					}
					before, _ := json.Marshal(input)
					var text, reasoning strings.Builder
					input.OnTextDelta = func(delta string) { text.WriteString(delta) }
					input.OnReasoningDelta = func(delta string) { reasoning.WriteString(delta) }
					result, err := senseNovaHostRunCreate(ctx, input, direct)
					if err != nil || result["text"] != "hello" || result["reasoning"] != "  first reasoning\n"+strings.Repeat("unaltered reason ", 100)+" second reasoning\n" {
						t.Fatalf("create response lost text/raw reasoning: %#v, %v", result, err)
					}
					if stream && (text.String() != "hello" || reasoning.String() != result["reasoning"]) {
						t.Fatalf("SSE deltas disagree with final output: %q / %q", text.String(), reasoning.String())
					}
					if after, _ := json.Marshal(input); !bytes.Equal(before, after) || calls.Load() != 1 {
						t.Fatalf("input mutated or create resubmitted: calls=%d", calls.Load())
					}
					// Text result DTO intentionally has no usage field. Exercise the
					// real HTTP-log usage parser against the exact bytes served above;
					// no account, billing order or database is involved.
					log := model.ApiCallLog{Capability: "text", Status: model.ApiCallStatusSucceeded, Path: "/v1/chat/completions"}
					(&Service{}).EnrichAPICallLog(&log, reply)
					if !log.UsageAvailable || log.InputTokens != 17 || log.OutputTokens != 5 || log.CachedTokens != 7 {
						t.Fatalf("usage parser lost reported token counts: %#v", log)
					}
				})
			}
		}
	}
}

func senseNovaHostAgentRequests(canonical bool, continued bool) *agentToolRequests {
	tools := []map[string]any{{"type": "function", "function": map[string]any{"name": "inspect_canvas", "description": "Inspect the current canvas", "parameters": map[string]any{"type": "object", "properties": map[string]any{"target": map[string]any{"type": "string"}}}}}}
	messages := []map[string]any{{"role": "user", "content": "inspect canvas"}}
	if continued {
		messages = append(messages,
			map[string]any{"role": "assistant", "content": "hello", "tool_calls": []any{map[string]any{"id": "call-fixture-1", "type": "function", "function": map[string]any{"name": "inspect_canvas", "arguments": `{"target":"canvas"}`}}}, "reasoning_content": "  tool history reasoning\n", "reasoning_wire": protocol.TextWireChatCompletion},
			map[string]any{"role": "tool", "tool_call_id": "call-fixture-1", "content": `{"found":true}`},
			map[string]any{"role": "user", "content": "continue"},
		)
	}
	if canonical {
		return &agentToolRequests{Canonical: &canonicalAgentRequest{Messages: messages, Tools: tools, ToolChoice: "auto", PromptCacheKey: "host-only"}}
	}
	return &agentToolRequests{ChatCompletion: map[string]any{"messages": messages, "tools": tools, "tool_choice": "auto", "parallel_tool_calls": false, "prompt_cache_key": "host-only", "max_tokens": 9000}}
}

func senseNovaHostRunAgent(ctx context.Context, input canvasGenerationInput, direct bool) (map[string]any, error) {
	if direct {
		adapter, _ := agentProtocolAdapterForContext(ctx, "sensenova-chat")
		return runDeclarativeAgentTask(ctx, input, adapter)
	}
	return runAgentToolTask(ctx, input)
}

func TestSenseNovaTextHostAgentToolLoopAndContext(t *testing.T) {
	registry := senseNovaHostTextRegistry(t)
	for _, modelName := range senseNovaHostTextModels {
		for _, stream := range []bool{false, true} {
			for _, direct := range []bool{false, true} {
				t.Run(fmt.Sprintf("%s/stream=%t/direct=%t", modelName, stream, direct), func(t *testing.T) {
					var calls atomic.Int32
					server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						step := calls.Add(1)
						var body map[string]any
						if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
							t.Error(err)
							return
						}
						senseNovaHostAssertRequest(t, r, body, modelName, stream, "auto", true)
						if modelName == "deepseek-flash" && direct && body["top_p"] != 0.95 {
							t.Error("explicit Agent DeepSeek top_p was lost before model-specific normalization")
						}
						if len(interfaceSlice(body["tools"])) != 1 {
							t.Errorf("tool schema lost: %#v", body["tools"])
						}
						if step == 2 {
							messages := interfaceSlice(body["messages"])
							if len(messages) != 4 {
								t.Errorf("tool continuation lost history: %#v", messages)
							} else {
								assistant := messages[1].(map[string]any)
								tool := messages[2].(map[string]any)
								toolCalls := interfaceSlice(assistant["tool_calls"])
								if len(toolCalls) != 1 || stringField(toolCalls[0].(map[string]any), "id") != "call-fixture-1" || tool["tool_call_id"] != "call-fixture-1" || assistant[senseNovaHostReasoningField(modelName)] != "  first reasoning\n"+strings.Repeat("unaltered reason ", 100)+" second reasoning\n" {
									t.Errorf("tool call ID or original reasoning history changed: %#v", messages)
								}
							}
						}
						mime := "application/json"
						if stream {
							mime = "text/event-stream"
						}
						w.Header().Set("Content-Type", mime)
						_, _ = w.Write(senseNovaHostTextReply(modelName, stream, step == 1))
					}))
					defer server.Close()
					ctx, cancel := context.WithTimeout(withProtocolRegistry(context.Background(), registry), 5*time.Second)
					defer cancel()
					var previousResult map[string]any
					for _, continued := range []bool{false, true} {
						input := senseNovaHostTextInput(server.URL, modelName, stream)
						input.Config.SystemPrompt = ""
						input.AgentRequests = senseNovaHostAgentRequests(!direct, continued)
						if continued {
							messages := input.AgentRequests.ChatCompletion
							var history []map[string]any
							if direct {
								history = messages["messages"].([]map[string]any)
							} else {
								history = input.AgentRequests.Canonical.Messages
							}
							history[1]["content"] = previousResult["text"]
							history[1]["tool_calls"] = previousResult["toolCalls"]
							history[1]["reasoning_content"] = previousResult["reasoning"]
							returnedCall := interfaceSlice(previousResult["toolCalls"])[0].(map[string]any)
							history[2]["tool_call_id"] = returnedCall["id"]
						}
						if direct && modelName == "deepseek-flash" {
							input.AgentRequests.ChatCompletion["temperature"] = 0.4
							input.AgentRequests.ChatCompletion["top_p"] = 0.2
						}
						before, _ := json.Marshal(input.AgentRequests)
						result, err := senseNovaHostRunAgent(ctx, input, direct)
						if err != nil || result["text"] != "hello" || result["reasoning"] != "  first reasoning\n"+strings.Repeat("unaltered reason ", 100)+" second reasoning\n" {
							t.Fatalf("Agent response lost text/raw reasoning: %#v, %v", result, err)
						}
						if !continued {
							toolCalls := interfaceSlice(result["toolCalls"])
							if len(toolCalls) != 1 || toolCalls[0].(map[string]any)["id"] != "call-fixture-1" || toolCalls[0].(map[string]any)["function"].(map[string]any)["arguments"] != `{"target":"canvas"}` {
								t.Fatalf("streamed/sync tool call identity or arguments lost: %#v", toolCalls)
							}
						}
						if after, _ := json.Marshal(input.AgentRequests); !bytes.Equal(before, after) || input.AgentRequests.Canonical != nil && input.AgentRequests.Canonical.PassReasoning {
							t.Fatal("host execution mutated the source conversation/SDK request")
						}
						previousResult = result
					}
					if calls.Load() != 2 {
						t.Fatalf("tool loop made %d upstream calls, want exactly two steps", calls.Load())
					}
				})
			}
		}
	}
}

func TestSenseNovaTextHostDeepSeekOffSampling(t *testing.T) {
	registry := senseNovaHostTextRegistry(t)
	for _, agent := range []bool{false, true} {
		t.Run(fmt.Sprintf("agent=%t", agent), func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				senseNovaHostAssertRequest(t, r, body, "deepseek-flash", false, "off", agent)
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write(senseNovaHostTextReply("deepseek-flash", false, false))
			}))
			defer server.Close()
			ctx := withProtocolRegistry(context.Background(), registry)
			input := senseNovaHostTextInput(server.URL, "deepseek-flash", false)
			input.TextOptions.ThinkingLevel = "off"
			if agent {
				input.AgentRequests = senseNovaHostAgentRequests(false, false)
				input.AgentRequests.ChatCompletion["temperature"] = 0.4
				input.AgentRequests.ChatCompletion["top_p"] = 0.2
				_, err := senseNovaHostRunAgent(ctx, input, true)
				if err != nil {
					t.Fatal(err)
				}
			} else {
				input.Metadata = map[string]any{"providerOptions": map[string]any{"sensenova-chat": map[string]any{"temperature": 0.4, "top_p": 0.2}}}
				if _, err := senseNovaHostRunCreate(ctx, input, false); err != nil {
					t.Fatal(err)
				}
			}
			if calls.Load() != 1 {
				t.Fatalf("off request was submitted %d times", calls.Load())
			}
		})
	}
}

func TestSenseNovaTextHostExplicitKimiSampling(t *testing.T) {
	registry := senseNovaHostTextRegistry(t)
	for _, agent := range []bool{false, true} {
		t.Run(fmt.Sprintf("agent=%t", agent), func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				var body map[string]any
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				senseNovaHostAssertRequest(t, r, body, "kimi-k3", false, "auto", agent)
				if body["temperature"] != float64(1) || body["top_p"] != 0.95 {
					t.Error("explicit documented Kimi sampling values were not preserved")
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write(senseNovaHostTextReply("kimi-k3", false, false))
			}))
			defer server.Close()
			ctx := withProtocolRegistry(context.Background(), registry)
			input := senseNovaHostTextInput(server.URL, "kimi-k3", false)
			var err error
			if agent {
				input.AgentRequests = senseNovaHostAgentRequests(false, false)
				input.AgentRequests.ChatCompletion["temperature"] = 1
				input.AgentRequests.ChatCompletion["top_p"] = 0.95
				_, err = senseNovaHostRunAgent(ctx, input, true)
			} else {
				input.Metadata = map[string]any{"providerOptions": map[string]any{"sensenova-chat": map[string]any{"temperature": 1, "top_p": 0.95}}}
				_, err = senseNovaHostRunCreate(ctx, input, false)
			}
			if err != nil || calls.Load() != 1 {
				t.Fatalf("explicit Kimi sampling request failed or resubmitted: %v, calls=%d", err, calls.Load())
			}
		})
	}
}

func TestSenseNovaTextHostFailuresAndCancellationDoNotResubmit(t *testing.T) {
	registry := senseNovaHostTextRegistry(t)
	for _, agent := range []bool{false, true} {
		for _, scenario := range []string{"http400", "stream-options400", "business-error", "sse-error", "cancel"} {
			t.Run(fmt.Sprintf("agent=%t/%s", agent, scenario), func(t *testing.T) {
				ctx, cancel := context.WithTimeout(withProtocolRegistry(context.Background(), registry), 5*time.Second)
				defer cancel()
				var calls atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					calls.Add(1)
					if scenario == "stream-options400" {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusBadRequest)
						fmt.Fprint(w, `{"error":{"code":"invalid_request_error","message":"fixture upstream failure: unknown parameter stream_options"}}`)
						return
					}
					if scenario == "cancel" {
						w.Header().Set("Content-Type", "text/event-stream")
						fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n")
						w.(http.Flusher).Flush()
						select {
						case <-r.Context().Done():
						case <-time.After(2 * time.Second):
							t.Error("upstream request did not receive cancellation")
						}
						return
					}
					if scenario == "sse-error" {
						w.Header().Set("Content-Type", "text/event-stream")
						fmt.Fprint(w, "data: {\"error\":{\"message\":\"fixture upstream failure\"}}\n\n")
						return
					}
					w.Header().Set("Content-Type", "application/json")
					if scenario == "http400" {
						w.WriteHeader(http.StatusBadRequest)
					}
					fmt.Fprint(w, `{"error":{"code":"fixture_failure","message":"fixture upstream failure"}}`)
				}))
				defer server.Close()
				input := senseNovaHostTextInput(server.URL, "sensenova-6.8-flash", scenario == "sse-error" || scenario == "cancel" || scenario == "stream-options400")
				input.OnTextDelta = func(string) { cancel() }
				var result map[string]any
				var err error
				if agent {
					input.AgentRequests = senseNovaHostAgentRequests(false, false)
					result, err = senseNovaHostRunAgent(ctx, input, true)
				} else {
					result, err = senseNovaHostRunCreate(ctx, input, false)
				}
				if err == nil || result != nil || calls.Load() != 1 {
					t.Fatalf("failure became success or was resubmitted: calls=%d, result=%#v, err=%v", calls.Load(), result, err)
				}
				if scenario == "cancel" && !errors.Is(err, context.Canceled) {
					t.Fatalf("cancellation identity lost: %v", err)
				}
				if scenario != "cancel" && !strings.Contains(err.Error(), "fixture upstream failure") {
					t.Fatalf("upstream error identity lost: %v", err)
				}
			})
		}
	}
}

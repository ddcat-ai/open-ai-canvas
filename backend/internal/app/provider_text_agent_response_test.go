package app

import (
	"encoding/json"
	"strings"
	"testing"

	protocolcontract "yingce/backend/internal/protocol"
)

func chatCompletionTestFrame(t *testing.T, payload map[string]any) []byte {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return []byte("data: " + string(data) + "\n\n")
}

func TestChatCompletionAgentPreservesRawReasoning(t *testing.T) {
	reasoning := " \n完整推理\n "
	for _, field := range []string{"reasoning_content", "reasoning"} {
		t.Run(field, func(t *testing.T) {
			payload := map[string]any{"choices": []any{map[string]any{
				"message":       map[string]any{"content": "answer", field: reasoning},
				"finish_reason": "stop",
			}}}
			result, err := parseAgentToolPayload(payload, protocolcontract.TextWireChatCompletion)
			if err != nil || result["text"] != "answer" || result["reasoning"] != reasoning {
				t.Fatalf("raw %s changed: result = %#v, error = %v", field, result, err)
			}
		})
	}
}

func TestChatCompletionAgentRejectsFailedFinishReasons(t *testing.T) {
	for _, test := range []struct{ finish, message string }{{"length", "截断"}, {"content_filter", "安全过滤"}} {
		t.Run(test.finish, func(t *testing.T) {
			payload := map[string]any{"choices": []any{map[string]any{
				"message": map[string]any{"content": "partial", "tool_calls": []any{map[string]any{
					"id": "call-1", "function": map[string]any{"name": "inspect", "arguments": "{}"},
				}}},
				"finish_reason": test.finish,
			}}}
			result, err := parseAgentToolPayload(payload, protocolcontract.TextWireChatCompletion)
			if err == nil || result != nil || !strings.Contains(err.Error(), test.message) {
				t.Fatalf("partial answer/tool call became success: %#v, %v", result, err)
			}
		})
	}
}

func TestChatCompletionStreamRejectsFailedFinishReasons(t *testing.T) {
	for _, test := range []struct{ finish, message string }{{"length", "截断"}, {"content_filter", "安全过滤"}} {
		t.Run(test.finish, func(t *testing.T) {
			var deltas strings.Builder
			parser := newStreamingAgentParser(protocolcontract.TextWireChatCompletion, func(value string) { deltas.WriteString(value) })
			parser.consume("text/event-stream", chatCompletionTestFrame(t, map[string]any{"choices": []any{map[string]any{
				"delta": map[string]any{"content": "partial"},
			}}}))
			parser.consume("text/event-stream", chatCompletionTestFrame(t, map[string]any{"choices": []any{map[string]any{
				"delta": map[string]any{}, "finish_reason": test.finish,
			}}}))
			parser.consume("text/event-stream", []byte("data: [DONE]\n\n"))
			parser.flush()
			result, err := parser.result()
			if err == nil || result != nil || !strings.Contains(err.Error(), test.message) || deltas.String() != "partial" {
				t.Fatalf("stream completion hid %s failure: result = %#v, error = %v, deltas = %q", test.finish, result, err, deltas.String())
			}
		})
	}
}

func TestChatCompletionStreamPreservesRawReasoningAndToolTermination(t *testing.T) {
	reasoning := " \n完整推理\n "
	for _, field := range []string{"reasoning_content", "reasoning", "reasoning_text"} {
		t.Run(field, func(t *testing.T) {
			parser := newStreamingAgentParser(protocolcontract.TextWireChatCompletion, nil)
			parser.consume("text/event-stream", chatCompletionTestFrame(t, map[string]any{"choices": []any{map[string]any{
				"delta": map[string]any{field: reasoning, "tool_calls": []any{map[string]any{
					"index": 0, "id": "call-1", "type": "function", "function": map[string]any{"name": "inspect", "arguments": "{}"},
				}}},
			}}}))
			parser.consume("text/event-stream", chatCompletionTestFrame(t, map[string]any{"choices": []any{map[string]any{
				"delta": map[string]any{}, "finish_reason": "tool_calls",
			}}}))
			parser.consume("text/event-stream", []byte("data: [DONE]\n\n"))
			parser.flush()
			result, err := parser.result()
			if err != nil || result["reasoning"] != reasoning || len(interfaceSlice(result["toolCalls"])) != 1 {
				t.Fatalf("raw reasoning or normal tool termination lost: %#v, %v", result, err)
			}
		})
	}
}

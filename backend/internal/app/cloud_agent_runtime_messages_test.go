package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

// 运行时会话消息（user/assistant/toolResult + 内容块）必须转换成供应商层能接受的规范请求，
// 否则第一步模型调用就会因“缺少工具选择”等校验失败。
func TestCanonicalFromRuntimeMessagesPassesProviderValidation(t *testing.T) {
	messages := []map[string]any{
		{"role": "user", "content": []interface{}{map[string]interface{}{"type": "text", "text": "帮我整理画布"}}, "timestamp": 1},
		{"role": "assistant", "content": []interface{}{
			map[string]interface{}{"type": "thinking", "thinking": "先看看画布"},
			map[string]interface{}{"type": "text", "text": "我先读取画布。"},
			map[string]interface{}{"type": "toolCall", "id": "call-1", "itemId": "fc-1", "name": "canvas_snapshot", "arguments": map[string]interface{}{}},
		}},
		{"role": "toolResult", "toolCallId": "call-1", "toolName": "canvas_snapshot", "content": []interface{}{map[string]interface{}{"type": "text", "text": "{\"nodes\":0}"}}, "isError": false},
	}
	tools := runtimeToolSchemas([]map[string]any{{"name": "canvas_snapshot", "description": "获取画布快照", "parameters": map[string]any{"type": "object", "properties": map[string]any{}}}})
	canonical, err := canonicalFromRuntimeMessages(messages, tools, "你是画布助手")
	if err != nil {
		t.Fatal(err)
	}
	if canonical.ToolChoice != "auto" {
		t.Fatalf("tool choice = %v", canonical.ToolChoice)
	}
	if len(canonical.Messages) != 4 || stringField(canonical.Messages[0], "role") != "system" {
		t.Fatalf("unexpected messages: %#v", canonical.Messages)
	}
	if stringField(canonical.Messages[3], "role") != "tool" || stringField(canonical.Messages[3], "tool_call_id") != "call-1" {
		t.Fatalf("tool result not converted: %#v", canonical.Messages[3])
	}
	calls := canonicalAgentToolCalls(canonical.Messages[2]["tool_calls"])
	if len(calls) != 1 || stringField(calls[0], "item_id") != "fc-1" {
		t.Fatalf("runtime Responses item id not preserved: %#v", calls)
	}
	if _, err := expandCanonicalAgentRequest(&canonical, providerConfig{}, false); err != nil {
		t.Fatalf("provider validation rejected runtime transcript: %v", err)
	}
}

func TestRuntimeToolCallsDecodeArguments(t *testing.T) {
	var call cloudAgentCall
	call.ID = "call-1"
	call.Function.Name = "canvas_node_read"
	call.Function.Arguments = `{"nodeId":"n1"}`
	out := runtimeToolCalls([]cloudAgentCall{call})
	args, _ := out[0]["arguments"].(map[string]any)
	if out[0]["name"] != "canvas_node_read" || args["nodeId"] != "n1" {
		t.Fatalf("unexpected runtime call: %#v", out[0])
	}
}

func TestValidateRuntimeMessagesForModelRejectsOrphanToolResult(t *testing.T) {
	messages := []map[string]any{{"role": "user", "content": "继续"}, {"role": "toolResult", "toolCallId": "missing", "content": "{}"}}
	if err := validateRuntimeMessagesForModel(messages); err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("orphan tool result error = %v", err)
	}
}

func TestValidateRuntimeMessagesForModelRejectsIncompleteToolTurn(t *testing.T) {
	messages := []map[string]any{{"role": "user", "content": "读取"}, {"role": "assistant", "content": []interface{}{map[string]interface{}{"type": "toolCall", "id": "call-2", "name": "canvas_get_state", "arguments": map[string]interface{}{}}}}}
	if err := validateRuntimeMessagesForModel(messages); err == nil || !strings.Contains(err.Error(), "call-2") {
		t.Fatalf("incomplete tool turn error = %v", err)
	}
}

func TestValidateRuntimeMessagesForModelAllowsMultipleToolCalls(t *testing.T) {
	messages := []map[string]any{
		{"role": "user", "content": "读取画布和当前选区"},
		{"role": "assistant", "content": []interface{}{
			map[string]interface{}{"type": "toolCall", "id": "call-state", "name": "canvas_get_state", "arguments": map[string]interface{}{}},
			map[string]interface{}{"type": "toolCall", "id": "call-selection", "name": "canvas_get_selection", "arguments": map[string]interface{}{}},
		}},
		{"role": "toolResult", "toolCallId": "call-selection", "content": "{}"},
		{"role": "toolResult", "toolCallId": "call-state", "content": "{}"},
	}
	if err := validateRuntimeMessagesForModel(messages); err != nil {
		t.Fatalf("multiple tool calls should be accepted: %v", err)
	}
}

func TestValidateCanonicalAgentHistoryRejectsOrphanToolResult(t *testing.T) {
	request := canonicalAgentRequest{
		Messages: []map[string]interface{}{
			{"role": "user", "content": "继续"},
			{"role": "tool", "tool_call_id": "missing", "content": "{}"},
		},
		ToolChoice: "auto",
	}
	if _, err := expandCanonicalAgentRequest(&request, providerConfig{}, false); err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("orphan canonical tool result error = %v", err)
	}
}

func TestValidateCanonicalAgentHistoryRequiresResponsesItemID(t *testing.T) {
	request := canonicalAgentRequest{
		Messages: []map[string]interface{}{
			{"role": "user", "content": "读取"},
			{"role": "assistant", "content": "", "tool_calls": []map[string]interface{}{{"id": "call-3", "function": map[string]interface{}{"name": "canvas_get_state", "arguments": "{}"}}}},
			{"role": "tool", "tool_call_id": "call-3", "content": "{}"},
		},
		ToolChoice: "auto",
	}
	if _, err := expandCanonicalAgentRequest(&request, providerConfig{InterfaceType: string(model.ChannelInterfaceOpenAIResponse)}, false); err == nil || !strings.Contains(err.Error(), "call-3") {
		t.Fatalf("missing Responses item id error = %v", err)
	}
}

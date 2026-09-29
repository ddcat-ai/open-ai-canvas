package app

import "testing"

// 运行时会话消息（user/assistant/toolResult + 内容块）必须转换成供应商层能接受的规范请求，
// 否则第一步模型调用就会因“缺少工具选择”等校验失败。
func TestCanonicalFromRuntimeMessagesPassesProviderValidation(t *testing.T) {
	messages := []map[string]any{
		{"role": "user", "content": []interface{}{map[string]interface{}{"type": "text", "text": "帮我整理画布"}}, "timestamp": 1},
		{"role": "assistant", "content": []interface{}{
			map[string]interface{}{"type": "thinking", "thinking": "先看看画布"},
			map[string]interface{}{"type": "text", "text": "我先读取画布。"},
			map[string]interface{}{"type": "toolCall", "id": "call-1", "name": "canvas_snapshot", "arguments": map[string]interface{}{}},
		}},
		{"role": "toolResult", "toolCallId": "call-1", "toolName": "canvas_snapshot", "content": []interface{}{map[string]interface{}{"type": "text", "text": "{\"nodes\":0}"}}, "isError": false},
	}
	tools := runtimeToolSchemas([]map[string]any{{"name": "canvas_snapshot", "description": "获取画布快照", "parameters": map[string]any{"type": "object", "properties": map[string]any{}}}})
	canonical := canonicalFromRuntimeMessages(messages, tools, "你是画布助手")
	if canonical.ToolChoice != "auto" {
		t.Fatalf("tool choice = %v", canonical.ToolChoice)
	}
	if len(canonical.Messages) != 4 || stringField(canonical.Messages[0], "role") != "system" {
		t.Fatalf("unexpected messages: %#v", canonical.Messages)
	}
	if stringField(canonical.Messages[3], "role") != "tool" || stringField(canonical.Messages[3], "tool_call_id") != "call-1" {
		t.Fatalf("tool result not converted: %#v", canonical.Messages[3])
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

package app

import (
	"strings"
	"testing"
)

func runtimeToolCallPart(id, name string) map[string]interface{} {
	return map[string]interface{}{"type": "toolCall", "id": id, "name": name, "arguments": map[string]interface{}{}}
}

// 复现：一步里 plan_update（需审批）+ canvas_list_node_types，
// 审批暂停后第二个调用没有结果，恢复运行时整轮以「工具调用缺少结果」失败。
func TestCloudAgentPiCanonicalRepairsCallSkippedByApprovalPause(t *testing.T) {
	messages := []map[string]any{
		{"role": "user", "content": "做一段特惠视频"},
		{"role": "assistant", "content": []interface{}{
			map[string]interface{}{"type": "text", "text": "参数已确认"},
			runtimeToolCallPart("call_00_plan", "plan_update"),
			runtimeToolCallPart("call_01_types", "canvas_list_node_types"),
		}},
		{"role": "toolResult", "toolCallId": "call_00_plan", "toolName": "plan_update", "content": []interface{}{map[string]interface{}{"type": "text", "text": "操作正在等待用户审批。"}}},
		{"role": "user", "content": "用户已批准刚才等待审批的操作。"},
	}
	// 恢复前服务端保存的规范历史：停在审批那一步，比运行时消息短。
	existing := canonicalAgentRequest{
		SystemPrompt:   "Agent system prompt",
		PromptCacheKey: "cache-key",
		Messages: []map[string]interface{}{
			{"role": "system", "content": "Agent system prompt"},
			{"role": "user", "content": "做一段特惠视频"},
			{"role": "assistant", "content": "参数已确认", "tool_calls": []interface{}{
				map[string]interface{}{"id": "call_00_plan", "function": map[string]interface{}{"name": "plan_update", "arguments": "{}"}},
				map[string]interface{}{"id": "call_01_types", "function": map[string]interface{}{"name": "canvas_list_node_types", "arguments": "{}"}},
			}},
		},
	}

	canonical, err := cloudAgentPiCanonicalForModelRequest(messages, existing)
	if err != nil {
		t.Fatalf("convert resumed transcript: %v", err)
	}
	if err := validateCanonicalAgentHistory(&canonical, false); err != nil {
		t.Fatalf("resumed history still invalid: %v", err)
	}
	// system + user + assistant + 两条工具结果 + 恢复提示词
	if len(canonical.Messages) != 6 {
		t.Fatalf("messages = %d, want 6: %#v", len(canonical.Messages), canonical.Messages)
	}
	skipped := canonical.Messages[4]
	if stringField(skipped, "role") != "tool" || stringField(skipped, "tool_call_id") != "call_01_types" || !strings.Contains(stringField(skipped, "content"), "未被执行") {
		t.Fatalf("skipped call was not answered: %#v", skipped)
	}
	last := canonical.Messages[5]
	if stringField(last, "role") != "user" || !strings.Contains(stringField(last, "content"), "已批准") {
		t.Fatalf("resume prompt did not reach the model: %#v", last)
	}
	if len(messages) != 4 {
		t.Fatalf("input transcript was mutated: %d messages", len(messages))
	}
}

func TestRepairRuntimeUnansweredCallsLeavesCompleteTranscriptUntouched(t *testing.T) {
	messages := []map[string]any{
		{"role": "user", "content": "读取画布和当前选区"},
		{"role": "assistant", "content": []interface{}{
			runtimeToolCallPart("call-state", "canvas_get_state"),
			runtimeToolCallPart("call-selection", "canvas_get_selection"),
		}},
		{"role": "toolResult", "toolCallId": "call-selection", "content": "{}"},
		{"role": "toolResult", "toolCallId": "call-state", "content": "{}"},
		{"role": "assistant", "content": []interface{}{map[string]interface{}{"type": "text", "text": "读完了"}}},
	}
	repaired := repairRuntimeUnansweredCalls(messages)
	if len(repaired) != len(messages) || &repaired[0] != &messages[0] {
		t.Fatalf("complete transcript was rewritten: %#v", repaired)
	}
}

func TestRepairRuntimeUnansweredCallsHandlesSeveralTurns(t *testing.T) {
	messages := []map[string]any{
		{"role": "user", "content": "开始"},
		{"role": "assistant", "content": []interface{}{runtimeToolCallPart("a1", "plan_update"), runtimeToolCallPart("a2", "canvas_get_state")}},
		{"role": "toolResult", "toolCallId": "a1", "content": "{}"},
		{"role": "user", "content": "继续"},
		{"role": "assistant", "content": []interface{}{runtimeToolCallPart("b1", "canvas_get_state")}},
		{"role": "toolResult", "toolCallId": "b1", "content": "{}"},
		{"role": "assistant", "content": []interface{}{runtimeToolCallPart("c1", "ask_user")}},
	}
	repaired := repairRuntimeUnansweredCalls(messages)
	if err := validateRuntimeMessagesForModel(repaired); err != nil {
		t.Fatalf("repaired transcript invalid: %v", err)
	}
	if len(repaired) != len(messages)+2 {
		t.Fatalf("repaired = %d messages, want %d", len(repaired), len(messages)+2)
	}
	if stringField(repaired[3], "toolCallId") != "a2" || stringField(repaired[len(repaired)-1], "toolCallId") != "c1" {
		t.Fatalf("synthetic results misplaced: %#v", repaired)
	}
}

// 后端重启后恢复运行时，服务端规范历史比运行时消息长，会被直接采用；
// 它里面没有结果的调用同样要补齐，否则恢复运行仍以「工具调用缺少结果」失败。
func TestCloudAgentPiCanonicalRepairsServerHistoryWhenItIsAuthoritative(t *testing.T) {
	existing := canonicalAgentRequest{
		SystemPrompt: "Agent system prompt",
		Messages: []map[string]interface{}{
			{"role": "system", "content": "Agent system prompt"},
			{"role": "user", "content": "整理画布"},
			{"role": "assistant", "content": "", "tool_calls": []interface{}{
				map[string]interface{}{"id": "call-a", "function": map[string]interface{}{"name": "canvas_get_state", "arguments": "{}"}},
				map[string]interface{}{"id": "call-b", "function": map[string]interface{}{"name": "canvas_list_node_types", "arguments": "{}"}},
			}},
			{"role": "tool", "tool_call_id": "call-a", "content": "{}"},
			{"role": "user", "content": "继续"},
		},
	}
	// 运行时这边只剩一条恢复提示词，比服务端历史短。
	messages := []map[string]any{{"role": "user", "content": "继续"}}

	canonical, err := cloudAgentPiCanonicalForModelRequest(messages, existing)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateCanonicalAgentHistory(&canonical, false); err != nil {
		t.Fatalf("authoritative server history still invalid: %v", err)
	}
	if len(canonical.Messages) != 6 || stringField(canonical.Messages[4], "tool_call_id") != "call-b" {
		t.Fatalf("missing result not inserted after existing results: %#v", canonical.Messages)
	}
}

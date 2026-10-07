package app

import (
	"encoding/json"
	"strings"
	"testing"
)

// 回归（线上评测 run ag7317ce5c seq 28→31）：审批等待期间模型历史停在「等待审批」占位
// 结果上，批准后执行器已写入画布，但恢复提示只有一句"已执行一次"——模型看不到结果里的
// 新 snapshotHash，只能重发同参数调用，撞上自己第一次执行改变的快照（state_conflict）。
// 恢复提示必须携带真实执行结果摘要；同批排在审批之后被中止的调用也要一并说明。
func TestCloudAgentApprovalResumePromptCarriesReceipt(t *testing.T) {
	receipt := `{"nodeId":"script-smart-speaker-mom","snapshotHash":"b935f1b7","rows":4}`
	state := &cloudAgentRuntime{}
	state.Canonical.Messages = []map[string]any{
		{"role": "user", "content": "补第 2 镜"},
		{"role": "assistant", "content": "", "tool_calls": []interface{}{
			map[string]interface{}{"id": "call_00", "type": "function", "function": map[string]interface{}{"name": "canvas_edit_storyboard", "arguments": "{}"}},
		}},
		{"role": "tool", "tool_call_id": "call_00", "content": "操作正在等待用户审批。"},
		{"role": "tool", "tool_call_id": "call_00", "content": receipt},
	}

	prompt := cloudAgentApprovalResumePrompt(state)
	if !strings.Contains(prompt, "b935f1b7") {
		t.Fatalf("恢复提示应携带执行结果里的最新 snapshotHash：\n%s", prompt)
	}
	if !strings.Contains(prompt, "不要重复调用") {
		t.Fatal("恢复提示必须明确禁止重发已执行的操作")
	}
	// 同批还有未执行的调用：CallIndex < len(Calls)。
	state.Calls = []cloudAgentCall{{ID: "call_00"}, {ID: "call_01"}}
	state.CallIndex = 0
	prompt = cloudAgentApprovalResumePrompt(state)
	if !strings.Contains(prompt, "其余调用未被执行") {
		t.Fatalf("同批剩余调用应在恢复提示中说明：\n%s", prompt)
	}
}

// 尾部结果是失败（含 error 字段）或没有工具结果时，回退到不携带结果的通用提示，
// 让模型从 canonical 历史里自己的工具结果获取事实。
func TestCloudAgentApprovalResumePromptFallsBackWithoutReceipt(t *testing.T) {
	failed := &cloudAgentRuntime{}
	failed.Canonical.Messages = []map[string]any{
		{"role": "tool", "tool_call_id": "call_00", "content": `{"error":"上游拒绝","errorClass":"upstream_failure"}`},
	}
	if prompt := cloudAgentApprovalResumePrompt(failed); strings.Contains(prompt, "上游拒绝") {
		t.Fatalf("失败结果不应作为成功回执进入提示：\n%s", prompt)
	} else if !strings.Contains(prompt, "业务执行器已执行一次") {
		t.Fatalf("无回执时应回退通用提示：\n%s", prompt)
	}

	empty := &cloudAgentRuntime{}
	if prompt := cloudAgentApprovalResumePrompt(empty); !strings.Contains(prompt, "业务执行器已执行一次") {
		t.Fatalf("空历史应回退通用提示：\n%s", prompt)
	}
}

// 回执超长时截断，避免恢复提示把大结果（如整页画布读取）原样塞回上下文。
func TestCloudAgentLastToolReceiptTruncates(t *testing.T) {
	big := map[string]any{"rows": strings.Repeat("镜", 3000)}
	raw, err := json.Marshal(big)
	if err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{}
	state.Canonical.Messages = []map[string]any{
		{"role": "tool", "tool_call_id": "call_00", "content": string(raw)},
	}
	receipt, ok := cloudAgentLastToolReceipt(state)
	if !ok {
		t.Fatal("应能取到尾部工具结果")
	}
	if got := len([]rune(receipt)); got > 1700 {
		t.Fatalf("超长回执应被截断：got %d runes", got)
	}
	if !strings.Contains(receipt, "已截断") {
		t.Fatal("截断回执应说明完整状态需用读取工具获取")
	}
}

// 占位补齐的「未执行」结果必须是结构化错误（errorClass=approval_deferred），
// 与真实工具失败同形态，模型与界面都能按码识别这是审批暂停的副作用。
func TestUnansweredCallPlaceholderIsStructuredError(t *testing.T) {
	messages := []map[string]any{
		{"role": "assistant", "content": []interface{}{
			map[string]interface{}{"type": "toolCall", "id": "call_a", "name": "generate_media", "arguments": map[string]interface{}{}},
		}},
	}
	repaired := repairRuntimeUnansweredCalls(messages)
	if len(repaired) != 2 {
		t.Fatalf("应补齐 1 条占位结果：got %d messages", len(repaired))
	}
	placeholder, _ := repaired[1]["content"].([]interface{})
	text, _ := placeholder[0].(map[string]interface{})["text"].(string)
	var decoded map[string]any
	if err := json.Unmarshal([]byte(text), &decoded); err != nil {
		t.Fatalf("占位结果应是结构化 JSON：%v", err)
	}
	if decoded["errorClass"] != cloudAgentToolErrorApprovalDeferred {
		t.Fatalf("占位错误码应为 approval_deferred：got %v", decoded["errorClass"])
	}
	if decoded["error"] == nil {
		t.Fatal("占位结果应保留人可读的 error 说明")
	}
	if cloudAgentToolErrorLabel(cloudAgentToolErrorApprovalDeferred) != "审批暂停未执行" {
		t.Fatal("错误码标签缺失")
	}
}

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

// 回归（评审 P2）：结果 JSON 的字段顺序不保证 snapshotHash 排在前面（Go 序列化 map
// 按字典序，preview/rows 会排在 snapshotHash 之前）。朴素前缀截断会把模型继续写入
// 所需的最新快照一起截掉，恢复提示反而引导模型带着旧快照撞锁。摘要必须按字段组装：
// 长描述字段截断，关键标识（nodeId/snapshotHash）无条件保留。
func TestCloudAgentLastToolReceiptKeepsSnapshotBehindLargeFields(t *testing.T) {
	// 构造字典序在 snapshotHash 之前、且总体超过截断预算的大字段。
	result := map[string]any{
		"nodeId":       "script-smart-speaker-mom",
		"preview":      strings.Repeat("镜", 2000),
		"rows":         strings.Repeat("分镜行内容", 900),
		"snapshotHash": "b935f1b7b18d4a85b2b9253a73dcff1f787f6b0bc1c440e46fde7fe3fa77b11f",
		"applied":      true,
	}
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	if idx := strings.Index(string(raw), `"snapshotHash"`); idx < 1600 {
		t.Fatalf("测试前提不成立：snapshotHash 应排在 1600 字符之后，实际在 %d", idx)
	}
	state := &cloudAgentRuntime{}
	state.Canonical.Messages = []map[string]any{
		{"role": "tool", "tool_call_id": "call_00", "content": string(raw)},
	}
	receipt, ok := cloudAgentLastToolReceipt(state)
	if !ok {
		t.Fatal("应能取到尾部工具结果")
	}
	for _, key := range []string{"b935f1b7b18d4a85", "script-smart-speaker-mom", `"applied":true`} {
		if !strings.Contains(receipt, key) {
			t.Fatalf("回执摘要必须保留关键标识 %s：\n%s", key, receipt)
		}
	}
	if got := len([]rune(receipt)); got > 1700 {
		t.Fatalf("摘要应控制在预算内：got %d runes", got)
	}
	// 预算不够时长字段要显式登记被丢弃，模型知道去哪补全。
	if !strings.Contains(receipt, "已截断") {
		t.Fatal("被截断的长字段应说明完整内容需用读取工具获取")
	}
	// 摘要仍是合法 JSON，模型可结构化解析。
	var decoded map[string]any
	if err := json.Unmarshal([]byte(receipt), &decoded); err != nil {
		t.Fatalf("摘要应是合法 JSON：%v", err)
	}
	if decoded["snapshotHash"] != result["snapshotHash"] {
		t.Fatal("快照字段值不应被改动")
	}
}

// 回归（评审 P2 二轮）：重发指引必须按对象区分。分镜等工具的 snapshotHash 是节点级的：
// 同批第一个调用只改变自己目标对象的快照——同对象的剩余调用要用回执最新快照更新参数；
// 其他对象的调用原快照仍有效，按原参数重发即可。指引若不限定"同一对象"，模型把 A 的
// 快照填进 B 的调用反而必然撞锁。
func TestUnansweredCallPlaceholderAdvisesSnapshotUpdate(t *testing.T) {
	var decoded map[string]any
	if err := json.Unmarshal([]byte(cloudAgentPiUnansweredCallText), &decoded); err != nil {
		t.Fatalf("占位文本应是合法 JSON：%v", err)
	}
	message, _ := decoded["error"].(string)
	if strings.Contains(message, "原样重新调用") {
		t.Fatal("占位指引不应笼统要求原样重发（同批写同一对象会撞锁）")
	}
	for _, needle := range []string{"同一对象", "最新 snapshotHash", "按原参数重发", "重新读取"} {
		if !strings.Contains(message, needle) {
			t.Fatalf("占位指引应包含 %q：\n%s", needle, message)
		}
	}
	// 指引的三条分支必须互斥可判：同对象→用回执快照；跨对象/无回执→原参数；被拒→重读。
	if !strings.Contains(message, "目标对象不同或没有回执时，按原参数重发") {
		t.Fatal("跨对象分支必须明确指示按原参数重发")
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

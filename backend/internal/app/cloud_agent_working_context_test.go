package app

import (
	"strconv"
	"strings"
	"testing"
)

func TestTrimCloudAgentTextHistoryKeepsRecentRounds(t *testing.T) {
	history := make([]providerTextMessage, 0, 36)
	handoff := cloudAgentContinuationContext(&CloudAgentRun{ID: "parent", Status: "failed"}, nil)
	for round := 1; round <= 12; round++ {
		history = append(history,
			providerTextMessage{Role: "user", Content: "目标" + strconv.Itoa(round)},
			providerTextMessage{Role: "assistant", Content: "回复" + strconv.Itoa(round)},
			providerTextMessage{Role: "user", Content: handoff, AgentContextSource: "continuation"},
		)
	}
	trimmed := trimCloudAgentTextHistory(history, 10, cloudAgentHistoryMaxBytes)
	if cloudAgentHistoryUserInstructionCount(trimmed) != 10 {
		t.Fatalf("应只留最近 10 轮用户目标，got %d / %d msgs", cloudAgentHistoryUserInstructionCount(trimmed), len(trimmed))
	}
	if trimmed[0].Content != "目标3" {
		t.Fatalf("最旧保留轮次不对：%q", trimmed[0].Content)
	}
	last := trimmed[len(trimmed)-1]
	if last.Role != "user" || last.Content != handoff {
		t.Fatalf("最近一轮摘要应还在：%+v", last)
	}
}

func TestTrimCloudAgentTextHistoryDropsOldestToFitBytes(t *testing.T) {
	history := []providerTextMessage{
		{Role: "user", Content: "旧目标" + string(make([]byte, 40000))},
		{Role: "assistant", Content: "旧回复"},
		{Role: "user", Content: "新目标"},
		{Role: "assistant", Content: "新回复"},
	}
	trimmed := trimCloudAgentTextHistory(history, 10, 8000)
	if cloudAgentHistoryUserInstructionCount(trimmed) != 1 || trimmed[0].Content != "新目标" {
		t.Fatalf("超字节时应丢掉旧轮：%+v", trimmed)
	}
}

func TestTrimCloudAgentTextHistoryCannotHideSingleOversizedRound(t *testing.T) {
	history := []providerTextMessage{
		{Role: "user", Content: strings.Repeat("x", 70000)},
		{Role: "assistant", Content: "ok"},
	}
	trimmed := trimCloudAgentTextHistory(history, 10, cloudAgentHistoryMaxBytes)
	if cloudAgentHistoryJSONSize(trimmed) <= cloudAgentHistoryMaxBytes {
		t.Fatal("只剩一轮且本身超过 64KB 时不能假装压进去")
	}
}

// 旧数据兜底：部署前落库的交接消息没有 agentContextSource 字段（内容是纯文本
// "上一轮已结束（…）"）。裁剪与轮次计数必须按**结构位置**把它认出来，否则"最近 10 轮"
// 会被幽灵轮次占满，更早的真人轮次被提前裁掉。
func TestTrimCloudAgentTextHistoryKeepsRoundsWithLegacyHandoffText(t *testing.T) {
	history := make([]providerTextMessage, 0, 36)
	for round := 1; round <= 12; round++ {
		history = append(history,
			providerTextMessage{Role: "user", Content: "目标" + strconv.Itoa(round)},
			providerTextMessage{Role: "assistant", Content: "回复" + strconv.Itoa(round)},
			// 旧格式：没有来源标记，只有纯文本约定。
			providerTextMessage{Role: "user", Content: "上一轮已结束（completed）。 已提交生成任务：task-" + strconv.Itoa(round)},
		)
	}
	if got := cloudAgentHistoryUserInstructionCount(history); got != 12 {
		t.Fatalf("真人轮次计数 = %d，期望 12（旧格式交接不能被算成真人轮次）", got)
	}
	trimmed := trimCloudAgentTextHistory(history, 10, cloudAgentHistoryMaxBytes)
	if len(trimmed) == 0 || trimmed[0].Content != "目标3" {
		t.Fatalf("最旧保留轮次不对：%+v", trimmed[0])
	}
	// 结构判据不能把真人消息误判：紧跟 assistant 的 user 才是运行时帧。
	mixed := []providerTextMessage{
		{Role: "user", Content: "目标"},
		{Role: "assistant", Content: "回复"},
		{Role: "user", Content: "接着做"},
	}
	if got := cloudAgentHistoryUserInstructionCount(mixed); got != 2 {
		t.Fatalf("真人轮次计数 = %d，期望 2（\"接着做\"是真人消息）", got)
	}
}

// 来源标记必须在历史重建里活下来：旧会话走 cloudAgentLegacyHistory 重建，
// 压缩走检查点重建，两边都只拷 role/content 的话身份就丢了。
func TestCloudAgentHistoryRebuildKeepsContextSource(t *testing.T) {
	// cloudAgentLegacyHistory 只接受 user/assistant 交替、且当前目标是偶数位的形态。
	messages := []map[string]interface{}{
		{"role": "user", "content": "目标"},
		{"role": "assistant", "content": "回复"},
		{"role": "user", "content": "【运行状态】{\"source\":\"server\",\"kind\":\"run_handoff\"}", cloudAgentContextSourceKey: "continuation"},
		{"role": "assistant", "content": "回复2"},
		{"role": "user", "content": "当前目标"},
	}
	history := cloudAgentLegacyHistory(messages, "当前目标")
	if len(history) != 4 {
		t.Fatalf("legacy history 长度 = %d，期望 4", len(history))
	}
	if history[2].AgentContextSource != "continuation" {
		t.Fatalf("重建后丢了来源标记：%+v", history[2])
	}
	if !isCloudAgentRuntimeFrame(history, 2) {
		t.Fatal("重建后的交接帧必须仍被认成运行时帧")
	}
}

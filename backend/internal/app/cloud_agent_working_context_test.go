package app

import (
	"strconv"
	"strings"
	"testing"
)

func TestTrimCloudAgentTextHistoryKeepsRecentRounds(t *testing.T) {
	history := make([]providerTextMessage, 0, 36)
	for round := 1; round <= 12; round++ {
		history = append(history,
			providerTextMessage{Role: "user", Content: "目标" + strconv.Itoa(round)},
			providerTextMessage{Role: "assistant", Content: "回复" + strconv.Itoa(round)},
			providerTextMessage{Role: "user", Content: "上一轮已结束（completed）。本轮只执行当前用户消息，不要回头核对上一轮待办是否完成。"},
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
	if last.Role != "user" || last.Content != "上一轮已结束（completed）。本轮只执行当前用户消息，不要回头核对上一轮待办是否完成。" {
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

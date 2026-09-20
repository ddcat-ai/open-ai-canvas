package app

import (
	"encoding/json"
	"strings"
)

const (
	cloudAgentHistoryKeepRounds = 10
	cloudAgentHistoryMaxBytes   = 64000
)

func isCloudAgentContinuationMessage(message providerTextMessage) bool {
	if message.Role != "user" {
		return false
	}
	content := strings.TrimSpace(message.Content)
	return strings.HasPrefix(content, "上一轮真实执行记录") || strings.HasPrefix(content, "上一轮已结束")
}

func cloudAgentHistoryUserInstructionCount(history []providerTextMessage) int {
	count := 0
	for _, message := range history {
		if message.Role == "user" && !isCloudAgentContinuationMessage(message) {
			count++
		}
	}
	return count
}

func cloudAgentHistoryJSONSize(history []providerTextMessage) int {
	raw, err := json.Marshal(history)
	if err != nil {
		return 0
	}
	return len(raw)
}

func dropOldestCloudAgentHistoryRound(history []providerTextMessage) []providerTextMessage {
	if len(history) == 0 {
		return history
	}
	if isCloudAgentContinuationMessage(history[0]) || history[0].Role != "user" {
		return history[1:]
	}
	index := 1
	for index < len(history) {
		if history[index].Role == "user" && !isCloudAgentContinuationMessage(history[index]) {
			break
		}
		index++
	}
	return history[index:]
}

// trimCloudAgentTextHistory 只把最近若干轮用户对话留给模型。
// 个人记忆、更早轮次和上一轮工具流水不进工作上下文；超字节上限时从最旧一轮往下丢。
func trimCloudAgentTextHistory(history []providerTextMessage, keepRounds, maxBytes int) []providerTextMessage {
	if keepRounds <= 0 {
		keepRounds = cloudAgentHistoryKeepRounds
	}
	if maxBytes <= 0 {
		maxBytes = cloudAgentHistoryMaxBytes
	}
	if len(history) == 0 {
		return history
	}
	start := 0
	seen := 0
	for index := len(history) - 1; index >= 0; index-- {
		if history[index].Role != "user" || isCloudAgentContinuationMessage(history[index]) {
			continue
		}
		seen++
		if seen == keepRounds {
			start = index
			break
		}
	}
	trimmed := append([]providerTextMessage{}, history[start:]...)
	for cloudAgentHistoryJSONSize(trimmed) > maxBytes && cloudAgentHistoryUserInstructionCount(trimmed) > 1 {
		next := dropOldestCloudAgentHistoryRound(trimmed)
		if len(next) >= len(trimmed) {
			break
		}
		trimmed = next
	}
	return trimmed
}

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
	if message.Role != "user" || message.AgentContextSource != "continuation" {
		return false
	}
	content := strings.TrimSpace(message.Content)
	if !strings.HasPrefix(content, cloudAgentRuntimeContextMarker) {
		return false
	}
	var frame struct {
		Source string `json:"source"`
		Kind   string `json:"kind"`
	}
	if err := json.Unmarshal([]byte(strings.TrimPrefix(content, cloudAgentRuntimeContextMarker)), &frame); err != nil {
		return false
	}
	return frame.Source == "server" && frame.Kind == cloudAgentContinuationKind
}

// cloudAgentLegacyRuntimeFramePrefixes 是我们自己产出的旧版交接文案前缀。
// 只用于"这份历史怎么裁"的判断，不用于给消息盖身份（见下）。
var cloudAgentLegacyRuntimeFramePrefixes = []string{"上一轮已结束（", "上一轮真实执行记录"}

// isCloudAgentLegacyRuntimeFrame 识别"部署前落库、没有来源字段"的旧版交接消息。
//
// `agentContextSource` 是后加的字段：升级后旧会话里那些 "上一轮已结束（…）" 一律失配，
// 会被算成真人轮次，于是"最近 10 轮"的窗口被幽灵轮次占满、更早的真人轮次被提前裁掉。
func isCloudAgentLegacyRuntimeFrame(message providerTextMessage) bool {
	if message.Role != "user" || message.AgentContextSource != "" {
		return false
	}
	content := strings.TrimSpace(message.Content)
	for _, prefix := range cloudAgentLegacyRuntimeFramePrefixes {
		if strings.HasPrefix(content, prefix) {
			return true
		}
	}
	return false
}

// isCloudAgentRuntimeFrame 判断 history[index] 是不是"服务端生成的运行时交接帧"。
//
// 判据：结构化身份（新数据）**或**"紧跟上一轮 assistant 回复 + 旧版交接文案"（旧数据）。
// 位置这一条不能单独用：压缩收尾后历史来自检查点，真人轮次也可能紧跟在 assistant 之后，
// 只按位置判会把真人轮次也当成帧、提前裁掉。
//
// 注意：这里只影响裁剪与轮次计数；**canonical 的来源标记仍然只认结构体字段**，
// 用户自己写一段 "上一轮已结束（…）" 不会因此获得 continuation 身份（只是那一轮不计入轮数）。
func isCloudAgentRuntimeFrame(history []providerTextMessage, index int) bool {
	if index < 0 || index >= len(history) {
		return false
	}
	message := history[index]
	if message.Role != "user" {
		return false
	}
	if isCloudAgentContinuationMessage(message) {
		return true
	}
	return index > 0 && history[index-1].Role == "assistant" && isCloudAgentLegacyRuntimeFrame(message)
}

func cloudAgentHistoryUserInstructionCount(history []providerTextMessage) int {
	count := 0
	for index := range history {
		if history[index].Role == "user" && !isCloudAgentRuntimeFrame(history, index) {
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
	if isCloudAgentRuntimeFrame(history, 0) || history[0].Role != "user" {
		return history[1:]
	}
	index := 1
	for index < len(history) {
		if history[index].Role == "user" && !isCloudAgentRuntimeFrame(history, index) {
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
		if history[index].Role != "user" || isCloudAgentRuntimeFrame(history, index) {
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

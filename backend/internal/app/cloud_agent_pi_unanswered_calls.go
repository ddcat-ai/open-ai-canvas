package app

import (
	"encoding/json"
	"maps"
	"strings"
)

// 工具调用与结果的配对修复。
//
// 上游要求 assistant 声明的每个工具调用后面紧跟且只跟一份结果。下面几种情况会破坏这一点，
// 不修复就会在 validateCanonicalAgentHistory 以「缺少结果 / 没有对应的工具调用」判死整轮；
// 新一轮又会继承同一份会话，之后每一轮都失败：
//   - 同一步里排在前面的调用进入审批，运行时中止本轮（agent-runtime.mjs 的 session.abort()），
//     后面的调用既没执行也没有结果；
//   - 取消、崩溃或远程运行时断线时停在半批调用中间；工具事务可能已经提交，运行时却没收到回执；
//   - 补齐的「未执行」结果已经落库，真实结果随后才追加到历史末尾，同一调用出现两份结果；
//   - 调用所在的 assistant 消息不在了，只剩结果。
//
// 修复规则：
//   - 缺结果的调用优先补服务端已保存的真实回执（同一调用声明之后、同一工具名），
//     否则补结构化的「未执行」结果；不能把已提交的媒体任务说成没执行，否则模型会重复生成。
//   - 已有结果只是审批暂停或「未执行」占位、服务端又有真实回执时，换成真实回执。
//   - 同一调用的重复结果只留一份，真实结果优先于占位。
//   - 找不到调用的结果不再当工具结果发送，原文转成一条运行状态数据消息放在该批结果之后。
//   - 调用 ID 缺失或别名冲突的调用从 assistant 消息里去掉。
//
// 没有需要修复的地方时原样返回同一个切片。

// 结果体用与真实工具失败一致的结构化 JSON（errorClass=approval_deferred）而不是纯文本，
// 让模型/界面/诊断都能按码识别"这是审批暂停的副作用，不是调用本身出错"。
// 重发指引必须按对象区分：分镜等工具的 snapshotHash 是节点级的，同批第一个调用只改变
// 它自己目标对象的快照——修改同一对象的剩余调用要用回执里的最新快照更新参数；修改其他
// 对象的调用原快照仍然有效，照原参数重发即可，把回执快照填进去反而必然撞锁。
const cloudAgentPiUnansweredCallText = `{"error":"该工具调用未被执行：同一步里排在前面的操作进入了用户审批（或本轮被中断），它从未运行。如仍需要它的结果，请重新调用；若它携带 snapshotHash 且与恢复提示回执修改的是同一对象，用回执里的最新 snapshotHash 更新参数；目标对象不同或没有回执时，按原参数重发；重发仍被快照拒绝就先重新读取目标对象再改。","errorClass":"approval_deferred","errorClassLabel":"审批暂停未执行","requiredAction":"resend"}`

// cloudAgentPiApprovalPauseText 是工具进入审批时交给运行时的占位结果。
const cloudAgentPiApprovalPauseText = "操作正在等待用户审批。"

// 孤立结果转成数据消息时的保留上限：只保留最近几条，单条截断，避免旧流水撑大上下文。
const (
	cloudAgentOrphanToolResultKeep  = 4
	cloudAgentOrphanToolResultRunes = 600
)

// repairRuntimeUnansweredCalls 修复运行时（Pi）消息里的配对问题；serverHistory 是服务端
// 规范历史，用来找回已提交但运行时没收到的回执。
func repairRuntimeUnansweredCalls(messages, serverHistory []map[string]any) []map[string]any {
	return repairToolHistory(messages, runtimeToolHistory, cloudAgentServerToolReceipts(serverHistory))
}

// repairCanonicalUnansweredCalls 是同一修复在服务端规范历史上的版本。
// cloudAgentPiCanonicalForModelRequest 在服务端历史更长或运行时历史不可用时采用它。
// Responses 的 function_call 条目不在这里修复，原样交给协议校验。
func repairCanonicalUnansweredCalls(messages []map[string]any) []map[string]any {
	for _, message := range messages {
		if stringField(message, "type") == "function_call" {
			return messages
		}
	}
	return repairToolHistory(messages, canonicalToolHistory, nil)
}

type toolHistoryCall struct {
	ID   string
	Name string
}

type toolHistoryReceipt struct {
	Name string
	Text string
}

func (r toolHistoryReceipt) matches(call toolHistoryCall) bool {
	return r.Name == "" || call.Name == "" || r.Name == call.Name
}

// toolHistoryFormat 描述一种消息格式里调用和结果的读写方式。运行时与服务端历史
// 字段名不同，配对规则相同。
type toolHistoryFormat struct {
	// calls 返回 assistant 消息里可配对的调用。rewrite 为 true 时 kept 是去掉无效或重复
	// 调用后的消息副本，kept 为 nil 表示整条消息已无内容、应丢弃。
	calls func(message map[string]any) (calls []toolHistoryCall, kept map[string]any, rewrite bool)
	// result 识别工具结果；valid=false 表示调用 ID 无法解析。
	result      func(message map[string]any) (id string, isResult, valid bool)
	withText    func(message map[string]any, text string) map[string]any
	placeholder func(call toolHistoryCall) map[string]any
	receipt     func(call toolHistoryCall, text string) map[string]any
}

func repairToolHistory(messages []map[string]any, format toolHistoryFormat, receipts map[string]toolHistoryReceipt) []map[string]any {
	out := make([]map[string]any, 0, len(messages)+1)
	changed := false
	var batch []toolHistoryCall
	open := map[string]toolHistoryCall{}
	answered := map[string]int{}
	var orphans []string
	closeBatch := func() {
		for _, call := range batch {
			if _, pending := open[call.ID]; !pending {
				continue
			}
			delete(open, call.ID)
			changed = true
			if receipt, ok := receipts[call.ID]; ok && receipt.matches(call) {
				out = append(out, format.receipt(call, receipt.Text))
			} else {
				out = append(out, format.placeholder(call))
			}
			answered[call.ID] = len(out) - 1
		}
		batch = nil
		if len(orphans) > 0 {
			out = append(out, cloudAgentOrphanToolResultsMessage(orphans))
			orphans = nil
		}
	}
	for _, message := range messages {
		if id, isResult, valid := format.result(message); isResult {
			text := runtimeContentText(message["content"])
			if !valid {
				changed = true
				orphans = append(orphans, text)
				continue
			}
			if call, pending := open[id]; pending {
				delete(open, id)
				if receipt, ok := receipts[id]; ok && receipt.matches(call) && cloudAgentToolResultIsPlaceholder(text) {
					message = format.withText(message, receipt.Text)
					changed = true
				}
				out = append(out, message)
				answered[id] = len(out) - 1
				continue
			}
			changed = true
			if index, ok := answered[id]; ok {
				if cloudAgentToolResultIsPlaceholder(runtimeContentText(out[index]["content"])) && !cloudAgentToolResultIsPlaceholder(text) {
					out[index] = format.withText(out[index], text)
				}
				continue
			}
			orphans = append(orphans, text)
			continue
		}
		closeBatch()
		calls, kept, rewrite := format.calls(message)
		if rewrite {
			changed = true
			if kept == nil {
				continue
			}
			message = kept
		}
		for _, call := range calls {
			delete(answered, call.ID)
			open[call.ID] = call
		}
		batch = calls
		out = append(out, message)
	}
	closeBatch()
	if !changed {
		return messages
	}
	return out
}

// cloudAgentToolResultIsPlaceholder 识别不含执行事实的占位结果：审批暂停时交给运行时的
// 占位，以及补齐的「未执行」结果。
func cloudAgentToolResultIsPlaceholder(text string) bool {
	trimmed := strings.TrimSpace(text)
	return trimmed == cloudAgentPiApprovalPauseText || trimmed == cloudAgentPiMediaBatchPauseText || trimmed == cloudAgentPiUnansweredCallText ||
		strings.Contains(trimmed, `"errorClass":"`+cloudAgentToolErrorApprovalDeferred+`"`)
}

// cloudAgentServerToolReceipts 收集服务端历史里已保存的真实工具回执。只认出现在其调用
// 声明之后的结果；同一 ID 再次被声明时以最新一次为准，避免把别的轮次的回执接到这次调用上。
func cloudAgentServerToolReceipts(history []map[string]any) map[string]toolHistoryReceipt {
	receipts := map[string]toolHistoryReceipt{}
	declared := map[string]string{}
	for _, message := range history {
		calls, _, _ := canonicalToolHistory.calls(message)
		for _, call := range calls {
			declared[call.ID] = call.Name
			delete(receipts, call.ID)
		}
		id, isResult, valid := canonicalToolHistory.result(message)
		if !isResult || !valid {
			continue
		}
		name, ok := declared[id]
		if !ok {
			continue
		}
		text := runtimeContentText(message["content"])
		if _, exists := receipts[id]; exists || strings.TrimSpace(text) == "" || cloudAgentToolResultIsPlaceholder(text) {
			continue
		}
		receipts[id] = toolHistoryReceipt{Name: name, Text: text}
	}
	return receipts
}

func cloudAgentOrphanToolResultsMessage(results []string) map[string]any {
	omitted := 0
	if len(results) > cloudAgentOrphanToolResultKeep {
		omitted = len(results) - cloudAgentOrphanToolResultKeep
		results = results[omitted:]
	}
	clipped := make([]string, 0, len(results))
	for _, result := range results {
		clipped = append(clipped, truncateRunes(strings.TrimSpace(result), cloudAgentOrphanToolResultRunes))
	}
	encoded, _ := json.Marshal(map[string]any{"results": clipped, "omitted": omitted})
	return cloudAgentRuntimeMessage(cloudAgentRuntimeContext{
		Kind:   cloudAgentContextOrphanToolResults,
		Detail: "这些工具结果的调用记录已不在上下文里，内容按原样保留：" + string(encoded),
	})
}

var runtimeToolHistory = toolHistoryFormat{
	calls: func(message map[string]any) ([]toolHistoryCall, map[string]any, bool) {
		if stringField(message, "role") != "assistant" {
			return nil, nil, false
		}
		parts, ok := message["content"].([]interface{})
		if !ok {
			return nil, nil, false
		}
		var calls []toolHistoryCall
		kept := make([]interface{}, 0, len(parts))
		seen := map[string]bool{}
		rewrite, hasText := false, false
		for _, value := range parts {
			part, _ := value.(map[string]interface{})
			if stringField(part, "type") != "toolCall" {
				if stringField(part, "type") == "text" && strings.TrimSpace(stringField(part, "text")) != "" {
					hasText = true
				}
				kept = append(kept, value)
				continue
			}
			id, err := strictRuntimeStringAliases(part, "Pi 工具调用 ID", "id", "call_id", "toolCallId", "tool_call_id")
			if err != nil || id == "" || seen[id] {
				rewrite = true
				continue
			}
			seen[id] = true
			calls = append(calls, toolHistoryCall{ID: id, Name: stringField(part, "name")})
			kept = append(kept, value)
		}
		if !rewrite {
			return calls, nil, false
		}
		if len(calls) == 0 && !hasText {
			return nil, nil, true
		}
		copied := maps.Clone(message)
		copied["content"] = kept
		return calls, copied, true
	},
	result: func(message map[string]any) (string, bool, bool) {
		if role := stringField(message, "role"); role != "toolResult" && role != "tool" {
			return "", false, false
		}
		id, err := strictRuntimeStringAliases(message, "Pi 工具结果 call id", "toolCallId", "tool_call_id", "call_id")
		return id, true, err == nil && id != ""
	},
	withText: func(message map[string]any, text string) map[string]any {
		copied := maps.Clone(message)
		copied["content"] = []interface{}{map[string]interface{}{"type": "text", "text": text}}
		copied["isError"] = cloudAgentToolContentIsError(text)
		delete(copied, "details")
		return copied
	},
	placeholder: func(call toolHistoryCall) map[string]any {
		return map[string]any{
			"role":       "toolResult",
			"toolCallId": call.ID,
			"toolName":   call.Name,
			"content":    []interface{}{map[string]interface{}{"type": "text", "text": cloudAgentPiUnansweredCallText}},
			"isError":    true,
		}
	},
	receipt: func(call toolHistoryCall, text string) map[string]any {
		return map[string]any{"role": "toolResult", "toolCallId": call.ID, "toolName": call.Name, "content": text, "isError": cloudAgentToolContentIsError(text)}
	},
}

var canonicalToolHistory = toolHistoryFormat{
	calls: func(message map[string]any) ([]toolHistoryCall, map[string]any, bool) {
		if stringField(message, "role") != "assistant" || message["tool_calls"] == nil {
			return nil, nil, false
		}
		var calls []toolHistoryCall
		var kept []interface{}
		seen := map[string]bool{}
		rewrite := false
		for _, call := range canonicalAgentToolCalls(message["tool_calls"]) {
			id, err := canonicalAgentToolCallID(call, "画布 Agent 工具调用")
			if err != nil || id == "" || seen[id] {
				rewrite = true
				continue
			}
			seen[id] = true
			function, _ := call["function"].(map[string]interface{})
			calls = append(calls, toolHistoryCall{ID: id, Name: stringField(function, "name")})
			kept = append(kept, call)
		}
		if !rewrite {
			return calls, nil, false
		}
		copied := maps.Clone(message)
		if len(kept) == 0 {
			delete(copied, "tool_calls")
			if strings.TrimSpace(runtimeContentText(copied["content"])) == "" {
				return nil, nil, true
			}
		} else {
			copied["tool_calls"] = kept
		}
		return calls, copied, true
	},
	result: func(message map[string]any) (string, bool, bool) {
		if stringField(message, "role") != "tool" {
			return "", false, false
		}
		id, err := canonicalAgentStringAliases(message, "画布 Agent 工具结果 call_id", "tool_call_id", "toolCallId", "call_id")
		return id, true, err == nil && id != ""
	},
	withText: func(message map[string]any, text string) map[string]any {
		copied := maps.Clone(message)
		copied["content"] = text
		return copied
	},
	placeholder: func(call toolHistoryCall) map[string]any {
		return map[string]any{"role": "tool", "tool_call_id": call.ID, "content": cloudAgentPiUnansweredCallText}
	},
	receipt: func(call toolHistoryCall, text string) map[string]any {
		return map[string]any{"role": "tool", "tool_call_id": call.ID, "content": text}
	},
}

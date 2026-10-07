package app

// 补齐没有结果的工具调用。
//
// 模型一步里发出多个工具调用、排在前面的那个进入用户审批时，运行时会中止本轮
// （agent-runtime.mjs 的 session.abort()），排在后面的调用既没执行也没有 toolResult。
// 用户批准后恢复运行，会话历史里就留着一个「有调用没结果」的条目：
// validateRuntimeMessagesForModel 判它无效，回退到旧的规范历史，随后在
// validateCanonicalAgentHistory 以「工具调用缺少结果」让整轮失败，恢复提示词也送不到模型。
//
// 这里在转换前给这些调用补一条明确的「未执行」结果：历史恢复合法，模型也知道
// 那一步没做过，需要时会自己重新调用。只补缺失的，不改已有的结果。
//
// 结果体用与真实工具失败一致的结构化 JSON（errorClass=approval_deferred）而不是纯文本，
// 让模型/界面/诊断都能按码识别"这是审批暂停的副作用，不是调用本身出错"。
// 重发指引必须按对象区分：分镜等工具的 snapshotHash 是节点级的，同批第一个调用只改变
// 它自己目标对象的快照——修改同一对象的剩余调用要用回执里的最新快照更新参数；修改其他
// 对象的调用原快照仍然有效，照原参数重发即可，把回执快照填进去反而必然撞锁。
const cloudAgentPiUnansweredCallText = `{"error":"该工具调用未被执行：同一步里排在前面的操作进入了用户审批（或本轮被中断），它从未运行。如仍需要它的结果，请重新调用；若它携带 snapshotHash 且与恢复提示回执修改的是同一对象，用回执里的最新 snapshotHash 更新参数；目标对象不同或没有回执时，按原参数重发；重发仍被快照拒绝就先重新读取目标对象再改。","errorClass":"approval_deferred","errorClassLabel":"审批暂停未执行","requiredAction":"resend"}`

// repairRuntimeUnansweredCalls 返回补齐后的消息序列；没有缺失时原样返回同一个切片。
// 调用 ID 解析不了的条目不在这里处理，留给后面的校验报出原始错误。
func repairRuntimeUnansweredCalls(messages []map[string]any) []map[string]any {
	var repaired []map[string]any
	for index := 0; index < len(messages); index++ {
		message := messages[index]
		if repaired != nil {
			repaired = append(repaired, message)
		}
		if stringField(message, "role") != "assistant" {
			continue
		}
		calls := runtimeAssistantToolCalls(message)
		if len(calls) == 0 {
			continue
		}
		answered := make(map[string]struct{}, len(calls))
		next := index + 1
		for ; next < len(messages); next++ {
			role := stringField(messages[next], "role")
			if role != "toolResult" && role != "tool" {
				break
			}
			if callID, err := strictRuntimeStringAliases(messages[next], "Pi 工具结果 call id", "toolCallId", "tool_call_id", "call_id"); err == nil && callID != "" {
				answered[callID] = struct{}{}
			}
		}
		var missing []runtimeAssistantToolCall
		for _, call := range calls {
			if _, ok := answered[call.ID]; !ok {
				missing = append(missing, call)
			}
		}
		if len(missing) == 0 {
			continue
		}
		if repaired == nil {
			repaired = append(make([]map[string]any, 0, len(messages)+len(missing)), messages[:index+1]...)
		}
		repaired = append(repaired, messages[index+1:next]...)
		for _, call := range missing {
			repaired = append(repaired, map[string]any{
				"role":       "toolResult",
				"toolCallId": call.ID,
				"toolName":   call.Name,
				"content":    []interface{}{map[string]interface{}{"type": "text", "text": cloudAgentPiUnansweredCallText}},
				"isError":    true,
			})
		}
		index = next - 1
	}
	if repaired == nil {
		return messages
	}
	return repaired
}

type runtimeAssistantToolCall struct {
	ID   string
	Name string
}

func runtimeAssistantToolCalls(message map[string]any) []runtimeAssistantToolCall {
	parts, _ := message["content"].([]interface{})
	var calls []runtimeAssistantToolCall
	for _, value := range parts {
		part, _ := value.(map[string]interface{})
		if stringField(part, "type") != "toolCall" {
			continue
		}
		callID, err := strictRuntimeStringAliases(part, "Pi 工具调用 ID", "id", "call_id", "toolCallId", "tool_call_id")
		if err != nil || callID == "" {
			continue
		}
		calls = append(calls, runtimeAssistantToolCall{ID: callID, Name: stringField(part, "name")})
	}
	return calls
}

// repairCanonicalUnansweredCalls 是同一修复在服务端规范历史上的版本。
// cloudAgentPiCanonicalForModelRequest 在服务端历史更长时会直接采用它而不是运行时
// 消息（例如后端重启后恢复运行）；那份历史同样可能留着没有结果的调用，
// 不补齐就会在 validateCanonicalAgentHistory 以「工具调用缺少结果」失败。
// 没有缺失时原样返回同一个切片。
func repairCanonicalUnansweredCalls(messages []map[string]any) []map[string]any {
	var repaired []map[string]any
	for index := 0; index < len(messages); index++ {
		message := messages[index]
		if repaired != nil {
			repaired = append(repaired, message)
		}
		if stringField(message, "role") != "assistant" {
			continue
		}
		calls := canonicalAgentToolCalls(message["tool_calls"])
		if len(calls) == 0 {
			continue
		}
		answered := make(map[string]struct{}, len(calls))
		next := index + 1
		for ; next < len(messages); next++ {
			if stringField(messages[next], "role") != "tool" {
				break
			}
			if callID, err := canonicalAgentStringAliases(messages[next], "画布 Agent 工具结果 call_id", "tool_call_id", "toolCallId", "call_id"); err == nil && callID != "" {
				answered[callID] = struct{}{}
			}
		}
		var missing []string
		for _, call := range calls {
			callID, err := canonicalAgentToolCallID(call, "画布 Agent 工具调用")
			if err != nil || callID == "" {
				continue
			}
			if _, ok := answered[callID]; !ok {
				missing = append(missing, callID)
			}
		}
		if len(missing) == 0 {
			continue
		}
		if repaired == nil {
			repaired = append(make([]map[string]any, 0, len(messages)+len(missing)), messages[:index+1]...)
		}
		repaired = append(repaired, messages[index+1:next]...)
		for _, callID := range missing {
			repaired = append(repaired, map[string]any{"role": "tool", "tool_call_id": callID, "content": cloudAgentPiUnansweredCallText})
		}
		index = next - 1
	}
	if repaired == nil {
		return messages
	}
	return repaired
}

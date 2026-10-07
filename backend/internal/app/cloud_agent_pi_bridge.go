// Agent 运行时与服务端之间的消息、工具与事件桥接。
//
// 运行时上报的消息被转换回服务端的 canonical 历史；工具调用统一经
// executeCloudAgentRuntimeTool 执行，与 Go 执行循环共用同一套校验与审批。

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// canonicalFromRuntimeMessages 把运行时的会话消息（user/assistant/toolResult，
// 内容块为 text/image/thinking/toolCall）转换成供应商层接受的规范格式。
const cloudAgentPiCompactionSummaryMessagePrefix = "The conversation history before this point was compacted into the following summary:\n\n<summary>\n"
const cloudAgentPiCompactionSummaryMessageSuffix = "\n</summary>"

// strictRuntimeStringAliases resolves protocol aliases without silently
// choosing one when two producers disagree.
func strictRuntimeStringAliases(fields map[string]interface{}, label string, aliases ...string) (string, error) {
	value := ""
	firstAlias := ""
	for _, alias := range aliases {
		raw, present := fields[alias]
		if !present || raw == nil {
			continue
		}
		text, ok := raw.(string)
		if !ok {
			return "", fmt.Errorf("%s 字段 %q 必须是字符串", label, alias)
		}
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		if value != "" && value != text {
			return "", fmt.Errorf("%s 的别名 %q 与 %q 冲突", label, firstAlias, alias)
		}
		if value == "" {
			value, firstAlias = text, alias
		}
	}
	return value, nil
}

func canonicalFromRuntimeMessages(messages []map[string]any, tools []map[string]interface{}, systemPrompt string) (canonicalAgentRequest, error) {
	canonical := canonicalAgentRequest{Tools: tools, ToolChoice: "auto", SystemPrompt: systemPrompt}
	for _, message := range messages {
		switch stringField(message, "role") {
		case "system":
			if text := runtimeContentText(message["content"]); strings.TrimSpace(text) != "" {
				canonical.Messages = append(canonical.Messages, map[string]interface{}{"role": "system", "content": text})
			}
		case "compactionSummary":
			summary := stringField(message, "summary")
			if summary != "" {
				canonical.Messages = append(canonical.Messages, map[string]interface{}{
					"role":    "user",
					"content": cloudAgentPiCompactionSummaryMessagePrefix + summary + cloudAgentPiCompactionSummaryMessageSuffix,
				})
			}
		case "user":
			canonical.Messages = append(canonical.Messages, map[string]interface{}{"role": "user", "content": runtimeUserContent(message["content"])})
		case "assistant":
			text := ""
			calls := []interface{}{}
			if parts, ok := message["content"].([]interface{}); ok {
				for _, value := range parts {
					part, _ := value.(map[string]interface{})
					switch stringField(part, "type") {
					case "text":
						text += stringField(part, "text")
					case "toolCall":
						arguments, _ := json.Marshal(part["arguments"])
						if part["arguments"] == nil {
							arguments = []byte("{}")
						}
						callID, err := strictRuntimeStringAliases(part, "Pi 工具调用 ID", "id", "call_id", "toolCallId", "tool_call_id")
						if err != nil {
							return canonicalAgentRequest{}, err
						}
						if callID == "" {
							return canonicalAgentRequest{}, errors.New("Pi 工具调用缺少 call id")
						}
						itemID, err := strictRuntimeStringAliases(part, "Pi 工具调用 item id", "item_id", "itemId")
						if err != nil {
							return canonicalAgentRequest{}, err
						}
						call := map[string]interface{}{
							"id":       callID,
							"function": map[string]interface{}{"name": stringField(part, "name"), "arguments": string(arguments)},
						}
						if itemID != "" {
							call["item_id"] = itemID
						}
						calls = append(calls, call)
					}
				}
			} else {
				text = runtimeContentText(message["content"])
			}
			if text == "" && len(calls) == 0 {
				continue
			}
			converted := map[string]interface{}{"role": "assistant", "content": text}
			if len(calls) > 0 {
				converted["tool_calls"] = calls
			}
			canonical.Messages = append(canonical.Messages, converted)
		case "toolResult", "tool":
			id, err := strictRuntimeStringAliases(message, "Pi 工具结果 call id", "toolCallId", "tool_call_id", "call_id")
			if err != nil {
				return canonicalAgentRequest{}, err
			}
			if id == "" {
				return canonicalAgentRequest{}, errors.New("Pi 工具结果缺少 call id")
			}
			canonical.Messages = append(canonical.Messages, map[string]interface{}{"role": "tool", "tool_call_id": id, "content": runtimeContentText(message["content"])})
		}
	}
	if strings.TrimSpace(systemPrompt) != "" {
		found := false
		for _, message := range canonical.Messages {
			if stringField(message, "role") == "system" {
				found = true
				break
			}
		}
		if !found {
			canonical.Messages = append([]map[string]interface{}{{"role": "system", "content": systemPrompt}}, canonical.Messages...)
		}
	}
	return canonical, nil
}

func validateRuntimeMessagesForModel(messages []map[string]any) error {
	pending := make(map[string]struct{})
	for _, message := range messages {
		switch stringField(message, "role") {
		case "assistant":
			if len(pending) > 0 {
				return fmt.Errorf("Pi 工具调用 %q 缺少结果", firstPendingRuntimeCall(pending))
			}
			parts, _ := message["content"].([]interface{})
			for _, value := range parts {
				part, _ := value.(map[string]interface{})
				if stringField(part, "type") != "toolCall" {
					continue
				}
				callID, err := strictRuntimeStringAliases(part, "Pi 工具调用 ID", "id", "call_id", "toolCallId", "tool_call_id")
				if err != nil {
					return err
				}
				if callID == "" {
					return errors.New("Pi 工具调用缺少 call id")
				}
				if _, exists := pending[callID]; exists {
					return fmt.Errorf("Pi 工具调用 %q 重复或缺少结果", callID)
				}
				arguments := part["arguments"]
				if arguments == nil {
					arguments = map[string]interface{}{}
				}
				encoded, err := json.Marshal(arguments)
				if err != nil {
					return fmt.Errorf("Pi 工具调用 %q 参数无效: %w", callID, err)
				}
				var object map[string]interface{}
				if err := json.Unmarshal(encoded, &object); err != nil || object == nil {
					return fmt.Errorf("Pi 工具调用 %q 参数不是 JSON 对象", callID)
				}
				pending[callID] = struct{}{}
			}
		case "toolResult", "tool":
			callID, err := strictRuntimeStringAliases(message, "Pi 工具结果 call id", "toolCallId", "tool_call_id", "call_id")
			if err != nil {
				return err
			}
			if callID == "" {
				return errors.New("Pi 工具结果缺少 call id")
			}
			if _, exists := pending[callID]; !exists {
				return fmt.Errorf("Pi 工具结果 %q 没有对应的工具调用", callID)
			}
			delete(pending, callID)
		case "user", "system":
			if len(pending) > 0 {
				return fmt.Errorf("Pi 工具调用 %q 缺少结果", firstPendingRuntimeCall(pending))
			}
		}
	}
	if len(pending) > 0 {
		return fmt.Errorf("Pi 工具调用 %q 缺少结果", firstPendingRuntimeCall(pending))
	}
	return nil
}

func firstPendingRuntimeCall(pending map[string]struct{}) string {
	for callID := range pending {
		return callID
	}
	return ""
}

func cloudAgentPiHasCompactionSummary(messages []map[string]any) bool {
	for _, message := range messages {
		if stringField(message, "role") == "compactionSummary" && strings.TrimSpace(stringField(message, "summary")) != "" {
			return true
		}
	}
	return false
}

func runtimeContentText(content interface{}) string {
	if text, ok := content.(string); ok {
		return text
	}
	parts, _ := content.([]interface{})
	texts := make([]string, 0, len(parts))
	for _, value := range parts {
		part, _ := value.(map[string]interface{})
		if stringField(part, "type") == "text" {
			texts = append(texts, stringField(part, "text"))
		}
	}
	return strings.Join(texts, "\n")
}

func runtimeUserContent(content interface{}) interface{} {
	if text, ok := content.(string); ok {
		return text
	}
	parts, _ := content.([]interface{})
	converted := make([]interface{}, 0, len(parts))
	for _, value := range parts {
		part, _ := value.(map[string]interface{})
		switch stringField(part, "type") {
		case "text":
			converted = append(converted, map[string]interface{}{"type": "text", "text": stringField(part, "text")})
		case "image":
			data, mimeType := stringField(part, "data"), stringField(part, "mimeType")
			if data != "" && mimeType != "" {
				converted = append(converted, map[string]interface{}{"type": "image_url", "image_url": map[string]interface{}{"url": "data:" + mimeType + ";base64," + data}})
			}
		case "image_url", "file_url":
			converted = append(converted, part)
		}
	}
	if len(converted) == 0 {
		return ""
	}
	return converted
}

// runtimeToolSchemas 把运行时声明的工具转换成规范的 function 工具定义。
func runtimeToolSchemas(tools []map[string]any) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(tools))
	for _, tool := range tools {
		name := stringValue(tool["name"])
		if name == "" {
			continue
		}
		parameters := tool["parameters"]
		if parameters == nil {
			parameters = map[string]interface{}{"type": "object", "properties": map[string]interface{}{}}
		}
		result = append(result, map[string]interface{}{
			"type": "function",
			"function": map[string]interface{}{
				"name":        name,
				"description": firstNonEmpty(stringValue(tool["description"]), name),
				"parameters":  parameters,
			},
		})
	}
	return result
}

// runtimeToolCalls 把规范工具调用转换回运行时需要的 {id, name, arguments(object)}。
func runtimeToolCalls(calls []cloudAgentCall) []map[string]any {
	result := make([]map[string]any, 0, len(calls))
	for _, call := range calls {
		arguments := map[string]any{}
		if strings.TrimSpace(call.Function.Arguments) != "" {
			_ = json.Unmarshal([]byte(call.Function.Arguments), &arguments)
		}
		entry := map[string]any{"id": call.ID, "name": call.Function.Name, "arguments": arguments}
		if call.ItemID != "" {
			entry["item_id"] = call.ItemID
		}
		result = append(result, entry)
	}
	return result
}

// cloudAgentPiTool 工具调用桥接：所有工具都交给唯一的 Go 业务执行器
// advanceCloudAgentTool（权限、审批、计费、画布写入都在那里治理）。
func (s *Service) cloudAgentPiTool(ctx context.Context, userID, runID string, payload map[string]json.RawMessage) (any, error) {
	callID, err := decodePiStringAliases(payload, "Pi 工具调用 ID", "callId", "call_id", "toolCallId", "tool_call_id", "id")
	if err != nil {
		return nil, err
	}
	if callID == "" {
		return nil, errors.New("Pi 工具调用缺少 call id")
	}
	name, err := decodePiStringAliases(payload, "Pi 工具名称", "name", "toolName")
	if err != nil {
		return nil, err
	}
	var call cloudAgentCall
	call.ID = callID
	call.Function.Name = name
	if raw, exists := payload["arguments"]; exists {
		call.Function.Arguments = strings.TrimSpace(string(raw))
	}
	if call.Function.Arguments == "" || call.Function.Arguments == "null" {
		call.Function.Arguments = "{}"
	}
	if call.Function.Name == "" {
		return nil, fmt.Errorf("tool call is missing a name")
	}
	if err := validateCloudAgentCalls([]cloudAgentCall{call}); err != nil {
		// 参数校验失败的调用可能已由纠偏提交预写了结构化回执（见
		// finishCloudAgentPiModelStepWithInvalidCalls）：超限/非法参数进不了执行器，
		// 但模型仍需要「拆分重试」的结构化指引，而不是这里的一句泛化校验错误——
		// 那会让 Pi 会话与服务端 canonical 各记一份不同的结果，下一轮模型请求
		// 按历史长度二选一，看到哪份不稳定。优先回放已保存回执，两边保持一致。
		if run, loadErr := s.repo.CloudAgent(userID, runID); loadErr == nil {
			if state, decodeErr := cloudAgentDecode(run); decodeErr == nil {
				if content, ok := cloudAgentToolMessage(&state, call.ID); ok {
					return cloudAgentPiToolResult(call, content), nil
				}
			}
		}
		return nil, err
	}

	// 工具白名单校验：拒绝未声明的工具调用
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, err
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		return nil, err
	}

	allowedTools := make(map[string]bool)
	for _, tool := range state.Canonical.Tools {
		if fn, ok := tool["function"].(map[string]interface{}); ok {
			name := stringValue(fn["name"])
			if name != "" {
				allowedTools[name] = true
			}
		}
	}

	if !allowedTools[call.Function.Name] {
		log.Printf("[Agent] rejected undeclared tool call: %s in run %s", call.Function.Name, runID)
		return nil, fmt.Errorf("未声明的工具: %s", call.Function.Name)
	}

	return s.executeCloudAgentRuntimeTool(ctx, userID, runID, call)
}

func (s *Service) executeCloudAgentRuntimeTool(ctx context.Context, userID, runID string, call cloudAgentCall) (any, error) {
	executed := false
	for attempt := 0; attempt < 8 && !executed; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return nil, err
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			return nil, err
		}
		// A runtime may retry the same /tool request after the bridge response was
		// lost. Replay the committed result before inspecting CallIndex: the
		// executor may already have advanced to the next call or completed the run.
		if content, ok := cloudAgentToolMessage(&state, call.ID); ok {
			return cloudAgentPiToolResult(call, content), nil
		}
		if cloudAgentRunTerminal(run.Status) {
			return nil, fmt.Errorf("run already terminated")
		}
		if state.StepLimits, err = s.cloudAgentStepLimits(); err != nil {
			return nil, err
		}
		if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
			return nil, fmt.Errorf("工具调用 %q 没有对应的模型工具调用", call.ID)
		}
		expected := state.Calls[state.CallIndex]
		if !cloudAgentToolCallsEquivalent(expected, call) {
			return nil, fmt.Errorf("工具调用 %q 与模型声明的工具调用不一致", call.ID)
		}
		state.Approval = nil
		err = s.advanceCloudAgentTool(run, &state)
		if errors.Is(err, repository.ErrCreationConflict) {
			time.Sleep(time.Duration(attempt+1) * 20 * time.Millisecond)
			continue
		}
		if err != nil {
			return nil, err
		}
		executed = true
	}
	if !executed {
		return nil, fmt.Errorf("execute tool %s: %w", call.Function.Name, repository.ErrCreationConflict)
	}
	// 媒体生成：等待已提交的任务结束，再由同一执行器回写画布并记录工具结果。
	for {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return nil, err
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			return nil, err
		}
		if run.Status == "waiting_approval" && state.Approval != nil {
			return map[string]any{"pause": true, "approvalId": state.Approval.ID, "content": "操作正在等待用户审批。"}, nil
		}
		if cloudAgentRunTerminal(run.Status) && run.Status != "completed" {
			return nil, fmt.Errorf("%s", firstNonEmpty(run.FailureMessage, "Agent 工具执行失败"))
		}
		if content, ok := cloudAgentToolMessage(&state, call.ID); ok {
			return cloudAgentPiToolResult(call, content), nil
		}
		if state.MediaTaskID == "" {
			return nil, fmt.Errorf("tool %s produced no result", call.Function.Name)
		}
		if _, err := s.waitCloudAgentTask(ctx, state.MediaTaskID); err != nil && ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if err := s.settleCloudAgentMedia(userID, runID); err != nil {
			return nil, err
		}
	}
}

func cloudAgentToolCallsEquivalent(expected, received cloudAgentCall) bool {
	if expected.ID == "" || expected.ID != received.ID || expected.Function.Name != received.Function.Name {
		return false
	}
	var expectedArgs, receivedArgs map[string]interface{}
	if err := json.Unmarshal([]byte(expected.Function.Arguments), &expectedArgs); err != nil || expectedArgs == nil {
		return false
	}
	if err := json.Unmarshal([]byte(received.Function.Arguments), &receivedArgs); err != nil || receivedArgs == nil {
		return false
	}
	left, err := json.Marshal(expectedArgs)
	if err != nil {
		return false
	}
	right, err := json.Marshal(receivedArgs)
	return err == nil && string(left) == string(right)
}

func cloudAgentPiToolResult(call cloudAgentCall, content string) map[string]any {
	if trimmed := strings.TrimSpace(content); trimmed == "" || trimmed == "null" {
		content = `{"error":"工具没有返回结果"}`
	}
	result := map[string]any{"content": content, "isError": cloudAgentToolContentIsError(content)}
	if call.Function.Name == "ask_user" {
		var payload map[string]any
		if json.Unmarshal([]byte(content), &payload) == nil && stringValue(payload["phase"]) == "question" {
			result["terminate"] = true
		}
	}
	return result
}

// settleCloudAgentMedia 在媒体任务结束后用唯一的业务执行器回写画布、记录工具结果并释放
// MediaTaskID。任务仍在生成时直接返回；并发写冲突时重读重试。
func (s *Service) settleCloudAgentMedia(userID, runID string) error {
	for attempt := 0; attempt < 8; attempt++ {
		latest, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		fresh, err := cloudAgentDecode(latest)
		if err != nil {
			return err
		}
		if fresh.MediaTaskID == "" || fresh.CallIndex >= len(fresh.Calls) {
			return nil
		}
		err = s.advanceCloudAgentMedia(latest, &fresh, fresh.Calls[fresh.CallIndex])
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
		time.Sleep(time.Duration(attempt+1) * 20 * time.Millisecond)
	}
	return repository.ErrCreationConflict
}

func cloudAgentToolMessage(state *cloudAgentRuntime, callID string) (string, bool) {
	for index := len(state.Canonical.Messages) - 1; index >= 0; index-- {
		message := state.Canonical.Messages[index]
		if stringField(message, "role") == "tool" && stringField(message, "tool_call_id") == callID {
			return stringField(message, "content"), true
		}
	}
	return "", false
}

func cloudAgentToolContentIsError(content string) bool {
	var decoded map[string]any
	if json.Unmarshal([]byte(content), &decoded) != nil {
		return false
	}
	_, failed := decoded["error"]
	return failed
}

// cloudAgentPiEvent 事件桥接。Node 端事件是平铺字段（{type, message, ...}），
// 不是 {type, data}；这里把整个 payload 作为事件数据交给处理器。
func (s *Service) cloudAgentPiEvent(ctx context.Context, userID, runID string, payload map[string]json.RawMessage) (any, error) {
	data := map[string]any{}
	for key, raw := range payload {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, fmt.Errorf("decode Agent event field %q: %w", key, err)
		}
		data[key] = value
	}
	eventType, _ := data["type"].(string)
	if nested, ok := data["data"].(map[string]any); ok {
		for key, value := range nested {
			if _, exists := data[key]; !exists {
				data[key] = value
			}
		}
	}
	if message, ok := data["message"].(map[string]any); ok {
		if _, exists := data["role"]; !exists {
			data["role"] = message["role"]
		}
	}

	switch eventType {
	case "message_start":
		return s.handleMessageStart(userID, runID, data)
	case "message_delta":
		return s.handleMessageDelta(userID, runID, data)
	case "message_end":
		return s.handleMessageEnd(userID, runID, data)
	case "session_snapshot":
		return s.handlePiSessionSnapshot(userID, runID, data)
	case "compaction_start", "compaction_end":
		kind, eventPayload, ok := cloudAgentPiCompactionEvent(eventType, data)
		if !ok {
			return map[string]any{"ok": true}, nil
		}
		if err := s.broadcastAgentEvent(userID, runID, kind, eventPayload); err != nil {
			return nil, err
		}
		return map[string]any{"ok": true}, nil
	case "tool_call", "tool_call_start", "tool_call_end":
		return s.handleToolCall(userID, runID, data)
	case "error":
		return s.handleError(userID, runID, data)
	default:
		return map[string]any{"ok": true}, nil
	}
}

func cloudAgentPiCompactionEvent(eventType string, data map[string]any) (string, map[string]any, bool) {
	reason := stringField(data, "reason")
	contextUsage, _ := data["contextUsage"].(map[string]any)
	switch eventType {
	case "compaction_start":
		payload := map[string]any{
			"basis":        "tokens",
			"reason":       reason,
			"contextUsage": contextUsage,
		}
		if compactionID := strings.TrimSpace(stringField(data, "compactionId")); compactionID != "" {
			payload["compactionId"] = compactionID
		}
		return "context_compaction_requested", payload, true
	case "compaction_end":
		payload := map[string]any{
			"reason":       reason,
			"aborted":      data["aborted"],
			"willRetry":    data["willRetry"],
			"contextUsage": contextUsage,
		}
		if compactionID := strings.TrimSpace(stringField(data, "compactionId")); compactionID != "" {
			payload["compactionId"] = compactionID
		}
		for _, key := range []string{"tokensBefore", "estimatedTokensAfter"} {
			if value, exists := data[key]; exists {
				payload[key] = value
			}
		}
		aborted, _ := data["aborted"].(bool)
		hasResult, _ := data["hasResult"].(bool)
		errorMessage := strings.TrimSpace(stringField(data, "errorMessage"))
		if hasResult && !aborted && errorMessage == "" {
			return "context_compacted", payload, true
		}
		payload["cancelled"] = aborted
		if aborted {
			payload["text"] = "上下文压缩已取消，原有对话历史已保留"
		} else {
			if errorMessage == "" {
				errorMessage = "Pi 未能生成上下文摘要"
			}
			payload["errorMessage"] = truncateRunes(errorMessage, 1000)
			payload["text"] = "上下文压缩失败，原有对话历史已保留：" + truncateRunes(errorMessage, 1000)
		}
		return "context_compaction_failed", payload, true
	default:
		return "", nil, false
	}
}

// handlePiSessionSnapshot 持久化 Pi 原生会话 JSONL，用于审批恢复和续轮。
func (s *Service) handlePiSessionSnapshot(userID, runID string, data map[string]any) (any, error) {
	sessionJSONL, _ := data["sessionJSONL"].(string)
	if sessionJSONL == "" {
		return map[string]any{"ok": true}, nil
	}
	for attempt := 0; attempt < 4; attempt++ {
		var expected int64
		existing, err := s.repo.CloudAgentPiSession(userID, runID)
		if err == nil {
			expected = existing.Revision
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		err = s.repo.SaveCloudAgentPiSession(&model.CloudAgentPiSession{RunID: runID, UserID: userID, SessionJSONL: sessionJSONL, UpdatedAt: time.Now()}, expected)
		if err == nil {
			if expected == 0 {
				// OnConflict DoNothing：并发首写时再按 revision 覆盖一次。
				if saved, readErr := s.repo.CloudAgentPiSession(userID, runID); readErr == nil && saved.SessionJSONL != sessionJSONL {
					continue
				}
			}
			return map[string]any{"ok": true}, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	return nil, fmt.Errorf("save Agent session: %w", repository.ErrCreationConflict)
}

func stateCanonicalFromInput(input map[string]any) canonicalAgentRequest {
	canonical, _ := canonicalAgentRequestFromInput(input)
	return canonical
}

func canonicalAgentRequestFromInput(input map[string]any) (canonicalAgentRequest, bool) {
	requests, ok := input["agentRequests"].(map[string]any)
	if !ok || requests["canonical"] == nil {
		return canonicalAgentRequest{}, false
	}
	raw, err := json.Marshal(requests["canonical"])
	if err != nil {
		return canonicalAgentRequest{}, false
	}
	var canonical canonicalAgentRequest
	if err := json.Unmarshal(raw, &canonical); err != nil {
		return canonicalAgentRequest{}, false
	}
	return canonical, true
}

func piToolDefinitions(source []map[string]interface{}) []map[string]any {
	result := make([]map[string]any, 0, len(source))
	for _, tool := range source {
		fn, _ := tool["function"].(map[string]interface{})
		name := stringValue(fn["name"])
		if name == "" {
			continue
		}
		result = append(result, map[string]any{
			"name":        name,
			"label":       firstNonEmpty(stringValue(fn["name"]), name),
			"description": stringValue(fn["description"]),
			"parameters":  fn["parameters"],
		})
	}
	return result
}

func isCanvasTool(toolName string) bool {
	return strings.HasPrefix(toolName, "canvas_")
}

func decodePiPayload(payload map[string]json.RawMessage, target interface{}) error {
	// 尝试直接解析整个 payload
	if data, err := json.Marshal(payload); err == nil {
		if err := json.Unmarshal(data, target); err == nil {
			return nil
		}
	}

	// 尝试解析 arguments 字段
	if argsRaw, ok := payload["arguments"]; ok {
		return json.Unmarshal(argsRaw, target)
	}

	return fmt.Errorf("failed to decode payload")
}

func decodePiStringAliases(payload map[string]json.RawMessage, label string, aliases ...string) (string, error) {
	fields := make(map[string]interface{}, len(payload))
	for key, raw := range payload {
		var value interface{}
		if err := json.Unmarshal(raw, &value); err != nil {
			return "", fmt.Errorf("decode Pi field %q: %w", key, err)
		}
		fields[key] = value
	}
	return strictRuntimeStringAliases(fields, label, aliases...)
}

func mustMarshal(v any) string {
	data, _ := json.Marshal(v)
	return string(data)
}

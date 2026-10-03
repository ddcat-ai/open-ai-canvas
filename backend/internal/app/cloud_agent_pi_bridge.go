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
func canonicalFromRuntimeMessages(messages []map[string]any, tools []map[string]interface{}, systemPrompt string) canonicalAgentRequest {
	canonical := canonicalAgentRequest{Tools: tools, ToolChoice: "auto", SystemPrompt: systemPrompt}
	for _, message := range messages {
		switch stringField(message, "role") {
		case "system":
			if text := runtimeContentText(message["content"]); strings.TrimSpace(text) != "" {
				canonical.Messages = append(canonical.Messages, map[string]interface{}{"role": "system", "content": text})
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
						calls = append(calls, map[string]interface{}{
							"id":       stringField(part, "id"),
							"function": map[string]interface{}{"name": stringField(part, "name"), "arguments": string(arguments)},
						})
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
			id := firstNonEmpty(stringField(message, "toolCallId"), stringField(message, "tool_call_id"))
			if id == "" {
				continue
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
	return canonical
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
		result = append(result, map[string]any{"id": call.ID, "name": call.Function.Name, "arguments": arguments})
	}
	return result
}

// cloudAgentPiTool 工具调用桥接：所有工具都交给唯一的 Go 业务执行器
// advanceCloudAgentTool（权限、审批、计费、画布写入都在那里治理）。
func (s *Service) cloudAgentPiTool(ctx context.Context, userID, runID string, payload map[string]json.RawMessage) (any, error) {
	var request struct {
		CallID     string          `json:"callId"`
		Name       string          `json:"name"`
		ToolName   string          `json:"toolName"`
		Arguments  json.RawMessage `json:"arguments"`
		ReplayOnly bool            `json:"replayOnly"`
	}
	if err := decodePiPayload(payload, &request); err != nil {
		return nil, err
	}
	var call cloudAgentCall
	call.ID = request.CallID
	if call.ID == "" || len(call.ID) > 160 {
		return nil, BadAuthRequest("工具调用缺少有效的固定标识")
	}
	call.Function.Name = firstNonEmpty(request.Name, request.ToolName)
	call.Function.Arguments = strings.TrimSpace(string(request.Arguments))
	if call.Function.Arguments == "" || call.Function.Arguments == "null" {
		call.Function.Arguments = "{}"
	}
	if call.Function.Name == "" {
		return nil, fmt.Errorf("tool call is missing a name")
	}

	// 工具白名单校验：拒绝未声明的工具调用
	run, err := s.ownedCloudAgent(ctx, userID, runID)
	if err != nil {
		return nil, err
	}
	state, err := cloudAgentDecodeForExecution(run)
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
	if request.ReplayOnly {
		content, ok := cloudAgentCommittedToolReplay(&state, call)
		if !ok {
			return nil, NewAppError(409, "已审批工具缺少匹配的执行结果，未重新执行")
		}
		if cloudAgentWrite(call.Function.Name) {
			receipt, err := s.repo.CloudAgentReceipt(userID, runID, "tool", call.ID)
			if err != nil {
				return nil, NewAppError(409, "已审批写入缺少执行回执，未重新执行")
			}
			digest, err := cloudAgentCallDigest(call)
			if err != nil || receipt.Status != "committed" || receipt.Name != call.Function.Name || receipt.InputSHA256 != digest {
				return nil, NewAppError(409, "已审批写入回执与工具调用不符，未重新执行")
			}
		}
		return map[string]any{"content": content, "isError": cloudAgentToolContentIsError(content)}, nil
	}

	return s.executeCloudAgentRuntimeTool(ctx, userID, runID, call)
}

func cloudAgentCommittedToolReplay(state *cloudAgentRuntime, call cloudAgentCall) (string, bool) {
	want, err := cloudAgentCallDigest(call)
	if err != nil || state == nil {
		return "", false
	}
	// Pi's /model request is persisted before the assistant tool calls arrive.
	// The Go tool executor keeps the exact admitted call and its completed index,
	// while the canonical transcript keeps the committed result.
	matched := false
	for index, original := range state.Calls {
		if original.ID != call.ID {
			continue
		}
		digest, err := cloudAgentCallDigest(original)
		if err != nil || index >= state.CallIndex || original.Function.Name != call.Function.Name || digest != want {
			return "", false
		}
		matched = true
		break
	}
	if !matched {
		return "", false
	}
	for i := len(state.Canonical.Messages) - 1; i >= 0; i-- {
		message := state.Canonical.Messages[i]
		if stringField(message, "role") == "tool" && stringField(message, "tool_call_id") == call.ID {
			return stringField(message, "content"), true
		}
	}
	return "", false
}

func (s *Service) executeCloudAgentRuntimeTool(ctx context.Context, userID, runID string, call cloudAgentCall) (any, error) {
	executed := false
	for attempt := 0; attempt < 8 && !executed; attempt++ {
		run, err := s.ownedCloudAgent(ctx, userID, runID)
		if err != nil {
			return nil, err
		}
		// This helper is also called directly by recovery paths. Check the
		// admitted execution contract before creating even a pending receipt.
		if _, err := cloudAgentDecodeForExecution(run); err != nil {
			return nil, err
		}
		if cloudAgentWrite(call.Function.Name) {
			receipt, err := s.prepareCloudAgentWriteReceipt(run, call)
			if errors.Is(err, repository.ErrCreationConflict) {
				continue
			}
			if err != nil {
				return nil, err
			}
			if receipt.Status == "committed" {
				return cloudAgentReceiptResponse(receipt)
			}
			if receipt.Status != "pending" {
				return nil, NewAppError(409, "工具提交结果需要核对，未自动重发")
			}
			run, err = s.ownedCloudAgent(ctx, userID, runID)
			if err != nil {
				return nil, err
			}
		}
		if cloudAgentRunTerminal(run.Status) {
			return nil, fmt.Errorf("run already terminated")
		}
		state, err := cloudAgentDecodeForExecution(run)
		if err != nil {
			return nil, err
		}
		if state.StepLimits, err = s.cloudAgentStepLimits(); err != nil {
			return nil, err
		}
		if !cloudAgentWrite(call.Function.Name) {
			state.Calls = []cloudAgentCall{call}
			state.CallIndex = 0
			state.Approval = nil
		} else if state.CallIndex >= len(state.Calls) || state.Calls[state.CallIndex].ID != call.ID {
			return nil, NewAppError(409, "工具恢复记录不一致，未自动重发")
		}
		err = s.advanceCloudAgentTool(run, &state)
		if errors.Is(err, errCloudAgentReceiptReplay) {
			continue
		}
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
		run.ExecutionFence = cloudAgentFence(ctx)
		if run.Status == "completed" || run.Status == "failed" {
			// The same tool still needs its committed question or failure result.
			// Only this terminal read retains the original owner and lease.
			if err := s.repo.CheckCloudAgentPiSnapshotOwner(run, cloudAgentFence(ctx)); err != nil {
				return nil, err
			}
		} else if err := s.repo.CheckCloudAgentOwner(run, cloudAgentFence(ctx)); err != nil {
			return nil, err
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			return nil, err
		}
		if run.Status == "waiting_approval" && state.Approval != nil {
			return map[string]any{"pause": true, "approvalId": state.Approval.ID, "content": "操作正在等待用户审批。"}, nil
		}
		if content, ok := cloudAgentToolMessage(&state, call.ID); ok {
			if trimmed := strings.TrimSpace(content); trimmed == "" || trimmed == "null" {
				content = `{"error":"工具没有返回结果"}`
			}
			result := map[string]any{"content": content, "isError": cloudAgentToolContentIsError(content)}
			if cloudAgentRunTerminal(run.Status) {
				// Persist the paired result without another model call after termination.
				result["terminate"] = true
			}
			return result, nil
		}
		if cloudAgentRunTerminal(run.Status) && run.Status != "completed" {
			return nil, fmt.Errorf("%s", firstNonEmpty(run.FailureMessage, "Agent 工具执行失败"))
		}
		if state.MediaTaskID == "" {
			return nil, fmt.Errorf("tool %s produced no result", call.Function.Name)
		}
		if _, err := s.waitCloudAgentMediaTask(ctx, userID, runID, state.MediaTaskID); err != nil && ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if err := s.settleCloudAgentMedia(userID, runID, cloudAgentFence(ctx)); err != nil {
			return nil, err
		}
	}
}

// settleCloudAgentMedia 在媒体任务结束后用唯一的业务执行器回写画布、记录工具结果并释放
// MediaTaskID。任务仍在生成时直接返回；并发写冲突时重读重试。
func (s *Service) settleCloudAgentMedia(userID, runID string, fences ...*model.CloudAgentFence) error {
	for attempt := 0; attempt < 8; attempt++ {
		latest, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		cloudAgentBindFence(latest, fences)
		fresh, err := cloudAgentDecode(latest)
		if err != nil {
			return err
		}
		if fresh.MediaTaskID == "" || fresh.CallIndex >= len(fresh.Calls) {
			return nil
		}
		call := fresh.Calls[fresh.CallIndex]
		if cloudAgentCommerceBatchCall(call.Function.Name) {
			batch := fresh.CommerceBatch
			if fresh.Approval != nil && fresh.Approval.Batch != nil {
				batch = fresh.Approval.Batch
			}
			err = s.advanceCloudAgentCommerceBatch(latest, &fresh, call, batch)
		} else {
			err = s.advanceCloudAgentMedia(latest, &fresh, call)
		}
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
	var eventType string
	if err := json.Unmarshal(payload["type"], &eventType); err != nil {
		return nil, fmt.Errorf("decode Agent event type: %w", err)
	}
	run, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		return nil, err
	}
	terminalFlush := (run.Status == "completed" || run.Status == "failed") && (eventType == "session_snapshot" || eventType == "tool_call_end")
	if terminalFlush {
		// The same live owner may finish a terminated tool's journal flush.
		err = s.repo.CheckCloudAgentPiSnapshotOwner(run, cloudAgentFence(ctx))
	} else {
		err = s.repo.CheckCloudAgentOwner(run, cloudAgentFence(ctx))
	}
	if err != nil {
		return nil, fmt.Errorf("Pi event %s: %w", eventType, err)
	}
	if terminalFlush && eventType == "tool_call_end" {
		return map[string]any{"ok": true}, nil
	}
	data := map[string]any{}
	for key, raw := range payload {
		var value any
		if err := json.Unmarshal(raw, &value); err != nil {
			return nil, fmt.Errorf("decode Agent event field %q: %w", key, err)
		}
		data[key] = value
	}
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
		return s.handleMessageStart(userID, runID, data, cloudAgentFence(ctx))
	case "message_delta":
		return s.handleMessageDelta(userID, runID, data, cloudAgentFence(ctx))
	case "message_end":
		return s.handleMessageEnd(userID, runID, data, cloudAgentFence(ctx))
	case "compaction_start", "compaction_end":
		return s.handlePiCompaction(userID, runID, data, cloudAgentFence(ctx))
	case "session_snapshot":
		return s.handlePiSessionSnapshot(userID, runID, data, cloudAgentFence(ctx))
	case "tool_call", "tool_call_start", "tool_call_end":
		return s.handleToolCall(userID, runID, data, cloudAgentFence(ctx))
	case "error":
		return s.handleError(userID, runID, data, cloudAgentFence(ctx))
	default:
		return map[string]any{"ok": true}, nil
	}
}

// handlePiSessionSnapshot 持久化 Pi 原生会话 JSONL，用于审批恢复和续轮。
func (s *Service) handlePiSessionSnapshot(userID, runID string, data map[string]any, fences ...*model.CloudAgentFence) (any, error) {
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
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return nil, err
		}
		cloudAgentBindFence(run, fences)
		err = s.repo.MutateCloudAgentPiSnapshot(run, func(_ *model.CloudAgentExecution, repo *repository.Repository) error {
			return repo.SaveCloudAgentPiSession(&model.CloudAgentPiSession{RunID: runID, UserID: userID, SessionJSONL: sessionJSONL, UpdatedAt: time.Now()}, expected)
		})
		if err == nil {
			if expected == 0 {
				// OnConflict DoNothing：并发首写时再按 revision 覆盖一次。
				if saved, readErr := s.repo.CloudAgentPiSession(userID, runID); readErr == nil && saved.SessionJSONL != sessionJSONL {
					continue
				}
			}
			return map[string]any{"ok": true}, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) && !errors.Is(err, repository.ErrCreationConflict) {
			return nil, err
		}
	}
	return nil, fmt.Errorf("save Agent session: %w", repository.ErrCreationConflict)
}

func stateCanonicalFromInput(input map[string]any) canonicalAgentRequest {
	canonical, _ := canonicalAgentRequestFromInput(input)
	return canonical
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

func mustMarshal(v any) string {
	data, _ := json.Marshal(v)
	return string(data)
}

func generateID() string {
	return fmt.Sprintf("%d", time.Now().UnixNano())
}

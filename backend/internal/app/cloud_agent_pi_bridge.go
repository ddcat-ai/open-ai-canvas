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
		CallID    string          `json:"callId"`
		Name      string          `json:"name"`
		ToolName  string          `json:"toolName"`
		Arguments json.RawMessage `json:"arguments"`
	}
	if err := decodePiPayload(payload, &request); err != nil {
		return nil, err
	}
	var call cloudAgentCall
	call.ID = firstNonEmpty(request.CallID, generateID())
	call.Function.Name = firstNonEmpty(request.Name, request.ToolName)
	call.Function.Arguments = strings.TrimSpace(string(request.Arguments))
	if call.Function.Arguments == "" || call.Function.Arguments == "null" {
		call.Function.Arguments = "{}"
	}
	if call.Function.Name == "" {
		return nil, fmt.Errorf("tool call is missing a name")
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
		if cloudAgentRunTerminal(run.Status) {
			return nil, fmt.Errorf("run already terminated")
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			return nil, err
		}
		if state.StepLimits, err = s.cloudAgentStepLimits(); err != nil {
			return nil, err
		}
		state.Calls = []cloudAgentCall{call}
		state.CallIndex = 0
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
			if trimmed := strings.TrimSpace(content); trimmed == "" || trimmed == "null" {
				content = `{"error":"工具没有返回结果"}`
			}
			result := map[string]any{"content": content, "isError": cloudAgentToolContentIsError(content)}
			if call.Function.Name == "ask_user" {
				var payload map[string]any
				if json.Unmarshal([]byte(content), &payload) == nil && stringValue(payload["phase"]) == "question" {
					// ask_user 已经把本轮交给用户，Pi 不能再发起下一次模型调用。
					result["terminate"] = true
				}
			}
			return result, nil
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
	case "tool_call", "tool_call_start", "tool_call_end":
		return s.handleToolCall(userID, runID, data)
	case "error":
		return s.handleError(userID, runID, data)
	default:
		return map[string]any{"ok": true}, nil
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

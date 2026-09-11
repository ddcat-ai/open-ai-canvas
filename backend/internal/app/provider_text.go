package app

// 文本生成、Agent 工具循环和文本流解析。

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

func runAgentToolTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	// 浏览器持久化的是协议中立请求；资源水合和模型路由完成后才展开上游协议，
	// 防止供应商请求体反向污染任务记录，也避免切换模型时复用错误协议。
	if input.AgentRequests != nil && input.AgentRequests.Canonical != nil {
		_, declarative := agentProtocolAdapterForContext(ctx, input.Config.InterfaceType)
		requests, err := expandCanonicalAgentRequest(input.AgentRequests.Canonical, input.Config, declarative)
		if err != nil {
			return nil, err
		}
		input.AgentRequests = requests
	}
	if adapter, ok := agentProtocolAdapterForContext(ctx, input.Config.InterfaceType); ok {
		return runDeclarativeAgentTask(ctx, input, adapter)
	}
	if input.AgentRequests == nil {
		return nil, errors.New("画布 Agent 工具请求缺少协议参数")
	}
	request := input.AgentRequests.ChatCompletion
	path := "/chat/completions"
	protocol := "chat-completion"
	if input.Config.InterfaceType == string(model.ChannelInterfaceOpenAIResponse) {
		request = input.AgentRequests.Responses
		path = "/responses"
		protocol = "responses"
	} else if input.Config.InterfaceType == string(model.ChannelInterfaceClaudeAPI) {
		if input.AgentRequests.Claude != nil {
			request = input.AgentRequests.Claude
		}
		path = "/messages"
		protocol = "claude-api"
	}
	if request == nil {
		return nil, errors.New("画布 Agent 工具请求缺少协议参数")
	}
	body := cloneStringAnyMap(request)
	if protocol == "claude-api" && input.AgentRequests.Claude == nil {
		body = claudeAgentBody(body)
	}
	body["model"] = input.Config.Model
	result, err := postStreamingAgent(ctx, input.Config, path, body, protocol, input.OnTextDelta)
	if protocol == "chat-completion" && isAgentToolChoiceCompatibilityError(err) {
		if !isAutoAgentToolChoice(body["tool_choice"]) {
			autoBody := cloneStringAnyMap(body)
			autoBody["tool_choice"] = "auto"
			result, err = postStreamingAgent(ctx, input.Config, path, autoBody, protocol, input.OnTextDelta)
		}
		if isAgentToolChoiceCompatibilityError(err) {
			withoutToolChoice := cloneStringAnyMap(body)
			delete(withoutToolChoice, "tool_choice")
			result, err = postStreamingAgent(ctx, input.Config, path, withoutToolChoice, protocol, input.OnTextDelta)
		}
	}
	if err != nil {
		return nil, err
	}
	return result, nil
}

func runDeclarativeAgentTask(ctx context.Context, input canvasGenerationInput, adapter protocol.AgentAdapter) (map[string]interface{}, error) {
	if input.AgentRequests == nil {
		return nil, errors.New("画布 Agent 工具请求缺少协议参数")
	}
	request := map[string]any{
		"chatCompletion": input.AgentRequests.ChatCompletion,
		"responses":      input.AgentRequests.Responses,
		"claude":         input.AgentRequests.Claude,
		"gemini":         input.AgentRequests.Gemini,
	}
	spec, err := adapter.BuildAgent(ctx, protocol.AgentRequestContext{BaseURL: input.Config.BaseURL, Model: input.Config.Model, Request: request})
	if err != nil {
		return nil, err
	}
	body, err := executeProtocolRequest(ctx, input.Config, spec)
	if err != nil {
		return nil, err
	}
	parsed, err := adapter.ParseAgent(ctx, body)
	if err != nil {
		return nil, err
	}
	result := map[string]interface{}{"mode": "text", "text": parsed.Text, "toolCalls": []interface{}{}}
	if parsed.Reasoning != "" {
		result["reasoning"] = parsed.Reasoning
	}
	calls := make([]interface{}, 0, len(parsed.ToolCalls))
	for _, call := range parsed.ToolCalls {
		mapped := map[string]interface{}{
			"id":       call.ID,
			"type":     "function",
			"function": map[string]interface{}{"name": call.Name, "arguments": call.Arguments},
		}
		if call.ThoughtSignature != "" {
			mapped["thoughtSignature"] = call.ThoughtSignature
		}
		calls = append(calls, mapped)
	}
	result["toolCalls"] = calls
	if strings.TrimSpace(parsed.Text) == "" && len(calls) == 0 {
		return nil, errors.New("声明式 Agent 接口没有返回内容")
	}
	return result, nil
}

func claudeAgentBody(request map[string]interface{}) map[string]interface{} {
	body := map[string]interface{}{"max_tokens": 4096}
	if messages, ok := request["messages"].([]interface{}); ok {
		claudeMessages := make([]interface{}, 0, len(messages))
		var system []string
		for _, value := range messages {
			message, _ := value.(map[string]interface{})
			role := strings.ToLower(strings.TrimSpace(stringField(message, "role")))
			if role == "system" {
				if content := strings.TrimSpace(fmt.Sprint(message["content"])); content != "" {
					system = append(system, content)
				}
				continue
			}
			if role == "tool" {
				claudeMessages = append(claudeMessages, map[string]interface{}{"role": "user", "content": []interface{}{map[string]interface{}{
					"type": "tool_result", "tool_use_id": stringField(message, "tool_call_id"), "content": fmt.Sprint(message["content"]),
				}}})
				continue
			}
			role = mapClaudeMessageRole(role)
			content := message["content"]
			if content == nil {
				content = ""
			}
			if toolCalls, ok := message["tool_calls"].([]interface{}); ok && len(toolCalls) > 0 {
				blocks := make([]interface{}, 0, len(toolCalls))
				for _, value := range toolCalls {
					toolCall, _ := value.(map[string]interface{})
					function, _ := toolCall["function"].(map[string]interface{})
					blocks = append(blocks, map[string]interface{}{
						"type": "tool_use", "id": stringField(toolCall, "id"), "name": stringField(function, "name"), "input": claudeToolInput(function["arguments"]),
					})
				}
				content = blocks
			}
			claudeMessages = append(claudeMessages, map[string]interface{}{"role": role, "content": content})
		}
		body["messages"] = claudeMessages
		if len(system) > 0 {
			body["system"] = strings.Join(system, "\n\n")
		}
	}
	if tools, ok := request["tools"].([]interface{}); ok && len(tools) > 0 {
		claudeTools := make([]interface{}, 0, len(tools))
		for _, value := range tools {
			tool, _ := value.(map[string]interface{})
			function, _ := tool["function"].(map[string]interface{})
			if len(function) == 0 {
				continue
			}
			claudeTools = append(claudeTools, map[string]interface{}{
				"name": stringField(function, "name"), "description": stringField(function, "description"), "input_schema": function["parameters"],
			})
		}
		if len(claudeTools) > 0 {
			body["tools"] = claudeTools
		}
	}
	if choice, ok := request["tool_choice"]; ok {
		body["tool_choice"] = claudeToolChoice(choice)
	}
	return body
}

func mapClaudeMessageRole(role string) string {
	if role == "assistant" {
		return "assistant"
	}
	return "user"
}

func claudeToolInput(value interface{}) interface{} {
	if raw, ok := value.(string); ok {
		var parsed interface{}
		if json.Unmarshal([]byte(raw), &parsed) == nil && parsed != nil {
			return parsed
		}
	}
	if value != nil {
		return value
	}
	return map[string]interface{}{}
}

func claudeToolChoice(value interface{}) interface{} {
	switch choice := value.(type) {
	case string:
		switch strings.ToLower(strings.TrimSpace(choice)) {
		case "required":
			return map[string]interface{}{"type": "any"}
		case "none":
			return map[string]interface{}{"type": "auto"}
		default:
			return map[string]interface{}{"type": "auto"}
		}
	case map[string]interface{}:
		if function, ok := choice["function"].(map[string]interface{}); ok && stringField(function, "name") != "" {
			return map[string]interface{}{"type": "tool", "name": stringField(function, "name")}
		}
		if name := stringField(choice, "name"); name != "" {
			return map[string]interface{}{"type": "tool", "name": name}
		}
	}
	return map[string]interface{}{"type": "auto"}
}

func isAgentToolChoiceCompatibilityError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	var payloadErr providerPayloadError
	if errors.As(err, &payloadErr) {
		message += " " + strings.ToLower(payloadErr.raw)
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		message += " " + strings.ToLower(httpErr.Body)
	}
	return strings.Contains(message, "tool_choice") || strings.Contains(message, "tool choice") || strings.Contains(message, "tool-choice") || strings.Contains(message, "thinking mode")
}

func isAutoAgentToolChoice(value interface{}) bool {
	choice, ok := value.(string)
	return ok && strings.EqualFold(strings.TrimSpace(choice), "auto")
}

func parseAgentToolPayload(payload map[string]interface{}, protocol string) (map[string]interface{}, error) {
	if err := validateTextPayload(payload); err != nil {
		return nil, err
	}
	result := map[string]interface{}{"mode": "text", "text": "", "toolCalls": []interface{}{}}
	if protocol == "responses" {
		result["text"] = firstNonEmptyString(stringField(payload, "output_text"), extractResponseText(payload))
		if reasoning := extractResponseReasoning(payload); reasoning != "" {
			result["reasoning"] = reasoning
		}
		calls := make([]interface{}, 0)
		for _, value := range interfaceSlice(payload["output"]) {
			item, _ := value.(map[string]interface{})
			if stringField(item, "type") != "function_call" {
				continue
			}
			calls = append(calls, map[string]interface{}{"id": firstNonEmptyString(stringField(item, "call_id"), stringField(item, "id")), "type": "function", "function": map[string]interface{}{"name": stringField(item, "name"), "arguments": stringField(item, "arguments")}})
		}
		result["toolCalls"] = calls
		return result, nil
	}
	if protocol == "claude-api" {
		content := interfaceSlice(payload["content"])
		calls := make([]interface{}, 0)
		for _, value := range content {
			item, _ := value.(map[string]interface{})
			switch stringField(item, "type") {
			case "text":
				result["text"] = result["text"].(string) + stringField(item, "text")
			case "thinking":
				result["reasoning"] = resultString(result, "reasoning") + firstNonEmptyString(stringField(item, "thinking"), stringField(item, "text"))
			case "tool_use":
				arguments, err := json.Marshal(item["input"])
				if err != nil {
					return nil, err
				}
				calls = append(calls, map[string]interface{}{"id": stringField(item, "id"), "type": "function", "function": map[string]interface{}{"name": stringField(item, "name"), "arguments": string(arguments)}})
			}
		}
		result["toolCalls"] = calls
		if result["text"] == "" && len(calls) == 0 {
			return nil, errors.New("Claude Agent 接口没有返回内容")
		}
		return result, nil
	}
	choices := interfaceSlice(payload["choices"])
	if len(choices) == 0 {
		return nil, errors.New("画布 Agent 接口没有返回 choices")
	}
	choice, _ := choices[0].(map[string]interface{})
	message, _ := choice["message"].(map[string]interface{})
	result["text"] = stringField(message, "content")
	if reasoning := firstNonEmptyString(stringField(message, "reasoning_content"), stringField(message, "reasoning")); reasoning != "" {
		result["reasoning"] = reasoning
	}
	calls := make([]interface{}, 0)
	for _, value := range interfaceSlice(message["tool_calls"]) {
		item, _ := value.(map[string]interface{})
		function, _ := item["function"].(map[string]interface{})
		calls = append(calls, map[string]interface{}{"id": stringField(item, "id"), "type": "function", "function": map[string]interface{}{"name": stringField(function, "name"), "arguments": stringField(function, "arguments")}})
	}
	result["toolCalls"] = calls
	return result, nil
}

func postStreamingAgent(ctx context.Context, config providerConfig, path string, body map[string]interface{}, protocol string, onDelta func(string)) (map[string]interface{}, error) {
	body["stream"] = true
	if protocol == "chat-completion" {
		metadata, _ := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
		if metadata.BillingMode == "token" {
			if err := ensureChatCompletionStreamUsage(body); err != nil {
				return nil, err
			}
		}
	}
	parser := newStreamingAgentParser(protocol, onDelta)
	data, mimeType, err := postStreamingBinary(ctx, config, path, body, parser.consume)
	if err != nil {
		return nil, err
	}
	if !strings.Contains(strings.ToLower(mimeType), "event-stream") {
		var payload map[string]interface{}
		if err := json.Unmarshal(data, &payload); err != nil {
			return nil, fmt.Errorf("Agent 接口返回格式无效：%w", err)
		}
		return parseAgentToolPayload(payload, protocol)
	}
	parser.flush()
	return parser.result()
}

type streamingAgentToolCall struct {
	id        string
	name      string
	arguments string
}

type streamingAgentParser struct {
	protocol     string
	buffer       string
	text         strings.Builder
	reasoning    strings.Builder
	toolCalls    map[int]*streamingAgentToolCall
	toolCallByID map[string]int
	completed    map[string]interface{}
	err          error
	emit         func(string)
}

func newStreamingAgentParser(protocol string, emit func(string)) *streamingAgentParser {
	return &streamingAgentParser{protocol: protocol, toolCalls: map[int]*streamingAgentToolCall{}, toolCallByID: map[string]int{}, emit: emit}
}

func (p *streamingAgentParser) consume(mimeType string, chunk []byte) {
	if p == nil || p.err != nil || !strings.Contains(strings.ToLower(mimeType), "event-stream") || len(chunk) == 0 {
		return
	}
	p.buffer += string(chunk)
	p.consumeFrames(false)
}

func (p *streamingAgentParser) flush() {
	if p == nil || p.err != nil {
		return
	}
	p.consumeFrames(true)
}

func (p *streamingAgentParser) consumeFrames(flush bool) {
	for p.err == nil {
		match := sseFrameBoundaryPattern.FindStringIndex(p.buffer)
		if match == nil {
			break
		}
		p.consumeFrame(p.buffer[:match[0]])
		p.buffer = p.buffer[match[1]:]
	}
	if flush && p.err == nil && strings.TrimSpace(p.buffer) != "" {
		p.consumeFrame(p.buffer)
		p.buffer = ""
	}
}

func (p *streamingAgentParser) consumeFrame(frame string) {
	var eventName string
	var dataLines []string
	for _, line := range strings.Split(strings.ReplaceAll(frame, "\r\n", "\n"), "\n") {
		switch {
		case strings.HasPrefix(line, "event:"):
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			dataLines = append(dataLines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	raw := strings.TrimSpace(strings.Join(dataLines, "\n"))
	if raw == "" || raw == "[DONE]" {
		return
	}
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		p.err = fmt.Errorf("Agent 流式事件解析失败：%w", err)
		return
	}
	if err := validateTextPayload(payload); err != nil {
		p.err = err
		return
	}
	switch p.protocol {
	case "responses":
		p.consumeResponsesEvent(eventName, payload)
	case "claude-api":
		p.consumeClaudeEvent(payload)
	default:
		p.consumeChatCompletionEvent(payload)
	}
}

func (p *streamingAgentParser) consumeResponsesEvent(eventName string, payload map[string]interface{}) {
	eventType := firstNonEmptyString(strings.TrimSpace(eventName), stringField(payload, "type"))
	switch eventType {
	case "response.output_text.delta", "output_text.delta":
		p.appendText(stringField(payload, "delta"))
	case "response.reasoning.delta", "response.reasoning_text.delta", "response.reasoning_summary_text.delta":
		p.reasoning.WriteString(stringField(payload, "delta"))
	case "response.completed":
		p.completed, _ = payload["response"].(map[string]interface{})
	case "response.output_item.added":
		item, _ := payload["item"].(map[string]interface{})
		if stringField(item, "type") == "function_call" {
			index := intField(payload, "output_index", len(p.toolCalls))
			p.setToolCall(index, firstNonEmptyString(stringField(item, "call_id"), stringField(item, "id")), stringField(item, "name"), stringField(item, "arguments"))
		}
	case "response.function_call_arguments.delta":
		index := p.responseToolCallIndex(payload)
		p.toolCall(index).arguments += stringField(payload, "delta")
	case "response.function_call_arguments.done":
		index := p.responseToolCallIndex(payload)
		if arguments := stringField(payload, "arguments"); arguments != "" {
			p.toolCall(index).arguments = arguments
		}
	}
}

func (p *streamingAgentParser) responseToolCallIndex(payload map[string]interface{}) int {
	itemID := firstNonEmptyString(stringField(payload, "item_id"), stringField(payload, "call_id"))
	if index, ok := p.toolCallByID[itemID]; ok {
		return index
	}
	return intField(payload, "output_index", len(p.toolCalls))
}

func (p *streamingAgentParser) consumeChatCompletionEvent(payload map[string]interface{}) {
	choices, _ := payload["choices"].([]interface{})
	for _, value := range choices {
		choice, _ := value.(map[string]interface{})
		delta, _ := choice["delta"].(map[string]interface{})
		p.appendText(streamContentText(delta["content"]))
		p.reasoning.WriteString(firstNonEmptyString(stringField(delta, "reasoning_content"), stringField(delta, "reasoning"), stringField(delta, "reasoning_text")))
		for fallbackIndex, toolValue := range interfaceSlice(delta["tool_calls"]) {
			tool, _ := toolValue.(map[string]interface{})
			index := intField(tool, "index", fallbackIndex)
			function, _ := tool["function"].(map[string]interface{})
			current := p.toolCall(index)
			if id := stringField(tool, "id"); id != "" {
				current.id = id
				p.toolCallByID[id] = index
			}
			if name := stringField(function, "name"); name != "" {
				current.name += name
			}
			current.arguments += stringField(function, "arguments")
		}
	}
}

func (p *streamingAgentParser) consumeClaudeEvent(payload map[string]interface{}) {
	switch stringField(payload, "type") {
	case "content_block_start":
		block, _ := payload["content_block"].(map[string]interface{})
		index := intField(payload, "index", len(p.toolCalls))
		switch stringField(block, "type") {
		case "text":
			p.appendText(stringField(block, "text"))
		case "thinking":
			p.reasoning.WriteString(firstNonEmptyString(stringField(block, "thinking"), stringField(block, "text")))
		case "tool_use":
			arguments := ""
			if input := block["input"]; input != nil {
				if encoded, err := json.Marshal(input); err == nil && string(encoded) != "{}" {
					arguments = string(encoded)
				}
			}
			p.setToolCall(index, stringField(block, "id"), stringField(block, "name"), arguments)
		}
	case "content_block_delta":
		delta, _ := payload["delta"].(map[string]interface{})
		index := intField(payload, "index", len(p.toolCalls)-1)
		if stringField(delta, "type") == "text_delta" {
			p.appendText(stringField(delta, "text"))
		}
		if stringField(delta, "type") == "thinking_delta" {
			p.reasoning.WriteString(firstNonEmptyString(stringField(delta, "thinking"), stringField(delta, "text")))
		}
		if stringField(delta, "type") == "input_json_delta" {
			p.toolCall(index).arguments += stringField(delta, "partial_json")
		}
	case "error":
		errValue, _ := payload["error"].(map[string]interface{})
		p.err = errors.New(defaultString(stringField(errValue, "message"), "Claude 上游返回失败"))
	}
}

func resultString(value map[string]interface{}, key string) string {
	return stringField(value, key)
}

func (p *streamingAgentParser) appendText(delta string) {
	if delta == "" {
		return
	}
	p.text.WriteString(delta)
	if p.emit != nil {
		p.emit(delta)
	}
}

func (p *streamingAgentParser) toolCall(index int) *streamingAgentToolCall {
	if index < 0 {
		index = 0
	}
	if p.toolCalls[index] == nil {
		p.toolCalls[index] = &streamingAgentToolCall{}
	}
	return p.toolCalls[index]
}

func (p *streamingAgentParser) setToolCall(index int, id string, name string, arguments string) {
	call := p.toolCall(index)
	call.id, call.name, call.arguments = id, name, arguments
	if id != "" {
		p.toolCallByID[id] = index
	}
}

func (p *streamingAgentParser) result() (map[string]interface{}, error) {
	if p.err != nil {
		return nil, p.err
	}
	if p.completed != nil {
		result, err := parseAgentToolPayload(p.completed, p.protocol)
		if err != nil {
			return nil, err
		}
		if p.text.Len() > 0 {
			result["text"] = p.text.String()
		}
		if p.reasoning.Len() > 0 {
			result["reasoning"] = p.reasoning.String()
		}
		return result, nil
	}
	result := map[string]interface{}{"mode": "text", "text": p.text.String(), "toolCalls": []interface{}{}}
	if p.reasoning.Len() > 0 {
		result["reasoning"] = p.reasoning.String()
	}
	indices := make([]int, 0, len(p.toolCalls))
	for index := range p.toolCalls {
		indices = append(indices, index)
	}
	sort.Ints(indices)
	calls := make([]interface{}, 0, len(indices))
	for _, index := range indices {
		call := p.toolCalls[index]
		if call == nil || strings.TrimSpace(call.id) == "" || strings.TrimSpace(call.name) == "" {
			continue
		}
		arguments := call.arguments
		if strings.TrimSpace(arguments) == "" {
			arguments = "{}"
		}
		var parsed interface{}
		if err := json.Unmarshal([]byte(arguments), &parsed); err != nil {
			return nil, fmt.Errorf("Agent 工具参数不是完整 JSON：%w", err)
		}
		calls = append(calls, map[string]interface{}{"id": call.id, "type": "function", "function": map[string]interface{}{"name": call.name, "arguments": arguments}})
	}
	result["toolCalls"] = calls
	if p.text.Len() == 0 && len(calls) == 0 {
		return nil, errors.New("画布 Agent 接口没有返回内容")
	}
	return result, nil
}

func intField(value map[string]interface{}, key string, fallback int) int {
	number, ok := value[key].(float64)
	if !ok || math.IsNaN(number) || math.IsInf(number, 0) {
		return fallback
	}
	return int(number)
}

func extractResponseReasoning(payload map[string]interface{}) string {
	var chunks []string
	for _, value := range interfaceSlice(payload["output"]) {
		item, _ := value.(map[string]interface{})
		if stringField(item, "type") != "reasoning" {
			continue
		}
		for _, key := range []string{"summary", "content"} {
			for _, part := range interfaceSlice(item[key]) {
				record, _ := part.(map[string]interface{})
				if text := strings.TrimSpace(stringField(record, "text")); text != "" {
					chunks = append(chunks, text)
				}
			}
		}
	}
	return strings.Join(chunks, "\n")
}

func interfaceSlice(value interface{}) []interface{} {
	items, _ := value.([]interface{})
	return items
}

func cloneStringAnyMap(value map[string]interface{}) map[string]interface{} {
	cloned := make(map[string]interface{}, len(value)+1)
	for key, item := range value {
		cloned[key] = item
	}
	return cloned
}

func runTextTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if _, ok := declarativeProtocolAdapterForContext(ctx, input.Config.InterfaceType); ok {
		return runDeclarativeProtocolTask(ctx, input)
	}
	switch input.Config.InterfaceType {
	case "chat-completion":
		return runChatCompletionsTextTask(ctx, input)
	case "openai-response":
		return runResponsesTextTask(ctx, input)
	case string(model.ChannelInterfaceClaudeAPI):
		return runClaudeTextTask(ctx, input)
	}
	return runLegacyTextTask(ctx, input)
}

func runLegacyTextTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	responseInput, err := textResponseInput(input)
	if err != nil {
		return nil, err
	}
	body := map[string]interface{}{"model": input.Config.Model, "input": responseInput}
	applyTextThinking(body, input, "responses")
	applyTextOutputLimit(body, input.MaxOutputTokens, "max_output_tokens")
	result, err := requestTextProvider(ctx, input.Config, "/responses", body, "responses", input.StreamText, input.OnTextDelta)
	if err != nil {
		if !shouldFallbackTextToChat(err) {
			return nil, err
		}
		result, chatErr := runChatCompletionsTextTask(ctx, input)
		if chatErr == nil {
			return result, nil
		}
		return nil, fmt.Errorf("文本接口请求失败：Responses API %v；Chat Completions %v", err, chatErr)
	}
	return providerTextTaskResult(result), nil
}

func runResponsesTextTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	responseInput, err := textResponseInput(input)
	if err != nil {
		return nil, err
	}
	body := map[string]interface{}{"model": input.Config.Model, "input": responseInput}
	applyTextThinking(body, input, "responses")
	applyTextOutputLimit(body, input.MaxOutputTokens, "max_output_tokens")
	result, err := requestTextProvider(ctx, input.Config, "/responses", body, "responses", input.StreamText, input.OnTextDelta)
	if err != nil {
		return nil, err
	}
	return providerTextTaskResult(result), nil
}

func runChatCompletionsTextTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	messages := []map[string]interface{}{}
	if systemPrompt := strings.TrimSpace(input.Config.SystemPrompt); systemPrompt != "" {
		messages = append(messages, map[string]interface{}{"role": "system", "content": systemPrompt})
	}
	messages = append(messages, validatedTextHistory(input.TextHistory)...)
	userContent, err := textChatContent(input)
	if err != nil {
		return nil, err
	}
	messages = append(messages, map[string]interface{}{"role": "user", "content": userContent})
	body := map[string]interface{}{"model": input.Config.Model, "messages": messages}
	applyTextThinking(body, input, "chat-completion")
	applyTextOutputLimit(body, input.MaxOutputTokens, "max_tokens")
	result, err := requestTextProvider(ctx, input.Config, "/chat/completions", body, "chat-completion", input.StreamText, input.OnTextDelta)
	if err != nil {
		return nil, err
	}
	return providerTextTaskResult(result), nil
}

func runClaudeTextTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if len(input.ReferenceVideos) > 0 {
		return nil, errors.New("Claude API 当前不支持视频参考输入")
	}
	messages := make([]map[string]interface{}, 0, len(input.TextHistory)+1)
	for _, message := range validatedTextHistory(input.TextHistory) {
		messages = append(messages, message)
	}
	content, err := claudeTextContent(input)
	if err != nil {
		return nil, err
	}
	messages = append(messages, map[string]interface{}{"role": "user", "content": content})
	maxTokens := 4096
	if input.MaxOutputTokens > 0 {
		maxTokens = input.MaxOutputTokens
	}
	body := map[string]interface{}{"model": input.Config.Model, "max_tokens": maxTokens, "messages": messages}
	applyTextThinking(body, input, "claude-api")
	if systemPrompt := strings.TrimSpace(input.Config.SystemPrompt); systemPrompt != "" {
		body["system"] = systemPrompt
	}
	result, err := requestTextProvider(ctx, input.Config, "/messages", body, "claude-api", input.StreamText, input.OnTextDelta)
	if err != nil {
		return nil, err
	}
	return providerTextTaskResult(result), nil
}

func applyTextThinking(body map[string]interface{}, input canvasGenerationInput, protocol string) {
	if !input.TextOptions.Thinking {
		return
	}
	switch protocol {
	case "responses":
		body["reasoning"] = map[string]interface{}{"effort": "medium", "summary": "auto"}
	case "chat-completion":
		body["reasoning_effort"] = "medium"
	case "claude-api":
		body["thinking"] = map[string]interface{}{"type": "enabled", "budget_tokens": 1024}
	}
}

type providerTextResult struct {
	Text      string
	Reasoning string
}

func providerTextTaskResult(result providerTextResult) map[string]interface{} {
	payload := map[string]interface{}{"mode": "text", "text": result.Text}
	if strings.TrimSpace(result.Reasoning) != "" {
		payload["reasoning"] = result.Reasoning
	}
	return payload
}

func applyTextOutputLimit(body map[string]interface{}, limit int, field string) {
	if limit > 0 {
		body[field] = limit
	}
}

func claudeTextContent(input canvasGenerationInput) (interface{}, error) {
	if len(input.ReferenceImages) == 0 {
		return input.Prompt, nil
	}
	content := []map[string]interface{}{{"type": "text", "text": input.Prompt}}
	for _, image := range input.ReferenceImages {
		value, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		if strings.HasPrefix(value, "data:") {
			mimeType, data, ok := splitDataURL(value)
			if !ok {
				return nil, errors.New("Claude 参考图片 data URL 无效")
			}
			content = append(content, map[string]interface{}{"type": "image", "source": map[string]interface{}{"type": "base64", "media_type": mimeType, "data": data}})
		} else {
			content = append(content, map[string]interface{}{"type": "image", "source": map[string]interface{}{"type": "url", "url": value}})
		}
	}
	return content, nil
}

func splitDataURL(value string) (string, string, bool) {
	if !strings.HasPrefix(value, "data:") {
		return "", "", false
	}
	separator := strings.Index(value, ",")
	if separator <= len("data:") {
		return "", "", false
	}
	header := strings.TrimPrefix(value[:separator], "data:")
	if !strings.HasSuffix(header, ";base64") {
		return "", "", false
	}
	return strings.TrimSuffix(header, ";base64"), value[separator+1:], value[separator+1:] != ""
}

func textResponseInput(input canvasGenerationInput) (interface{}, error) {
	systemPrompt := strings.TrimSpace(input.Config.SystemPrompt)
	if len(input.TextHistory) == 0 && len(input.ReferenceImages) == 0 && len(input.ReferenceVideos) == 0 {
		return withSystemPrompt(input.Config, input.Prompt), nil
	}
	messages := make([]map[string]interface{}, 0, len(input.TextHistory)+2)
	if systemPrompt != "" {
		messages = append(messages, map[string]interface{}{"role": "system", "content": systemPrompt})
	}
	messages = append(messages, validatedTextHistory(input.TextHistory)...)
	content, err := textResponseContent(input)
	if err != nil {
		return nil, err
	}
	messages = append(messages, map[string]interface{}{"role": "user", "content": content})
	return messages, nil
}

func validatedTextHistory(history []providerTextMessage) []map[string]interface{} {
	result := make([]map[string]interface{}, 0, len(history))
	for _, message := range history {
		role := strings.ToLower(strings.TrimSpace(message.Role))
		content := strings.TrimSpace(message.Content)
		if (role != "user" && role != "assistant") || content == "" {
			continue
		}
		result = append(result, map[string]interface{}{"role": role, "content": content})
	}
	return result
}

func textResponseContent(input canvasGenerationInput) ([]map[string]interface{}, error) {
	content := []map[string]interface{}{{"type": "input_text", "text": input.Prompt}}
	for _, image := range input.ReferenceImages {
		url, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"type": "input_image", "image_url": url})
	}
	for _, video := range input.ReferenceVideos {
		url, err := openAIVideoInputURL(video)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"type": "input_video", "video_url": url})
	}
	return content, nil
}

func textChatContent(input canvasGenerationInput) (interface{}, error) {
	if len(input.ReferenceImages) == 0 && len(input.ReferenceVideos) == 0 {
		return input.Prompt, nil
	}
	content := []map[string]interface{}{{"type": "text", "text": input.Prompt}}
	for _, image := range input.ReferenceImages {
		url, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"type": "image_url", "image_url": map[string]interface{}{"url": url}})
	}
	for _, video := range input.ReferenceVideos {
		url, err := openAIVideoInputURL(video)
		if err != nil {
			return nil, err
		}
		content = append(content, map[string]interface{}{"type": "video_url", "video_url": map[string]interface{}{"url": url}})
	}
	return content, nil
}

func shouldFallbackTextToChat(err error) bool {
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) {
		return false
	}
	// 只在上游明确说这个路径不存在/不允许时，才把 Responses 换成 Chat Completions。
	// 502/503/504 是瞬时故障，换协议不会修好，还会把真正的上游故障伪装成“能力缺失后的第二次失败”。
	switch httpErr.StatusCode {
	case http.StatusNotFound, http.StatusMethodNotAllowed, http.StatusNotImplemented:
		return true
	default:
		return false
	}
}

func requestTextProvider(ctx context.Context, config providerConfig, path string, body map[string]interface{}, protocol string, stream bool, onDelta func(string)) (providerTextResult, error) {
	if stream {
		return postStreamingTextResult(ctx, config, path, body, protocol, onDelta)
	}
	var payload map[string]interface{}
	if err := postJSON(ctx, config, path, body, &payload); err != nil {
		return providerTextResult{}, err
	}
	parsed, err := parseAgentToolPayload(payload, protocol)
	if err != nil {
		return providerTextResult{}, err
	}
	result := providerTextResult{Text: stringField(parsed, "text"), Reasoning: stringField(parsed, "reasoning")}
	if result.Text == "" {
		return providerTextResult{}, errors.New("文本接口没有返回内容")
	}
	return result, nil
}

func postStreamingText(ctx context.Context, config providerConfig, path string, body map[string]interface{}, protocol string, onDelta func(string)) (string, error) {
	result, err := postStreamingTextResult(ctx, config, path, body, protocol, onDelta)
	return result.Text, err
}

func postStreamingTextResult(ctx context.Context, config providerConfig, path string, body map[string]interface{}, protocol string, onDelta func(string)) (providerTextResult, error) {
	// 文本创作与 Agent 共用同一套 SSE 解析，确保正文、推理摘要和供应商错误语义一致。
	parsed, err := postStreamingAgent(ctx, config, path, body, protocol, onDelta)
	if err != nil {
		return providerTextResult{}, err
	}
	result := providerTextResult{Text: stringField(parsed, "text"), Reasoning: stringField(parsed, "reasoning")}
	if result.Text == "" {
		return providerTextResult{}, errors.New("流式文本接口没有返回内容")
	}
	return result, nil
}

func extractTextPayload(payload map[string]interface{}, protocol string) string {
	if protocol == "claude-api" {
		content, _ := payload["content"].([]interface{})
		var result strings.Builder
		for _, item := range content {
			record, _ := item.(map[string]interface{})
			if stringField(record, "type") == "text" {
				result.WriteString(stringField(record, "text"))
			}
		}
		return result.String()
	}
	if protocol == "responses" {
		text := stringField(payload, "output_text")
		if text == "" {
			text = extractResponseText(payload)
		}
		return text
	}
	return extractChatCompletionText(payload)
}

func validateTextPayload(payload map[string]interface{}) error {
	if code, ok := payload["code"].(float64); ok && code != 0 {
		rawMessage := defaultString(stringField(payload, "msg"), "请求失败")
		return providerPayloadError{raw: rawMessage, message: providerPayloadErrorMessage(rawMessage)}
	}
	if errValue, ok := payload["error"].(map[string]interface{}); ok {
		if message := stringField(errValue, "message"); message != "" {
			return providerPayloadError{raw: message, message: providerPayloadErrorMessage(message)}
		}
	}
	return nil
}

func parseTextEventStream(data []byte, protocol string) (string, error) {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 64<<10), len(data)+1)
	var text strings.Builder
	var eventName string
	var dataLines []string

	flush := func() error {
		if len(dataLines) == 0 {
			eventName = ""
			return nil
		}
		raw := strings.TrimSpace(strings.Join(dataLines, "\n"))
		dataLines = nil
		if raw == "" || raw == "[DONE]" {
			eventName = ""
			return nil
		}
		var payload map[string]interface{}
		if err := json.Unmarshal([]byte(raw), &payload); err != nil {
			return fmt.Errorf("流式文本事件解析失败：%w", err)
		}
		if eventName == "error" {
			if err := validateTextPayload(payload); err != nil {
				return err
			}
			return errors.New("上游流式文本请求失败")
		}
		if err := validateTextPayload(payload); err != nil {
			return err
		}
		if protocol == "responses" {
			text.WriteString(stringField(payload, "delta"))
		} else if protocol == "claude-api" {
			delta, _ := payload["delta"].(map[string]interface{})
			if stringField(delta, "type") == "text_delta" {
				text.WriteString(stringField(delta, "text"))
			}
		} else {
			choices, _ := payload["choices"].([]interface{})
			for _, choice := range choices {
				record, _ := choice.(map[string]interface{})
				delta, _ := record["delta"].(map[string]interface{})
				text.WriteString(streamContentText(delta["content"]))
			}
		}
		eventName = ""
		return nil
	}

	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if err := flush(); err != nil {
				return "", err
			}
			continue
		}
		switch {
		case strings.HasPrefix(line, "event:"):
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			value := strings.TrimPrefix(line, "data:")
			dataLines = append(dataLines, strings.TrimPrefix(value, " "))
		}
	}
	if err := scanner.Err(); err != nil {
		return "", fmt.Errorf("读取流式文本响应失败：%w", err)
	}
	if err := flush(); err != nil {
		return "", err
	}
	if text.Len() == 0 {
		return "", errors.New("流式文本接口没有返回内容")
	}
	return text.String(), nil
}

func streamContentText(value interface{}) string {
	if text, ok := value.(string); ok {
		return text
	}
	parts, ok := value.([]interface{})
	if !ok {
		return ""
	}
	var result strings.Builder
	for _, part := range parts {
		record, _ := part.(map[string]interface{})
		result.WriteString(stringField(record, "text"))
	}
	return result.String()
}

type streamingTextDeltaParser struct {
	protocol string
	buffer   string
	emit     func(string)
}

func newStreamingTextDeltaParser(protocol string, emit func(string)) *streamingTextDeltaParser {
	return &streamingTextDeltaParser{protocol: protocol, emit: emit}
}

func (p *streamingTextDeltaParser) consume(mimeType string, chunk []byte) {
	if p == nil || p.emit == nil || !strings.Contains(strings.ToLower(mimeType), "event-stream") || len(chunk) == 0 {
		return
	}
	p.buffer += string(chunk)
	p.consumeFrames(false)
}

func (p *streamingTextDeltaParser) flush() {
	if p == nil || p.emit == nil {
		return
	}
	p.consumeFrames(true)
}

func (p *streamingTextDeltaParser) consumeFrames(flush bool) {
	for {
		match := sseFrameBoundaryPattern.FindStringIndex(p.buffer)
		if match == nil {
			break
		}
		p.consumeFrame(p.buffer[:match[0]])
		p.buffer = p.buffer[match[1]:]
	}
	if flush && strings.TrimSpace(p.buffer) != "" {
		p.consumeFrame(p.buffer)
		p.buffer = ""
	}
}

func (p *streamingTextDeltaParser) consumeFrame(frame string) {
	var eventName string
	var dataLines []string
	for _, line := range strings.Split(strings.ReplaceAll(frame, "\r\n", "\n"), "\n") {
		switch {
		case strings.HasPrefix(line, "event:"):
			eventName = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			dataLines = append(dataLines, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	raw := strings.TrimSpace(strings.Join(dataLines, "\n"))
	if raw == "" || raw == "[DONE]" {
		return
	}
	var payload map[string]interface{}
	if json.Unmarshal([]byte(raw), &payload) != nil {
		return
	}
	if delta := streamingTextDelta(p.protocol, eventName, payload); delta != "" {
		p.emit(delta)
	}
}

func streamingTextDelta(protocol string, eventName string, payload map[string]interface{}) string {
	if protocol == "responses" {
		eventType := firstNonEmptyString(strings.TrimSpace(eventName), stringField(payload, "type"))
		if eventType == "response.output_text.delta" || eventType == "output_text.delta" || eventType == "" || eventType == "message" {
			return stringField(payload, "delta")
		}
		return ""
	}
	if protocol == "claude-api" {
		delta, _ := payload["delta"].(map[string]interface{})
		if stringField(delta, "type") == "text_delta" {
			return stringField(delta, "text")
		}
		return ""
	}
	choices, _ := payload["choices"].([]interface{})
	var text strings.Builder
	for _, choice := range choices {
		record, _ := choice.(map[string]interface{})
		delta, _ := record["delta"].(map[string]interface{})
		text.WriteString(streamContentText(delta["content"]))
	}
	return text.String()
}

func extractResponseText(payload map[string]interface{}) string {
	output, ok := payload["output"].([]interface{})
	if !ok {
		return ""
	}
	var chunks []string
	for _, item := range output {
		record, ok := item.(map[string]interface{})
		if !ok || record["type"] != "message" {
			continue
		}
		content, _ := record["content"].([]interface{})
		for _, part := range content {
			partRecord, ok := part.(map[string]interface{})
			if ok && stringField(partRecord, "text") != "" {
				chunks = append(chunks, stringField(partRecord, "text"))
			}
		}
	}
	return strings.Join(chunks, "")
}

func extractChatCompletionText(payload map[string]interface{}) string {
	if data, ok := payload["data"].(map[string]interface{}); ok {
		payload = data
	}
	choices, ok := payload["choices"].([]interface{})
	if !ok {
		return ""
	}
	var chunks []string
	for _, choice := range choices {
		record, ok := choice.(map[string]interface{})
		if !ok {
			continue
		}
		if message, ok := record["message"].(map[string]interface{}); ok {
			if text := stringField(message, "content"); text != "" {
				chunks = append(chunks, text)
			}
		}
		if text := stringField(record, "text"); text != "" {
			chunks = append(chunks, text)
		}
	}
	return strings.Join(chunks, "")
}

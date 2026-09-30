// Agent 模型步的流式（SSE）解析：把三种协议的增量事件拼成完整的文本、推理与工具调用。
//
// 工具调用参数按 index/ID 逐段拼接；解析器只在 flush 时产出结果，中途断流视为失败而不是截断成功。

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
)

func postStreamingAgent(ctx context.Context, config providerConfig, path string, body map[string]interface{}, protocol string, onDelta func(string), onReasoning ...func(string)) (map[string]interface{}, error) {
	body["stream"] = true
	if protocol == "chat-completion" {
		if err := ensureChatCompletionStreamUsage(body); err != nil {
			return nil, err
		}
	}
	parser := newStreamingAgentParser(protocol, onDelta)
	if len(onReasoning) > 0 {
		parser.emitReasoning = onReasoning[0]
	}
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
	protocol      string
	buffer        string
	text          strings.Builder
	reasoning     strings.Builder
	toolCalls     map[int]*streamingAgentToolCall
	toolCallByID  map[string]int
	completed     map[string]interface{}
	err           error
	emit          func(string)
	emitReasoning func(string)
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
		p.appendReasoning(stringField(payload, "delta"))
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
		p.appendReasoning(firstRawString(stringField(delta, "reasoning_content"), stringField(delta, "reasoning"), stringField(delta, "reasoning_text")))
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
			p.appendReasoning(firstRawString(stringField(block, "thinking"), stringField(block, "text")))
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
			p.appendReasoning(firstRawString(stringField(delta, "thinking"), stringField(delta, "text")))
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

func (p *streamingAgentParser) appendReasoning(delta string) {
	if delta == "" {
		return
	}
	p.reasoning.WriteString(delta)
	if p.emitReasoning != nil {
		p.emitReasoning(delta)
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

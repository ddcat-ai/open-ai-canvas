// 普通文本任务的流式解析与增量推送（文本节点、提示词优化等非 Agent 场景）。

package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

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

// firstRawString 返回第一个非空字符串，并原样保留首尾空白。流式增量逐 token 到达，
// 空格常常就在 token 开头（" user"）；用会 TrimSpace 的 firstNonEmptyString 会把词粘在一起。
func firstRawString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

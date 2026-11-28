// 普通文本任务的流式解析与增量推送（文本节点、提示词优化等非 Agent 场景）。

package app

import (
	"context"
	"errors"
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

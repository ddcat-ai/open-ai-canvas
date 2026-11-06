package app

// 文本生成、Agent 工具循环和文本流解析。

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

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

// Text plugins whose declared create path speaks a host-known wire keep the
// plugin's request mapping and host transport, while sharing the thinking
// parameters and SSE parser used by built-in text generation and Agent requests.
func executeProtocolCreateRequest(ctx context.Context, input canvasGenerationInput, spec protocol.RequestSpec) ([]byte, *protocol.Result, error) {
	wire := ""
	if input.Mode == "text" {
		wire = declaredTextWire(ctx, input.Config.InterfaceType)
	}
	thinkingWire := ""
	if input.Mode == "text" {
		thinkingWire = textThinkingWire(ctx, input.Config.InterfaceType, false)
	}
	if wire == "" {
		// 插件自定义线格式（如 Gemini generateContent）的请求和响应仍由插件映射，宿主只补思考参数。
		if thinkingWire != "" {
			if body := protocolBodyObject(spec.Body); body != nil {
				applyTextThinking(body, input, thinkingWire)
				spec.Body = body
			}
		}
		data, err := executeProtocolRequest(ctx, input.Config, spec)
		return data, nil, err
	}
	body := protocolBodyObject(spec.Body)
	if body == nil {
		return nil, nil, errors.New("声明式文本请求体必须是 JSON 对象")
	}
	applyTextThinking(body, input, wire)
	spec.Body = body
	if !input.StreamText {
		data, err := executeProtocolRequest(ctx, input.Config, spec)
		return data, nil, err
	}
	body["stream"] = true
	if wire == protocol.TextWireChatCompletion {
		if err := ensureChatCompletionStreamUsage(body); err != nil {
			return nil, nil, err
		}
	}
	data, mimeType, parser, err := executeTextWireStream(ctx, input.Config, spec, body, wire, func() *streamingAgentParser {
		parser := newStreamingAgentParser(wire, input.OnTextDelta)
		parser.emitReasoning = input.OnReasoningDelta
		return parser
	})
	if err != nil || !strings.Contains(strings.ToLower(mimeType), "event-stream") {
		return data, nil, err
	}
	parser.flush()
	parsed, err := parser.result()
	if err != nil {
		return nil, nil, err
	}
	text := stringField(parsed, "text")
	if text == "" {
		return nil, nil, errors.New("流式文本接口没有返回内容")
	}
	return data, &protocol.Result{Text: text, Reasoning: stringField(parsed, "reasoning")}, nil
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

// Chat Completion defaults to automatic tool selection when tools are present,
// so an explicit "auto" only reduces compatibility. Reasoning endpoints also
// disagree on forced choices. Normalize before the first network request while
// preserving required/named choices for non-reasoning structured tasks.
func normalizeAgentToolChoice(body map[string]interface{}, thinking bool, protocol string) {
	if protocol == "chat-completion" && (thinking || isAutoAgentToolChoice(body["tool_choice"])) {
		delete(body, "tool_choice")
	}
	// Claude 开启思考时只接受 auto/none，强制工具调用会直接 400。
	if protocol == "claude-api" && thinking {
		if choice, ok := body["tool_choice"].(map[string]interface{}); ok && stringField(choice, "type") != "auto" && stringField(choice, "type") != "none" {
			body["tool_choice"] = map[string]interface{}{"type": "auto"}
		}
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
	// Claude Messages 没有视频内容块；静默丢弃会让模型在没看到视频时照样作答。
	if len(input.ReferenceVideos) > 0 {
		return nil, errors.New("Claude 文本接口不支持参考视频，请换用支持视频识别的文本模型")
	}
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

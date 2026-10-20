package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"strings"

	"yingce/backend/internal/protocol"
)

// Native Gemini selects SSE through its endpoint/query, not an OpenAI stream
// field. Keep the plugin's auth/body and the existing cache recovery boundary.
func executeGeminiAgentStream(ctx context.Context, input canvasGenerationInput, spec protocol.RequestSpec) ([]byte, error) {
	path, err := url.Parse(spec.Path)
	if err != nil || !strings.HasSuffix(path.Path, ":generateContent") {
		return nil, errors.New("Gemini Agent 流式接口地址无效")
	}
	path.Path = strings.TrimSuffix(path.Path, ":generateContent") + ":streamGenerateContent"
	query := path.Query()
	query.Set("alt", "sse")
	path.RawQuery = query.Encode()
	spec.Path = path.String()
	parser := newStreamingAgentParser(officialGeminiAgentInterface, input.OnTextDelta)
	data, mime, err := executeProtocolBinaryRequestWithConsumer(ctx, input.Config, spec, parser.consume)
	if err != nil {
		return nil, err
	}
	streamed := strings.Contains(strings.ToLower(mime), "event-stream")
	if streamed {
		parser.flush()
	} else {
		var payload map[string]any
		if err := json.Unmarshal(data, &payload); err != nil {
			return nil, providerResponseDecodeError{Err: fmt.Errorf("Gemini Agent 接口返回格式无效：%w", err)}
		}
		if err := validateTextPayload(payload); err != nil {
			return nil, err
		}
		// JSON-only gateways still need the same thought filtering, visible-text
		// merge and tool validation. They may omit the streaming finish marker.
		parser.consumeGeminiEvent(payload)
	}
	if parser.err != nil {
		return nil, parser.err
	}
	if streamed && !parser.geminiFinished {
		return nil, providerResponseDecodeError{Err: fmt.Errorf("Gemini 响应提前结束，未收到完成状态；请先核对原请求：%w", io.ErrUnexpectedEOF)}
	}
	// The manifest parses the first text part and every function part. Merge only
	// visible text; retain each tool part and its signature without flattening it.
	parts := []any{map[string]any{"text": parser.text.String()}}
	parts = append(parts, parser.geminiParts...)
	return json.Marshal(map[string]any{"candidates": []any{map[string]any{
		"content": map[string]any{"role": "model", "parts": parts},
	}}})
}

func (p *streamingAgentParser) consumeGeminiEvent(payload map[string]any) {
	if feedback, ok := payload["promptFeedback"].(map[string]any); ok && stringField(feedback, "blockReason") != "" {
		p.err = errors.New("Gemini 未接受本次输入：" + stringField(feedback, "blockReason"))
		return
	}
	candidates := interfaceSlice(payload["candidates"])
	if len(candidates) == 0 {
		return
	}
	candidate, _ := candidates[0].(map[string]any)
	content, _ := candidate["content"].(map[string]any)
	for _, item := range interfaceSlice(content["parts"]) {
		part, _ := item.(map[string]any)
		if thought, _ := part["thought"].(bool); thought {
			continue
		}
		p.appendText(stringField(part, "text"))
		if call, ok := part["functionCall"].(map[string]any); ok {
			// Streaming arguments are not enabled in our native request. Reject
			// incomplete calls rather than executing a partially received action.
			if _, partial := call["partialArgs"]; partial || strings.TrimSpace(stringField(call, "name")) == "" {
				p.err = errors.New("Gemini 返回了不完整的工具调用")
				return
			}
			p.geminiParts = append(p.geminiParts, part)
		}
	}
	if finish := stringField(candidate, "finishReason"); finish != "" {
		if finish != "STOP" && !(finish == "MAX_TOKENS" && len(p.geminiParts) == 0) {
			p.err = errors.New("Gemini 未完成本次响应：" + finish)
			return
		}
		p.geminiFinished = true
	}
}

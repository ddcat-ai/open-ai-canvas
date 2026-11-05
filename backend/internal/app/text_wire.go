package app

// 声明式文本插件的线格式按插件声明的 create / agent 路径识别（protocol.TextWireForPath），
// 不按协议 ID：deepseek-chat、kimi-chat 等插件和 chat-completion 共用同一套流式解析、
// 思考参数、输出上限、工具选择和用量统计。

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func declaredTextWire(ctx context.Context, interfaceType string) string {
	adapter, ok := declarativeProtocolAdapterForContext(ctx, interfaceType)
	if !ok {
		return ""
	}
	return adapter.Metadata().TextWire
}

// textModelWire 是模型目录（PublicChannelModel.TextWire）和插件目录下发给浏览器的请求格式：
// 浏览器直连系统代理的提示词优化、编辑器助手和美术点评按它选择 /chat/completions、/responses
// 或 /messages；协议的 create 路径识别不出时为空，字段省略。
func (s *Service) textModelWire(capability string, protocolID model.ChannelInterfaceType) string {
	if normalizeCapability(capability) != "text" {
		return ""
	}
	metadata, ok := s.protocolMetadata(string(protocolID))
	if !ok {
		return ""
	}
	return metadata.TextWire
}

func declaredAgentWire(ctx context.Context, interfaceType string) string {
	adapter, ok := declarativeProtocolAdapterForContext(ctx, interfaceType)
	if !ok {
		return ""
	}
	return adapter.Metadata().AgentWire
}

// streamUsageOptionRejected 判断上游是否明确拒收了宿主补上的 stream_options。
// 部分 OpenAI 兼容上游（如 Mistral、Azure AI Foundry 无服务器端点）按严格 schema 校验，
// 多出的字段直接返回 400/422；被拒的请求没有进入生成，去掉该字段重试一次不会重复计费。
func streamUsageOptionRejected(err error) bool {
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) {
		return false
	}
	return StreamUsageOptionRejectedResponse(httpErr.StatusCode, []byte(httpErr.Body))
}

// StreamUsageOptionRejectedResponse 是同一判断的响应形态，供系统代理在转发前识别。
func StreamUsageOptionRejectedResponse(statusCode int, body []byte) bool {
	if statusCode != http.StatusBadRequest && statusCode != http.StatusUnprocessableEntity {
		return false
	}
	text := strings.ToLower(string(body))
	return strings.Contains(text, "stream_options") || strings.Contains(text, "include_usage")
}

// executeTextWireStream 执行宿主已知线格式的声明式流式请求。Chat Completions 上游明确拒收
// stream_options 时去掉该字段重试一次；body 必须就是 spec.Body 指向的同一个对象。
func executeTextWireStream(ctx context.Context, config providerConfig, spec protocol.RequestSpec, body map[string]any, wire string, newParser func() *streamingAgentParser) ([]byte, string, *streamingAgentParser, error) {
	parser := newParser()
	data, mimeType, err := executeProtocolBinaryRequestWithConsumer(ctx, config, spec, parser.consume)
	if err == nil || wire != protocol.TextWireChatCompletion || !streamUsageOptionRejected(err) {
		return data, mimeType, parser, err
	}
	delete(body, "stream_options")
	parser = newParser()
	data, mimeType, err = executeProtocolBinaryRequestWithConsumer(ctx, config, spec, parser.consume)
	return data, mimeType, parser, err
}

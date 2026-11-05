package app

// 系统代理（/api/{channelId}/...）按模型协议做路径白名单和出站鉴权。
// 内置协议沿用宿主自己的合同；其余协议只认已安装插件的声明，不再按协议 ID 放行或拼请求头。

import (
	"net/http"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

// SystemProxyDeclaredPostPaths 返回已安装声明式插件的 POST create / agent 路径，
// 已去掉 /v1 等版本前缀，与浏览器发往系统代理的路径同一形态。协议未安装或不是声明式插件时返回 nil，
// 调用方据此拒绝内置合同以外的路径。
func (s *Service) SystemProxyDeclaredPostPaths(protocolID model.ChannelInterfaceType) []string {
	metadata, ok := s.protocolMetadata(string(protocolID))
	if !ok || metadata.Execution != "declarative" {
		return nil
	}
	paths := make([]string, 0, 2)
	for _, summary := range []string{metadata.Create, metadata.Agent} {
		method, path, found := strings.Cut(strings.TrimSpace(summary), " ")
		if !found || !strings.EqualFold(strings.TrimSpace(method), http.MethodPost) {
			continue
		}
		if normalized := systemProxyComparablePath(path); normalized != "" && !containsCapabilityString(paths, normalized) {
			paths = append(paths, normalized)
		}
	}
	return paths
}

// systemProxyComparablePath 去掉声明路径开头的版本前缀和查询串。浏览器只发 /chat/completions 这类
// 协议路径，版本由 ChannelAPIURLForProtocol 按渠道 Base URL 补齐；带模板变量的路径保持原样，
// 因为系统代理不会替插件展开模板，这类路径不会和任何浏览器路径相等。
func systemProxyComparablePath(path string) string {
	path = strings.TrimSpace(path)
	if index := strings.IndexAny(path, "?#"); index >= 0 {
		path = path[:index]
	}
	if path == "" || !strings.HasPrefix(path, "/") {
		return ""
	}
	if prefix := requestAPIPathPrefix(path); prefix != "" {
		path = strings.TrimPrefix(path, path[:len(prefix)])
	}
	path = "/" + strings.Trim(path, "/")
	if path == "/" {
		return ""
	}
	return path
}

// ApplySystemProxyAuth 按插件声明的 auth 写出站鉴权（与声明式任务共用 applyProtocolAuth）；
// 协议没有安装声明式插件或插件未声明鉴权方式时，保留系统代理原有的内置写法。
func (s *Service) ApplySystemProxyAuth(req *http.Request, channel *model.ModelChannel, protocolID model.ChannelInterfaceType) error {
	if metadata, ok := s.protocolMetadata(string(protocolID)); ok && metadata.Execution == "declarative" && strings.TrimSpace(metadata.Auth.Type) != "" {
		config := providerConfig{APIKey: channel.APIKey, SecretKey: channel.SecretKey, APIFormat: channelAPIFormatForProtocol(channel.APIFormat, protocolID)}
		return applyProtocolAuth(req, config, metadata.Auth)
	}
	applySystemProxyBuiltinAuth(req, channel.APIKey, protocolID)
	return nil
}

func applySystemProxyBuiltinAuth(req *http.Request, apiKey string, protocolID model.ChannelInterfaceType) {
	switch protocolID {
	case model.ChannelInterfaceGeminiVeo, model.ChannelInterfaceGeminiImage:
		req.Header.Set("x-goog-api-key", apiKey)
	case model.ChannelInterfaceClaudeAPI:
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", "2023-06-01")
	default:
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
}

// SystemProxyChatCompletionPath 判断代理路径是不是 Chat Completions 请求，决定是否补 stream usage。
// 依据是实际转发的路径，而不是协议 ID：白名单已保证该路径属于模型协议的声明。
func SystemProxyChatCompletionPath(path string) bool {
	return protocol.TextWireForPath(path) == protocol.TextWireChatCompletion
}

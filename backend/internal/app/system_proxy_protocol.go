package app

// 系统代理（/api/{channelId}/...）按模型协议做路径白名单和出站鉴权。
// 内置协议沿用宿主自己的合同；其余协议只认已安装插件的声明，不再按协议 ID 放行或拼请求头。

import (
	"net/http"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

type SystemProxyContract struct {
	protocolID model.ChannelInterfaceType
	metadata   protocol.Metadata
}

func (s *Service) ResolveSystemProxyContract(protocolID model.ChannelInterfaceType, digest string) (SystemProxyContract, error) {
	contract := SystemProxyContract{protocolID: protocolID}
	if protocolID == "" {
		return contract, nil
	}
	release, err := selectModelRelease(s.protocolRegistry(), string(protocolID), digest, false)
	if err != nil {
		return contract, err
	}
	adapter, ok := release.Registry.Resolve(string(protocolID))
	if !ok {
		return contract, BadAuthRequest("系统模型的请求协议不可用")
	}
	contract.metadata = adapter.Metadata()
	return contract, nil
}

func (contract SystemProxyContract) DeclaredPostPaths() []string {
	metadata := contract.metadata
	if metadata.Execution != "declarative" {
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

func (contract SystemProxyContract) ApplyAuth(req *http.Request, channel *model.ModelChannel) error {
	protocolID, metadata := contract.protocolID, contract.metadata
	if metadata.Execution == "declarative" && strings.TrimSpace(metadata.Auth.Type) != "" {
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

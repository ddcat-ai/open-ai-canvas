package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ValidateChannelOutboundURL keeps all provider channels on the server-side
// outbound policy. Local desktop endpoints are intentionally unsupported.
func (s *Service) ValidateChannelOutboundURL(rawURL string) (*url.URL, error) {
	return ValidateOutboundURL(rawURL)
}

// OutboundHTTPClientForChannel 返回渠道专用的出站 HTTP 客户端。
// proxyURL 非空时使用渠道级代理（socks5/socks5h/http/https），否则回退到全局客户端。
func (s *Service) OutboundHTTPClientForChannel(timeout time.Duration, _ *url.URL, proxyURL string) *http.Client {
	client := OutboundHTTPClientWithProxy(timeout, proxyURL)
	base := client.Transport
	if base == nil {
		base = http.DefaultTransport
	}
	client.Transport = liteRemoteProxyTransport{service: s, base: base}
	return client
}

type liteRemoteProxyTransport struct {
	service *Service
	base    http.RoundTripper
}

func (t liteRemoteProxyTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	metadata, ok := request.Context().Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || t.service == nil || metadata.ChannelID == "" || metadata.TaskID == "" {
		return t.base.RoundTrip(request)
	}
	channel, err := t.service.repo.SystemChannel(metadata.ChannelID)
	if err != nil || !isLiteRemoteProviderID(channel.CatalogProviderID) {
		return t.base.RoundTrip(request)
	}
	remoteID, ok := liteRemoteChannelID(channel.CatalogProviderID)
	if request.URL != nil && request.Method == http.MethodGet && !strings.HasPrefix(request.URL.Path, "/api/ai/system/") {
		localKey := request.Header.Get("X-Yingce-Lite-Relay-Key")
		request.Header.Del("X-Yingce-Lite-Relay-Key")
		if localKey != "" && request.Header.Get("Authorization") == "Bearer "+localKey {
			request.Header.Del("Authorization")
		}
		if localKey != "" {
			for _, name := range []string{"X-Api-Key", "X-Goog-Api-Key", "Api-Key"} {
				if request.Header.Get(name) == localKey {
					request.Header.Del(name)
				}
			}
		}
		return t.base.RoundTrip(request)
	}
	if request.URL == nil || request.URL.Scheme != "http" || request.URL.Hostname() != "127.0.0.1" ||
		!ok || !strings.HasPrefix(request.URL.Path, "/api/ai/system/"+remoteID+"/") || request.Header.Get("X-Yingce-Lite-Relay-Key") == "" {
		return nil, errors.New("Lite 影策渠道未通过本机安全中转")
	}
	if request.Method == http.MethodPost {
		keyInput := fmt.Sprintf("%s|%d|%s|%s|%s", metadata.TaskID, metadata.RouteRun, metadata.RequestKind, request.Method, request.URL.Path)
		key := sha256.Sum256([]byte(keyInput))
		request.Header.Set("X-Idempotency-Key", hex.EncodeToString(key[:]))
		request.Header.Set("X-Canvas-Scene", firstNonEmpty(metadata.Operation, metadata.Capability))
	}
	if (metadata.RequestKind == "poll" || metadata.RequestKind == "download") && metadata.ProviderRequestID != "" {
		request.Header.Set("X-Yingce-Lite-Task-ID", metadata.ProviderRequestID)
	}
	return t.base.RoundTrip(request)
}

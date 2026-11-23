package app

import (
	"net/http"
	"net/url"
	"time"
)

// ValidateChannelOutboundURL keeps all provider channels on the server-side
// outbound policy. Local desktop endpoints are intentionally unsupported.
func (s *Service) ValidateChannelOutboundURL(rawURL string) (*url.URL, error) {
	return ValidateOutboundURL(rawURL)
}

// OutboundHTTPClientForChannel 返回渠道专用的出站 HTTP 客户端。
// proxyURL 非空时使用渠道级代理（socks5/socks5h/http/https），否则回退到全局客户端。
// 两种路径都禁止重定向写入请求，并在跨源读取时清除自定义凭据。
func (s *Service) OutboundHTTPClientForChannel(timeout time.Duration, _ *url.URL, proxyURL string) *http.Client {
	return OutboundHTTPClientWithProxy(timeout, proxyURL)
}

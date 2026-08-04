package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	maxOutboundRedirects     = 5
	maxOutboundHeaderCount   = 32
	maxOutboundHeaderBytes   = 16 << 10
	CustomRelayHeadersHeader = "X-Canvas-Upstream-Headers"
	DefaultOutboundUserAgent = "InfiniteCanvas/1.0 (+https://github.com/ddcat-ai/open-ai-canvas)"
)

type OutboundHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

var (
	outboundTransport          = newOutboundTransport(resolveOutboundHost)
	customRelayTransport       = newOutboundTransport(resolveCustomRelayHost)
	blockedCustomRelayPrefixes = []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/8"),
		netip.MustParsePrefix("100.64.0.0/10"),
		netip.MustParsePrefix("192.0.0.0/24"),
		netip.MustParsePrefix("192.0.2.0/24"),
		netip.MustParsePrefix("198.18.0.0/15"),
		netip.MustParsePrefix("198.51.100.0/24"),
		netip.MustParsePrefix("203.0.113.0/24"),
		netip.MustParsePrefix("240.0.0.0/4"),
		netip.MustParsePrefix("100::/64"),
		netip.MustParsePrefix("2001:db8::/32"),
	}
)

func ValidateOutboundURL(rawURL string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" {
		return nil, BadAuthRequest("外部服务地址无效")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, BadAuthRequest("外部服务地址只支持 http/https")
	}
	if parsed.User != nil {
		return nil, BadAuthRequest("外部服务地址不允许包含认证信息")
	}
	if err := validateOutboundHost(parsed.Hostname()); err != nil {
		return nil, err
	}
	return parsed, nil
}

// 用户自定义渠道必须使用更严格的出口策略：不接受 URL 凭据，且仅部署者精确配置的
// 主机可以路由到私网或使用会明文传输 API Key 的 HTTP。
func ValidateCustomRelayURL(rawURL string) (*url.URL, error) {
	if len(strings.TrimSpace(rawURL)) > 4096 {
		return nil, BadAuthRequest("自定义渠道地址过长")
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" || !parsed.IsAbs() {
		return nil, BadAuthRequest("自定义渠道地址无效")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && scheme != "http" {
		return nil, BadAuthRequest("自定义渠道地址只支持 http/https")
	}
	if scheme == "http" && !allowedPrivateUpstreamHost(parsed.Hostname()) {
		return nil, BadAuthRequest("自定义渠道 HTTP 仅允许访问已配置的可信上游主机")
	}
	if parsed.User != nil {
		return nil, BadAuthRequest("自定义渠道地址不允许包含认证信息")
	}
	if parsed.Fragment != "" {
		return nil, BadAuthRequest("自定义渠道地址不允许包含片段")
	}
	if err := validateCustomRelayHost(parsed.Hostname()); err != nil {
		return nil, err
	}
	return parsed, nil
}

func OutboundHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Transport: outboundTransport,
		Timeout:   timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= maxOutboundRedirects {
				return errors.New("外部服务重定向次数过多")
			}
			_, err := ValidateOutboundURL(req.URL.String())
			return err
		},
	}
}

func CustomRelayHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{
		Transport: customRelayTransport,
		Timeout:   timeout,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return errors.New("自定义渠道中转不允许重定向")
		},
	}
}

// ApplyDefaultOutboundHeaders 为所有服务端出网请求提供可识别的产品标识，
// 避免 Go 默认 User-Agent 被部分 WAF 或中转网关拦截。
func ApplyDefaultOutboundHeaders(req *http.Request) {
	if req != nil && strings.TrimSpace(req.Header.Get("User-Agent")) == "" {
		req.Header.Set("User-Agent", DefaultOutboundUserAgent)
	}
}

// NormalizeOutboundHeaders 是自定义 Header 的安全边界：允许业务/WAF 校验头和 User-Agent，
// 但禁止覆盖鉴权、请求体协议、代理内部头及 hop-by-hop 头。
func NormalizeOutboundHeaders(headers []OutboundHeader) ([]OutboundHeader, error) {
	if len(headers) > maxOutboundHeaderCount {
		return nil, BadAuthRequest(fmt.Sprintf("自定义请求头最多支持 %d 项", maxOutboundHeaderCount))
	}
	seen := make(map[string]struct{}, len(headers))
	normalized := make([]OutboundHeader, 0, len(headers))
	totalBytes := 0
	for _, item := range headers {
		name := strings.TrimSpace(item.Name)
		value := strings.TrimSpace(item.Value)
		if name == "" && value == "" {
			continue
		}
		if name == "" || !validOutboundHeaderName(name) {
			return nil, BadAuthRequest("自定义请求头名称无效，请使用标准 HTTP Header 名称")
		}
		name = http.CanonicalHeaderKey(name)
		lowerName := strings.ToLower(name)
		if blockedOutboundHeader(lowerName) {
			return nil, BadAuthRequest("请求头 " + name + " 由系统管理，不允许自定义")
		}
		if _, exists := seen[lowerName]; exists {
			return nil, BadAuthRequest("自定义请求头不能重复：" + name)
		}
		if !validOutboundHeaderValue(value) {
			return nil, BadAuthRequest("请求头 " + name + " 的值包含非法控制字符")
		}
		if len(name) > 128 || len(value) > 4096 {
			return nil, BadAuthRequest("单个自定义请求头名称或值过长")
		}
		totalBytes += len(name) + len(value)
		if totalBytes > maxOutboundHeaderBytes {
			return nil, BadAuthRequest("自定义请求头总大小不能超过 16KB")
		}
		seen[lowerName] = struct{}{}
		normalized = append(normalized, OutboundHeader{Name: name, Value: value})
	}
	return normalized, nil
}

func ApplyOutboundHeaders(req *http.Request, headers []OutboundHeader) {
	if req == nil {
		return
	}
	for _, item := range headers {
		req.Header.Set(item.Name, item.Value)
	}
}

func EncodeOutboundHeadersJSON(headers []OutboundHeader) (string, error) {
	normalized, err := NormalizeOutboundHeaders(headers)
	if err != nil {
		return "", err
	}
	data, err := json.Marshal(normalized)
	return string(data), err
}

func ParseOutboundHeadersJSON(raw string) ([]OutboundHeader, error) {
	if strings.TrimSpace(raw) == "" {
		return []OutboundHeader{}, nil
	}
	var headers []OutboundHeader
	if err := json.Unmarshal([]byte(raw), &headers); err != nil {
		return nil, errors.New("渠道自定义请求头配置损坏")
	}
	return NormalizeOutboundHeaders(headers)
}

func DecodeRelayOutboundHeaders(encoded string) ([]OutboundHeader, error) {
	if strings.TrimSpace(encoded) == "" {
		return []OutboundHeader{}, nil
	}
	if len(encoded) > (maxOutboundHeaderBytes*2)+1024 {
		return nil, BadAuthRequest("自定义请求头配置过大")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, BadAuthRequest("自定义请求头编码无效")
	}
	var headers []OutboundHeader
	if err := json.Unmarshal(data, &headers); err != nil {
		return nil, BadAuthRequest("自定义请求头格式无效")
	}
	return NormalizeOutboundHeaders(headers)
}

func validOutboundHeaderName(name string) bool {
	if name == "" {
		return false
	}
	for index := 0; index < len(name); index++ {
		char := name[index]
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || strings.ContainsRune("!#$%&'*+-.^_`|~", rune(char)) {
			continue
		}
		return false
	}
	return true
}

func validOutboundHeaderValue(value string) bool {
	for index := 0; index < len(value); index++ {
		char := value[index]
		if char == '\t' || char >= 32 && char != 127 {
			continue
		}
		return false
	}
	return true
}

func blockedOutboundHeader(name string) bool {
	switch name {
	case "authorization", "proxy-authorization", "cookie", "set-cookie", "host", "content-length", "content-type", "accept", "connection", "proxy-connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "forwarded", "x-goog-api-key":
		return true
	}
	return strings.HasPrefix(name, "x-canvas-") || strings.HasPrefix(name, "x-forwarded-")
}

func newOutboundTransport(resolveHost func(context.Context, string) ([]net.IP, error)) *http.Transport {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	return &http.Transport{
		DialContext: func(ctx context.Context, network string, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			addresses, err := resolveHost(ctx, host)
			if err != nil {
				return nil, err
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(addresses[0].String(), port))
		},
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		MaxIdleConnsPerHost:   20,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
}

func validateOutboundHost(host string) error {
	_, err := resolveOutboundHost(context.Background(), host)
	return err
}

func validateCustomRelayHost(host string) error {
	_, err := resolveCustomRelayHost(context.Background(), host)
	return err
}

func resolveOutboundHost(ctx context.Context, host string) ([]net.IP, error) {
	host = normalizeOutboundHost(host)
	return resolveOutboundHostWithPolicy(ctx, host, allowPrivateUpstreams() || allowedPrivateUpstreamHost(host))
}

func resolveCustomRelayHost(ctx context.Context, host string) ([]net.IP, error) {
	host = normalizeOutboundHost(host)
	allowPrivateHost := allowedPrivateUpstreamHost(host)
	addresses, err := resolveOutboundHostWithPolicy(ctx, host, allowPrivateHost)
	if err != nil {
		return nil, err
	}
	if !allowPrivateHost {
		for _, ip := range addresses {
			if blockedCustomRelayIP(ip) {
				return nil, BadAuthRequest("不允许访问保留地址或特殊用途地址")
			}
		}
	}
	return addresses, nil
}

func resolveOutboundHostWithPolicy(ctx context.Context, host string, allowPrivateHost bool) ([]net.IP, error) {
	if host == "" {
		return nil, BadAuthRequest("外部服务域名无效")
	}
	if !allowPrivateHost && (host == "localhost" || strings.HasSuffix(host, ".localhost")) {
		return nil, BadAuthRequest("不允许访问本机或内网地址")
	}
	addresses, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, BadAuthRequest("外部服务域名解析失败")
	}
	if len(addresses) == 0 {
		return nil, BadAuthRequest("外部服务域名没有可用地址")
	}
	if !allowPrivateHost {
		for _, ip := range addresses {
			if blockedOutboundIP(ip) {
				return nil, BadAuthRequest("不允许访问本机、内网或链路本地地址")
			}
		}
	}
	return addresses, nil
}

func blockedOutboundIP(ip net.IP) bool {
	return ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalMulticast() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.IsMulticast()
}

func blockedCustomRelayIP(ip net.IP) bool {
	if blockedOutboundIP(ip) {
		return true
	}
	address, ok := netip.AddrFromSlice(ip)
	if !ok {
		return true
	}
	address = address.Unmap()
	for _, prefix := range blockedCustomRelayPrefixes {
		if prefix.Contains(address) {
			return true
		}
	}
	return false
}

func allowPrivateUpstreams() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS")))
	return value == "1" || value == "true" || value == "yes"
}

// allowedPrivateUpstreamHost lets operators pin only explicitly trusted upstream
// hostnames to an internal route without disabling SSRF protection for every URL.
func allowedPrivateUpstreamHost(host string) bool {
	host = normalizeOutboundHost(host)
	if host == "" {
		return false
	}
	for _, configured := range strings.Split(os.Getenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS"), ",") {
		if normalizeOutboundHost(configured) == host {
			return true
		}
	}
	return false
}

func normalizeOutboundHost(host string) string {
	return strings.TrimSuffix(strings.ToLower(strings.TrimSpace(host)), ".")
}

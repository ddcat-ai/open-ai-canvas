package service

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"time"
)

const maxOutboundRedirects = 5

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

// 用户自定义渠道必须使用更严格的出口策略：只允许 HTTPS，不接受 URL 凭据，
// 仅部署者精确配置的主机可以路由到私网。
func ValidateCustomRelayURL(rawURL string) (*url.URL, error) {
	if len(strings.TrimSpace(rawURL)) > 4096 {
		return nil, BadAuthRequest("自定义渠道地址过长")
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" || !parsed.IsAbs() {
		return nil, BadAuthRequest("自定义渠道地址无效")
	}
	if parsed.Scheme != "https" {
		return nil, BadAuthRequest("自定义渠道中转只支持 HTTPS")
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

package service

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const maxOutboundRedirects = 5

var outboundTransport = newOutboundTransport()

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

func newOutboundTransport() *http.Transport {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	return &http.Transport{
		DialContext: func(ctx context.Context, network string, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			addresses, err := resolveOutboundHost(ctx, host)
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

func resolveOutboundHost(ctx context.Context, host string) ([]net.IP, error) {
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "" {
		return nil, BadAuthRequest("外部服务域名无效")
	}
	if !allowPrivateUpstreams() && (host == "localhost" || strings.HasSuffix(host, ".localhost")) {
		return nil, BadAuthRequest("不允许访问本机地址")
	}
	addresses, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
	if err != nil {
		return nil, BadAuthRequest("外部服务域名解析失败")
	}
	if len(addresses) == 0 {
		return nil, BadAuthRequest("外部服务域名没有可用地址")
	}
	if !allowPrivateUpstreams() {
		// 局域网地址用于连接自部署模型；默认仍阻止回环和链路本地等高风险目标。
		for _, ip := range addresses {
			if blockedOutboundIP(ip) {
				return nil, BadAuthRequest("不允许访问本机或链路本地地址")
			}
		}
	}
	return addresses, nil
}

func blockedOutboundIP(ip net.IP) bool {
	return ip == nil || ip.IsLoopback() || ip.IsLinkLocalMulticast() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.IsMulticast()
}

func allowPrivateUpstreams() bool {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS")))
	return value == "1" || value == "true" || value == "yes"
}

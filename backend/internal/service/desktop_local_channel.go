package service

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const LocalChannelRequestHeader = "X-Canvas-Allow-Local-Channel"
const LocalChannelBaseURLHeader = "X-Canvas-Upstream-Base-URL"

// RuntimeCapabilities 只来自后端启动配置，HTTP 请求不得修改这些能力。
type RuntimeCapabilities struct {
	desktopLocalChannels bool
}

func RuntimeCapabilitiesForDeployment(bindAddr string, desktopLocalChannelsSetting string) RuntimeCapabilities {
	if !truthyRuntimeCapability(desktopLocalChannelsSetting) || !isExplicitDesktopLoopbackBind(bindAddr) {
		return RuntimeCapabilities{}
	}
	return RuntimeCapabilities{desktopLocalChannels: true}
}

func truthyRuntimeCapability(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1", "true", "yes":
		return true
	default:
		return false
	}
}

func isExplicitDesktopLoopbackBind(bindAddr string) bool {
	host, port, err := net.SplitHostPort(strings.TrimSpace(bindAddr))
	if err != nil || host != "127.0.0.1" {
		return false
	}
	value, err := strconv.Atoi(port)
	return err == nil && value >= 1 && value <= 65535
}

func (s *Service) DesktopLocalChannelsEnabled() bool {
	return s != nil && s.runtimeCapabilities.desktopLocalChannels
}

func (s *Service) effectiveAllowLocalChannel(requested bool) bool {
	return requested && s.DesktopLocalChannelsEnabled()
}

type outboundLookup func(context.Context, string) ([]net.IP, error)

// OutboundPolicy 是独立的桌面 loopback 出口策略。它不读取任何 legacy private-upstream 环境变量。
type OutboundPolicy struct {
	lookup       outboundLookup
	loopbackOnly bool
}

func desktopLoopbackOutboundPolicy(lookup outboundLookup) OutboundPolicy {
	if lookup == nil {
		lookup = func(ctx context.Context, host string) ([]net.IP, error) {
			return net.DefaultResolver.LookupIP(ctx, "ip", host)
		}
	}
	return OutboundPolicy{lookup: lookup, loopbackOnly: true}
}

func validateOutboundURLWithPolicy(rawURL string, policy OutboundPolicy) (*url.URL, error) {
	if len(strings.TrimSpace(rawURL)) > 4096 {
		return nil, BadAuthRequest("外部服务地址过长")
	}
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Hostname() == "" || !parsed.IsAbs() {
		return nil, BadAuthRequest("外部服务地址无效")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, BadAuthRequest("外部服务地址只支持 http/https")
	}
	if parsed.User != nil {
		return nil, BadAuthRequest("外部服务地址不允许包含认证信息")
	}
	if parsed.Fragment != "" {
		return nil, BadAuthRequest("外部服务地址不允许包含片段")
	}
	if policy.loopbackOnly {
		if err := validateDesktopLoopbackPort(parsed); err != nil {
			return nil, err
		}
		if _, err := resolveDesktopLoopbackHost(context.Background(), parsed.Hostname(), policy.lookup); err != nil {
			return nil, err
		}
	}
	return parsed, nil
}

func validateDesktopLoopbackPort(parsed *url.URL) error {
	if parsed == nil || strings.HasSuffix(parsed.Host, ":") {
		return BadAuthRequest("外部服务地址端口无效")
	}
	port := parsed.Port()
	if port == "" {
		return nil
	}
	for _, char := range port {
		if char < '0' || char > '9' {
			return BadAuthRequest("外部服务地址端口无效")
		}
	}
	value, err := strconv.Atoi(port)
	if err != nil || value < 1 || value > 65535 {
		return BadAuthRequest("外部服务地址端口无效")
	}
	return nil
}

func resolveDesktopLoopbackHost(ctx context.Context, host string, lookup outboundLookup) ([]net.IP, error) {
	if host == "127.0.0.1" {
		return []net.IP{net.ParseIP("127.0.0.1")}, nil
	}
	if !strings.EqualFold(host, "localhost") {
		return nil, BadAuthRequest("不允许访问本机、内网或链路本地地址")
	}
	addresses, err := lookup(ctx, host)
	if err != nil {
		return nil, BadAuthRequest("外部服务域名解析失败")
	}
	if len(addresses) == 0 {
		return nil, BadAuthRequest("外部服务域名没有可用地址")
	}
	for _, ip := range addresses {
		if ip == nil || !ip.IsLoopback() {
			return nil, BadAuthRequest("不允许访问本机、内网或链路本地地址")
		}
	}
	return addresses, nil
}

func outboundHTTPClientWithPolicy(timeout time.Duration, policy OutboundPolicy) *http.Client {
	return &http.Client{
		Transport: newOutboundTransportWithPolicy(policy),
		Timeout:   timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("本机渠道不允许重定向")
		},
	}
}

func newOutboundTransportWithPolicy(policy OutboundPolicy) *http.Transport {
	dialer := &net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}
	return &http.Transport{
		DialContext: func(ctx context.Context, network string, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			addresses, err := resolveDesktopLoopbackHost(ctx, host, policy.lookup)
			if err != nil {
				return nil, err
			}
			var lastErr error
			for _, ip := range addresses {
				connection, dialErr := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if dialErr == nil {
					return connection, nil
				}
				lastErr = dialErr
				if ctx.Err() != nil {
					return nil, ctx.Err()
				}
			}
			return nil, lastErr
		},
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          20,
		MaxIdleConnsPerHost:   10,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   15 * time.Second,
		ExpectContinueTimeout: time.Second,
	}
}

func isExactDesktopLoopbackHost(host string) bool {
	return host == "127.0.0.1" || strings.EqualFold(host, "localhost")
}

func ValidateCustomRelayChannelURL(rawURL string, configuredBaseURL string, requestedAllowLocal bool, desktopLocalChannelsEnabled bool) (*url.URL, error) {
	svc := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: desktopLocalChannelsEnabled}}
	target, err := svc.validateChannelOutboundURL(rawURL, requestedAllowLocal, true)
	if err != nil || !requestedAllowLocal || !desktopLocalChannelsEnabled || target == nil || !isExactDesktopLoopbackHost(target.Hostname()) {
		return target, err
	}
	base, err := svc.validateChannelOutboundURL(configuredBaseURL, true, true)
	if err != nil {
		return nil, err
	}
	if !sameOutboundOrigin(base, target) {
		return nil, BadAuthRequest("本机渠道请求必须与配置的 Base URL 同源")
	}
	return target, nil
}

func sameOutboundOrigin(left *url.URL, right *url.URL) bool {
	if left == nil || right == nil {
		return false
	}
	return strings.EqualFold(left.Scheme, right.Scheme) && strings.EqualFold(left.Host, right.Host)
}

func CustomRelayHTTPClientForChannel(timeout time.Duration, target *url.URL, requestedAllowLocal bool, desktopLocalChannelsEnabled bool) *http.Client {
	if requestedAllowLocal && desktopLocalChannelsEnabled && target != nil && isExactDesktopLoopbackHost(target.Hostname()) {
		return outboundHTTPClientWithPolicy(timeout, desktopLoopbackOutboundPolicy(nil))
	}
	return CustomRelayHTTPClient(timeout)
}

func (s *Service) ValidateChannelOutboundURL(rawURL string, requestedAllowLocal bool, customRelay bool) (*url.URL, error) {
	return s.validateChannelOutboundURL(rawURL, requestedAllowLocal, customRelay)
}

func (s *Service) OutboundHTTPClientForChannel(timeout time.Duration, target *url.URL, requestedAllowLocal bool) *http.Client {
	if s.effectiveAllowLocalChannel(requestedAllowLocal) && target != nil && isExactDesktopLoopbackHost(target.Hostname()) {
		return outboundHTTPClientWithPolicy(timeout, desktopLoopbackOutboundPolicy(nil))
	}
	return OutboundHTTPClient(timeout)
}

func (s *Service) validateChannelOutboundURL(rawURL string, requestedAllowLocal bool, customRelay bool) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if requestedAllowLocal {
		if !s.effectiveAllowLocalChannel(true) {
			return nil, BadAuthRequest("不允许访问本机、内网或链路本地地址")
		}
		return validateOutboundURLWithPolicy(rawURL, desktopLoopbackOutboundPolicy(nil))
	}
	if err == nil && isExactDesktopLoopbackHost(parsed.Hostname()) {
		return nil, BadAuthRequest("不允许访问本机、内网或链路本地地址")
	}
	if customRelay {
		return ValidateCustomRelayURL(rawURL)
	}
	return ValidateOutboundURL(rawURL)
}

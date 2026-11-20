package outbound

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

var mcpTransport = newMCPTransport()

func allowedPrivateMCPHost(host string) bool {
	host = normalizeOutboundHost(host)
	if host == "" {
		return false
	}
	for _, configured := range strings.Split(os.Getenv("CANVAS_MCP_ALLOWED_PRIVATE_HOSTS"), ",") {
		if normalizeOutboundHost(configured) == host {
			return true
		}
	}
	return false
}

func resolveMCPHost(ctx context.Context, host string) ([]net.IP, error) {
	host = normalizeOutboundHost(host)
	trusted := allowedPrivateMCPHost(host)
	addresses, err := resolveOutboundHostWithPolicy(ctx, host, trusted)
	if err != nil {
		return nil, err
	}
	if !trusted {
		for _, ip := range addresses {
			if blockedCustomRelayIP(ip) {
				return nil, BadAuthRequest("MCP 不允许访问本机、私网或保留地址")
			}
		}
	}
	return addresses, nil
}

func ValidateMCPURL(ctx context.Context, raw string) (*url.URL, error) {
	if len(raw) > 4096 {
		return nil, BadAuthRequest("MCP 地址过长")
	}
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" || !parsed.IsAbs() || parsed.User != nil || parsed.Fragment != "" {
		return nil, BadAuthRequest("MCP 地址无效或包含认证信息、片段")
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && allowedPrivateMCPHost(parsed.Hostname())) {
		return nil, BadAuthRequest("MCP 必须使用 HTTPS；HTTP 仅允许 MCP 独立白名单内的主机")
	}
	if _, err := resolveMCPHost(ctx, parsed.Hostname()); err != nil {
		return nil, err
	}
	return parsed, nil
}

func newMCPTransport() *http.Transport {
	transport := newOutboundTransport(resolveMCPHost)
	// An environment proxy can resolve a different/private target after local
	// validation. MCP always dials the validated IP and has no proxy exception.
	transport.Proxy = nil
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		addresses, err := resolveMCPHost(ctx, host)
		if err != nil {
			return nil, err
		}
		return dialer.DialContext(ctx, network, net.JoinHostPort(addresses[0].String(), port))
	}
	transport.MaxConnsPerHost = 16
	return transport
}

func MCPHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{Transport: mcpTransport, Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("MCP 请求不允许重定向")
	}}
}

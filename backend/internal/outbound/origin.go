package outbound

import (
	"net"
	"net/url"
	"strconv"
	"strings"
)

// NormalizeOrigin 把 http(s) 地址规范成 scheme://host[:port]（省略默认端口），用于白名单比对。
// allowPath 为 false 时只接受 origin 本身，用于校验管理员填写的白名单项。
func NormalizeOrigin(raw string, allowPath bool) (string, error) {
	raw = strings.TrimSpace(raw)
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Hostname() == "" || (!allowPath && strings.ContainsAny(raw, "*\\")) {
		return "", BadAuthRequest("地址必须是完整的 http(s) origin，例如 https://api.example.com")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "https" && scheme != "http" {
		return "", BadAuthRequest("地址只支持 http/https")
	}
	if parsed.User != nil {
		return "", BadAuthRequest("地址不允许包含认证信息")
	}
	if !allowPath && ((parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.ForceQuery || parsed.Fragment != "") {
		return "", BadAuthRequest("只填写 origin，不能包含路径、查询参数或片段")
	}
	host := normalizeOutboundHost(parsed.Hostname())
	port := parsed.Port()
	if port != "" {
		number, err := strconv.Atoi(port)
		if err != nil || number < 1 || number > 65535 {
			return "", BadAuthRequest("地址端口无效")
		}
		port = strconv.Itoa(number)
		if (scheme == "https" && number == 443) || (scheme == "http" && number == 80) {
			port = ""
		}
	}
	if port == "" {
		if strings.Contains(host, ":") {
			return scheme + "://[" + host + "]", nil
		}
		return scheme + "://" + host, nil
	}
	return scheme + "://" + net.JoinHostPort(host, port), nil
}

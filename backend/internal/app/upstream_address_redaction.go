package app

import (
	"regexp"
	"strings"
)

// 用户可见文本（任务错误、退款原因、积分流水备注）会随 API 回传到浏览器，
// 不能出现上游地址。原始内容仍写入请求日志和任务诊断，管理员按需排查。
const (
	upstreamAddressLinkPlaceholder = "[链接已隐藏]"
	upstreamAddressHostPlaceholder = "[地址已隐藏]"
)

var (
	// 网络错误的地址常以 dial/read/write tcp <addr> 形式出现，保留动词前缀，
	// 前端据此继续把这条失败归类成网络异常。
	upstreamNetworkOperation = regexp.MustCompile(`(?i)\b(?:dial|read|write|proxyconnect)\s+tcp\s+\S+`)
	upstreamIPv4Address      = regexp.MustCompile(`\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b`)
)

// redactUpstreamAddress 隐藏文本里的上游 URL、IP 和网络操作地址。
// URL 复用请求明细的 [链接已隐藏] 约定，保持用户可见文案与后台日志同一套措辞。
func redactUpstreamAddress(text string) string {
	if strings.TrimSpace(text) == "" {
		return text
	}
	text = providerErrorURL.ReplaceAllString(text, upstreamAddressLinkPlaceholder)
	text = upstreamNetworkOperation.ReplaceAllStringFunc(text, func(match string) string {
		fields := strings.Fields(match)
		if len(fields) >= 2 {
			return fields[0] + " " + fields[1] + " " + upstreamAddressHostPlaceholder + ":"
		}
		return upstreamAddressHostPlaceholder
	})
	return upstreamIPv4Address.ReplaceAllString(text, upstreamAddressHostPlaceholder)
}

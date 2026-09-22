package app

import (
	"encoding/json"
	"regexp"
	"strings"
)

var providerErrorURL = regexp.MustCompile(`(?i)https?://[^\s<>"'，。；）]+`)
var providerErrorSensitive = regexp.MustCompile(`(?i)余额|额度|配额|欠费|账单|充值|计费|密钥|密码|令牌|balance|quota|billing|credit|payment|funds|wallet|api[ _-]?key|authorization|bearer|cookie|(?:access|refresh|auth|session)[ _-]?token|token\s*[=:]|secret|password|credential|sk-[a-z0-9]|tenant|trace[ _-]?id|request[ _-]?id|internal stack|stack\s*trace|dial tcp|no such host|prompt\s*[=:]`)

// 只提取错误消息字段，不序列化整个响应，避免回传 headers、请求正文和诊断信息。
func providerErrorDetail(raw string) string {
	raw = strings.TrimSpace(raw)
	var payload any
	if json.Unmarshal([]byte(raw), &payload) == nil {
		raw = providerErrorMessageField(payload)
	} else if strings.HasPrefix(raw, "{") || strings.HasPrefix(raw, "[") {
		return ""
	}
	// 网关 HTML、敏感账务/凭据诊断整条隐藏；普通消息里的 URL 单独移除。
	if strings.HasPrefix(raw, "{") || strings.HasPrefix(raw, "[") || strings.ContainsAny(raw, "<>") || providerErrorSensitive.MatchString(raw) {
		return ""
	}
	raw = providerErrorURL.ReplaceAllString(raw, "[链接已隐藏]")
	return truncateRunes(strings.Join(strings.Fields(raw), " "), 1_500)
}

func providerErrorMessageField(value any) string {
	switch value := value.(type) {
	case string:
		return strings.TrimSpace(value)
	case map[string]any:
		for _, key := range []string{"error", "message", "msg", "detail"} {
			if message := providerErrorMessageField(value[key]); message != "" {
				return message
			}
		}
	}
	return ""
}

func providerErrorWithDetail(fallback, raw string) string {
	if message, ok := providerPayloadErrorCategory(raw); ok {
		fallback = message
	}
	return appendProviderErrorDetail(fallback, raw)
}

func appendProviderErrorDetail(fallback, raw string) string {
	if detail := providerErrorDetail(raw); detail != "" && detail != fallback {
		return fallback + "；上游：" + detail
	}
	return fallback
}

package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

const contentModerationErrorCode = "sensitive_words_detected"

const contentModerationRetryMessage = "内容审核未通过，请修改提示词后重新生成；原任务不能直接重试"

// 只提取供应商明确返回的错误码和短消息，避免把完整响应或用户输入复制到调用日志。
func providerFailureDetails(payload map[string]any) (string, string) {
	candidates := make([]map[string]any, 0, 3)
	for _, key := range []string{"error", "data"} {
		if nested, ok := payload[key].(map[string]any); ok {
			candidates = append(candidates, nested)
		}
	}
	// 内层通常是供应商业务错误，外层 code 可能只是 HTTP 包装码。
	candidates = append(candidates, payload)
	code := ""
	message := ""
	for _, candidate := range candidates {
		if code == "" {
			code = normalizedProviderErrorCode(candidate["code"])
		}
		if message == "" {
			message = strings.TrimSpace(stringField(candidate, "message"))
			if message == "" {
				message = strings.TrimSpace(stringField(candidate, "msg"))
			}
		}
	}
	return code, truncateRunes(message, 500)
}

func providerResponseBusinessFailure(responseBody []byte) (string, string, bool) {
	if len(responseBody) == 0 {
		return "", "", false
	}
	var payload map[string]any
	if json.Unmarshal(responseBody, &payload) != nil {
		return "", "", false
	}
	return providerPayloadBusinessFailure(payload)
}

func providerPayloadBusinessFailure(payload map[string]any) (string, string, bool) {
	if errorValue, ok := payload["error"].(map[string]any); ok {
		code, message := providerFailureDetails(map[string]any{"error": errorValue})
		if code != "" || message != "" {
			return code, message, true
		}
	}
	if !providerBusinessCodeFailed(payload["code"]) {
		return "", "", false
	}
	code, message := providerFailureDetails(payload)
	return code, message, true
}

func providerBusinessCodeFailed(value any) bool {
	code := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	switch code {
	case "", "0", "success", "succeeded", "ok", "<nil>":
		return false
	default:
		return true
	}
}

func normalizedProviderErrorCode(value any) string {
	var code string
	switch current := value.(type) {
	case string:
		code = current
	case fmt.Stringer:
		code = current.String()
	case float64:
		if current != 0 {
			code = fmt.Sprintf("%g", current)
		}
	case int:
		if current != 0 {
			code = fmt.Sprintf("%d", current)
		}
	case int64:
		if current != 0 {
			code = fmt.Sprintf("%d", current)
		}
	}
	code = strings.TrimSpace(code)
	if code == "0" {
		return ""
	}
	return truncateRunes(code, 80)
}

func isContentModerationFailure(value string) bool {
	return strings.Contains(strings.ToLower(value), contentModerationErrorCode)
}

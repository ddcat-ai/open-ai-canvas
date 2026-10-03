package app

import (
	"encoding/json"
	"errors"
	"log"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
)

// 这组函数与前端 web/src/lib/generation-error.ts 的 generationErrorMessage 保持同一套分类，
// 让画布节点和 Agent 对同一个失败说同一句话：审核、存储、网络、HTTP 状态分别归类，
// 其余可读的供应商原因原样保留，而不是统一成"生成失败"。

const (
	taskErrorModerationMessage = "内容审核未通过，本次平台积分未扣除或已退还。请修改提示词后重新生成。"
	taskErrorDefaultMessage    = "生成失败，请稍后重试。"
	taskErrorNetworkMessage    = "网络异常。"
)

var (
	taskErrorNetworkPattern        = regexp.MustCompile(`(?i)\b(?:dial tcp|connection refused|connection reset|no such host|i/o timeout|context deadline exceeded|network error|failed to fetch|fetch failed|socket hang up|econnrefused|econnreset|etimedout|broken pipe|unexpected eof|tls handshake timeout)\b`)
	taskErrorInfrastructurePattern = regexp.MustCompile(`(?i)(?:接口请求失败|Request failed with status code|https?://|\b(?:GET|POST|PUT|PATCH|DELETE)\s+["']?|Bad Gateway|Service Unavailable|Gateway Timeout|upstream_error|\bread tcp\b|\bwrite tcp\b)`)
	taskErrorWrappedInterface      = regexp.MustCompile(`(?s)^接口请求失败[:：]\s*(.*)$`)
	taskErrorWrappedRequest        = regexp.MustCompile(`(?is)^Request failed with status code \d{3}\s*[:：-]?\s*(.+)$`)
	taskErrorWrappedStatusPrefix   = regexp.MustCompile(`(?i)^\d{3}(?:\s+(?:Bad Gateway|Service Unavailable|Gateway Timeout|Internal Server Error|Not Found|Unauthorized|Forbidden|Too Many Requests))?\s*[:：-]?\s*`)
	taskErrorStorageDisabled       = regexp.MustCompile(`(?i)\bUserDisable\b`)
	taskErrorStorageUpload         = regexp.MustCompile(`(?i)(?:参考(?:图片|媒体)上传失败|OSS 上传失败|对象存储|腾讯云 COS|七牛云)`)
	taskErrorModelCapability       = regexp.MustCompile(`所选模型不支持当前请求|模型不支持当前请求|不支持操作\s+|能力类型不匹配`)
	taskErrorModelParameters       = regexp.MustCompile(`不支持参数|超出支持范围|数量需在|至少需要\s+\d+\s+个|暂时无法满足这组输入和参数`)
	taskErrorTechnicalProvider    = regexp.MustCompile(`(?i)(?:provider request failed|invalid_request_error|internal_server_error|bad_request|unauthorized|forbidden|not_found|upstream_error|request failed with status code|http\s*\d{3})`)
)

// userFacingTaskError 把任务里保存的原始错误转换成用户能看懂的中文原因。
func userFacingTaskError(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return taskErrorDefaultMessage
	}
	if taskErrorIsModeration(raw) {
		return taskErrorModerationText(raw)
	}
	providerMessage := taskErrorStructuredProviderMessage(raw)
	if providerMessage == "" {
		providerMessage = taskErrorWrappedProviderMessage(raw)
	}
	display := raw
	if providerMessage != "" {
		display = providerMessage
	}
	if taskErrorIsModeration(display) {
		return taskErrorModerationText(display)
	}
	if message := taskErrorStorageMessage(raw); message != "" {
		return message
	}
	if message := taskErrorStorageMessage(display); message != "" {
		return message
	}
	if taskErrorNetworkPattern.MatchString(display) {
		return taskErrorNetworkMessage
	}
	if taskErrorModelCapability.MatchString(display) {
		return "所选模型不支持当前生成方式或输入，请切换模型或调整输入后重试。"
	}
	if taskErrorModelParameters.MatchString(display) {
		return "当前模型不支持这组参数或参考素材，请调整输入或切换模型后重试。"
	}
	if taskErrorTechnicalProvider.MatchString(display) {
		return "模型服务处理失败，请稍后重试或换用其他模型。"
	}
	if providerMessage == "" {
		if !strings.Contains(display, "；上游：") {
			switch {
			case taskErrorHasStatus(raw, "429"):
				return "服务当前繁忙，请稍后重试。"
			case taskErrorHasStatus(raw, "401", "403"):
				return "生成服务鉴权失败，请检查渠道配置。"
			case taskErrorHasStatus(raw, "404"):
				return "生成服务地址不可用，请检查渠道配置。"
			case taskErrorHasStatus(raw, "500", "502", "503", "504"):
				return taskErrorNetworkMessage
			}
		}
		if taskErrorInfrastructurePattern.MatchString(raw) {
			return taskErrorNetworkMessage
		}
	}
	return truncateRunes(display, 240)
}

// userFacingTaskFailure 给任务失败加上"哪一步失败"的前缀，例如"图片生成失败：网络异常。"
func userFacingTaskFailure(task *model.Task) string {
	if task == nil {
		return "任务失败：" + taskErrorDefaultMessage
	}
	reason := userFacingTaskError(task.Error)
	if task.Status == model.TaskStatusCancelled && strings.TrimSpace(task.Error) == "" {
		reason = "任务已取消"
	}
	return userFacingTaskKind(task) + "失败：" + reason
}

func userFacingTaskKind(task *model.Task) string {
	switch {
	case task.Operation == cloudAgentStepOperation || task.Operation == cloudAgentOperation || task.Operation == cloudAgentContextCompactionOperation:
		return "模型调用"
	case task.Type == "canvas_image" || strings.Contains(task.Type, "image"):
		return "图片生成"
	case task.Type == "canvas_video" || strings.HasPrefix(task.Type, "video_") || strings.Contains(task.Type, "video"):
		return "视频生成"
	case strings.Contains(task.Type, "audio"):
		return "音频生成"
	case task.Type == "canvas_text":
		return "文本生成"
	}
	return "任务"
}

// cloudAgentUserFailureMessage 决定 Agent 运行失败时展示给用户的文字。
// 已经是中文、可读的原因（业务错误、任务失败原因）原样展示；内部英文诊断只写日志，
// 用户看到的是可操作的中文提示和诊断号，不会看到 Go/Node 的原始报错。
func cloudAgentUserFailureMessage(runID string, cause error) string {
	if cause == nil {
		return "Agent 执行中断，请重新发送消息"
	}
	var appErr *AppError
	if errors.As(cause, &appErr) && appErr != nil && cloudAgentReadableMessage(appErr.Message) {
		return strings.TrimSpace(appErr.Message)
	}
	if message := cloudAgentInnermostMessage(cause); cloudAgentReadableMessage(message) {
		return message
	}
	log.Printf("[Agent] internal failure run=%s: %v", runID, cause)
	return "Agent 执行中断，请重新发送消息；如反复出现，请把诊断号 " + runID + " 反馈给管理员"
}

// cloudAgentInnermostMessage 沿包装链找到最内层的错误文字。包装前缀（"load session: "
// 之类）是给日志看的内部上下文，不展示给用户。
func cloudAgentInnermostMessage(err error) string {
	for err != nil {
		next := errors.Unwrap(err)
		if next == nil {
			return strings.TrimSpace(err.Error())
		}
		err = next
	}
	return ""
}

// cloudAgentReadableMessage 只放行"以中文为主、不含地址/堆栈/凭证"的文字。
func cloudAgentReadableMessage(message string) bool {
	message = strings.TrimSpace(message)
	if message == "" || !utf8.ValidString(message) || strings.ContainsAny(message, "\r\n\x00") {
		return false
	}
	han, letters := 0, 0
	for _, r := range message {
		switch {
		case unicode.Is(unicode.Han, r):
			han++
		case r < unicode.MaxASCII && unicode.IsLetter(r):
			letters++
		}
	}
	if han == 0 || letters > han*2 {
		return false
	}
	return safeTaskDiagnosticMessage(message) == truncateRunes(message, 240) && !taskErrorInfrastructurePattern.MatchString(message) && !taskErrorNetworkPattern.MatchString(message)
}

func taskErrorIsModeration(value string) bool {
	return strings.Contains(strings.ToLower(value), "sensitive_words_detected") || strings.Contains(value, "内容审核未通过")
}

func taskErrorModerationText(raw string) string {
	if index := strings.Index(raw, "；上游："); index >= 0 && !taskErrorInfrastructurePattern.MatchString(raw) {
		return taskErrorModerationMessage + raw[index:]
	}
	return taskErrorModerationMessage
}

func taskErrorStorageMessage(value string) string {
	switch {
	case value == "":
		return ""
	case taskErrorStorageDisabled.MatchString(value):
		return "对象存储账号已停用，请检查或更换对象存储配置。"
	case taskErrorStorageUpload.MatchString(value):
		return "参考素材上传到对象存储失败，请检查对象存储配置后重试。"
	}
	return ""
}

func taskErrorHasStatus(value string, statuses ...string) bool {
	for _, status := range statuses {
		if regexp.MustCompile(`\b` + status + `\b`).MatchString(value) {
			return true
		}
	}
	return false
}

func taskErrorStructuredProviderMessage(raw string) string {
	for index := strings.Index(raw, "{"); index >= 0; {
		var payload any
		if json.Unmarshal([]byte(strings.TrimSpace(raw[index:])), &payload) == nil {
			if message := taskErrorPayloadMessage(payload); message != "" {
				return message
			}
		}
		next := strings.Index(raw[index+1:], "{")
		if next < 0 {
			break
		}
		index += next + 1
	}
	return ""
}

func taskErrorWrappedProviderMessage(raw string) string {
	var wrapped string
	if match := taskErrorWrappedInterface.FindStringSubmatch(raw); match != nil {
		wrapped = match[1]
	} else if match := taskErrorWrappedRequest.FindStringSubmatch(raw); match != nil {
		wrapped = match[1]
	} else {
		return ""
	}
	message := strings.TrimSpace(taskErrorWrappedStatusPrefix.ReplaceAllString(wrapped, ""))
	if message == "" || taskErrorInfrastructurePattern.MatchString(message) {
		return ""
	}
	return message
}

func taskErrorPayloadMessage(payload any) string {
	switch value := payload.(type) {
	case string:
		return strings.TrimSpace(value)
	case map[string]any:
		if nested, ok := value["error"].(map[string]any); ok {
			if message := taskErrorPayloadMessage(nested); message != "" {
				return message
			}
		}
		for _, key := range []string{"message", "msg", "detail"} {
			if text, ok := value[key].(string); ok && strings.TrimSpace(text) != "" {
				return strings.TrimSpace(text)
			}
		}
		if text, ok := value["error"].(string); ok {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

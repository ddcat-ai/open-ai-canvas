// 供应商调用的错误类型与用户可读文案。
//
// 原始上游错误（状态码、响应体片段）只进诊断与调用日志；返回给用户的文案按类别归一，
// 不泄露密钥、内部地址或冗长响应体。

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

type providerError struct {
	Message string `json:"message"`
}

// providerPayloadError 在进程内保留上游原始原因，供协议兼容分支做机器判断；
// 对调用方只暴露经过过滤的错误原因。Provider 正文可能包含密钥或内部诊断，
// 禁止原样进入用户错误和日志。
type providerPayloadError struct {
	raw     string
	message string
}

func (e providerPayloadError) Error() string { return e.message }

type providerHTTPError struct {
	StatusCode int
	Status     string
	Body       string
	RetryAfter time.Duration
}

type providerResponseDecodeError struct {
	Err error
}

func (e providerResponseDecodeError) Error() string { return e.Err.Error() }

func (e providerResponseDecodeError) Unwrap() error { return e.Err }

type providerCircuitOpenError struct{}

func (providerCircuitOpenError) Error() string {
	return "当前渠道连续失败，已暂时熔断，请稍后重试"
}

type providerStatePendingError struct {
	TaskID string
	Cause  error
}

func (e providerStatePendingError) Error() string {
	return fmt.Sprintf("上游任务状态尚未同步，将继续查询原任务（任务 %s）", e.TaskID)
}

func (e providerStatePendingError) Unwrap() error { return e.Cause }

type providerAnalyticsKey struct{}

type providerAnalyticsContext struct {
	Service           *Service
	Billing           taskBillingLifecycle
	UserID            string
	TaskID            string
	TraceID           string
	RequestID         string
	BillingOrderID    string
	BillingMode       string
	Capability        string
	Operation         string
	ChannelID         string
	Model             string
	VideoSeconds      int
	RequestKind       string
	ProviderRequestID string
	ConcurrencyLimit  int
}

func withProviderAnalytics(ctx context.Context, service *Service, task model.Task) context.Context {
	metadata := providerAnalyticsContext{Service: service, UserID: task.UserID, TaskID: task.ID, TraceID: task.TraceID, RequestID: task.RequestID, BillingOrderID: task.BillingOrderID, Capability: capabilityFromTaskType(task.Type), Operation: task.Operation, Model: task.Model, ProviderRequestID: task.ProviderRequestID}
	if service != nil {
		metadata.Billing = service.taskBilling()
	}
	// 账单模式随请求上下文传递，流式协议据此只为 Token 计费开启 usage 终态块。
	if service != nil && task.BillingOrderID != "" {
		if order, err := service.repo.BillingOrder(task.BillingOrderID); err == nil {
			metadata.BillingMode = order.BillingMode
		}
	}
	var input struct {
		Mode   string         `json:"mode"`
		Config providerConfig `json:"config"`
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) == nil {
		metadata.ChannelID = firstNonEmpty(input.Config.ChannelID, systemChannelIDFromBaseURL(input.Config.BaseURL))
		metadata.Model = firstNonEmpty(input.Config.ChannelModelKey, input.Config.Model, metadata.Model)
		metadata.VideoSeconds, _ = strconv.Atoi(input.Config.VideoSeconds)
		if normalized := normalizeCapability(input.Mode); normalized != "" {
			metadata.Capability = normalized
		}
	}
	return context.WithValue(ctx, providerAnalyticsKey{}, metadata)
}

func resumedProviderRequestID(ctx context.Context) string {
	metadata, _ := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	return strings.TrimSpace(metadata.ProviderRequestID)
}

func withProviderRequestKind(ctx context.Context, requestKind string) context.Context {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok {
		return ctx
	}
	metadata.RequestKind = requestKind
	return context.WithValue(ctx, providerAnalyticsKey{}, metadata)
}

func (e providerHTTPError) Error() string {
	if e.StatusCode == http.StatusBadRequest || e.StatusCode == http.StatusUnprocessableEntity {
		return providerErrorWithDetail(e.summary(), e.Body)
	}
	if message := speechResourceDeniedUserMessage(e.Body); (e.StatusCode == http.StatusUnauthorized || e.StatusCode == http.StatusForbidden) && message != "" {
		return message
	}
	return appendProviderErrorDetail(e.summary(), e.Body)
}

const volcengineSpeechResourceDeniedMessage = "语音合成服务未开通，或音色与模型版本不匹配。请在火山引擎控制台开通语音合成 1.0，并确认当前音色属于这一版本"

func speechResourceDeniedUserMessage(raw string) string {
	if strings.Contains(strings.ToLower(raw), "requested resource not granted") {
		return volcengineSpeechResourceDeniedMessage
	}
	return ""
}

func (e providerHTTPError) summary() string {
	switch e.StatusCode {
	case 524:
		return "上游网关超时（524）：模型请求可能仍在服务端执行并产生费用，请勿立即重试，请先到供应商后台核对任务或账单"
	case http.StatusBadRequest, http.StatusUnprocessableEntity:
		return "模型服务拒绝了请求，请检查模型和参数"
	case http.StatusUnauthorized, http.StatusForbidden:
		return "模型服务鉴权失败，请检查 API Key 和模型权限"
	case http.StatusNotFound:
		return "模型或模型接口不存在，请检查渠道配置"
	case http.StatusRequestTimeout, http.StatusGatewayTimeout:
		return "模型服务响应超时，请稍后重试"
	case http.StatusTooManyRequests:
		return "模型服务请求过于频繁或额度不足，请稍后重试"
	}
	if e.StatusCode >= http.StatusInternalServerError {
		return fmt.Sprintf("模型服务暂时不可用（HTTP %d）", e.StatusCode)
	}
	return fmt.Sprintf("模型服务请求失败（HTTP %d）", e.StatusCode)
}

func providerUserFacingErrorMessage(err error) string {
	if err == nil {
		return "模型服务请求失败"
	}
	if errors.Is(err, context.Canceled) {
		return "模型请求已取消"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "模型服务响应超时，请稍后重试"
	}
	var appErr *AppError
	if errors.As(err, &appErr) && strings.TrimSpace(appErr.Message) != "" {
		return appErr.Message
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.Error()
	}
	return "连接模型服务失败，请检查渠道地址和网络"
}

// providerPayloadErrorCategory 把上游失败正文归类为固定的用户可见原因。
// 第二个返回值为 false 表示正文无法归类，调用方应退回到更通用的提示，
// 不要因为归类失败就把正文本身当作错误信息。
// 正文可能包含密钥或内部诊断信息，只能参与归类，不得回传用户或写入日志。
func providerPayloadErrorCategory(raw string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	if normalized == "" {
		return "", false
	}
	switch {
	// 真人肖像类目只匹配供应商错误码里的稳定标识，不扫描自然语言。
	// 正文常常回显用户提示词，"likeness"、"肖像"这类词单独出现并不能证明
	// 上游是因为真人形象拒绝，按词判断会把普通参数错误误报成肖像问题。
	// 该类目排在安全审核之前：错误码已经足够具体，比通用审核提示更可行动。
	case strings.Contains(normalized, "privacyinformation"), strings.Contains(normalized, "sensitivecontentdetected"):
		return "输入素材疑似包含真人形象，该模型拒绝生成，请更换为非真人素材或改用其他模型", true
	case strings.Contains(normalized, "safety"), strings.Contains(normalized, "moderation"), strings.Contains(normalized, "content policy"), strings.Contains(normalized, "blocked"):
		return "请求内容未通过模型服务安全审核，请调整后重试", true
	// 工具调用与工具结果不配对：上游要求 assistant 消息声明的每一个 tool_call_id 都在
	// 紧随其后的 tool 消息里被回应。这是**我们组装请求**的问题——用户改提示词或查额度
	// 都没用——所以文案指向反馈而不是"调整输入"。
	//
	// 必须排在额度类目之前：DeepSeek 的原文含 "insufficient"，
	// "An assistant message with 'tool_calls' must be followed by tool messages
	// responding to each 'tool_call_id'. (insufficient tool messages following
	// tool_calls message)" 落到额度类目就会把协议错误报成"渠道余额不足"，
	// 掩盖真正的原因（历史里的工具结果不连续）。
	case strings.Contains(normalized, "must be followed by tool messages"),
		strings.Contains(normalized, "insufficient tool messages following"):
		return "会话里的工具调用与结果不匹配，本轮已停止；这不是额度或提示词问题，如反复出现请反馈", true
	case strings.Contains(normalized, "quota"), strings.Contains(normalized, "insufficient"), strings.Contains(normalized, "balance"), strings.Contains(normalized, "billing"):
		return "模型服务额度不足，请检查渠道余额或配额", true
	case strings.Contains(normalized, "model") && (strings.Contains(normalized, "not found") || strings.Contains(normalized, "permission") || strings.Contains(normalized, "access")):
		return "模型不存在或当前渠道未获得模型权限", true
	// 推理/思考模式模型通常禁止强制指定工具调用：DeepSeek 思考模式返回
	// "Thinking mode does not support this tool_choice"，其他 OpenAI 兼容
	// 供应商措辞类似。归为固定可行动原因；显式思考模式会在出站前省略
	// tool_choice，未声明但由上游隐式开启思考时再按兼容序列重试。排在
	// 通用参数类目之前，避免稳定标识落回笼统的"请检查模型和参数"。
	case (strings.Contains(normalized, "thinking") || strings.Contains(normalized, "reasoning")) && strings.Contains(normalized, "tool_choice"),
		strings.Contains(normalized, "tool_choice") && (strings.Contains(normalized, "not support") || strings.Contains(normalized, "unsupported")):
		return "当前模型为思考/推理模式，不支持强制工具调用（tool_choice=required），请改用自动工具选择或更换非思考模式模型", true
	case strings.Contains(normalized, "invalid"), strings.Contains(normalized, "parameter"), strings.Contains(normalized, "argument"):
		return "模型服务拒绝了请求，请检查模型和参数", true
	}
	return "", false
}

func providerPayloadErrorMessage(raw string) string {
	return providerErrorWithDetail("模型服务返回失败，请检查请求内容或渠道配置", raw)
}

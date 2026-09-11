package app

// Provider 出站 HTTP、multipart 与媒体字节读取。

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platform"
)

func postGeminiJSON(ctx context.Context, config providerConfig, path string, body interface{}, target interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("序列化上游请求失败：%w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, geminiVeoURL(config.BaseURL, path), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("x-goog-api-key", config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	ApplyOutboundHeaders(req, config.Headers)
	return doJSON(req, target)
}

func getGeminiJSON(ctx context.Context, config providerConfig, path string, target interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, geminiVeoURL(config.BaseURL, path), nil)
	if err != nil {
		return err
	}
	req.Header.Set("x-goog-api-key", config.APIKey)
	ApplyOutboundHeaders(req, config.Headers)
	return doJSON(req, target)
}

func getGeminiBinary(ctx context.Context, config providerConfig, rawURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("x-goog-api-key", config.APIKey)
	ApplyOutboundHeaders(req, config.Headers)
	return doBinary(req)
}

func geminiVeoURL(baseURL string, path string) string {
	return apiURLWithDefaultPrefix(baseURL, path, "/v1beta")
}

func postStreamingBinary(ctx context.Context, config providerConfig, path string, body interface{}, onChunk func(string, []byte)) ([]byte, string, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, "", fmt.Errorf("序列化上游请求失败：%w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL(config.BaseURL, path), bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	applyProviderAuth(req, config)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	ApplyOutboundHeaders(req, config.Headers)
	return doBinaryWithConsumer(req, onChunk)
}

func postJSON(ctx context.Context, config providerConfig, path string, body interface{}, target interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("序列化上游请求失败：%w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL(config.BaseURL, path), bytes.NewReader(data))
	if err != nil {
		return err
	}
	applyProviderAuth(req, config)
	req.Header.Set("Content-Type", "application/json")
	ApplyOutboundHeaders(req, config.Headers)
	return doJSON(req, target)
}

func applyProviderAuth(req *http.Request, config providerConfig) {
	if config.APIFormat == "claude" {
		req.Header.Set("x-api-key", config.APIKey)
		req.Header.Set("anthropic-version", "2023-06-01")
		return
	}
	if config.APIFormat == "gemini" {
		req.Header.Set("x-goog-api-key", config.APIKey)
		return
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
}

func postForm(ctx context.Context, config providerConfig, path string, contentType string, body io.Reader, target interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL(config.BaseURL, path), body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	req.Header.Set("Content-Type", contentType)
	ApplyOutboundHeaders(req, config.Headers)
	return doJSON(req, target)
}

func getJSON(ctx context.Context, config providerConfig, path string, target interface{}) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL(config.BaseURL, path), nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	ApplyOutboundHeaders(req, config.Headers)
	return doJSON(req, target)
}

func postBinary(ctx context.Context, config providerConfig, path string, body interface{}) ([]byte, string, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, "", fmt.Errorf("序列化上游请求失败：%w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, apiURL(config.BaseURL, path), bytes.NewReader(data))
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	req.Header.Set("Content-Type", "application/json")
	ApplyOutboundHeaders(req, config.Headers)
	return doBinary(req)
}

func getBinary(ctx context.Context, config providerConfig, path string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL(config.BaseURL, path), nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	ApplyOutboundHeaders(req, config.Headers)
	return doBinary(req)
}

func getExternalBinary(ctx context.Context, rawURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	return doBinary(req)
}

func getProviderExternalBinary(ctx context.Context, config providerConfig, rawURL string) ([]byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", err
	}
	if sameProviderOrigin(config.BaseURL, rawURL) {
		applyProviderAuth(req, config)
		ApplyOutboundHeaders(req, config.Headers)
	}
	return doBinary(req)
}

func sameProviderOrigin(baseURL string, rawURL string) bool {
	base, baseErr := url.Parse(strings.TrimSpace(baseURL))
	target, targetErr := url.Parse(strings.TrimSpace(rawURL))
	if baseErr != nil || targetErr != nil || base.Scheme == "" || base.Host == "" || target.Scheme == "" || target.Host == "" {
		return false
	}
	return strings.EqualFold(base.Scheme, target.Scheme) && strings.EqualFold(base.Host, target.Host)
}

func doJSON(req *http.Request, target interface{}) error {
	data, mimeType, err := doBinary(req)
	if err != nil {
		return err
	}
	if !strings.Contains(mimeType, "json") && !json.Valid(data) {
		return fmt.Errorf("接口返回非 JSON 内容：%s", mimeType)
	}
	if err := json.Unmarshal(data, target); err != nil {
		return err
	}
	if payload, ok := target.(*imageResponse); ok {
		if payload.Error != nil && payload.Error.Message != "" {
			return errors.New(providerPayloadErrorMessage(payload.Error.Message))
		}
		if payload.Code != nil && *payload.Code != 0 {
			return errors.New(providerPayloadErrorMessage(payload.Msg))
		}
	}
	if payload, ok := target.(*map[string]interface{}); ok {
		if _, rawMessage, failed := providerPayloadBusinessFailure(*payload); failed {
			return providerPayloadError{raw: rawMessage, message: providerPayloadErrorMessage(rawMessage)}
		}
		if errValue, ok := (*payload)["error"].(map[string]interface{}); ok && stringField(errValue, "message") != "" {
			rawMessage := stringField(errValue, "message")
			return providerPayloadError{raw: rawMessage, message: providerPayloadErrorMessage(rawMessage)}
		}
	}
	return nil
}

func withProviderOutboundPolicy(ctx context.Context, config providerConfig) context.Context {
	if !config.AllowLocalChannel {
		return ctx
	}
	parsed, err := url.Parse(strings.TrimSpace(config.BaseURL))
	if err != nil || !isExactDesktopLoopbackHost(parsed.Hostname()) {
		return ctx
	}
	return context.WithValue(ctx, providerOutboundPolicyKey{}, providerOutboundPolicyContext{scheme: strings.ToLower(parsed.Scheme), host: strings.ToLower(parsed.Host)})
}

func providerLoopbackPolicyForRequest(req *http.Request) (OutboundPolicy, bool) {
	policyContext, ok := req.Context().Value(providerOutboundPolicyKey{}).(providerOutboundPolicyContext)
	if !ok || policyContext.scheme == "" || policyContext.host == "" {
		return OutboundPolicy{}, false
	}
	if strings.ToLower(req.URL.Scheme) != policyContext.scheme || strings.ToLower(req.URL.Host) != policyContext.host {
		return OutboundPolicy{}, false
	}
	return desktopLoopbackOutboundPolicy(nil), true
}

func doBinary(req *http.Request) ([]byte, string, error) {
	return doBinaryWithConsumer(req, nil)
}

// doBinaryWithConsumer 是 Provider 出站响应的统一安全边界。JSON、SSE 和媒体下载最终都在这里执行
// 渠道并发/熔断、SSRF、超时、响应大小、HTTP 状态和审计检查；onChunk 仅观察已读取的流片段，
// 不会绕过完整响应的大小上限或错误判定。
func doBinaryWithConsumer(req *http.Request, onChunk func(string, []byte)) ([]byte, string, error) {
	startedAt := time.Now()
	requestTimeout := providerHTTPTimeout
	if deadline, ok := req.Context().Deadline(); ok {
		if remaining := time.Until(deadline); remaining > 0 {
			requestTimeout = remaining
		}
	}
	var release func()
	var coordinator *platform.Coordinator
	var runtimeService *Service
	responseLimit := maxProviderResponseBytes
	channelID := ""
	if metadata, ok := req.Context().Value(providerAnalyticsKey{}).(providerAnalyticsContext); ok && metadata.Service != nil {
		runtimeService = metadata.Service
		coordinator = metadata.Service.coordinator
		channelID = metadata.ChannelID
		policy, err := metadata.Service.RuntimePolicy()
		if err != nil {
			return nil, "", fmt.Errorf("读取生成资源限制失败：%w", err)
		}
		responseLimit = megabytes(policy.Resource.GeneratedFileMB)
		open, err := coordinator.CircuitOpen(req.Context(), channelID)
		if err != nil {
			return nil, "", fmt.Errorf("读取渠道熔断状态失败：%w", err)
		}
		if open {
			return nil, "", errors.New("当前渠道连续失败，已暂时熔断，请稍后重试")
		}
		slotID := channelID
		if slotID == "" {
			slotID = "custom:" + strings.ToLower(req.URL.Host)
		}
		var concurrencyLimit int
		release, concurrencyLimit, err = metadata.Service.AcquireChannelSlot(req.Context(), channelID, slotID, requestTimeout+time.Minute)
		metadata.ConcurrencyLimit = concurrencyLimit
		req = req.WithContext(context.WithValue(req.Context(), providerAnalyticsKey{}, metadata))
		if err != nil {
			recordProviderRequest(req, startedAt, 0, nil, err)
			return nil, "", err
		}
		defer release()
	}
	policy, loopback := providerLoopbackPolicyForRequest(req)
	if loopback {
		if _, err := validateOutboundURLWithPolicy(req.URL.String(), policy); err != nil {
			recordProviderRequest(req, startedAt, 0, nil, err)
			return nil, "", err
		}
	} else if _, err := ValidateOutboundURL(req.URL.String()); err != nil {
		recordProviderRequest(req, startedAt, 0, nil, err)
		return nil, "", err
	}
	ApplyDefaultOutboundHeaders(req)
	client := OutboundHTTPClient(requestTimeout)
	if loopback {
		client = outboundHTTPClientWithPolicy(requestTimeout, policy)
	}
	resp, err := client.Do(req)
	if err != nil {
		if runtimeService != nil {
			_ = runtimeService.RecordChannelResult(req.Context(), channelID, !errors.Is(err, context.Canceled))
		}
		recordProviderRequest(req, startedAt, 0, nil, err)
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.ContentLength > responseLimit {
		err = fmt.Errorf("上游响应超过 %s 限制", formatStorageLimit(responseLimit))
		recordProviderRequest(req, startedAt, resp.StatusCode, nil, err)
		return nil, "", err
	}
	mimeType := resp.Header.Get("Content-Type")
	var buffered bytes.Buffer
	reader := io.LimitReader(resp.Body, responseLimit+1)
	chunk := make([]byte, 32<<10)
	for {
		readCount, readErr := reader.Read(chunk)
		if readCount > 0 {
			if int64(buffered.Len()+readCount) > responseLimit {
				err = fmt.Errorf("上游响应超过 %s 限制", formatStorageLimit(responseLimit))
				recordProviderRequest(req, startedAt, resp.StatusCode, buffered.Bytes(), err)
				return nil, "", err
			}
			_, _ = buffered.Write(chunk[:readCount])
			if onChunk != nil {
				onChunk(mimeType, chunk[:readCount])
			}
		}
		if errors.Is(readErr, io.EOF) {
			break
		}
		if readErr != nil {
			recordProviderRequest(req, startedAt, resp.StatusCode, buffered.Bytes(), readErr)
			return nil, "", readErr
		}
	}
	data := buffered.Bytes()
	if int64(len(data)) > responseLimit {
		err = fmt.Errorf("上游响应超过 %s 限制", formatStorageLimit(responseLimit))
		recordProviderRequest(req, startedAt, resp.StatusCode, nil, err)
		return nil, "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if runtimeService != nil {
			_ = runtimeService.RecordChannelResult(req.Context(), channelID, resp.StatusCode >= 500)
		}
		httpErr := providerHTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: string(data), RetryAfter: parseRetryAfter(resp.Header.Get("Retry-After"), time.Now())}
		recordProviderRequest(req, startedAt, resp.StatusCode, data, httpErr)
		return nil, "", httpErr
	}
	recordProviderRequest(req, startedAt, resp.StatusCode, data, nil)
	if runtimeService != nil {
		_ = runtimeService.RecordChannelResult(req.Context(), channelID, false)
	}
	return data, mimeType, nil
}

func parseRetryAfter(value string, now time.Time) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	if seconds, err := strconv.Atoi(value); err == nil && seconds > 0 {
		return time.Duration(seconds) * time.Second
	}
	if at, err := http.ParseTime(value); err == nil && at.After(now) {
		return at.Sub(now)
	}
	return 0
}

func providerPollingDeadline(ctx context.Context) time.Time {
	if deadline, ok := ctx.Deadline(); ok {
		return deadline
	}
	return time.Now().Add(videoPollTimeout)
}

func recordProviderRequest(req *http.Request, startedAt time.Time, statusCode int, responseBody []byte, requestErr error) {
	metadata, ok := req.Context().Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Service == nil {
		return
	}
	status := model.ApiCallStatusSucceeded
	errorCode := ""
	errorText := ""
	if requestErr != nil || statusCode < 200 || statusCode >= 300 {
		status = model.ApiCallStatusFailed
		errorCode, errorText = providerRequestErrorDetails(requestErr)
	} else if businessCode, businessMessage, failed := providerResponseBusinessFailure(responseBody); failed {
		status = model.ApiCallStatusFailed
		errorCode = businessCode
		errorText = businessMessage
	}
	requestKind := providerRequestKind(req.Method, req.URL.Path)
	if metadata.RequestKind != "" {
		requestKind = metadata.RequestKind
	}
	if status == model.ApiCallStatusSucceeded && (requestKind == "create" || requestKind == "poll") && (metadata.Capability == "image" || metadata.Capability == "video") {
		metadata.Service.syncProviderTaskProgress(metadata.TaskID, responseBody)
	}
	apiFormat := "openai"
	if req.Header.Get("x-goog-api-key") != "" {
		apiFormat = "gemini"
	}
	callLog := model.ApiCallLog{
		UserID: metadata.UserID, TraceID: metadata.TraceID, RequestID: metadata.RequestID, ChannelID: metadata.ChannelID, TaskID: metadata.TaskID, BillingOrderID: metadata.BillingOrderID,
		Source: "backend-task", Capability: metadata.Capability, Operation: metadata.Operation,
		RequestKind: requestKind, Billable: req.Method == http.MethodPost && requestKind != "cancel",
		APIFormat: apiFormat, Method: req.Method, Path: req.URL.Path, Model: metadata.Model,
		Status: status, StatusCode: statusCode, DurationMs: time.Since(startedAt).Milliseconds(),
		ErrorCode: errorCode, Error: errorText, ConcurrencyLimit: metadata.ConcurrencyLimit, UpstreamURL: req.URL.Scheme + "://" + req.URL.Host + req.URL.Path,
		ProviderRequestID: metadata.ProviderRequestID, RequestContentType: req.Header.Get("Content-Type"), RequestBody: requestPayloadForLog(req), ResponseBody: SanitizeAPICallPayload(responseBody, ""),
	}
	channelSlotFailure := false
	if code, message := ChannelSlotFailureDetails(requestErr); code != "" {
		channelSlotFailure = true
		callLog.ErrorCode = code
		callLog.Error = message
	}
	if requestKind == "create" && metadata.Capability == "video" {
		callLog.VideoSeconds = metadata.VideoSeconds
		if callLog.VideoSeconds <= 0 {
			if strings.Contains(strings.ToLower(metadata.Model), "seedance") || strings.Contains(req.URL.Path, "/contents/generations/tasks") {
				callLog.VideoSeconds = 5
			} else {
				callLog.VideoSeconds = 6
			}
		}
	}
	metadata.Service.EnrichAPICallLog(&callLog, responseBody)
	if err := metadata.Service.LogAPICall(callLog); err != nil {
		if !channelSlotFailure && metadata.Billing != nil {
			if uncertainErr := metadata.Billing.MarkBillingUncertain(metadata.BillingOrderID, "上游调用日志写入失败，费用状态待核对"); uncertainErr != nil {
				// 这里无法把日志落库错误返回给已完成的 HTTP 请求，只能把计费边界失败写入进程日志，交给待核对审计继续处理。
				log.Printf("provider billing uncertainty update failed: task_id=%s billing_order_id=%s error=%v", metadata.TaskID, metadata.BillingOrderID, uncertainErr)
			}
		}
	}
}

func providerRequestErrorDetails(err error) (string, string) {
	if err == nil {
		return "", ""
	}
	if errors.Is(err, context.Canceled) {
		return "request_cancelled", "任务取消，中断上游请求"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "upstream_timeout", "等待上游响应超时"
	}
	return "", safeProviderLogError(err)
}

func safeProviderLogError(err error) string {
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		return fmt.Sprintf("上游 HTTP %d", httpErr.StatusCode)
	}
	return truncateRunes(err.Error(), 500)
}

func providerRequestKind(method string, path string) string {
	if method == http.MethodGet {
		if strings.HasSuffix(strings.TrimRight(path, "/"), "/content") || strings.Contains(path, "/download") {
			return "download"
		}
		return "poll"
	}
	if strings.Contains(path, "repair") {
		return "repair"
	}
	return "create"
}

func apiURL(baseURL string, path string) string {
	return apiURLWithDefaultPrefix(baseURL, path, "/v1")
}

// ChannelAPIURL 是 Provider 请求拼接 URL 的唯一公共入口。
// 渠道地址可配置为 host、host/、host/v1 或 host/v1/；调用方应传协议路径，避免重复硬编码版本前缀。
func ChannelAPIURL(baseURL string, path string) string {
	return apiURL(baseURL, path)
}

// ChannelAPIURLForProtocol 把协议默认版本收敛在传输边界：Gemini 默认 v1beta，
// OpenAI 兼容协议默认 v1；baseURL 或 path 中显式出现的版本始终优先。
func ChannelAPIURLForProtocol(baseURL string, path string, interfaceType model.ChannelInterfaceType) string {
	if interfaceType == model.ChannelInterfaceAgnesVideo && strings.HasPrefix(strings.TrimSpace(path), "/agnesapi") {
		base, err := url.Parse(strings.TrimSpace(baseURL))
		requestPath, pathErr := url.Parse(strings.TrimSpace(path))
		if err == nil && pathErr == nil && base.Scheme != "" && base.Host != "" && strings.HasPrefix(requestPath.Path, "/") {
			base.Path = requestPath.Path
			base.RawPath = requestPath.RawPath
			base.RawQuery = requestPath.RawQuery
			base.Fragment = ""
			return base.String()
		}
	}
	defaultPrefix := "/v1"
	if interfaceType == model.ChannelInterfaceGeminiVeo || interfaceType == model.ChannelInterfaceGeminiImage {
		defaultPrefix = "/v1beta"
	}
	return apiURLWithDefaultPrefix(baseURL, path, defaultPrefix)
}

var channelAPIPrefixes = []string{"/api/plan/v3", "/api/v3", "/api/v1", "/v1beta", "/v1", "/v2", "/v3"}

func apiURLWithDefaultPrefix(baseURL string, path string, defaultPrefix string) string {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	requestPath := strings.TrimSpace(path)
	if requestPath == "" {
		return base
	}
	if !strings.HasPrefix(requestPath, "/") {
		requestPath = "/" + requestPath
	}

	requestPrefix := requestAPIPathPrefix(requestPath)
	basePrefix := baseAPIPathPrefix(base)
	if requestPrefix != "" {
		if basePrefix == requestPrefix {
			return base + strings.TrimPrefix(requestPath, requestPrefix)
		}
		// 请求路径显式版本优先于 baseURL 残留版本，例如 base=/v1、path=/v2/... 时必须切到 /v2。
		return strings.TrimSuffix(base, basePrefix) + requestPath
	}
	if basePrefix != "" {
		return base + requestPath
	}
	return base + defaultPrefix + requestPath
}

func requestAPIPathPrefix(value string) string {
	lower := strings.ToLower(value)
	for _, prefix := range channelAPIPrefixes {
		if lower == prefix || strings.HasPrefix(lower, prefix+"/") || strings.HasPrefix(lower, prefix+"?") || strings.HasPrefix(lower, prefix+"#") {
			return prefix
		}
	}
	return ""
}

func baseAPIPathPrefix(value string) string {
	lower := strings.ToLower(strings.TrimRight(value, "/"))
	for _, prefix := range channelAPIPrefixes {
		if lower == prefix || strings.HasSuffix(lower, prefix) {
			return prefix
		}
	}
	return ""
}

func writeField(writer *multipart.Writer, key string, value string) {
	_ = writer.WriteField(key, value)
}

func writeMediaPart(writer *multipart.Writer, field string, media providerMedia) error {
	raw, mimeType, err := mediaBytes(media)
	if err != nil {
		return err
	}
	filename := providerMediaFilename(media, mimeType)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": field, "filename": filename}))
	header.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return err
	}
	_, err = part.Write(raw)
	return err
}

func providerMediaFilename(media providerMedia, mimeType string) string {
	base := strings.TrimSpace(media.ID)
	if base == "" {
		base = "reference"
	}
	var builder strings.Builder
	for _, char := range base {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' {
			builder.WriteRune(char)
			if builder.Len() >= 64 {
				break
			}
		}
	}
	base = builder.String()
	if base == "" {
		base = "reference"
	}
	extensions, _ := mime.ExtensionsByType(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
	extension := ".bin"
	if len(extensions) > 0 {
		extension = extensions[0]
	}
	return "reference-" + base + extension
}

func mediaBytes(media providerMedia) ([]byte, string, error) {
	value := media.DataURL
	if value == "" {
		value = media.URL
	}
	if !strings.HasPrefix(value, "data:") {
		return nil, "", errors.New("后端任务队列需要 data URL 形式的本地参考素材")
	}
	header, encoded, ok := strings.Cut(value, ",")
	if !ok {
		return nil, "", errors.New("data URL 格式错误")
	}
	mimeType := strings.TrimPrefix(strings.Split(strings.TrimPrefix(header, "data:"), ";")[0], " ")
	raw, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return nil, "", err
	}
	return raw, normalizedMediaMimeType(defaultString(mimeType, media.Type), raw), nil
}

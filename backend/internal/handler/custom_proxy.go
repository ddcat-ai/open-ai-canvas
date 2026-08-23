package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

const maxCustomRelayErrorResponseBytes int64 = 64 << 10

var customRelayClient = service.CustomRelayHTTPClientForChannel

func RegisterCustomRelayRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.Any("/ai/custom", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireFeature(service.FeatureCustomChannels); err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "custom-relay:"+user.ID, policy.Request.CustomRelayPerMinute, time.Minute) {
			return
		}
		ttl := time.Duration(policy.Request.CustomRelayTimeoutMinutes+1) * time.Minute
		release, acquired, err := svc.AcquireCustomRelaySlot(c.Request.Context(), user.ID, policy.Request.CustomRelayConcurrency, ttl)
		if err != nil {
			fail(c, http.StatusServiceUnavailable, errors.New("自定义渠道并发协调服务不可用"))
			return
		}
		if !acquired {
			fail(c, http.StatusTooManyRequests, errors.New("自定义渠道并发请求过多，请等待已有请求完成"))
			return
		}
		defer release()
		proxyCustomRelayRequestWithService(c, policy.Request, svc.DesktopLocalChannelsEnabled(), svc)
	})
}

func proxyCustomRelayRequest(c *gin.Context, policy service.RuntimeRequestPolicy) {
	proxyCustomRelayRequestWithCapabilities(c, policy, false)
}

func proxyCustomRelayRequestWithCapabilities(c *gin.Context, policy service.RuntimeRequestPolicy, desktopLocalChannelsEnabled bool) {
	proxyCustomRelayRequestWithService(c, policy, desktopLocalChannelsEnabled, nil)
}

func proxyCustomRelayRequestWithService(c *gin.Context, policy service.RuntimeRequestPolicy, desktopLocalChannelsEnabled bool, svc *service.Service) {
	requestedAllowLocal := strings.TrimSpace(c.GetHeader(service.LocalChannelRequestHeader)) == "1"
	target, err := service.ValidateCustomRelayChannelURL(c.GetHeader("X-Canvas-Upstream-URL"), c.GetHeader(service.LocalChannelBaseURLHeader), requestedAllowLocal, desktopLocalChannelsEnabled)
	if err != nil {
		failService(c, err)
		return
	}
	apiFormat := strings.ToLower(strings.TrimSpace(c.GetHeader("X-Canvas-Upstream-Format")))
	if apiFormat == "" {
		apiFormat = "openai"
	}
	if err := authorizeCustomRelay(c.Request.Method, target, apiFormat, c.GetHeader("Content-Type")); err != nil {
		fail(c, http.StatusForbidden, err)
		return
	}
	apiKey, err := customRelayAPIKey(c.GetHeader("Authorization"))
	if err != nil {
		fail(c, http.StatusUnauthorized, err)
		return
	}
	headers, err := service.DecodeRelayOutboundHeaders(c.GetHeader(service.CustomRelayHeadersHeader))
	if err != nil {
		failService(c, err)
		return
	}
	requestLimit := policy.CustomRelayRequestMB << 20
	if c.Request.ContentLength > requestLimit {
		fail(c, http.StatusRequestEntityTooLarge, errors.New("自定义渠道请求超过配置上限"))
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, requestLimit)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			fail(c, http.StatusRequestEntityTooLarge, errors.New("自定义渠道请求超过配置上限"))
			return
		}
		fail(c, http.StatusBadRequest, errors.New("读取自定义渠道请求失败"))
		return
	}
	if c.Request.Method == http.MethodGet && len(body) != 0 {
		fail(c, http.StatusBadRequest, errors.New("模型列表请求不允许携带请求体"))
		return
	}
	upstreamReq, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, target.String(), bytes.NewReader(body))
	if err != nil {
		fail(c, http.StatusBadRequest, errors.New("构造自定义渠道请求失败"))
		return
	}
	if contentType := c.GetHeader("Content-Type"); contentType != "" {
		upstreamReq.Header.Set("Content-Type", contentType)
	}
	if strings.Contains(strings.ToLower(c.GetHeader("Accept")), "text/event-stream") {
		upstreamReq.Header.Set("Accept", "text/event-stream")
	} else {
		upstreamReq.Header.Set("Accept", "application/json")
	}
	service.ApplyOutboundHeaders(upstreamReq, headers)
	service.ApplyDefaultOutboundHeaders(upstreamReq)
	if apiFormat == "gemini" {
		upstreamReq.Header.Set("x-goog-api-key", apiKey)
	} else if apiFormat == "claude" {
		upstreamReq.Header.Set("x-api-key", apiKey)
		upstreamReq.Header.Set("anthropic-version", "2023-06-01")
	} else {
		upstreamReq.Header.Set("Authorization", "Bearer "+apiKey)
	}

	resp, err := customRelayClient(time.Duration(policy.CustomRelayTimeoutMinutes)*time.Minute, target, requestedAllowLocal, desktopLocalChannelsEnabled).Do(upstreamReq)
	if err != nil {
		fail(c, http.StatusBadGateway, errors.New(userFacingRelayError(svc, errors.New("自定义渠道上游连接失败"))))
		return
	}
	defer resp.Body.Close()
	allowBinary := customVideoContentPath.MatchString(target.EscapedPath()) || strings.HasSuffix(target.Path, "/audio/speech")
	writeCustomRelayResponse(c, svc, resp, apiKey, policy.CustomRelayResponseMB<<20, allowBinary)
}

func writeCustomRelayResponse(c *gin.Context, svc *service.Service, resp *http.Response, apiKey string, responseLimit int64, allowBinary bool) {
	c.Header("Cache-Control", "no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	mediaType, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		writeCustomRelayError(c, svc, resp, apiKey, mediaType)
		return
	}
	if mediaType == "text/event-stream" {
		c.Header("Content-Type", "text/event-stream; charset=utf-8")
		c.Header("X-Accel-Buffering", "no")
		c.Status(resp.StatusCode)
		c.Writer.WriteHeaderNow()
		copyCustomRelayStream(c, resp.Body, apiKey, responseLimit)
		return
	}
	if allowBinary && (strings.HasPrefix(mediaType, "video/") || strings.HasPrefix(mediaType, "audio/") || mediaType == "application/octet-stream") {
		body, err := readLimitedRelayBody(resp.Body, responseLimit)
		if err != nil {
			fail(c, http.StatusBadGateway, errors.New(userFacingRelayError(svc, errors.New("自定义渠道上游返回了过大的媒体文件"))))
			return
		}
		c.Data(resp.StatusCode, mediaType, body)
		return
	}
	if mediaType != "application/json" && !strings.HasSuffix(mediaType, "+json") {
		fail(c, http.StatusBadGateway, errors.New(userFacingRelayError(svc, errors.New("自定义渠道上游返回了不支持的内容类型"))))
		return
	}
	limit := responseLimit
	body, err := readLimitedRelayBody(resp.Body, limit)
	if err != nil || !json.Valid(body) {
		fail(c, http.StatusBadGateway, errors.New(userFacingRelayError(svc, errors.New("自定义渠道上游返回无效或过大的 JSON"))))
		return
	}
	body = redactRelaySecret(body, apiKey)
	c.Data(resp.StatusCode, "application/json; charset=utf-8", body)
}

func writeCustomRelayError(c *gin.Context, svc *service.Service, resp *http.Response, apiKey string, mediaType string) {
	body, err := readLimitedRelayBody(resp.Body, maxCustomRelayErrorResponseBytes)
	if err != nil {
		fail(c, http.StatusBadGateway, errors.New(userFacingRelayError(svc, errors.New("自定义渠道上游请求失败"))))
		return
	}
	body = redactRelaySecret(body, apiKey)
	rawMessage := strings.TrimSpace(string(body))
	if intercepted := interceptedRelayText(svc, rawMessage); intercepted != rawMessage {
		fail(c, resp.StatusCode, errors.New(intercepted))
		return
	}
	if (mediaType == "application/json" || strings.HasSuffix(mediaType, "+json")) && json.Valid(body) {
		c.Data(resp.StatusCode, "application/json; charset=utf-8", body)
		return
	}
	snippet := strings.TrimSpace(string(body))
	if len(snippet) > 200 {
		snippet = snippet[:200] + "..."
	}
	fail(c, resp.StatusCode, errors.New(userFacingRelayError(svc, fmt.Errorf("自定义渠道上游请求失败（%s）%s", resp.Status, snippet))))
}

func userFacingRelayError(svc *service.Service, err error) string {
	if svc == nil {
		return err.Error()
	}
	return svc.UserFacingErrorMessage(err)
}

func interceptedRelayText(svc *service.Service, raw string) string {
	if svc == nil {
		return raw
	}
	return svc.InterceptResponseText(raw)
}

func copyCustomRelayStream(c *gin.Context, source io.Reader, apiKey string, maxBytes int64) {
	redactor := newRelayStreamRedactor(apiKey)
	buffer := make([]byte, 32<<10)
	var written int64
	for written < maxBytes {
		read, err := source.Read(buffer)
		if read > 0 {
			remaining := maxBytes - written
			if int64(read) > remaining {
				read = int(remaining)
			}
			chunk := redactor.Push(buffer[:read], false)
			if len(chunk) > 0 {
				if _, writeErr := c.Writer.Write(chunk); writeErr != nil {
					return
				}
				c.Writer.Flush()
			}
			written += int64(read)
		}
		if err != nil {
			break
		}
	}
	if tail := redactor.Push(nil, true); len(tail) > 0 {
		_, _ = c.Writer.Write(tail)
		c.Writer.Flush()
	}
}

func readLimitedRelayBody(body io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, errors.New("response body is too large")
	}
	return data, nil
}

func customRelayAPIKey(value string) (string, error) {
	scheme, apiKey, found := strings.Cut(strings.TrimSpace(value), " ")
	apiKey = strings.TrimSpace(apiKey)
	if !found || !strings.EqualFold(scheme, "Bearer") || apiKey == "" || len(apiKey) > 512 || strings.ContainsAny(apiKey, "\r\n") {
		return "", errors.New("自定义渠道 API Key 无效")
	}
	return apiKey, nil
}

func redactRelaySecret(body []byte, apiKey string) []byte {
	if apiKey == "" {
		return body
	}
	return bytes.ReplaceAll(body, []byte(apiKey), []byte("[REDACTED]"))
}

type relayStreamRedactor struct {
	secret  []byte
	pending []byte
}

func newRelayStreamRedactor(secret string) *relayStreamRedactor {
	return &relayStreamRedactor{secret: []byte(secret)}
}

func (r *relayStreamRedactor) Push(chunk []byte, final bool) []byte {
	r.pending = append(r.pending, chunk...)
	if len(r.secret) == 0 {
		result := append([]byte(nil), r.pending...)
		r.pending = r.pending[:0]
		return result
	}
	r.pending = bytes.ReplaceAll(r.pending, r.secret, []byte("[REDACTED]"))
	if final {
		result := append([]byte(nil), r.pending...)
		r.pending = r.pending[:0]
		return result
	}
	keep := relaySecretPrefixSuffixLength(r.pending, r.secret)
	cut := len(r.pending) - keep
	result := append([]byte(nil), r.pending[:cut]...)
	r.pending = append(r.pending[:0], r.pending[cut:]...)
	return result
}

func relaySecretPrefixSuffixLength(data []byte, secret []byte) int {
	limit := len(secret) - 1
	if len(data) < limit {
		limit = len(data)
	}
	for length := limit; length > 0; length-- {
		if bytes.Equal(data[len(data)-length:], secret[:length]) {
			return length
		}
	}
	return 0
}

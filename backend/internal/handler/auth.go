package handler

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAuthRoutes(r *gin.RouterGroup, svc *service.Service) {
	registerChannelOrderRoutes(r, svc)
	registerNotificationRoutes(r, svc)
	r.GET("/auth/settings", func(c *gin.Context) {
		settings, err := svc.PublicAuthSettings()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, settings)
	})
	r.POST("/auth/register", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.RegisterRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "register:"+c.ClientIP(), policy.Request.RegisterPerHour, time.Hour) {
			return
		}
		result, err := svc.Register(req)
		if err != nil {
			failService(c, err)
			return
		}
		setSessionCookie(c, result.Session, result.MaxAgeSecs)
		ok(c, gin.H{"user": result.User})
	})
	r.POST("/auth/email-code", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			Email string `json:"email"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "email-code:"+c.ClientIP(), policy.Request.EmailCodePerHour, time.Hour) {
			return
		}
		if !enforceRateLimit(c, "registration-email-account:"+passwordResetRateLimitSubject(req.Email), 10, time.Hour) {
			return
		}
		if err := svc.SendRegistrationEmailCode(req.Email); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"sent": true})
	})
	r.POST("/auth/password-reset-code", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			Email string `json:"email"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "password-reset-code-ip:"+c.ClientIP(), policy.Request.EmailCodePerHour, time.Hour) {
			return
		}
		if !enforceRateLimit(c, "password-reset-code-account:"+passwordResetRateLimitSubject(req.Email), policy.Request.EmailCodePerHour, time.Hour) {
			return
		}
		if err := svc.SendPasswordResetEmailCode(req.Email); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"sent": true})
	})
	r.POST("/auth/password-reset", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.PasswordResetRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "password-reset-ip:"+c.ClientIP(), policy.Request.LoginIPPerTenMinutes, 10*time.Minute) {
			return
		}
		if !enforceRateLimit(c, "password-reset-account:"+passwordResetRateLimitSubject(req.Email), policy.Request.LoginAccountPerTenMinutes, 10*time.Minute) {
			return
		}
		if err := svc.ResetPassword(req); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"reset": true})
	})
	r.POST("/auth/login", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.LoginRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "login-ip:"+c.ClientIP(), policy.Request.LoginIPPerTenMinutes, 10*time.Minute) {
			return
		}
		if !enforceRateLimit(c, "login:"+c.ClientIP()+":"+strings.ToLower(strings.TrimSpace(req.Username)), policy.Request.LoginAccountPerTenMinutes, 10*time.Minute) {
			return
		}
		result, err := svc.Login(req)
		if err != nil {
			failService(c, err)
			return
		}
		setSessionCookie(c, result.Session, result.MaxAgeSecs)
		ok(c, gin.H{"user": result.User})
	})
	r.GET("/auth/linuxdo/start", func(c *gin.Context) {
		if !enforceRateLimit(c, "linuxdo-start:"+c.ClientIP(), 20, 10*time.Minute) {
			return
		}
		acceptedTerms := c.Query("acceptedTerms") == "true"
		target, err := svc.BeginLinuxDOLogin(c.Query("next"), acceptedTerms)
		if err != nil {
			failService(c, err)
			return
		}
		c.Redirect(http.StatusFound, target)
	})
	r.GET("/auth/linuxdo/callback", linuxDOCallbackHandler(svc))
	r.POST("/auth/logout", func(c *gin.Context) {
		_ = svc.Logout(sessionCookie(c))
		clearSessionCookie(c)
		ok(c, gin.H{"ok": true})
	})
	r.GET("/auth/session", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			ok(c, gin.H{"user": nil})
			return
		}
		publicUser, err := svc.PublicAuthUser(user)
		if err != nil {
			failService(c, err)
			return
		}
		limits, err := svc.PublicRuntimeLimits()
		if err != nil {
			failService(c, err)
			return
		}
		drawingEngine, err := svc.DrawingEngineSetting()
		if err != nil {
			failService(c, err)
			return
		}
		features, err := svc.FeatureAvailability()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"user": publicUser, "runtimeLimits": limits, "drawingEngine": drawingEngine, "features": features})
	})
	r.GET("/channels/system", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		channels, err := svc.PublicSystemChannels()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channels": channels})
	})
}

// 兼容已在 Linux.do OAuth 应用中登记的传统回调地址，处理逻辑与 /api/auth/linuxdo/callback 完全一致。
func RegisterOAuthCallbackRoutes(r gin.IRoutes, svc *service.Service) {
	r.GET("/oauth/linuxdo/callback", linuxDOCallbackHandler(svc))
}

func linuxDOCallbackHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !enforceRateLimit(c, "linuxdo-callback:"+c.ClientIP(), 30, 10*time.Minute) {
			return
		}
		result, err := svc.CompleteLinuxDOLogin(c.Query("state"), c.Query("code"))
		if err != nil {
			c.Redirect(http.StatusFound, "/login?oauth_error="+url.QueryEscape(err.Error()))
			return
		}
		setSessionCookie(c, result.Session.Session, result.Session.MaxAgeSecs)
		c.Redirect(http.StatusFound, result.Next)
	}
}

func RegisterAdminRoutes(r *gin.RouterGroup, svc *service.Service) {
	registerAdminUserRoutes(r, svc)
	registerAdminChannelRoutes(r, svc)
	registerAdminSettingRoutes(r, svc)
	registerAdminAPILogRoutes(r, svc)
}

func RegisterSystemProxyRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.Any("/ai/system/:channelId/*path", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		channel, err := svc.SystemChannel(c.Param("channelId"))
		if err != nil {
			fail(c, http.StatusNotFound, errors.New("系统渠道不存在或已停用"))
			return
		}
		proxySystemRequest(c, svc, user, channel)
	})
}

// SystemProxyNoRouteHandler handles the short public proxy form
// /api/{channelId}/{providerPath}. It deliberately runs from NoRoute so it
// cannot shadow existing business routes such as /api/tasks or /api/plugins.
func SystemProxyNoRouteHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		channelID, providerPath, ok := shortSystemProxyPath(c.Request.URL.Path)
		if !ok {
			fail(c, http.StatusNotFound, errors.New("请求不存在"))
			return
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		channel, err := svc.SystemChannel(channelID)
		if err != nil {
			fail(c, http.StatusNotFound, errors.New("系统渠道不存在或已停用"))
			return
		}
		proxySystemRequestPath(c, svc, user, channel, providerPath)
	}
}

func shortSystemProxyPath(rawPath string) (string, string, bool) {
	const prefix = "/api/"
	if !strings.HasPrefix(rawPath, prefix) {
		return "", "", false
	}
	remainder := strings.TrimPrefix(rawPath, prefix)
	separator := strings.IndexByte(remainder, '/')
	if separator <= 0 || separator == len(remainder)-1 {
		return "", "", false
	}
	channelID := remainder[:separator]
	providerPath := remainder[separator:]
	if strings.ContainsAny(channelID, "?#\\") || strings.Contains(providerPath, "\\") || isReservedAPIPathPrefix(channelID) {
		return "", "", false
	}
	return channelID, providerPath, true
}

// NoRoute also sees unmatched descendants of registered API routes. Keep the
// short proxy from interpreting /api/tasks/unknown (or /api/plugins/unknown)
// as a channel request when a business route returns 404.
func isReservedAPIPathPrefix(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "admin", "agent", "ai", "announcements", "banner-announcements", "assets", "auth", "canvas-projects", "channels", "diagnostics", "features", "files", "model-catalog", "models", "oauth", "plugins", "projects", "public", "resources", "sessions", "settings", "skills", "style-profiles", "tasks", "timeline", "user-data", "voice-profiles", "wallet":
		return true
	default:
		return false
	}
}

func proxySystemRequest(c *gin.Context, svc *service.Service, user *model.User, channel *model.ModelChannel) {
	proxySystemRequestPath(c, svc, user, channel, c.Param("path"))
}

func proxySystemRequestPath(c *gin.Context, svc *service.Service, user *model.User, channel *model.ModelChannel, providerPath string) {
	startedAt := time.Now()
	policy, available := loadRuntimePolicy(c, svc)
	if !available || !enforceRateLimit(c, "system-proxy:"+user.ID, policy.Request.SystemRelayPerMinute, time.Minute) {
		return
	}
	path := providerPath
	if path == "" {
		path = "/"
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, policy.Request.SystemRelayRequestMB<<20)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	modelName := proxyRequestModelForPath(path, c.GetHeader("Content-Type"), body)
	if modelName == "" && c.Request.Method == http.MethodGet && path == "/agnesapi" {
		modelName = strings.TrimSpace(c.Query("model_name"))
	}
	protocol := model.ChannelInterfaceType("")
	capability := "text"
	var channelModel *model.ChannelModel
	if !(c.Request.Method == http.MethodGet && path == "/models") {
		if c.Request.Method == http.MethodGet && systemMiniMaxTaskPath.MatchString(path) && modelName == "" {
			supported, supportErr := svc.SystemChannelHasProtocol(channel.ID, model.ChannelInterfaceMiniMaxVideo)
			if supportErr != nil {
				failService(c, supportErr)
				return
			}
			if !supported {
				fail(c, http.StatusForbidden, errors.New("当前系统渠道未授权 MiniMax 视频协议"))
				return
			}
			protocol = model.ChannelInterfaceMiniMaxVideo
			capability = "video"
		} else {
			var modelErr error
			channelModel, modelErr = svc.SystemChannelModel(channel.ID, modelName)
			if modelErr != nil || channelModel.Protocol == "" {
				fail(c, http.StatusForbidden, errors.New("当前系统渠道未授权该模型或模型协议尚未配置"))
				return
			}
			protocol = channelModel.Protocol
			capability = channelModel.Capability
		}
	}
	if err := authorizeSystemProxy(channel, protocol, c.Request.Method, path, c.GetHeader("Content-Type"), body); err != nil {
		fail(c, http.StatusForbidden, err)
		return
	}
	if channelModel != nil && channelModel.BillingMode == "token" && protocol == model.ChannelInterfaceChatCompletion {
		body, err = service.EnsureChatCompletionStreamUsageRequest(body)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
	}
	billingOrderID := ""
	query := c.Request.URL.Query()
	for _, key := range []string{"key", "api_key", "access_token", "token"} {
		query.Del(key)
	}
	target := service.ChannelAPIURLForProtocol(channel.BaseURL, path, protocol)
	if encodedQuery := query.Encode(); encodedQuery != "" {
		target += "?" + encodedQuery
	}
	validatedTarget, err := svc.ValidateChannelOutboundURL(target)
	if err != nil {
		failService(c, err)
		return
	}
	channelHeaders, err := service.ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		failService(c, err)
		return
	}
	// 同步代理与后台任务必须共享渠道槽位，否则两条入口会共同超过供应商并发上限。
	releaseChannel, concurrencyLimit, err := svc.AcquireChannelSlot(c.Request.Context(), channel.ID, "", 36*time.Minute)
	if err != nil {
		log := apiCallLog(user, channel, billingOrderID, capability, protocol, c.Request.Method, path, target, body, c.GetHeader("Content-Type"), model.ApiCallStatusFailed, 0, time.Since(startedAt), err.Error(), concurrencyLimit)
		log.ErrorCode, log.Error = service.ChannelSlotFailureDetails(err)
		logSystemProxyCall(svc, log, nil)
		failInternal(c, http.StatusServiceUnavailable, err)
		return
	}
	defer releaseChannel()
	if c.Request.Method == http.MethodPost {
		order, err := svc.ReserveProxyBillingWithBody(user.ID, channel.ID, strings.TrimPrefix(modelName, "models/"), capability, c.GetHeader("X-Canvas-Scene"), c.GetHeader("X-Idempotency-Key"), proxyRequestVideoSeconds(c.GetHeader("Content-Type"), body), body)
		if err != nil {
			failService(c, err)
			return
		}
		if order != nil {
			billingOrderID = order.ID
			if err := svc.MarkBillingRunning(billingOrderID); err != nil {
				refundSystemProxyBilling(svc, billingOrderID, "系统渠道请求尚未发出")
				failService(c, err)
				return
			}
		}
	}
	upstreamReq, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, validatedTarget.String(), bytes.NewReader(body))
	if err != nil {
		refundSystemProxyBilling(svc, billingOrderID, "系统渠道请求构造失败")
		fail(c, http.StatusBadRequest, err)
		return
	}
	if contentType := c.GetHeader("Content-Type"); contentType != "" {
		upstreamReq.Header.Set("Content-Type", contentType)
	}
	if accept := c.GetHeader("Accept"); accept != "" {
		upstreamReq.Header.Set("Accept", accept)
	}
	service.ApplyOutboundHeaders(upstreamReq, channelHeaders)
	service.ApplyDefaultOutboundHeaders(upstreamReq)
	if protocol == model.ChannelInterfaceGeminiVeo || protocol == model.ChannelInterfaceGeminiImage {
		upstreamReq.Header.Set("x-goog-api-key", channel.APIKey)
	} else if protocol == model.ChannelInterfaceClaudeAPI {
		upstreamReq.Header.Set("x-api-key", channel.APIKey)
		upstreamReq.Header.Set("anthropic-version", "2023-06-01")
	} else {
		upstreamReq.Header.Set("Authorization", "Bearer "+channel.APIKey)
	}

	status := model.ApiCallStatusSucceeded
	statusCode := 0
	errorText := ""
	resp, err := svc.OutboundHTTPClientForChannel(35*time.Minute, validatedTarget).Do(upstreamReq)
	if err != nil {
		status = model.ApiCallStatusFailed
		errorText = err.Error()
		markSystemProxyBillingUncertain(svc, billingOrderID, "系统渠道连接中断，费用状态待核对")
		logSystemProxyCall(svc, apiCallLog(user, channel, billingOrderID, capability, protocol, c.Request.Method, path, target, body, c.GetHeader("Content-Type"), status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), nil)
		fail(c, http.StatusBadGateway, errors.New("系统渠道连接失败"))
		return
	}
	defer resp.Body.Close()
	statusCode = resp.StatusCode
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		status = model.ApiCallStatusFailed
	}
	responseLimit := policy.Request.SystemRelayResponseMB << 20
	streamed := isSystemProxyEventStream(resp)
	var responseBody []byte
	var readErr error
	if streamed {
		responseBody, readErr = streamSystemProxyResponse(c, resp, responseLimit)
	} else {
		responseBody, readErr = io.ReadAll(io.LimitReader(resp.Body, responseLimit+1))
	}
	if readErr != nil {
		status = model.ApiCallStatusFailed
		errorText = readErr.Error()
		billingNote := "系统渠道响应读取失败，费用状态待核对"
		if errors.Is(readErr, errSystemProxyResponseTooLarge) {
			billingNote = "上游已响应但流式响应体超过限制，费用状态待核对"
		}
		markSystemProxyBillingUncertain(svc, billingOrderID, billingNote)
		logSystemProxyCall(svc, apiCallLog(user, channel, billingOrderID, capability, protocol, c.Request.Method, path, target, body, c.GetHeader("Content-Type"), status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), responseBody)
		// SSE 响应头已经发送，流中断后只能关闭连接；非流式响应仍返回结构化错误。
		if !streamed {
			fail(c, http.StatusBadGateway, errors.New("系统渠道响应读取失败"))
		}
		return
	}
	if int64(len(responseBody)) > responseLimit {
		markSystemProxyBillingUncertain(svc, billingOrderID, "上游已响应但响应体超过限制，费用状态待核对")
		fail(c, http.StatusBadGateway, fmt.Errorf("系统渠道响应超过 %dMB 限制", policy.Request.SystemRelayResponseMB))
		return
	}
	logErr := logSystemProxyCall(svc, apiCallLog(user, channel, billingOrderID, capability, protocol, c.Request.Method, path, target, body, c.GetHeader("Content-Type"), status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), responseBody)
	if status == model.ApiCallStatusSucceeded {
		if logErr != nil {
			markSystemProxyBillingUncertain(svc, billingOrderID, "上游成功但调用日志写入失败，费用状态待核对")
		} else if err := svc.SettleBilling(billingOrderID, ""); err != nil {
			markSystemProxyBillingUncertain(svc, billingOrderID, "上游成功但积分结算失败："+err.Error())
		}
	} else if statusCode == 524 {
		markSystemProxyBillingUncertain(svc, billingOrderID, "上游返回 524，费用状态待核对")
	} else {
		refundSystemProxyBilling(svc, billingOrderID, "上游明确返回失败")
	}
	if streamed {
		return
	}
	copySystemProxyResponseHeaders(c, resp)
	c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), responseBody)
}

func refundSystemProxyBilling(svc *service.Service, billingOrderID string, reason string) {
	if billingOrderID == "" {
		return
	}
	if err := svc.RefundBilling(billingOrderID, reason); err != nil {
		log.Printf("system proxy billing refund failed: billing_order_id=%s error=%v", billingOrderID, err)
		// 退款写失败不能当没发生：转待核对，避免订单停在 running 被当成已扣费。
		markSystemProxyBillingUncertain(svc, billingOrderID, "退款失败，费用状态待核对："+err.Error())
	}
}

func markSystemProxyBillingUncertain(svc *service.Service, billingOrderID string, reason string) {
	if billingOrderID == "" {
		return
	}
	if err := svc.MarkBillingUncertain(billingOrderID, reason); err != nil {
		log.Printf("system proxy billing uncertainty update failed: billing_order_id=%s error=%v", billingOrderID, err)
	}
}

func apiCallLog(user *model.User, channel *model.ModelChannel, billingOrderID string, capability string, protocol model.ChannelInterfaceType, method string, path string, target string, body []byte, contentType string, status model.ApiCallStatus, statusCode int, duration time.Duration, errorText string, concurrencyLimit int) model.ApiCallLog {
	requestKind := "create"
	apiFormat := "openai"
	if protocol == model.ChannelInterfaceGeminiVeo || protocol == model.ChannelInterfaceGeminiImage {
		apiFormat = "gemini"
	}
	if method == http.MethodGet {
		requestKind = "poll"
		if strings.HasSuffix(strings.TrimRight(path, "/"), "/content") {
			requestKind = "download"
		}
	}
	return model.ApiCallLog{
		UserID:             user.ID,
		ChannelID:          channel.ID,
		BillingOrderID:     billingOrderID,
		Source:             "system-channel",
		Capability:         capability,
		RequestKind:        requestKind,
		Billable:           method == http.MethodPost,
		APIFormat:          apiFormat,
		Method:             method,
		Path:               path,
		Model:              readPayloadModel(body),
		Status:             status,
		StatusCode:         statusCode,
		DurationMs:         duration.Milliseconds(),
		Error:              errorText,
		ConcurrencyLimit:   concurrencyLimit,
		UpstreamURL:        target,
		RequestContentType: contentType,
		RequestBody:        service.SanitizeAPICallPayload(body, contentType),
	}
}

func logSystemProxyCall(svc *service.Service, log model.ApiCallLog, responseBody []byte) error {
	log.ResponseBody = service.SanitizeAPICallPayload(responseBody, "")
	svc.EnrichAPICallLog(&log, responseBody)
	return svc.LogAPICall(log)
}

func readPayloadModel(body []byte) string {
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return ""
	}
	if modelName, ok := payload["model"].(string); ok {
		return modelName
	}
	return ""
}

func currentUser(c *gin.Context, svc *service.Service) (*model.User, error) {
	return svc.CurrentUser(sessionCookie(c))
}

func sessionCookie(c *gin.Context) string {
	value, _ := c.Cookie(service.SessionCookieName)
	return value
}

func passwordResetRateLimitSubject(value string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(value))))
	return fmt.Sprintf("%x", sum[:])
}

func setSessionCookie(c *gin.Context, value string, maxAge int) {
	secure := c.Request.TLS != nil || strings.EqualFold(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")), "https")
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     service.SessionCookieName,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

func clearSessionCookie(c *gin.Context) {
	secure := c.Request.TLS != nil || strings.EqualFold(strings.TrimSpace(c.GetHeader("X-Forwarded-Proto")), "https")
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     service.SessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   secure,
	})
}

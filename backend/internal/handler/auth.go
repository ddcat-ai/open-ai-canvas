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

	"yingce/backend/internal/model"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAuthRoutes(r *gin.RouterGroup, svc *service.Service) {
	registerChannelOrderRoutes(r, svc)
	RegisterDesktopAuthRoutes(r, svc)
	registerNotificationRoutes(r, svc)
	registerAuthProfileRoutes(r, svc)
	registerWechatRoutes(r, svc)
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
		req.LoginContext = loginRequestContext(c)
		req.Context = c.Request.Context()
		result, err := svc.Register(req)
		if err != nil {
			failService(c, err)
			return
		}
		setSessionCookie(c, result.Session, result.MaxAgeSecs)
		ok(c, gin.H{"user": result.User, "session": result.Session, "expiresIn": result.MaxAgeSecs})
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
	r.POST("/auth/login", rejectedLoginAudit(svc, "password"), func(c *gin.Context) {
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
		subject, err := svc.LoginRateLimitSubject(req.Username)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "login:"+c.ClientIP()+":"+subject, policy.Request.LoginAccountPerTenMinutes, 10*time.Minute) {
			return
		}
		req.LoginContext = loginRequestContext(c)
		req.Context = c.Request.Context()
		c.Set("login_audit_handled", true)
		result, err := svc.Login(req)
		if err != nil {
			failService(c, err)
			return
		}
		setSessionCookie(c, result.Session, result.MaxAgeSecs)
		ok(c, gin.H{"user": result.User, "session": result.Session, "expiresIn": result.MaxAgeSecs})
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
	r.GET("/auth/linuxdo/callback", rejectedLoginAudit(svc, "linuxdo"), linuxDOCallbackHandler(svc))
	registerOIDCRoutes(r, svc)
	r.POST("/auth/logout", func(c *gin.Context) {
		if err := svc.LogoutForExpectedUser(sessionCookie(c), c.GetHeader("X-Canvas-Expected-User"), loginRequestContext(c)); err != nil {
			failService(c, err)
			return
		}
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
		referralAvailable, err := svc.ReferralAvailable(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"user": publicUser, "userGroup": svc.PublicUserGroupFor(user), "runtimeLimits": limits, "drawingEngine": drawingEngine, "features": features, "referralAvailable": referralAvailable})
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
	r.GET("/oauth/linuxdo/callback", rejectedLoginAudit(svc, "linuxdo"), linuxDOCallbackHandler(svc))
}

func linuxDOCallbackHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !enforceRateLimit(c, "linuxdo-callback:"+c.ClientIP(), 30, 10*time.Minute) {
			return
		}
		reauthentication, stateErr := svc.LinuxDOReauthenticationState(c.Query("state"))
		if stateErr != nil {
			if err := svc.RecordRejectedLogin("linuxdo", loginRequestContext(c), 400); err != nil {
				log.Printf("OAuth rejected login audit write failed: error=%v", err)
			}
			c.Redirect(http.StatusFound, "/login?oauth_error="+url.QueryEscape("无法读取身份验证状态，请重试"))
			return
		}
		c.Set("login_audit_handled", true)
		result, err := svc.CompleteLinuxDOLogin(c.Query("state"), c.Query("code"), sessionCookie(c), loginRequestContext(c))
		if err != nil {
			if reauthentication {
				c.Redirect(http.StatusFound, "/settings?section=profile&reauth=error")
				return
			}
			c.Redirect(http.StatusFound, "/login?oauth_error="+url.QueryEscape(err.Error()))
			return
		}
		if !result.Reauthenticated {
			setSessionCookie(c, result.Session.Session, result.Session.MaxAgeSecs)
		}
		c.Redirect(http.StatusFound, result.Next)
	}
}

func RegisterAdminRoutes(r *gin.RouterGroup, svc *service.Service) {
	registerAdminUserRoutes(r, svc)
	registerAdminUserGroupRoutes(r, svc)
	registerAdminChannelRoutes(r, svc)
	registerAdminSettingRoutes(r, svc)
	registerAdminAPILogRoutes(r, svc)
	registerAdminLoginLogRoutes(r, svc)
	registerEmailRoutes(r, svc)
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
	case "admin", "agent", "ai", "announcements", "banner-announcements", "assets", "auth", "canvas-projects", "channels", "diagnostics", "dramas", "features", "files", "model-catalog", "models", "oauth", "plugins", "projects", "public", "resources", "sessions", "settings", "skills", "style-profiles", "tasks", "timeline", "user-data", "voice-profiles", "wallet":
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
	// 分组只能使用绑定的系统渠道；中转入口与任务准入同样失败关闭。
	if err := svc.RequireUserChannelAccess(user, channel.ID); err != nil {
		failService(c, err)
		return
	}
	policy, available := loadRuntimePolicy(c, svc)
	if !available || !enforceRateLimit(c, "system-proxy:"+user.ID, policy.Request.SystemRelayPerMinute, time.Minute) {
		return
	}
	if c.Request.Method == http.MethodPost && !validSystemProxyIdempotencyKey(c.GetHeader("X-Idempotency-Key")) {
		fail(c, http.StatusBadRequest, errors.New("生成请求必须携带有效的 X-Idempotency-Key（最多 128 字节）"))
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
	protocol := model.ChannelInterfaceType("")
	capability := "text"
	var channelModel *model.ChannelModel
	billingOrderID := ""
	var asyncBillingOrder *model.BillingOrder
	asyncOperation := ""
	asyncTaskID := ""
	isAsyncContinuation := c.Request.Method == http.MethodGet && path != "/models" || c.Request.Method == http.MethodPost && strings.TrimSpace(c.GetHeader("X-Yingce-Lite-Task-ID")) != ""
	if isAsyncContinuation {
		candidates := systemProxyTaskIDCandidates(path, c.Request.URL.Query(), body, c.GetHeader("X-Yingce-Lite-Task-ID"))
		order, orderErr := svc.SystemProxyBillingOrderForTask(user.ID, channel.ID, candidates)
		if orderErr != nil {
			fail(c, http.StatusForbidden, errors.New("异步任务不属于当前账号或渠道"))
			return
		}
		channelModel, err = svc.SystemChannelModel(channel.ID, order.Model)
		if err != nil || channelModel == nil || channelModel.Protocol == "" {
			fail(c, http.StatusForbidden, errors.New("异步任务模型已不可用"))
			return
		}
		protocol = channelModel.Protocol
		capability = channelModel.Capability
		var matched bool
		asyncTaskID, asyncOperation, matched = svc.MatchSystemProxyAsyncRequest(string(protocol), capability, order.Model, order.ProviderRequestID, c.Request.Method, path, c.Request.URL.Query())
		if !matched {
			fail(c, http.StatusForbidden, errors.New("异步任务轮询路径与计费订单不匹配"))
			return
		}
		asyncBillingOrder = order
		billingOrderID = order.ID
		modelName = order.Model
	} else if !(c.Request.Method == http.MethodGet && path == "/models") {
		channelModel, err = svc.SystemChannelModel(channel.ID, modelName)
		if err != nil || channelModel.Protocol == "" {
			fail(c, http.StatusForbidden, errors.New("当前系统渠道未授权该模型或模型协议尚未配置"))
			return
		}
		protocol = channelModel.Protocol
		capability = channelModel.Capability
	}
	var declaredPaths []string
	if protocol != "" {
		declaredPaths = svc.SystemProxyDeclaredPostPaths(protocol)
	}
	if !isAsyncContinuation {
		if err := authorizeSystemProxy(channel, protocol, declaredPaths, c.Request.Method, path, c.GetHeader("Content-Type"), body); err != nil {
			fail(c, http.StatusForbidden, err)
			return
		}
	}
	// 按 Token 计费的 Chat Completions 流式请求需要上游最后返回 usage 块；是否属于 Chat Completions
	// 看实际转发的路径，不看协议 ID，插件协议（deepseek-chat 等）同样能拿到用量结算。
	clientBody := body
	if channelModel != nil && channelModel.BillingMode == "token" && service.SystemProxyChatCompletionPath(path) {
		body, err = service.EnsureChatCompletionStreamUsageRequest(body)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
	}
	streamUsageInjected := !bytes.Equal(clientBody, body)
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
		_, _ = logSystemProxyCall(svc, log, nil)
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
	newUpstreamRequest := func(payload []byte) (*http.Request, error) {
		upstreamReq, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, validatedTarget.String(), bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		if contentType := c.GetHeader("Content-Type"); contentType != "" {
			upstreamReq.Header.Set("Content-Type", contentType)
		}
		if accept := c.GetHeader("Accept"); accept != "" {
			upstreamReq.Header.Set("Accept", accept)
		}
		service.ApplyOutboundHeaders(upstreamReq, channelHeaders)
		service.ApplyDefaultOutboundHeaders(upstreamReq)
		// 鉴权按插件声明写（bearer / header / anthropic / google-api-key / 签名等），未声明时沿用内置写法。
		if err := svc.ApplySystemProxyAuth(upstreamReq, channel, protocol); err != nil {
			return nil, err
		}
		return upstreamReq, nil
	}
	upstreamReq, err := newUpstreamRequest(body)
	if err != nil {
		refundSystemProxyBilling(svc, billingOrderID, "系统渠道请求构造失败")
		fail(c, http.StatusBadRequest, err)
		return
	}

	status := model.ApiCallStatusSucceeded
	statusCode := 0
	errorText := ""
	responseLimit := policy.Request.SystemRelayResponseMB << 20
	client := svc.OutboundHTTPClientForChannel(35*time.Minute, validatedTarget, channel.ProxyURL)
	resp, err := client.Do(upstreamReq)
	if err == nil && streamUsageInjected {
		resp, err = resendIfStreamUsageRejected(resp, responseLimit, func() (*http.Response, error) {
			body = clientBody
			retryReq, buildErr := newUpstreamRequest(body)
			if buildErr != nil {
				return nil, buildErr
			}
			return client.Do(retryReq)
		})
	}
	if err != nil {
		status = model.ApiCallStatusFailed
		errorText = err.Error()
		markSystemProxyBillingUncertain(svc, billingOrderID, "系统渠道连接中断，费用状态待核对")
		_, _ = logSystemProxyCall(svc, apiCallLog(user, channel, billingOrderID, capability, protocol, c.Request.Method, path, target, body, c.GetHeader("Content-Type"), status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), nil)
		fail(c, http.StatusBadGateway, errors.New("系统渠道连接失败"))
		return
	}
	defer resp.Body.Close()
	statusCode = resp.StatusCode
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		status = model.ApiCallStatusFailed
	}
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
		_, _ = logSystemProxyCall(svc, apiCallLog(user, channel, billingOrderID, capability, protocol, c.Request.Method, path, target, body, c.GetHeader("Content-Type"), status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), responseBody)
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
	callResult, logErr := logSystemProxyCall(svc, apiCallLog(user, channel, billingOrderID, capability, protocol, c.Request.Method, path, target, body, c.GetHeader("Content-Type"), status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), responseBody)
	if isAsyncContinuation {
		handleSystemProxyAsyncContinuation(svc, asyncBillingOrder, channelModel, asyncTaskID, asyncOperation, callResult, statusCode, logErr, responseBody)
	} else if c.Request.Method == http.MethodPost && channelModel != nil && svc.SystemProxySupportsPolling(string(protocol)) {
		handleSystemProxyAsyncCreate(svc, billingOrderID, user.ID, channel.ID, channelModel, callResult, statusCode, logErr, responseBody)
	} else if status == model.ApiCallStatusSucceeded {
		if logErr != nil {
			markSystemProxyBillingUncertain(svc, billingOrderID, "上游成功但调用日志写入失败，费用状态待核对")
		} else if err := svc.SettleBilling(billingOrderID, ""); err != nil {
			markSystemProxyBillingUncertain(svc, billingOrderID, "上游成功但积分结算失败，费用状态待核对")
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

// resendIfStreamUsageRejected 处理严格 schema 上游（如 Mistral）拒收宿主补上的 stream_options：
// 400/422 且错误里点名该字段时，按浏览器原始请求体重发一次。被拒的请求没有进入生成，不会重复计费；
// 其他响应原样交回，错误体已读出的部分会放回 Body，后续读取和日志不受影响。
func validSystemProxyIdempotencyKey(value string) bool {
	value = strings.TrimSpace(value)
	return value != "" && len(value) <= 128
}

func systemProxyTaskIDCandidates(requestPath string, query url.Values, body []byte, relayTaskID string) []string {
	seen := make(map[string]struct{})
	result := make([]string, 0, 8)
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || len(value) > 160 || strings.ContainsAny(value, "\r\n\x00") {
			return
		}
		if _, exists := seen[value]; exists {
			return
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	add(relayTaskID)
	for _, key := range []string{"task_id", "taskId", "request_id", "requestId", "video_id", "videoId", "id", "name"} {
		for _, value := range query[key] {
			add(value)
		}
	}
	if strings.Contains(requestPath, "/operations/") {
		if index := strings.Index(requestPath, "/operations/"); index >= 0 {
			add(strings.TrimPrefix(requestPath[index+1:], "/"))
		}
	}
	segments := strings.Split(strings.Trim(requestPath, "/"), "/")
	if len(segments) > 0 {
		if len(segments) > 1 && strings.EqualFold(segments[len(segments)-1], "content") {
			parent, err := url.PathUnescape(segments[len(segments)-2])
			if err == nil {
				add(parent)
			}
		}
		last, err := url.PathUnescape(segments[len(segments)-1])
		if err == nil {
			add(last)
		}
	}
	var payload map[string]any
	if json.Unmarshal(body, &payload) == nil {
		for _, key := range []string{"task_id", "taskId", "request_id", "requestId", "video_id", "videoId", "id", "name"} {
			if value, ok := payload[key].(string); ok {
				add(value)
			}
		}
		for _, key := range []string{"task", "data"} {
			if nested, ok := payload[key].(map[string]any); ok {
				for _, field := range []string{"task_id", "taskId", "request_id", "requestId", "video_id", "videoId", "id", "name"} {
					if value, ok := nested[field].(string); ok {
						add(value)
					}
				}
			}
		}
	}
	return result
}

func systemProxyTaskIDMatches(routeTaskID string, billingTaskID string) bool {
	if routeTaskID == billingTaskID {
		return true
	}
	return strings.HasSuffix(billingTaskID, "/"+routeTaskID)
}

func handleSystemProxyAsyncCreate(svc *service.Service, billingOrderID string, userID string, channelID string, channelModel *model.ChannelModel, call systemProxyCallResult, statusCode int, logErr error, responseBody []byte) {
	if billingOrderID == "" {
		return
	}
	if call.Status != model.ApiCallStatusSucceeded {
		if statusCode == 524 || call.StatusCode == 0 {
			markSystemProxyBillingUncertain(svc, billingOrderID, "异步上游创建状态不明确，费用待核对")
		} else {
			refundSystemProxyBilling(svc, billingOrderID, "异步上游明确拒绝创建")
		}
		return
	}
	if logErr != nil {
		markSystemProxyBillingUncertain(svc, billingOrderID, "异步任务已创建但调用记录写入失败，费用待核对")
		return
	}
	result, parseErr := svc.ParseSystemProxyAsyncResponse(string(channelModel.Protocol), channelModel.Capability, channelModel.ModelKey, "", "create", responseBody)
	if parseErr != nil {
		if call.ProviderRequestID != "" {
			result = &service.SystemProxyAsyncResult{TaskID: call.ProviderRequestID}
		} else {
			markSystemProxyBillingUncertain(svc, billingOrderID, "异步上游响应无法解析且没有可核对的任务 ID，费用待核对")
			return
		}
	}
	if result.TaskID == "" {
		result.TaskID = call.ProviderRequestID
	}
	if call.ProviderRequestID != "" && result.TaskID != "" && !systemProxyTaskIDMatches(call.ProviderRequestID, result.TaskID) && !systemProxyTaskIDMatches(result.TaskID, call.ProviderRequestID) {
		markSystemProxyBillingUncertain(svc, billingOrderID, "异步上游返回了不一致的任务标识，费用待核对")
		return
	}
	status := strings.ToLower(strings.TrimSpace(string(result.Status)))
	if status == "" {
		status = strings.ToLower(strings.TrimSpace(call.ProviderStatus))
	}
	if status == "failed" || status == "failure" || status == "error" || status == "cancelled" || status == "canceled" {
		refundSystemProxyBilling(svc, billingOrderID, "异步上游确认生成失败")
		return
	}
	linkTask := func() bool {
		if result.TaskID == "" {
			markSystemProxyBillingUncertain(svc, billingOrderID, "异步任务缺少可核对的上游任务 ID，费用待核对")
			return false
		}
		if linkErr := svc.LinkSystemProxyBillingTask(billingOrderID, userID, channelID, result.TaskID); linkErr != nil {
			markSystemProxyBillingUncertain(svc, billingOrderID, "异步任务已创建但账单无法关联，费用待核对")
			return false
		}
		return true
	}
	switch status {
	case "queued", "pending", "processing", "running", "in_progress", "in-progress":
		linkTask()
		return
	case "succeeded", "success", "completed", "complete", "done":
		if result.RequiresResultRequest && !result.HasResult {
			linkTask()
			return
		}
		if err := svc.SettleBilling(billingOrderID, result.TaskID); err != nil {
			markSystemProxyBillingUncertain(svc, billingOrderID, "生成请求成功但积分结算失败，费用状态待核对")
		}
	default:
		if result.TaskID != "" && !linkTask() {
			return
		}
		markSystemProxyBillingUncertain(svc, billingOrderID, "异步上游返回未知创建状态，费用待核对")
	}
}

func handleSystemProxyAsyncContinuation(svc *service.Service, order *model.BillingOrder, channelModel *model.ChannelModel, taskID string, operation string, call systemProxyCallResult, statusCode int, logErr error, responseBody []byte) {
	if order == nil {
		return
	}
	if statusCode < 200 || statusCode >= 300 {
		markSystemProxyBillingUncertain(svc, order.ID, "异步上游查询或取结果失败，费用待核对")
		return
	}
	if logErr != nil {
		markSystemProxyBillingUncertain(svc, order.ID, "异步任务状态已返回但调用记录写入失败，费用待核对")
		return
	}
	if operation == "result" {
		if err := svc.SettleBilling(order.ID, order.ProviderRequestID); err != nil {
			markSystemProxyBillingUncertain(svc, order.ID, "异步结果已返回但积分结算失败，费用待核对")
		}
		return
	}
	if channelModel == nil {
		markSystemProxyBillingUncertain(svc, order.ID, "异步任务模型无法确认，费用待核对")
		return
	}
	parsed, parseErr := svc.ParseSystemProxyAsyncResponse(string(channelModel.Protocol), channelModel.Capability, order.Model, taskID, "poll", responseBody)
	status := ""
	if parseErr == nil && parsed != nil {
		status = string(parsed.Status)
	}
	if status == "" {
		status = strings.ToLower(strings.TrimSpace(call.ProviderStatus))
	}
	switch status {
	case "queued", "pending", "processing", "running", "in_progress", "in-progress":
		return
	case "failed", "failure", "error", "cancelled", "canceled":
		refundSystemProxyBilling(svc, order.ID, "异步上游确认生成失败")
		return
	case "succeeded", "success", "completed", "complete", "done":
		if parseErr == nil && parsed != nil && parsed.RequiresResultRequest && !parsed.HasResult {
			return
		}
		if err := svc.SettleBilling(order.ID, order.ProviderRequestID); err != nil {
			markSystemProxyBillingUncertain(svc, order.ID, "异步任务成功但积分结算失败，费用状态待核对")
		}
		return
	default:
		markSystemProxyBillingUncertain(svc, order.ID, "异步上游返回未知状态，费用待核对")
	}
}

func resendIfStreamUsageRejected(resp *http.Response, limit int64, resend func() (*http.Response, error)) (*http.Response, error) {
	if resp.StatusCode != http.StatusBadRequest && resp.StatusCode != http.StatusUnprocessableEntity {
		return resp, nil
	}
	data, readErr := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	_ = resp.Body.Close()
	if readErr == nil && service.StreamUsageOptionRejectedResponse(resp.StatusCode, data) {
		return resend()
	}
	resp.Body = io.NopCloser(bytes.NewReader(data))
	return resp, nil
}

func refundSystemProxyBilling(svc *service.Service, billingOrderID string, reason string) {
	if billingOrderID == "" {
		return
	}
	if err := svc.RefundBilling(billingOrderID, reason); err != nil {
		log.Printf("system proxy billing refund failed: billing_order_id=%s", billingOrderID)
		// 退款写失败不能当没发生：转待核对，避免订单停在 running 被当成已扣费。
		markSystemProxyBillingUncertain(svc, billingOrderID, "退款失败，费用状态待核对")
	}
}

func markSystemProxyBillingUncertain(svc *service.Service, billingOrderID string, reason string) {
	if billingOrderID == "" {
		return
	}
	if err := svc.MarkBillingUncertain(billingOrderID, reason); err != nil {
		log.Printf("system proxy billing uncertainty update failed: billing_order_id=%s", billingOrderID)
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
		// Request and response content can contain prompts, references, or
		// generated material. Keep operational metadata only.
		RequestBody: "",
	}
}

type systemProxyCallResult struct {
	Status            model.ApiCallStatus
	StatusCode        int
	ProviderRequestID string
	ProviderStatus    string
}

func logSystemProxyCall(svc *service.Service, log model.ApiCallLog, responseBody []byte) (systemProxyCallResult, error) {
	svc.EnrichAPICallLog(&log, responseBody)
	result := systemProxyCallResult{Status: log.Status, StatusCode: log.StatusCode, ProviderRequestID: log.ProviderRequestID, ProviderStatus: log.ProviderStatus}
	minimizeSystemProxyLog(&log)
	return result, svc.LogAPICall(log)
}

// Upstream error messages and URLs can echo request content or signed media URLs.
// Extract usage first, then retain only the operational fields needed for billing.
func minimizeSystemProxyLog(log *model.ApiCallLog) {
	log.RequestBody = ""
	log.ResponseBody = ""
	log.Error = ""
	log.ErrorCode = ""
	log.UpstreamURL = ""
	log.Path = ""
	log.Model = ""
	log.ProviderRequestID = ""
	log.ProviderStatus = ""
	log.RequestContentType = ""
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
	user, err := svc.CurrentUser(sessionCookie(c))
	if err != nil {
		return nil, err
	}
	if expected := c.GetHeader("X-Canvas-Expected-User"); expected != "" && expected != user.ID {
		return nil, service.Forbidden("账号已切换，请重新加载后重试")
	}
	return user, nil
}

func sessionCookie(c *gin.Context) string {
	if value, err := c.Cookie(service.SessionCookieName); err == nil && strings.TrimSpace(value) != "" {
		return value
	}
	// Desktop clients cannot share the browser's HttpOnly cookie jar with the
	// embedded backend. Accept the same opaque server session as a Bearer token;
	// this does not grant API-key or administrator privileges.
	const prefix = "Bearer "
	header := strings.TrimSpace(c.GetHeader("Authorization"))
	if len(header) > len(prefix) && strings.EqualFold(header[:len(prefix)], prefix) {
		return strings.TrimSpace(header[len(prefix):])
	}
	return ""
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

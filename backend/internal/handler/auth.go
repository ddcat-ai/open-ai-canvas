package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAuthRoutes(r *gin.RouterGroup, svc *service.Service) {
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
		if err := svc.SendRegistrationEmailCode(req.Email); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"sent": true})
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
		target, err := svc.BeginLinuxDOLogin(c.Query("next"))
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
		channels, _ := svc.PublicSystemChannels()
		limits, err := svc.PublicRuntimeLimits()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"user": publicUser, "systemChannels": channels, "runtimeLimits": limits})
	})
	r.GET("/channels/system", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
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
	r.GET("/admin/users", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		users, err := svc.AdminUsers(user, service.AdminListQuery{Keyword: c.Query("keyword"), Type: c.Query("role"), Status: c.Query("status"), Page: page, Limit: limit})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, users)
	})
	r.GET("/admin/references", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		data, err := svc.AdminReferences(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, data)
	})
	r.POST("/admin/users/bulk-disable", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.BulkDisableUsersRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.BulkDisableUsers(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/users/:id/detail", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminUserDetail(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/users/:id/ledger", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		result, err := svc.AdminUserLedger(user, c.Param("id"), c.Query("type"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/users/:id/tasks", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		result, err := svc.AdminUserTasks(user, c.Param("id"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/users/:id/audit-events", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		result, err := svc.AdminUserAuditEvents(user, c.Param("id"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.PATCH("/admin/users/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.UpdateUserRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		updated, err := svc.UpdateUser(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"user": updated})
	})
	r.DELETE("/admin/users/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteUser(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	r.GET("/admin/channels", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		channels, err := svc.AdminSystemChannelPage(user, service.AdminListQuery{Keyword: c.Query("keyword"), Type: c.Query("interfaceType"), Status: c.Query("status"), Page: page, Limit: limit})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, channels)
	})
	r.POST("/admin/channels", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.ChannelRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		channel, err := svc.CreateSystemChannel(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channel": channel})
	})
	r.PATCH("/admin/channels/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.ChannelRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		channel, err := svc.UpdateSystemChannel(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channel": channel})
	})
	r.DELETE("/admin/channels/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteSystemChannel(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	r.GET("/admin/storyboard-prompts", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		templates, variables, err := svc.AdminStoryboardPromptTemplates(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"templates": templates, "variables": variables})
	})
	r.POST("/admin/storyboard-prompts", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.StoryboardPromptTemplateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		template, err := svc.CreateStoryboardPromptTemplate(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"template": template})
	})
	r.PATCH("/admin/storyboard-prompts/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.StoryboardPromptTemplateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		template, err := svc.UpdateStoryboardPromptTemplate(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"template": template})
	})
	r.DELETE("/admin/storyboard-prompts/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteStoryboardPromptTemplate(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	r.GET("/admin/settings/oss", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.AdminOSSSetting(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	r.PATCH("/admin/settings/oss", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.OSSSettingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		setting, err := svc.UpdateOSSSetting(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	r.GET("/admin/settings/runtime-policy", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.AdminRuntimePolicySetting(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	r.GET("/admin/settings/runtime-policy/self-use", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.AdminSelfUseRuntimePolicy(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	r.PUT("/admin/settings/runtime-policy", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.RuntimePolicySetting
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		setting, err := svc.UpdateRuntimePolicySetting(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	r.DELETE("/admin/settings/runtime-policy", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.ResetRuntimePolicySetting(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	r.GET("/admin/api-logs", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		logs, err := svc.AdminAPICallLogs(user, service.APICallLogQuery{AnalyticsQuery: analyticsQuery(c), Keyword: c.Query("keyword"), Status: c.Query("status"), Page: page, Limit: limit})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, logs)
	})
	r.GET("/admin/api-logs/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		log, err := svc.AdminAPICallLog(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"log": log})
	})
	r.GET("/admin/api-logs-export.csv", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		selectedIDs := []string(nil)
		if value := strings.TrimSpace(c.Query("ids")); value != "" {
			selectedIDs = strings.Split(value, ",")
		}
		data, err := svc.AdminAPICallLogsCSV(user, service.APICallLogQuery{AnalyticsQuery: analyticsQuery(c), Keyword: c.Query("keyword"), Status: c.Query("status"), IDs: selectedIDs})
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Content-Disposition", "attachment; filename=api-calls-"+time.Now().UTC().Format("20060102-150405")+".csv")
		c.Data(http.StatusOK, "text/csv; charset=utf-8", data)
	})
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

func proxySystemRequest(c *gin.Context, svc *service.Service, user *model.User, channel *model.ModelChannel) {
	startedAt := time.Now()
	policy, available := loadRuntimePolicy(c, svc)
	if !available || !enforceRateLimit(c, "system-proxy:"+user.ID, policy.Request.SystemRelayPerMinute, time.Minute) {
		return
	}
	path := c.Param("path")
	if path == "" {
		path = "/"
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, policy.Request.SystemRelayRequestMB<<20)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	if err := authorizeSystemProxy(channel, c.Request.Method, path, c.GetHeader("Content-Type"), body); err != nil {
		fail(c, http.StatusForbidden, err)
		return
	}
	modelName := proxyRequestModel(c.GetHeader("Content-Type"), body)
	billingOrderID := ""
	query := c.Request.URL.Query()
	for _, key := range []string{"key", "api_key", "access_token", "token"} {
		query.Del(key)
	}
	target := strings.TrimRight(channel.BaseURL, "/") + path
	if encodedQuery := query.Encode(); encodedQuery != "" {
		target += "?" + encodedQuery
	}
	if _, err := service.ValidateOutboundURL(target); err != nil {
		_ = svc.RefundBilling(billingOrderID, "系统渠道地址校验失败")
		failService(c, err)
		return
	}
	// 同步代理与后台任务必须共享渠道槽位，否则两条入口会共同超过供应商并发上限。
	releaseChannel, concurrencyLimit, err := svc.AcquireChannelSlot(c.Request.Context(), channel.ID, "", 36*time.Minute)
	if err != nil {
		log := apiCallLog(user, channel, billingOrderID, c.Request.Method, path, target, body, model.ApiCallStatusFailed, 0, time.Since(startedAt), err.Error(), concurrencyLimit)
		log.ErrorCode, log.Error = service.ChannelSlotFailureDetails(err)
		logSystemProxyCall(svc, log, nil)
		fail(c, http.StatusServiceUnavailable, err)
		return
	}
	defer releaseChannel()
	if c.Request.Method == http.MethodPost {
		capability := "text"
		switch channel.InterfaceType {
		case model.ChannelInterfaceOpenAIImage:
			capability = "image"
		case model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceNewAPIChannel1, model.ChannelInterfaceNewAPIChannel2, model.ChannelInterfaceXAIVideo:
			capability = "video"
		}
		order, err := svc.ReserveProxyBilling(user.ID, channel.ID, strings.TrimPrefix(modelName, "models/"), capability, c.GetHeader("X-Canvas-Scene"), c.GetHeader("X-Idempotency-Key"))
		if err != nil {
			failService(c, err)
			return
		}
		billingOrderID = order.ID
		if err := svc.MarkBillingRunning(billingOrderID); err != nil {
			_ = svc.RefundBilling(billingOrderID, "系统渠道请求尚未发出")
			failService(c, err)
			return
		}
	}
	upstreamReq, err := http.NewRequestWithContext(c.Request.Context(), c.Request.Method, target, bytes.NewReader(body))
	if err != nil {
		_ = svc.RefundBilling(billingOrderID, "系统渠道请求构造失败")
		fail(c, http.StatusBadRequest, err)
		return
	}
	if contentType := c.GetHeader("Content-Type"); contentType != "" {
		upstreamReq.Header.Set("Content-Type", contentType)
	}
	if accept := c.GetHeader("Accept"); accept != "" {
		upstreamReq.Header.Set("Accept", accept)
	}
	if channel.APIFormat == "gemini" {
		upstreamReq.Header.Set("x-goog-api-key", channel.APIKey)
	} else {
		upstreamReq.Header.Set("Authorization", "Bearer "+channel.APIKey)
	}

	status := model.ApiCallStatusSucceeded
	statusCode := 0
	errorText := ""
	resp, err := service.OutboundHTTPClient(35 * time.Minute).Do(upstreamReq)
	if err != nil {
		status = model.ApiCallStatusFailed
		errorText = err.Error()
		_ = svc.MarkBillingUncertain(billingOrderID, "系统渠道连接中断，费用状态待核对")
		logSystemProxyCall(svc, apiCallLog(user, channel, billingOrderID, c.Request.Method, path, target, body, status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), nil)
		fail(c, http.StatusBadGateway, errors.New("系统渠道连接失败"))
		return
	}
	defer resp.Body.Close()
	statusCode = resp.StatusCode
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		status = model.ApiCallStatusFailed
	}
	responseLimit := policy.Request.SystemRelayResponseMB << 20
	responseBody, readErr := io.ReadAll(io.LimitReader(resp.Body, responseLimit+1))
	if readErr != nil {
		status = model.ApiCallStatusFailed
		errorText = readErr.Error()
		_ = svc.MarkBillingUncertain(billingOrderID, "系统渠道响应读取失败，费用状态待核对")
		logSystemProxyCall(svc, apiCallLog(user, channel, billingOrderID, c.Request.Method, path, target, body, status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), nil)
		fail(c, http.StatusBadGateway, errors.New("系统渠道响应读取失败"))
		return
	}
	if int64(len(responseBody)) > responseLimit {
		_ = svc.MarkBillingUncertain(billingOrderID, "上游已响应但响应体超过限制，费用状态待核对")
		fail(c, http.StatusBadGateway, fmt.Errorf("系统渠道响应超过 %dMB 限制", policy.Request.SystemRelayResponseMB))
		return
	}
	if status == model.ApiCallStatusSucceeded {
		if err := svc.SettleBilling(billingOrderID, ""); err != nil {
			_ = svc.MarkBillingUncertain(billingOrderID, "上游成功但积分结算失败："+err.Error())
		}
	} else if statusCode == 524 {
		_ = svc.MarkBillingUncertain(billingOrderID, "上游返回 524，费用状态待核对")
	} else {
		_ = svc.RefundBilling(billingOrderID, "上游明确返回失败")
	}
	logSystemProxyCall(svc, apiCallLog(user, channel, billingOrderID, c.Request.Method, path, target, body, status, statusCode, time.Since(startedAt), errorText, concurrencyLimit), responseBody)
	for _, key := range []string{"Content-Type", "Cache-Control", "Content-Disposition"} {
		if value := resp.Header.Get(key); value != "" {
			c.Header(key, value)
		}
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(resp.StatusCode, resp.Header.Get("Content-Type"), responseBody)
}

func apiCallLog(user *model.User, channel *model.ModelChannel, billingOrderID string, method string, path string, target string, body []byte, status model.ApiCallStatus, statusCode int, duration time.Duration, errorText string, concurrencyLimit int) model.ApiCallLog {
	capability := "text"
	switch channel.InterfaceType {
	case model.ChannelInterfaceOpenAIImage:
		capability = "image"
	case model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceNewAPIChannel1, model.ChannelInterfaceNewAPIChannel2, model.ChannelInterfaceXAIVideo:
		capability = "video"
	}
	requestKind := "create"
	if method == http.MethodGet {
		requestKind = "poll"
		if strings.HasSuffix(strings.TrimRight(path, "/"), "/content") {
			requestKind = "download"
		}
	}
	return model.ApiCallLog{
		UserID:           user.ID,
		ChannelID:        channel.ID,
		BillingOrderID:   billingOrderID,
		Source:           "system-channel",
		Capability:       capability,
		RequestKind:      requestKind,
		Billable:         method == http.MethodPost,
		APIFormat:        channel.APIFormat,
		Method:           method,
		Path:             path,
		Model:            readPayloadModel(body),
		Status:           status,
		StatusCode:       statusCode,
		DurationMs:       duration.Milliseconds(),
		Error:            errorText,
		ConcurrencyLimit: concurrencyLimit,
		UpstreamURL:      target,
	}
}

func logSystemProxyCall(svc *service.Service, log model.ApiCallLog, responseBody []byte) {
	svc.EnrichAPICallLog(&log, responseBody)
	_ = svc.LogAPICall(log)
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

func failService(c *gin.Context, err error) {
	var authErr *service.AuthError
	if errors.As(err, &authErr) {
		fail(c, authErr.Status, errors.New(authErr.Message))
		return
	}
	fail(c, http.StatusInternalServerError, err)
}

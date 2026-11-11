package handler

import (
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAdminSystemPerformanceRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/system-performance", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminSystemPerformance(c.Request.Context(), actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/admin/system-performance/rainyun-realtime", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminRainyunRealtime(c.Request.Context(), actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/admin/settings/rainyun-monitor", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminRainyunMonitorSetting(c.Request.Context(), actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.PATCH("/admin/settings/rainyun-monitor", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		// 鉴权后才读取请求体；绑定失败统一提示，不回显请求中的管理密钥。
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var input struct {
			Enabled    *bool   `json:"enabled"`
			InstanceID *int64  `json:"instanceId"`
			APIKey     *string `json:"apiKey"`
		}
		if err := c.ShouldBindJSON(&input); err != nil || input.Enabled == nil || input.InstanceID == nil || input.APIKey == nil {
			failService(c, service.BadAuthRequest("雨云监控配置请求无效，须完整提交 enabled、instanceId 和 apiKey"))
			return
		}
		request := service.RainyunMonitorSettingRequest{Enabled: *input.Enabled, InstanceID: *input.InstanceID, APIKey: *input.APIKey}
		result, err := svc.UpdateRainyunMonitorSetting(c.Request.Context(), actor, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.PUT("/admin/system-performance/agent-limit", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var request service.AgentSessionLimitRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			failService(c, service.BadAuthRequest("Agent 并发请求无效"))
			return
		}
		result, err := svc.UpdateAgentSessionLimit(c.Request.Context(), actor, request.MaxSessions)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/admin/system-performance/cache/clear", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var request service.AdminCacheClearRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			failService(c, service.BadAuthRequest("缓存清理请求无效"))
			return
		}
		result, err := svc.ClearAdminRuntimeCache(c.Request.Context(), actor, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

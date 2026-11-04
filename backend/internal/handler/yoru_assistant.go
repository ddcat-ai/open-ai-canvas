package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func RegisterYoruAssistantRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/public/yoru", func(c *gin.Context) {
		actor, _ := currentUser(c, svc)
		setting, err := svc.PublicYoruSettings(actor)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, setting)
	})
	r.GET("/admin/settings/yoru", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(actor); err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.YoruSettings()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, setting)
	})
	r.PUT("/admin/settings/yoru", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 48<<10)
		var req service.YoruSettings
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		setting, err := svc.UpdateYoruSettings(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, setting)
	})
	r.POST("/yoru/messages", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "yoru:"+actor.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 24<<10)
		var req service.YoruChatRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		task, err := svc.CreateYoruChatTask(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, task)
	})
}

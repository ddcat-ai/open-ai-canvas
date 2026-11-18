package handler

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerChatGPTPlanRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/chatgpt-plan", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		status, err := svc.ChatGPTPlanConnectionStatus(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, status)
	})
	r.POST("/admin/chatgpt-plan/start", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "chatgpt-plan-start:"+actor.ID, 3, time.Minute) {
			return
		}
		url, err := svc.StartChatGPTPlanConnection(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"authorizationUrl": url})
	})
	r.POST("/admin/chatgpt-plan/disconnect", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		confirmed, err := svc.DisconnectChatGPTPlan(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"revocationConfirmed": confirmed})
	})
	r.GET("/admin/chatgpt-plan/models", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		models, err := svc.ListChatGPTPlanModels(c.Request.Context(), actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"models": models})
	})
	r.POST("/admin/chatgpt-plan/models", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var request struct {
			Slug string `json:"slug"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.AddChatGPTPlanModel(c.Request.Context(), actor, strings.TrimSpace(request.Slug))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"model": item})
	})
}

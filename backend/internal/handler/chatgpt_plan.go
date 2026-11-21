package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerChatGPTPlanRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/chatgpt-plan", func(c *gin.Context) {
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
	r.POST("/chatgpt-plan/start", func(c *gin.Context) {
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
	r.POST("/chatgpt-plan/disconnect", func(c *gin.Context) {
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
	r.GET("/chatgpt-plan/models", func(c *gin.Context) {
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
	r.PUT("/chatgpt-plan/models", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var request struct {
			Slugs []string `json:"slugs"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.SaveChatGPTPlanModels(c.Request.Context(), actor, request.Slugs); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"saved": true})
	})
}

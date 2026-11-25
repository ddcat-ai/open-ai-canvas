package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/protocol"
	"yingce/backend/internal/service"
)

func registerRequestProtocolRoutes(r *gin.RouterGroup, svc *service.Service) {
	routes := r.Group("/admin/request-protocols")
	routes.GET("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.AdminRequestProtocols(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"protocols": items})
	})
	routes.POST("/check", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 3*protocol.PluginManifestMaxBytes)
		var request service.RequestProtocolCheck
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.AdminCheckRequestProtocol(c.Request.Context(), user, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	routes.POST("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 3*protocol.PluginManifestMaxBytes)
		var request service.PublishRequestProtocolRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.AdminPublishRequestProtocol(c.Request.Context(), user, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"protocol": result})
	})
}

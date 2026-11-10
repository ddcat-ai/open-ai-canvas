package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerChannelWebsiteRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/channels/:id/catalog-status", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminChannelCatalogStatus(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/channel-websites", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		sites, err := svc.AdminChannelWebsites(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"websites": sites})
	})
	save := func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.ChannelWebsiteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		site, err := svc.SaveAdminChannelWebsite(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"website": site})
	}
	r.POST("/admin/channel-websites", save)
	r.PATCH("/admin/channel-websites/:id", save)
	r.DELETE("/admin/channel-websites/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteAdminChannelWebsite(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	r.GET("/admin/channels/:id/protocol-suggestion", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminChannelProtocolSuggestion(user, c.Param("id"), c.Query("providerModelKey"), c.Query("capability"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

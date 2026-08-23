package handler

import (
	"strings"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterProtocolRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/protocols", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		scope := strings.TrimSpace(c.DefaultQuery("scope", "user.custom-channel"))
		capability := strings.TrimSpace(c.Query("capability"))
		ok(c, gin.H{"protocols": svc.ProtocolCatalog(scope, capability, false)})
	})
	r.GET("/admin/protocols", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		includeUnavailable := c.Query("includeUnavailable") == "1"
		capability := strings.TrimSpace(c.Query("capability"))
		ok(c, gin.H{"protocols": svc.ProtocolCatalog("admin.system-channel", capability, includeUnavailable)})
	})
}

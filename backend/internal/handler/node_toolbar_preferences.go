package handler

import (
	"net/http"
	"time"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func registerNodeToolbarPreferenceRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/settings/node-toolbar", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		preferences, err := svc.UserNodeToolbarPreferences(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"preferences": preferences})
	})
	r.PUT("/settings/node-toolbar/:nodeType", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "node-toolbar-write:"+user.ID, policy.Request.CanvasWritePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.NodeToolbarPreferenceRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		entries, err := svc.UpdateUserNodeToolbarPreference(user, c.Param("nodeType"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"pinnedEntryIds": entries})
	})
	r.DELETE("/settings/node-toolbar/:nodeType", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "node-toolbar-write:"+user.ID, policy.Request.CanvasWritePerMinute, time.Minute) {
			return
		}
		if err := svc.ResetUserNodeToolbarPreference(user, c.Param("nodeType")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"nodeType": c.Param("nodeType")})
	})
}

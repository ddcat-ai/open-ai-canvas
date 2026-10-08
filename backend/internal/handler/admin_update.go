package handler

import (
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAdminUpdateRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/system-update", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		status, err := svc.AdminUpdateStatus(c.Request.Context(), actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, status)
	})
	r.POST("/admin/system-update/check", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		status, err := svc.AdminCheckUpdate(c.Request.Context(), actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, status)
	})
	r.POST("/admin/system-update/start", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var request struct {
			TargetVersion string `json:"targetVersion" binding:"required"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		status, err := svc.AdminStartUpdate(c.Request.Context(), actor, request.TargetVersion)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, status)
	})
	r.POST("/admin/system-update/rollback", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var request struct {
			Reason string `json:"reason" binding:"required"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		status, err := svc.AdminRollbackUpdate(c.Request.Context(), actor, request.Reason)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, status)
	})
}

package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/canvas"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterCanvasBranchRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/canvas-projects/:id/branch-context", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		context, err := svc.CanvasCollaboration().CanvasBranchContextForUser(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"context": context})
	})

	r.GET("/canvas-projects/:id/branches", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		branches, err := svc.CanvasCollaboration().CanvasBranchesForUser(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"branches": branches})
	})

	r.POST("/canvas-projects/:id/branches", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req canvas.CanvasBranchCreateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("独立方案请求格式错误"))
			return
		}
		result, err := svc.CanvasCollaboration().CreateCanvasBranchForUser(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/canvas-branches/:branchId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.CanvasCollaboration().CanvasBranchForUser(user, c.Param("branchId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/canvas-branches/:branchId/merge-preview", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req canvas.CanvasBranchMergePreviewRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("合并预览请求格式错误"))
			return
		}
		result, err := svc.CanvasCollaboration().CanvasBranchMergePreviewForUser(user, c.Param("branchId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/canvas-branches/:branchId/merge", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<20)
		var req canvas.CanvasBranchMergeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("合并请求格式错误"))
			return
		}
		result, err := svc.CanvasCollaboration().MergeCanvasBranchForUser(user, c.Param("branchId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/canvas-branches/:branchId/archive", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.CanvasCollaboration().ArchiveCanvasBranchForUser(user, c.Param("branchId")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"branchId": c.Param("branchId"), "status": "archived"})
	})
}

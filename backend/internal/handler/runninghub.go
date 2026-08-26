package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterRunningHubRoutes 是独立工作流 Provider 的管理代理，不复用 ModelChannel。
func RegisterRunningHubRoutes(r *gin.RouterGroup, svc *service.Service) {
	fetch := func(c *gin.Context, app bool) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireWorkflowPluginForInterface("runninghub-workflow-image"); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
		var req service.RunningHubWorkflowFetchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		var result map[string]any
		var err error
		if app {
			result, err = svc.FetchRunningHubAppInfo(c.Request.Context(), req)
		} else {
			result, err = svc.FetchRunningHubWorkflowInfo(c.Request.Context(), req)
		}
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
	r.POST("/runninghub/workflow-info", func(c *gin.Context) { fetch(c, false) })
	r.POST("/runninghub/app-info", func(c *gin.Context) { fetch(c, true) })
}

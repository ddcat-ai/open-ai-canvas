package handler

import (
	"fmt"
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterDiagnosticsRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/diagnostics/preview", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<20)
		var req service.DiagnosticExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		preview, err := svc.PreviewDiagnosticBundle(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, preview)
	})

	r.POST("/diagnostics/export", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<20)
		var req service.DiagnosticExportRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		bundle, err := svc.ExportDiagnosticBundle(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=%q", bundle.FileName))
		c.Header("X-Diagnostic-Bundle-ID", bundle.BundleID)
		c.Header("X-Diagnostic-Schema-Version", "1")
		c.Data(http.StatusOK, "application/zip", bundle.Data)
	})

}

package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAdminSystemPerformanceRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/system-performance", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminSystemPerformance(c.Request.Context(), actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/admin/system-performance/cache/clear", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4<<10)
		var request service.AdminCacheClearRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			failService(c, service.BadAuthRequest("缓存清理请求无效"))
			return
		}
		result, err := svc.ClearAdminRuntimeCache(c.Request.Context(), actor, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

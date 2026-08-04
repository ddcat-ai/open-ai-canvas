package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterFeatureAvailabilityRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/features", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.FeatureAvailability()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"features": setting})
	})

	r.GET("/admin/settings/features", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.AdminFeatureAvailability(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"features": setting})
	})

	r.PATCH("/admin/settings/features", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.FeatureAvailability
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		setting, err := svc.UpdateFeatureAvailability(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"features": setting})
	})
}

// 功能守卫先校验登录态再判断开放状态，避免关闭功能时改变未登录请求的认证语义。
func RequireFeature(svc *service.Service, feature string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		if err := svc.RequireFeature(feature); err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Next()
	}
}

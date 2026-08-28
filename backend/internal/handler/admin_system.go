package handler

import (
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterSystemInfoRoutes(r *gin.RouterGroup, svc *service.Service, commit string, buildTime string) {
	r.GET("/admin/system/instances", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"instances": service.CollectSystemInstances(commit, buildTime), "intervalSeconds": 30})
	})
}

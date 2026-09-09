package handler

import (
	"github.com/gin-gonic/gin"
	"infinite-canvas/backend/internal/service"
	"net/http"
)

func registerChannelOrderRoutes(r *gin.RouterGroup, svc *service.Service) {
	for _, path := range []string{"/admin/channels/order", "/admin/channels/:id/models/order"} {
		r.GET(path, func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			items, err := svc.AdminChannelOrder(user, c.Param("id"))
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"items": items})
		})
		r.PUT(path, func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
			var req service.ChannelOrderRequest
			if err := c.ShouldBindJSON(&req); err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			if err := svc.SaveAdminChannelOrder(user, c.Param("id"), req); err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"saved": true})
		})
	}
}

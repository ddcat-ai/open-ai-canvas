package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"yingce/backend/internal/service"
)

func registerCreationHistoryRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/creation-conversations", func(c *gin.Context) {
		ownerKey, err := currentContentKey(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		value, err := svc.ListCreationHistory(ownerKey, c.Query("after"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.GET("/creation-conversations/:id", func(c *gin.Context) {
		ownerKey, err := currentContentKey(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		value, err := svc.GetCreationHistory(ownerKey, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
	r.POST("/creation-conversations/:id/sync", func(c *gin.Context) {
		ownerKey, err := currentContentKey(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req service.CreationHistoryMutation
		if err = c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		value, err := svc.SyncCreationHistory(ownerKey, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, value)
	})
}

package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAdminStorageRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/admin/resources/delete", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AdminResourceDeleteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("删除资源请求无效"))
			return
		}
		result, err := svc.DeleteAdminResources(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/admin/storage/stats", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		stats, err := svc.AdminStorageStats(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"stats": stats})
	})

	r.GET("/admin/resources", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.AdminResourcePage(user, service.AdminResourceQuery{
			Keyword: c.Query("keyword"), Kind: c.Query("kind"), Status: c.Query("status"),
			Provider: c.Query("provider"), UserID: c.Query("userId"), Page: page, Limit: limit,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/admin/resources/:id/file", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		delivery, err := svc.PrepareResourceDeliveryAsAdmin(user, c.Param("id"), resourceAccessOptions(c), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		disposition := ""
		if c.Query("download") == "1" {
			disposition = "attachment"
		}
		serveResourceDelivery(c, delivery, "private, no-cache", disposition)
	})
}

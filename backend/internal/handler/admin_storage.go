package handler

import (
	"strconv"

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
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
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
		stream, err := svc.OpenResourceRangeAsAdmin(user, c.Param("id"), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		defer stream.Body.Close()
		mimeType := stream.Resource.MimeType
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
		c.Header("Cache-Control", "private, no-cache")
		c.Header("Accept-Ranges", stream.AcceptRanges)
		c.Header("X-Content-Type-Options", "nosniff")
		if stream.ContentRange != "" {
			c.Header("Content-Range", stream.ContentRange)
		}
		if c.Query("download") == "1" {
			c.Header("Content-Disposition", "attachment")
		}
		c.DataFromReader(stream.StatusCode, stream.ContentLength, mimeType, stream.Body, nil)
	})
}

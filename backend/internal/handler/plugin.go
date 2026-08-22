package handler

import (
	"net/http"
	"strconv"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterPluginRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/plugins/eagle/library", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		library, err := svc.EagleLibrary(c.Query("baseUrl"))
		if err != nil {
			failService(c, err)
			return
		}
		library.LibraryPath = ""
		ok(c, gin.H{"library": library})
	})
	r.GET("/plugins/eagle/items", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "60"))
		offset, _ := strconv.Atoi(c.DefaultQuery("offset", "0"))
		items, err := svc.EagleItems(c.Query("baseUrl"), service.EagleItemQuery{FolderID: c.Query("folderId"), Keyword: c.Query("keyword"), Limit: limit, Offset: offset})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": items})
	})
	r.GET("/plugins/eagle/items/:itemId/file", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		file, err := svc.OpenEagleItemFile(c.Query("baseUrl"), c.Param("itemId"))
		if err != nil {
			failService(c, err)
			return
		}
		defer file.Body.Close()
		c.Header("Cache-Control", "private, no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Content-Disposition", "attachment; filename=\""+file.Name+"\"")
		c.DataFromReader(http.StatusOK, file.Size, file.MimeType, file.Body, nil)
	})
	r.GET("/plugins/eagle/items/:itemId/thumbnail", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		file, err := svc.OpenEagleItemThumbnail(c.Query("baseUrl"), c.Param("itemId"))
		if err != nil {
			failService(c, err)
			return
		}
		defer file.Body.Close()
		c.Header("Cache-Control", "private, max-age=60")
		c.Header("X-Content-Type-Options", "nosniff")
		c.DataFromReader(http.StatusOK, file.Size, file.MimeType, file.Body, nil)
	})
	r.POST("/plugins/eagle/items", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 160<<20)
		var request service.EagleAddItemRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.AddEagleItem(c.Query("baseUrl"), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"item": item})
	})
	r.POST("/plugins/eagle/folders", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var request struct {
			Name     string `json:"name"`
			ParentID string `json:"parentId"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.CreateEagleFolder(c.Query("baseUrl"), request.Name, request.ParentID); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"created": true})
	})
}

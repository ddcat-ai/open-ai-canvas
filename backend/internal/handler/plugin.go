package handler

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterPluginRoutes(r *gin.RouterGroup, svc *service.Service) {
	pluginRoutes := r.Group("/plugins")
	pluginRoutes.Use(requirePluginCenterAccess(svc))
	// The frontend plugin center is the single management surface. Protocol
	// plugins are returned as kind=protocol records alongside UI plugins.
	pluginRoutes.GET("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		plugins, err := svc.PluginsForUser(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"plugins": plugins})
	})
	pluginRoutes.POST("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512<<10)
		var data []byte
		if strings.HasPrefix(strings.ToLower(c.GetHeader("Content-Type")), "multipart/form-data") {
			file, _, fileErr := c.Request.FormFile("file")
			if fileErr != nil {
				fail(c, http.StatusBadRequest, fileErr)
				return
			}
			defer file.Close()
			data, err = io.ReadAll(io.LimitReader(file, 512<<10+1))
		} else {
			data, err = io.ReadAll(io.LimitReader(c.Request.Body, 512<<10+1))
		}
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		plugin, err := svc.InstallPlugin(data)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"plugin": plugin})
	})
	pluginRoutes.POST("/:id/enable", pluginToggle(svc, true))
	pluginRoutes.POST("/:id/disable", pluginToggle(svc, false))
	pluginRoutes.DELETE("/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		if err := svc.UninstallPlugin(c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})

	pluginRoutes.GET("/eagle/library", func(c *gin.Context) {
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
	pluginRoutes.GET("/eagle/items", func(c *gin.Context) {
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
	pluginRoutes.GET("/eagle/items/:itemId/file", func(c *gin.Context) {
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
	pluginRoutes.GET("/eagle/items/:itemId/thumbnail", func(c *gin.Context) {
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
	pluginRoutes.POST("/eagle/items", func(c *gin.Context) {
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
	pluginRoutes.POST("/eagle/folders", func(c *gin.Context) {
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

func requirePluginCenterAccess(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		if user.Role == model.UserRoleAdmin {
			c.Next()
			return
		}
		if err := svc.RequireFeature(service.FeaturePluginCenter); err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Next()
	}
}

func pluginToggle(svc *service.Service, enabled bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		plugin, err := svc.SetPluginEnabled(c.Param("id"), enabled)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"plugin": plugin})
	}
}

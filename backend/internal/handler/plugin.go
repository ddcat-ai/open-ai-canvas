package handler

import (
	"io"
	"net/http"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterPluginRoutes(r *gin.RouterGroup, svc *service.Service) {
	statusRoutes := r.Group("/plugins")
	statusRoutes.GET("/status", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		states, err := svc.PluginStatesForUser(user)
		if err != nil {
			failService(c, err)
			return
		}
		statuses, err := svc.WorkflowPluginStatusesForUser(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"statuses": statuses, "states": states})
	})
	adminRoutes := r.Group("/admin/plugins")
	adminRoutes.GET("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		states, err := svc.AdminPluginStates(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"plugins": svc.Plugins(), "states": states})
	})
	adminRoutes.PUT("/:id/availability", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request struct {
			Available bool `json:"available"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		state, err := svc.SetPluginPlatformAvailability(user, c.Param("id"), request.Available)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"state": state})
	})
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
		states, err := svc.PluginStatesForUser(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"plugins": plugins, "states": states})
	})
	pluginRoutes.GET("/catalog", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		scope := strings.TrimSpace(c.DefaultQuery("scope", "user.custom-channel"))
		capability := strings.TrimSpace(c.Query("capability"))
		ok(c, gin.H{"providers": svc.PluginProviderCatalog(scope, capability, false)})
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
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, protocol.PluginPackageMaxBytes)
		var data []byte
		fileName := ""
		if strings.HasPrefix(strings.ToLower(c.GetHeader("Content-Type")), "multipart/form-data") {
			file, header, fileErr := c.Request.FormFile("file")
			if fileErr != nil {
				fail(c, http.StatusBadRequest, fileErr)
				return
			}
			defer file.Close()
			fileName = header.Filename
			data, err = io.ReadAll(io.LimitReader(file, protocol.PluginPackageMaxBytes+1))
		} else {
			data, err = io.ReadAll(io.LimitReader(c.Request.Body, protocol.PluginPackageMaxBytes+1))
		}
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		plugin, err := svc.InstallPluginForAdmin(user, data, fileName)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"plugin": plugin})
	})
	pluginRoutes.GET("/:id/package", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		visiblePlugins, err := svc.PluginsForUser(user)
		if err != nil {
			failService(c, err)
			return
		}
		visible := false
		for _, plugin := range visiblePlugins {
			if plugin.Manifest.ID == c.Param("id") {
				visible = true
				break
			}
		}
		if !visible {
			failService(c, service.Forbidden("无权访问该插件包"))
			return
		}
		data, fileName, err := svc.PluginPackage(c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		if fileName == "" {
			fileName = c.Param("id") + ".yingce-plugin"
		}
		c.Header("Cache-Control", "private, no-store")
		c.Header("Content-Disposition", "attachment; filename=\""+strings.ReplaceAll(fileName, "\"", "")+"\"")
		c.Data(http.StatusOK, "application/zip", data)
	})
	pluginRoutes.POST("/:id/enable", pluginToggle(svc, true))
	pluginRoutes.POST("/:id/disable", pluginToggle(svc, false))
	pluginRoutes.PUT("/:id/activation", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request struct {
			Enabled bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		state, err := svc.SetUserPluginEnabled(user, c.Param("id"), request.Enabled)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"state": state})
	})
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
		if err := svc.UninstallPluginForAdmin(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})

	pluginRoutes.GET("/eagle/library", func(c *gin.Context) {
		if _, allowed := requireEnabledPlugin(c, svc, service.PluginEagleAssetConnector); !allowed {
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
		if _, allowed := requireEnabledPlugin(c, svc, service.PluginEagleAssetConnector); !allowed {
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
		if _, allowed := requireEnabledPlugin(c, svc, service.PluginEagleAssetConnector); !allowed {
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
		if _, allowed := requireEnabledPlugin(c, svc, service.PluginEagleAssetConnector); !allowed {
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
		if _, allowed := requireEnabledPlugin(c, svc, service.PluginEagleAssetConnector); !allowed {
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
		if _, allowed := requireEnabledPlugin(c, svc, service.PluginEagleAssetConnector); !allowed {
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
		state, err := svc.SetPluginPlatformAvailability(user, c.Param("id"), enabled)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"state": state})
	}
}

func requireEnabledPlugin(c *gin.Context, svc *service.Service, pluginID string) (*model.User, bool) {
	user, err := currentUser(c, svc)
	if err == nil {
		err = svc.RequirePluginForUser(user.ID, pluginID)
	}
	if err != nil {
		failService(c, err)
		return nil, false
	}
	return user, true
}

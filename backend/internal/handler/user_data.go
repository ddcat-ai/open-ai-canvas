package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterUserDataRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/assets/batch", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			IDs []string `json:"ids"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		assets, err := svc.UserAssetsByIDs(user.ID, req.IDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"assets": assets})
	})
	r.GET("/settings/prompt-templates", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		preferences, err := svc.UserPromptPreferences(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"preferences": preferences})
	})
	r.PATCH("/settings/prompt-templates/:operation", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.UserPromptCustomizationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		customization, err := svc.UpdateUserPromptCustomization(user, c.Param("operation"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"customization": customization})
	})
	r.DELETE("/settings/prompt-templates/:operation", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.ResetUserPromptCustomization(user, c.Param("operation")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	r.GET("/settings/oss", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.UserOSSSetting(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	r.PATCH("/settings/oss", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.OSSSettingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		setting, err := svc.UpdateUserOSSSetting(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	r.POST("/settings/oss/test", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "user-storage-test:"+user.ID, 6, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.OSSSettingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.TestUserOSSSetting(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/resources", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
		resources, err := svc.Resources(user.ID, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resources": resources})
	})
	r.GET("/resources/storage-usage", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		usage, err := svc.AccountFileStorageUsage(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"usage": usage})
	})
	r.POST("/resources/:id/ark-private-asset", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "resources-ark-private-asset:"+user.ID, policy.Request.ResourceImportPerMinute, time.Minute) {
			return
		}
		result, err := svc.SyncResourceToArkPrivateAsset(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"sync": result})
	})
	r.POST("/resources", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "resources-upload:"+user.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, (policy.Resource.ResourceUploadMB<<20)+(1<<20))
		file, err := c.FormFile("file")
		if err != nil {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				// 超 MaxBytesReader 上限时 FormFile 返回英文 http 错误，转成与 service 配额校验一致的中文文案。
				fail(c, http.StatusBadRequest, fmt.Errorf("单个上传文件必须小于 %dMB", policy.Resource.ResourceUploadMB))
				return
			}
			fail(c, http.StatusBadRequest, err)
			return
		}
		width, _ := strconv.Atoi(c.PostForm("width"))
		height, _ := strconv.Atoi(c.PostForm("height"))
		durationMs, _ := strconv.ParseInt(c.PostForm("durationMs"), 10, 64)
		resource, err := svc.UploadResource(user.ID, file, c.PostForm("kind"), width, height, durationMs, c.GetHeader("X-Idempotency-Key"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resource": resource})
	})
	r.POST("/resources/import", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "resources-import:"+user.ID, policy.Request.ResourceImportPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req struct {
			URL        string `json:"url"`
			Kind       string `json:"kind"`
			Width      int    `json:"width"`
			Height     int    `json:"height"`
			DurationMs int64  `json:"durationMs"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		resource, err := svc.ImportResourceURL(user.ID, req.URL, req.Kind, req.Width, req.Height, req.DurationMs, c.GetHeader("X-Idempotency-Key"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resource": resource})
	})
	r.GET("/resources/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		resource, err := svc.Resource(user.ID, c.Param("id"))
		if err != nil {
			fail(c, http.StatusNotFound, err)
			return
		}
		ok(c, gin.H{"resource": resource})
	})
	r.GET("/resources/:id/oss-url", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		resource, err := svc.Resource(user.ID, c.Param("id"))
		if err != nil {
			fail(c, http.StatusNotFound, err)
			return
		}
		ossURL, err := svc.DirectResourceURL(user.ID, resource.ID)
		if err != nil {
			failService(c, err)
			return
		}
		// 签名地址只用于当前复制动作，禁止浏览器或中间代理缓存。
		c.Header("Cache-Control", "private, no-store")
		c.Header("Referrer-Policy", "no-referrer")
		ok(c, gin.H{"url": ossURL})
	})
	r.GET("/resources/:id/file", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		delivery, err := svc.PrepareResourceDelivery(user.ID, c.Param("id"), service.ResourceDeliveryOptions{
			ForceDirect: c.Query("direct") == "1",
			ForceProxy:  c.Query("proxy") == "1",
		})
		if err != nil {
			failService(c, err)
			return
		}
		if delivery.RedirectURL != "" {
			// CDN 或对象存储直连地址不进入应用缓存，也不作为后续请求的 Referer 泄露。
			c.Header("Cache-Control", "private, no-store")
			c.Header("Referrer-Policy", "no-referrer")
			c.Header("X-Content-Type-Options", "nosniff")
			c.Redirect(http.StatusTemporaryRedirect, delivery.RedirectURL)
			return
		}
		resource := delivery.Resource
		etag := resourceResponseETag(resource)
		// variant=playback：serve 浏览器兼容播放副本（H.265→H.264 转码）。
		// 副本就绪时用独立 ETag 后缀，避免浏览器拿原件缓存命中 304 而继续黑屏。
		usePlayback := c.Query("variant") == "playback" && resource.Provider == "local" &&
			resource.PlaybackStatus == model.PlaybackStatusReady && resource.PlaybackObjectKey != ""
		serveETag := etag
		if usePlayback {
			serveETag = etag + ":pb"
		}
		// 私有资源允许浏览器保存响应，但每次复用前必须重新鉴权；304 会在读取 OSS 前返回。
		c.Header("Cache-Control", "private, no-cache")
		c.Header("ETag", serveETag)
		c.Header("Accept-Ranges", "bytes")
		c.Header("X-Content-Type-Options", "nosniff")
		if resource.Kind == "file" {
			c.Header("Content-Disposition", "attachment")
			c.Header("Content-Security-Policy", "sandbox")
		}
		if ifNoneMatch(c.GetHeader("If-None-Match"), serveETag) {
			c.Status(http.StatusNotModified)
			return
		}
		rangeHeader := c.GetHeader("Range")
		if ifRange := strings.TrimSpace(c.GetHeader("If-Range")); ifRange != "" && ifRange != serveETag {
			rangeHeader = ""
		}
		var stream *service.ResourceStream
		if usePlayback {
			stream, err = svc.OpenResourcePlaybackRange(user.ID, resource.ID)
			if err == nil {
				resource = stream.Resource // MimeType 已置 video/mp4
			} else if errors.Is(err, service.ErrPlaybackNotReady) {
				// 副本尚未就绪：回退原件，并撤销 :pb 后缀，保证副本就绪后
				// 浏览器不会拿原件缓存命中 304 而继续黑屏。
				c.Header("ETag", etag)
				stream, err = svc.OpenResourceRange(user.ID, resource.ID, rangeHeader)
				if err != nil {
					failService(c, err)
					return
				}
			} else {
				failService(c, err)
				return
			}
		} else {
			stream, err = svc.OpenResourceRange(user.ID, resource.ID, rangeHeader)
			if err != nil {
				failService(c, err)
				return
			}
		}
		if err != nil {
			failService(c, err)
			return
		}
		defer stream.Body.Close()
		if resource.MimeType == "" {
			resource.MimeType = "application/octet-stream"
		}
		if resource.Provider == "local" {
			if seeker, ok := stream.Body.(io.ReadSeeker); ok {
				c.Header("Content-Type", resource.MimeType)
				http.ServeContent(c.Writer, c.Request, resource.ID, resource.UpdatedAt, seeker)
				return
			}
		}
		if stream.ContentRange != "" {
			c.Header("Content-Range", stream.ContentRange)
		}
		if stream.AcceptRanges != "" {
			c.Header("Accept-Ranges", stream.AcceptRanges)
		}
		c.DataFromReader(stream.StatusCode, stream.ContentLength, resource.MimeType, stream.Body, nil)
	})
	publicResourceHandler := func(c *gin.Context) {
		stream, err := svc.OpenPublicResourceRange(c.Param("id"), c.Query("expires"), c.Query("signature"), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		defer stream.Body.Close()
		resource := stream.Resource
		if resource.MimeType == "" {
			resource.MimeType = "application/octet-stream"
		}
		c.Header("Cache-Control", "public, max-age=0, must-revalidate")
		c.Header("Accept-Ranges", "bytes")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("X-Content-Type-Options", "nosniff")
		if stream.ContentRange != "" {
			c.Header("Content-Range", stream.ContentRange)
		}
		if seeker, ok := stream.Body.(io.ReadSeeker); ok {
			c.Header("Content-Type", resource.MimeType)
			http.ServeContent(c.Writer, c.Request, resource.ID, resource.UpdatedAt, seeker)
			return
		}
		c.DataFromReader(stream.StatusCode, stream.ContentLength, resource.MimeType, stream.Body, nil)
	}
	r.GET("/public/resources/:id/file", publicResourceHandler)
	r.GET("/public/resources/:id/file/:filename", publicResourceHandler)
	r.GET("/assets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if _, paged := c.GetQuery("page"); paged || hasUserAssetPageFilters(c) {
			page, pageErr := strconv.Atoi(c.DefaultQuery("page", "1"))
			if pageErr != nil || page < 1 {
				fail(c, http.StatusBadRequest, service.BadAuthRequest("页码必须是正整数"))
				return
			}
			pageSize, pageSizeErr := strconv.Atoi(c.DefaultQuery("page_size", "40"))
			if pageSizeErr != nil || pageSize < 1 {
				fail(c, http.StatusBadRequest, service.BadAuthRequest("每页数量必须是正整数"))
				return
			}
			var folderID *string
			if value, present := c.GetQuery("folder_id"); present {
				folderID = &value
			}
			assets, pageErr := svc.UserAssetsPage(user.ID, page, pageSize, service.UserAssetPageFilter{
				Kind: c.Query("kind"), Category: c.Query("category"), FolderID: folderID,
				Uncategorized: c.Query("uncategorized") == "1", Status: c.Query("status"), Query: c.Query("q"),
			})
			if pageErr != nil {
				failService(c, pageErr)
				return
			}
			ok(c, assets)
			return
		}
		assets, err := svc.UserAssetSummaries(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"assets": assets})
	})
	r.GET("/asset-folders", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		folders, err := svc.AssetFolders(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"folders": folders})
	})
	r.POST("/asset-folders", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.CreateAssetFolderRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		folder, err := svc.CreateAssetFolder(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"folder": folder})
	})
	r.PATCH("/asset-folders/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.UpdateAssetFolderRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		folder, err := svc.UpdateAssetFolder(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"folder": folder})
	})
	r.DELETE("/asset-folders/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteAssetFolder(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	r.PATCH("/assets/folder", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.MoveUserAssetsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.MoveUserAssetsToFolder(user.ID, req); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"assetIds": req.AssetIDs, "folderId": req.FolderID})
	})
	r.GET("/user-data/snapshot", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		snapshot, err := svc.UserDataSnapshot(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, snapshot)
	})
	r.GET("/assets/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		asset, err := svc.UserAsset(user.ID, c.Param("id"))
		if err != nil {
			fail(c, http.StatusNotFound, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})
	r.PUT("/assets/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "assets-write:"+user.ID, policy.Request.AssetWritePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 5<<20)
		var req struct {
			Asset json.RawMessage `json:"asset"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		var identity struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(req.Asset, &identity) != nil || identity.ID != c.Param("id") {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("素材 ID 与请求路径不一致"))
			return
		}
		asset, err := svc.UpsertUserAsset(user.ID, req.Asset)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})
	r.DELETE("/assets/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteUserAsset(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	r.GET("/canvas-projects", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if c.Query("page") != "" {
			page, _ := strconv.Atoi(c.Query("page"))
			pageSize, _ := strconv.Atoi(c.Query("page_size"))
			result, pageErr := svc.UserCanvasProjectsPage(user.ID, page, pageSize, c.Query("project_id"), c.Query("q"), c.Query("sort"))
			if pageErr != nil {
				failService(c, pageErr)
				return
			}
			ok(c, result)
			return
		}
		projects, err := svc.UserCanvasProjectSummaries(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"projects": projects})
	})
	r.GET("/canvas-projects/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		project, err := svc.UserCanvasProject(user.ID, c.Param("id"))
		if err != nil {
			fail(c, http.StatusNotFound, err)
			return
		}
		ok(c, gin.H{"project": project})
	})
	r.PUT("/canvas-projects/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "canvas-write:"+user.ID, policy.Request.CanvasWritePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 5<<20)
		var req struct {
			Project json.RawMessage `json:"project"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		var identity struct {
			ID string `json:"id"`
		}
		if json.Unmarshal(req.Project, &identity) != nil || identity.ID != c.Param("id") {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("画布 ID 与请求路径不一致"))
			return
		}
		project, err := svc.UpsertUserCanvasProject(user.ID, req.Project)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"project": project})
	})
	r.DELETE("/canvas-projects/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteUserCanvasProject(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
}

func hasUserAssetPageFilters(c *gin.Context) bool {
	for _, key := range []string{"page_size", "kind", "category", "folder_id", "uncategorized", "status", "q"} {
		if _, present := c.GetQuery(key); present {
			return true
		}
	}
	return false
}

func resourceResponseETag(resource *model.Resource) string {
	value := strings.Trim(strings.TrimSpace(resource.ETag), `"`)
	if value == "" {
		value = fmt.Sprintf("%s-%d-%d", resource.ID, resource.Size, resource.UpdatedAt.UnixNano())
	}
	return strconv.Quote(value)
}

func ifNoneMatch(header string, etag string) bool {
	for _, candidate := range strings.Split(header, ",") {
		candidate = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(candidate), "W/"))
		if candidate == "*" || candidate == etag {
			return true
		}
	}
	return false
}

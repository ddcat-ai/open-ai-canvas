package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterUserDataRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/resources/access", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req []service.ResourceAccessRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ResourceAccessBatch(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": result})
	})
	r.POST("/assets/batch-delete", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var ids []string
		if err := c.ShouldBindJSON(&ids); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.PurgeUserAssets(user.ID, ids); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ids": ids})
	})
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
		pageSize, err := parsePositiveQueryInt(c.Query("pageSize"), 200)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		resources, err := svc.Resources(user.ID, pageSize)
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
	r.GET("/resources/:id/file", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		options := resourceAccessOptions(c)
		delivery, err := svc.PrepareResourceDelivery(user.ID, c.Param("id"), options, c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		serveResourceDelivery(c, delivery, "private, no-cache", "")
	})
	publicResourceHandler := func(c *gin.Context) {
		options := resourceAccessOptions(c)
		delivery, err := svc.PreparePublicResourceDelivery(c.Param("id"), c.Query("expires"), c.Query("signature"), options, c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		serveResourceDelivery(c, delivery, "public, max-age=0, must-revalidate", "")
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
			page, pageSize, pageErr := parsePaginationQuery(c, 40)
			if pageErr != nil {
				fail(c, http.StatusBadRequest, pageErr)
				return
			}
			var folderID *string
			if value, present := c.GetQuery("folderId"); present {
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
		if err := svc.PurgeUserAsset(user.ID, c.Param("id")); err != nil {
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
			page, pageSize, pageErr := parsePaginationQuery(c, 40)
			if pageErr != nil {
				fail(c, http.StatusBadRequest, pageErr)
				return
			}
			result, pageErr := svc.UserCanvasProjectsPage(user.ID, page, pageSize, c.Query("projectId"), c.Query("q"), c.Query("sort"))
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
	r.GET("/canvas-projects/:id/history", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.CanvasHistory(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/canvas-projects/:id/history/:snapshotId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		snapshot, err := svc.CanvasHistorySnapshot(user.ID, c.Param("id"), c.Param("snapshotId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"snapshot": snapshot, "project": json.RawMessage(snapshot.PayloadJSON)})
	})
	r.POST("/canvas-projects/:id/history/:snapshotId/restore", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "canvas-write:"+user.ID, policy.Request.CanvasWritePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		var req struct {
			Revision *int64 `json:"revision"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("恢复请求格式错误"))
			return
		}
		project, err := svc.RestoreCanvasHistory(user.ID, c.Param("id"), c.Param("snapshotId"), req.Revision)
		if err != nil {
			failService(c, err)
			return
		}
		log.Printf("canvas_restore request_id=%q trace_id=%q actor=%q canvas=%q snapshot=%q base_revision=%d revision=%d", RequestID(c), TraceID(c), user.ID, c.Param("id"), c.Param("snapshotId"), *req.Revision, project.Revision)
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
			Project                json.RawMessage `json:"project"`
			RepairMissingResources bool            `json:"repairMissingResources"`
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
		var audit struct {
			Revision    *int64            `json:"revision"`
			Nodes       []json.RawMessage `json:"nodes"`
			Connections []json.RawMessage `json:"connections"`
		}
		_ = json.Unmarshal(req.Project, &audit)
		baseRevision := int64(-1)
		if audit.Revision != nil {
			baseRevision = *audit.Revision
		}
		var project service.UserDataSummary
		if req.RepairMissingResources {
			project, err = svc.RepairUserCanvasProject(user.ID, req.Project)
		} else {
			project, err = svc.UpsertUserCanvasProject(user.ID, req.Project)
		}
		defer func() {
			nodesBefore, nodesAfter := -1, len(audit.Nodes)
			if project.SaveAudit != nil {
				nodesBefore, nodesAfter = project.SaveAudit.NodesBefore, project.SaveAudit.NodesAfter
			}
			// Metadata only: never log prompts, media URLs, cookies, or the canvas payload.
			log.Printf("canvas_save request_id=%q trace_id=%q actor=%q canvas=%q base_revision=%d revision=%d nodes_before=%d nodes_after=%d connections=%d status=%d", RequestID(c), TraceID(c), user.ID, identity.ID, baseRevision, project.Revision, nodesBefore, nodesAfter, len(audit.Connections), c.Writer.Status())
		}()
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
	for _, key := range []string{"pageSize", "kind", "category", "folderId", "uncategorized", "status", "q"} {
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

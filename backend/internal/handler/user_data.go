package handler

import (
	"encoding/json"
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
	r.POST("/resources", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "resources-upload:"+user.ID, 30, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.MaxResourceUploadBytes+(1<<20))
		file, err := c.FormFile("file")
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		width, _ := strconv.Atoi(c.PostForm("width"))
		height, _ := strconv.Atoi(c.PostForm("height"))
		durationMs, _ := strconv.ParseInt(c.PostForm("durationMs"), 10, 64)
		resource, err := svc.UploadResource(user.ID, file, c.PostForm("kind"), width, height, durationMs)
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
		if !enforceRateLimit(c, "resources-import:"+user.ID, 30, time.Minute) {
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
		resource, err := svc.ImportResourceURL(user.ID, req.URL, req.Kind, req.Width, req.Height, req.DurationMs)
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
		resource, err := svc.Resource(user.ID, c.Param("id"))
		if err != nil {
			fail(c, http.StatusNotFound, err)
			return
		}
		if c.Query("direct") == "1" && resource.Provider != "local" {
			directURL, err := svc.DirectResourceURL(user.ID, resource.ID)
			if err != nil {
				failService(c, err)
				return
			}
			// 签名 URL 不进入应用、代理或浏览器缓存，也不作为后续请求的 Referer 泄露。
			c.Header("Cache-Control", "private, no-store")
			c.Header("Referrer-Policy", "no-referrer")
			c.Header("X-Content-Type-Options", "nosniff")
			c.Redirect(http.StatusTemporaryRedirect, directURL)
			return
		}
		etag := resourceResponseETag(resource)
		// 私有资源允许浏览器保存响应，但每次复用前必须重新鉴权；304 会在读取 OSS 前返回。
		c.Header("Cache-Control", "private, no-cache")
		c.Header("ETag", etag)
		c.Header("Accept-Ranges", "bytes")
		c.Header("X-Content-Type-Options", "nosniff")
		if resource.Kind == "file" {
			c.Header("Content-Disposition", "attachment")
			c.Header("Content-Security-Policy", "sandbox")
		}
		if ifNoneMatch(c.GetHeader("If-None-Match"), etag) {
			c.Status(http.StatusNotModified)
			return
		}
		rangeHeader := c.GetHeader("Range")
		if ifRange := strings.TrimSpace(c.GetHeader("If-Range")); ifRange != "" && ifRange != etag {
			rangeHeader = ""
		}
		stream, err := svc.OpenResourceRange(user.ID, resource.ID, rangeHeader)
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
	r.GET("/assets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		assets, err := svc.UserAssetSummaries(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"assets": assets})
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
		if !enforceRateLimit(c, "assets-write:"+user.ID, 120, time.Minute) {
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
		if !enforceRateLimit(c, "canvas-write:"+user.ID, 120, time.Minute) {
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

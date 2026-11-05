package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterPoseLibraryRoutes 注册站点姿势库：登录用户浏览、预览和选用，管理员导入、同步和维护。
func RegisterPoseLibraryRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/pose-library/poses", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 24)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		catalog, err := svc.PoseLibraryCatalog(user, service.PoseLibraryCatalogQuery{
			Keyword: c.Query("keyword"), System: c.Query("system"), Category: c.Query("category"), Angle: c.Query("angle"), Page: page, PageSize: pageSize,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, catalog)
	})
	r.GET("/pose-library/items/:id/thumb", func(c *gin.Context) { servePoseLibraryFile(c, svc, service.PoseLibraryFileThumb) })
	r.GET("/pose-library/items/:id/image", func(c *gin.Context) { servePoseLibraryFile(c, svc, service.PoseLibraryFileImage) })
	r.POST("/pose-library/use", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "pose-library-use:"+user.ID, policy.Request.ResourceImportPerMinute, time.Minute) {
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
		items, err := svc.UsePoseLibraryItems(user, req.IDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": items})
	})

	r.GET("/admin/pose-library/items", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 50)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.AdminPoseLibraryItems(user, service.PoseLibraryAdminQuery{
			Keyword: c.Query("keyword"), SourceKey: c.Query("source"), System: c.Query("system"), Status: c.Query("status"), Page: page, PageSize: pageSize,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/pose-library/import", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.PoseLibraryMaxImportBytes+(1<<20))
		defer cleanupMultipartForm(c)
		data, err := readMultipartFile(c, "file", service.PoseLibraryMaxImportBytes)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		var systems []string
		if raw := strings.TrimSpace(c.PostForm("systems")); raw != "" {
			if err := json.Unmarshal([]byte(raw), &systems); err != nil {
				fail(c, http.StatusBadRequest, errors.New("systems 须为 JSON 字符串数组"))
				return
			}
		}
		result, err := svc.ImportPoseLibrary(user, service.PoseLibraryImportRequest{Data: data, BaseURL: c.PostForm("baseUrl"), Systems: systems})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/pose-library/sync", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.PoseLibrarySyncRequest
		if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.SyncPoseLibraryImages(c.Request.Context(), user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/pose-library/items", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.PoseLibraryMaxImageBytes+(1<<20))
		defer cleanupMultipartForm(c)
		data, err := readMultipartFile(c, "file", service.PoseLibraryMaxImageBytes)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.CreatePoseLibraryItem(user, service.PoseLibraryCreateItemRequest{
			Name: c.PostForm("name"), System: c.PostForm("system"), Category: c.PostForm("category"), Angle: c.PostForm("angle"), Code: c.PostForm("code"), Data: data,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"item": item})
	})
	r.PATCH("/admin/pose-library/items/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.PoseLibraryUpdateItemRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.UpdatePoseLibraryItem(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"item": item})
	})
	r.DELETE("/admin/pose-library/items/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeletePoseLibraryItem(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	r.POST("/admin/pose-library/bulk", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.PoseLibraryBulkRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.BulkPoseLibraryItems(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

// servePoseLibraryFile 直接输出本站数据目录里的姿势图。URL 带 ?v=同步时间，文件更新后地址随之变化，可以放心让浏览器缓存。
func servePoseLibraryFile(c *gin.Context, svc *service.Service, variant service.PoseLibraryFileVariant) {
	user, err := currentUser(c, svc)
	if err != nil {
		failService(c, err)
		return
	}
	opened, err := svc.OpenPoseLibraryFile(user, c.Param("id"), variant)
	if err != nil {
		failService(c, err)
		return
	}
	defer opened.File.Close()
	c.Header("Cache-Control", "private, max-age=604800")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Referrer-Policy", "no-referrer")
	if opened.MimeType != "" {
		c.Header("Content-Type", opened.MimeType)
	}
	http.ServeContent(c.Writer, c.Request, "", opened.Info.ModTime(), opened.File)
}

func readMultipartFile(c *gin.Context, field string, maxBytes int64) ([]byte, error) {
	header, err := c.FormFile(field)
	if err != nil {
		return nil, errors.New("请选择要上传的文件")
	}
	if header.Size > maxBytes {
		return nil, errors.New("文件超过大小上限")
	}
	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, errors.New("文件超过大小上限")
	}
	return data, nil
}

func cleanupMultipartForm(c *gin.Context) {
	if c.Request.MultipartForm != nil {
		_ = c.Request.MultipartForm.RemoveAll()
	}
}

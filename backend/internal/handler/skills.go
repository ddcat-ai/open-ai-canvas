package handler

import (
	"mime"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterSkillRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/skills/install", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.SkillPackageUploadMaxBytes)
		file, err := c.FormFile("file")
		if err != nil {
			failService(c, service.BadAuthRequest("请选择 Markdown 或 ZIP 技能文件"))
			return
		}
		isPrivate, err := parseOptionalBool(c.PostForm("is_private"))
		if err != nil {
			failService(c, service.BadAuthRequest("is_private 必须是布尔值"))
			return
		}
		sourceType := strings.ToLower(strings.TrimSpace(c.PostForm("source_type")))
		if sourceType == "" {
			switch strings.ToLower(filepath.Ext(file.Filename)) {
			case ".md", ".markdown":
				sourceType = "markdown"
			case ".zip":
				sourceType = "zip"
			}
		}
		skill, err := svc.InstallSkillUpload(user.ID, sourceType, file, service.SkillInstallRequest{
			Name: c.PostForm("name"), Description: c.PostForm("description"), Tag: c.PostForm("tag"), IsPrivate: isPrivate,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.POST("/skills/install/github", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req service.SkillGitHubInstallRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("GitHub 技能数据格式无效"))
			return
		}
		skill, err := svc.InstallGitHubSkill(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.GET("/skills", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
		result, err := svc.Skills(user.ID, service.SkillListRequest{
			Page: page, PageSize: pageSize, Scope: c.DefaultQuery("scope", "public"),
			Search: c.Query("search"), Tag: c.Query("tag"), Sort: c.DefaultQuery("sort", "popular"),
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/skills/added", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skills, err := svc.AddedSkills(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skills": skills})
	})

	r.GET("/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SkillDetail(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.GET("/skills/:id/files", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		files, err := svc.SkillPackageFiles(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"files": files})
	})

	r.GET("/skills/:id/file", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		file, err := svc.SkillPackageFile(user.ID, c.Param("id"), c.Query("path"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"file": file})
	})

	r.GET("/skills/:id/file/raw", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		data, mimeType, fileName, err := svc.SkillPackageRawFile(user.ID, c.Param("id"), c.Query("path"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("Content-Security-Policy", "default-src 'none'; sandbox")
		c.Header("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": fileName}))
		c.Data(http.StatusOK, mimeType, data)
	})

	r.GET("/skills/:id/bundle", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		bundle, err := svc.SkillPackageBundle(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"bundle": bundle})
	})

	r.GET("/skills/:id/search", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		results, err := svc.SearchSkillPackage(user.ID, c.Param("id"), c.Query("q"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"results": results})
	})

	r.POST("/skills/:id/sync", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SyncGitHubSkill(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.POST("/skills", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SkillMutationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("技能数据格式无效"))
			return
		}
		skill, err := svc.CreateSkill(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.PUT("/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SkillMutationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("技能数据格式无效"))
			return
		}
		skill, err := svc.UpdateSkill(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.DELETE("/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteSkill(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})

	r.POST("/skills/:id/add", setSkillAdded(svc, true))
	r.DELETE("/skills/:id/add", setSkillAdded(svc, false))
	r.POST("/skills/:id/like", setSkillLiked(svc, true))
	r.DELETE("/skills/:id/like", setSkillLiked(svc, false))
}

func parseOptionalBool(value string) (bool, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return false, nil
	}
	return strconv.ParseBool(value)
}

func setSkillAdded(svc *service.Service, added bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SetSkillAdded(user.ID, c.Param("id"), added)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	}
}

func setSkillLiked(svc *service.Service, liked bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SetSkillLiked(user.ID, c.Param("id"), liked)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	}
}

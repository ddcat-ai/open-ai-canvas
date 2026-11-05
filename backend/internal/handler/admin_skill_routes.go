// 管理端技能管理接口：列表、详情、基本信息、上架 / 下架、删除，以及技能包文件浏览与编辑。
//
// 所有接口在 service 层通过 RequireAdmin 校验身份；这里只做参数解析与响应封装。
package handler

import (
	"mime"
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAdminSkillRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/skills", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		list, err := svc.AdminSkills(user, service.AdminSkillListRequest{
			Page: page, PageSize: pageSize, Keyword: c.Query("keyword"), Status: c.Query("status"), SourceType: c.Query("sourceType"), Tag: c.Query("tag"),
		})
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, list)
	})

	r.GET("/admin/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.AdminSkillDetail(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"skill": skill})
	})

	r.PUT("/admin/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.AdminSkillInfoRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("技能信息格式无效"))
			return
		}
		skill, err := svc.AdminUpdateSkillInfo(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.PATCH("/admin/skills/:id/status", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		var req struct {
			Enabled *bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
			failService(c, service.BadAuthRequest("请指定 enabled"))
			return
		}
		skill, err := svc.AdminSetSkillEnabled(user, c.Param("id"), *req.Enabled)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.DELETE("/admin/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.AdminDeleteSkill(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})

	r.GET("/admin/skills/:id/files", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		files, err := svc.AdminSkillPackageFiles(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"files": files})
	})

	r.PUT("/admin/skills/:id/files", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.SkillPackageEditMaxBytes)
		var req service.SkillPackageEditRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("技能文件修改数据格式无效或超过大小限制"))
			return
		}
		result, err := svc.AdminEditSkillPackageFiles(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/admin/skills/:id/file", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		file, err := svc.AdminSkillPackageFile(user, c.Param("id"), c.Query("path"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"file": file})
	})

	r.GET("/admin/skills/:id/file/raw", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		data, mimeType, fileName, err := svc.AdminSkillPackageRawFile(user, c.Param("id"), c.Query("path"))
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
}

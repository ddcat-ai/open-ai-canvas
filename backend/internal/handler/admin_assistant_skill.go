package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"yingce/backend/internal/service"
)

func registerAssistantSkill(g *gin.RouterGroup) {
	g.GET("/skill/latest", func(c *gin.Context) {
		manifest, _, err := service.AssistantSkillPackage()
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, manifest)
	})
	g.GET("/skill/releases/:version", func(c *gin.Context) {
		manifest, data, err := service.AssistantSkillPackage()
		if err != nil {
			failService(c, err)
			return
		}
		if c.Param("version") != manifest.Version+".zip" {
			failService(c, service.NotFound("此服务版本不提供该 Skill 包"))
			return
		}
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
		c.Header("ETag", "\""+manifest.SHA256+"\"")
		c.Header("Content-Disposition", "attachment; filename=canvas-admin-"+manifest.Version+".zip")
		if c.GetHeader("If-None-Match") == "\""+manifest.SHA256+"\"" {
			c.Status(http.StatusNotModified)
			return
		}
		c.Data(http.StatusOK, "application/zip", data)
	})
}

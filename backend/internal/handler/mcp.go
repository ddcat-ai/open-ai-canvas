package handler

import (
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterMCPRoutes(api *gin.RouterGroup, svc *service.Service) {
	for _, scope := range []struct {
		path  string
		admin bool
	}{{"/agent/mcp", false}, {"/admin/mcp", true}} {
		group := api.Group(scope.path)
		admin := scope.admin
		group.GET("/catalog", func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			items, err := svc.MCPCatalog(actor, admin)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"items": items})
		})
		group.GET("/connections", func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			items, err := svc.MCPConnections(actor, admin)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"items": items})
		})
		save := func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			var input service.MCPConnectionInput
			if err := decodeAgentJSON(c, &input, 128<<10); err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			view, err := svc.SaveMCPConnection(actor, c.Param("id"), admin, input)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, view)
		}
		group.POST("/connections", save)
		group.PUT("/connections/:id", save)
		group.DELETE("/connections/:id", func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			if err := svc.DeleteMCPConnection(actor, c.Param("id"), admin); err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"deleted": true})
		})
		group.POST("/connections/:id/test", func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			view, err := svc.TestMCPConnection(c.Request.Context(), actor, c.Param("id"), admin)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, view)
		})
		if !admin {
			continue
		}
		saveTemplate := func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			var input service.MCPTemplateInput
			if err := decodeAgentJSON(c, &input, 64<<10); err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			view, err := svc.SaveMCPTemplate(actor, c.Param("id"), input)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, view)
		}
		group.POST("/catalog", saveTemplate)
		group.PUT("/catalog/:id", saveTemplate)
		group.DELETE("/catalog/:id", func(c *gin.Context) {
			actor, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			if err := svc.DeleteMCPTemplate(actor, c.Param("id")); err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"deleted": true})
		})
	}
}

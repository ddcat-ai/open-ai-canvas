package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterMCPCanvasRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/mcp/projects", func(c *gin.Context) {
		principal, err := RequireMCPToken(c, svc, "canvas:read")
		if err != nil {
			failService(c, err)
			return
		}
		projects, err := svc.ListMCPProjects(principal.UserID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, projects)
	})
	r.GET("/mcp/projects/:id", func(c *gin.Context) {
		principal, err := RequireMCPToken(c, svc, "canvas:read")
		if err != nil {
			failService(c, err)
			return
		}
		project, err := svc.GetMCPProject(principal.UserID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		snapshot, decodeErr := service.DecodeMCPCanvasSnapshot(json.RawMessage(project.Payload))
		if decodeErr != nil {
			fail(c, 422, service.NewAppError(422, "画布快照无效"))
			return
		}
		ok(c, gin.H{"project": service.SanitizeMCPOutput(snapshot), "revision": project.Revision, "stateHash": project.StateHash, "hashSource": "server"})
	})
	r.POST("/mcp/projects/:id/tools/validate", func(c *gin.Context) {
		principal, err := RequireMCPToken(c, svc, "canvas:write")
		if err != nil {
			failService(c, err)
			return
		}
		var req service.MCPToolRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, 400, err)
			return
		}
		req.RequestID = RequestID(c)
		req.TokenFamilyID = principal.Token.TokenFamilyID
		result, err := svc.ValidateMCPCanvasOps(principal.UserID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/mcp/projects/:id/tools/apply", func(c *gin.Context) {
		principal, err := RequireMCPToken(c, svc, "canvas:write")
		if err != nil {
			failService(c, err)
			return
		}
		var req service.MCPToolRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, 400, err)
			return
		}
		req.RequestID = RequestID(c)
		req.TokenFamilyID = principal.Token.TokenFamilyID
		// Batch generation must enforce the same scope as the dedicated endpoint.
		for _, op := range req.Ops {
			if op.Type == "run_generation" && !principal.Scopes["canvas:generate"] {
				failService(c, service.NewAppError(http.StatusForbidden, "MCP token 缺少所需权限"))
				return
			}
		}
		result, err := svc.ApplyMCPCanvasOps(principal.UserID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/mcp/projects/:id/tools/generate", func(c *gin.Context) {
		principal, err := RequireMCPToken(c, svc, "canvas:generate")
		if err != nil {
			failService(c, err)
			return
		}
		if !principal.Scopes["canvas:write"] {
			failService(c, service.NewAppError(http.StatusForbidden, "MCP token 缺少所需权限"))
			return
		}
		var req service.MCPGenerationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, 400, err)
			return
		}
		req.RequestID = RequestID(c)
		req.TokenFamilyID = principal.Token.TokenFamilyID
		if strings.TrimSpace(req.NodeID) == "" {
			fail(c, 422, service.NewAppError(422, "缺少生成节点 id"))
			return
		}
		result, err := svc.SubmitMCPGeneration(principal.UserID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

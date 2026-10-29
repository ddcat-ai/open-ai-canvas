package handler

import (
	"net/http"
	"strconv"
	"strings"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// registerAgentMemoryDocumentRoutes 注册用户长期记忆文件接口；归属校验和容量、泄露检查都在 service 层。
func registerAgentMemoryDocumentRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/agent/memory", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.AgentMemoryDocument(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.PUT("/agent/memory", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AgentMemoryDocUpdateRequest
		if err := decodeAgentJSON(c, &req, 128<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		view, err := svc.UpdateAgentMemoryDocument(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.PATCH("/agent/memory/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AgentMemoryDocSettingsRequest
		if err := decodeAgentJSON(c, &req, 4<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		view, err := svc.UpdateAgentMemoryDocumentSettings(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.GET("/agent/memory/revisions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, _ := strconv.Atoi(c.Query("limit"))
		revisions, err := svc.AgentMemoryDocumentRevisions(user.ID, strings.TrimSpace(c.Query("status")), limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"revisions": revisions})
	})
	r.POST("/agent/memory/revisions/:revisionId/undo", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.UndoAgentMemoryRevision(user.ID, c.Param("revisionId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.POST("/agent/memory/revisions/:revisionId/decide", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AgentMemoryDocDecisionRequest
		if err := decodeAgentJSON(c, &req, 4<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		view, err := svc.DecideAgentMemoryRevision(user.ID, c.Param("revisionId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
}

// registerAgentMemoryDocumentAdminRoutes 让管理员按用户只读查看记忆文件正文。
func registerAgentMemoryDocumentAdminRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/agent-memory-documents", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		limit, _ := strconv.Atoi(c.Query("limit"))
		documents, err := svc.AdminAgentMemoryDocuments(strings.TrimSpace(c.Query("userId")), limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"documents": documents})
	})
}

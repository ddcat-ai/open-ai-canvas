package handler

import (
	"net/http"
	"strconv"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func registerAgentMemoryProposalRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/agent/memories/proposals", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, _ := strconv.Atoi(c.Query("limit"))
		views, err := svc.UserAgentMemoryProposals(user.ID, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"proposals": views})
	})
	r.POST("/agent/memories/proposals/:proposalId/decide", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AgentMemoryProposalDecision
		if err := decodeAgentJSON(c, &req, 4<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		view, err := svc.DecideUserAgentMemoryProposal(user.ID, c.Param("proposalId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.GET("/agent/memories/revisions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, _ := strconv.Atoi(c.Query("limit"))
		views, err := svc.UserAgentMemoryRevisions(user.ID, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"revisions": views})
	})
	r.POST("/agent/memories/revisions/:revisionId/restore", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AgentMemoryRevisionRestore
		if err := decodeAgentJSON(c, &req, 4<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		view, err := svc.RestoreUserAgentMemoryRevision(user.ID, c.Param("revisionId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
}

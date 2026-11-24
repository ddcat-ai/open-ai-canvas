package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func teamEndpoint(svc *service.Service, run func(*gin.Context, string) (any, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := run(c, actor.ID)
		if err != nil {
			failService(c, err)
			return
		}
		if !c.Writer.Written() {
			ok(c, result)
		}
	}
}

func teamBody(c *gin.Context, value any, limit int64) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	if err := c.ShouldBindJSON(value); err != nil {
		return service.BadAuthRequest("请求内容无效或超过大小限制")
	}
	return nil
}

func RegisterTeamWorkspaceRoutes(api *gin.RouterGroup, svc *service.Service) {
	guarded := api.Group("", RequireFeature(svc, service.FeatureTeams))
	registerTeamRoutes(guarded, svc)
	registerTeamAssetRoutes(guarded, svc)
	registerTeamWalletRoutes(guarded, svc)
	workspace := guarded.Group("/teams/:teamId/workspace")
	registerWorkspaceContentRoutes(workspace, svc)
	registerWorkspaceAssetBatchRoutes(workspace, svc)
	registerWorkspaceResourceRoutes(workspace, svc)
	RegisterChunkedUploadRoutes(workspace, svc)
	registerCreationHistoryRoutes(workspace, svc)
	RegisterCanvasRealtimeRoutes(workspace, svc)
	registerTaskSubmissionRoutes(workspace, svc)
	registerTaskReadRoutes(workspace, svc)
	registerTaskTextReadRoutes(workspace, svc)
}

func registerTeamRoutes(r *gin.RouterGroup, svc *service.Service) {
	teams := r.Group("/teams")
	teams.GET("", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) { return svc.ListMyTeams(userID) }))
	teams.POST("", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
		if !enforceRateLimit(c, "team-create:"+userID, 10, time.Hour) {
			return nil, nil
		}
		var req struct {
			Name string `json:"name"`
		}
		if err := teamBody(c, &req, 4<<10); err != nil {
			return nil, err
		}
		return svc.CreateTeam(userID, req.Name)
	}))
	t := teams.Group("/:teamId")
	t.POST("/groups", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
		if !enforceRateLimit(c, "team-create:"+userID, 10, time.Hour) {
			return nil, nil
		}
		var req struct {
			Name string `json:"name"`
		}
		if err := teamBody(c, &req, 4<<10); err != nil {
			return nil, err
		}
		return svc.CreateTeamGroup(userID, c.Param("teamId"), req.Name)
	}))
	t.GET("", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) { return svc.GetTeam(userID, c.Param("teamId")) }))
	t.GET("/members", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) { return svc.TeamMembers(userID, c.Param("teamId")) }))
	t.GET("/invite-candidates", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
		if !enforceRateLimit(c, "team-search:"+userID, 60, time.Minute) {
			return nil, nil
		}
		return svc.SearchTeamCandidates(userID, c.Param("teamId"), c.Query("q"))
	}))
	t.GET("/invitations", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
		return svc.TeamInvitations(userID, c.Param("teamId"))
	}))
	t.POST("/invitations", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
		if !enforceRateLimit(c, "team-invite:"+userID, 60, time.Hour) {
			return nil, nil
		}
		var req struct {
			InviteeUserID string `json:"inviteeUserId"`
		}
		if err := teamBody(c, &req, 4<<10); err != nil {
			return nil, err
		}
		return svc.InviteTeamUser(userID, c.Param("teamId"), req.InviteeUserID)
	}))
	t.POST("/invitations/:id/revoke", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
		return svc.ResolveTeamInvitation(userID, c.Param("teamId"), c.Param("id"), model.InvitationRevoked)
	}))
	t.DELETE("/members/:membershipId", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
		return gin.H{"removed": true}, svc.EndTeamMembership(userID, c.Param("teamId"), c.Param("membershipId"), false)
	}))
	t.POST("/leave", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
		return gin.H{"left": true}, svc.EndTeamMembership(userID, c.Param("teamId"), "", true)
	}))
	r.GET("/team-invitations", teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) { return svc.MyTeamInvitations(userID) }))
	for action, decision := range map[string]string{"accept": model.InvitationAccepted, "reject": model.InvitationRejected} {
		r.POST("/team-invitations/:id/"+action, teamEndpoint(svc, func(c *gin.Context, userID string) (any, error) {
			return svc.ResolveTeamInvitation(userID, "", c.Param("id"), decision)
		}))
	}
}

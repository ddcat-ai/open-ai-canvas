package handler

import (
	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerTeamAssetRoutes(api *gin.RouterGroup, svc *service.Service) {
	api.POST("/teams/:teamId/asset-publications", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.PublishTeamAssetsRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			failService(c, service.BadAuthRequest("发布请求格式无效"))
			return
		}
		result, err := svc.PublishTeamAssets(c.Request.Context(), user.ID, c.Param("teamId"), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	api.GET("/teams/:teamId/asset-publications/:publicationId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.GetTeamAssetPublication(user.ID, c.Param("teamId"), c.Param("publicationId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

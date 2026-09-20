package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterCanvasAPI 注册当前公开 HTTP API。main 把它挂在 /api。前后端一起发布，不做路径版本前缀。
func RegisterCanvasAPI(api *gin.RouterGroup, svc *service.Service) {
	RegisterOpenAPIRoutes(api)
	RegisterAuthRoutes(api, svc)
	RegisterAppearanceRoutes(api, svc)
	RegisterFeatureAvailabilityRoutes(api, svc)
	RegisterAgentRoutes(api, svc)
	RegisterAgentMemoryRoutes(api, svc)
	RegisterResponseInterceptionRoutes(api, svc)
	RegisterAdminRoutes(api, svc)
	RegisterAgentLessonAdminRoutes(api, svc)
	RegisterAdminAnalyticsRoutes(api, svc)
	RegisterAdminStorageRoutes(api, svc)
	RegisterAdminUpdateRoutes(api, svc)
	RegisterAdminSystemPerformanceRoutes(api, svc)
	RegisterAnnouncementRoutes(api, svc)
	RegisterFinanceRoutes(api, svc)
	RegisterCreationRoutes(api, svc)
	RegisterPaymentRoutes(api, svc)
	RegisterLibTVRoutes(api, svc)
	RegisterTapNowRoutes(api, svc)
	RegisterChannelModelRoutes(api, svc)
	RegisterLogicalModelRoutes(api, svc)
	RegisterModelCatalogRoutes(api, svc)
	RegisterSystemProxyRoutes(api, svc)
	RegisterCustomRelayRoutes(api, svc)
	RegisterTaskRoutes(api, svc)
	RegisterRunningHubRoutes(api, svc)
	RegisterSkillRoutes(api, svc)
	RegisterUserDataRoutes(api, svc)
	RegisterChunkedUploadRoutes(api, svc)
	RegisterDiagnosticsRoutes(api, svc)
	RegisterPluginRoutes(api, svc)
	projectAPI := api.Group("")
	projectAPI.Use(RequireFeature(svc, service.FeatureShortDrama))
	RegisterProjectRoutes(projectAPI, svc)
	RegisterCanvasShareRoutes(api, svc)
}

func RegisterOpenAPIRoutes(api *gin.RouterGroup) {
	api.GET("/openapi.yaml", func(c *gin.Context) {
		c.Data(http.StatusOK, "application/yaml; charset=utf-8", openAPISpec)
	})
}

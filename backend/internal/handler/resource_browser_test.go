package handler

import (
	"testing"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func TestBrowserResourceRoutesCoexistWithChunkUploads(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	group := router.Group("/api")
	RegisterUserDataRoutes(group, &service.Service{})
	RegisterChunkedUploadRoutes(group, &service.Service{})
	wanted := map[string]bool{
		"POST /api/resources/:id/generated-upload":                    false,
		"POST /api/resources/:id/generated-upload/:uploadId/complete": false,
		"POST /api/resources/:id/generated-upload/:uploadId/fallback": false,
		"POST /api/resources/:id/thumbnail-upload/begin":              false,
		"POST /api/resources/:id/thumbnail-upload/complete":           false,
		"POST /api/resources/uploads/direct":                          false,
		"POST /api/resources/uploads/direct/:id/complete":             false,
		"DELETE /api/resources/uploads/direct/:id":                    false,
		"POST /api/resources/:id/thumbnail":                           false,
		"GET /api/resources/:id/browser-file":                         false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, ok := wanted[key]; ok {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Errorf("missing route %s", route)
		}
	}
}

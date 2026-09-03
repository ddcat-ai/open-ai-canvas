package handler

import (
	"testing"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestAppearanceRoutesAreRegistered(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterAppearanceRoutes(router.Group("/api"), &service.Service{})
	wanted := map[string]bool{
		"GET /api/public/appearance":                       false,
		"GET /api/public/appearance/assets/:slot":          false,
		"GET /api/admin/settings/appearance":               false,
		"PATCH /api/admin/settings/appearance":             false,
		"DELETE /api/admin/settings/appearance":            false,
		"POST /api/admin/settings/appearance/assets/:slot": false,
	}
	for _, route := range router.Routes() {
		key := route.Method + " " + route.Path
		if _, exists := wanted[key]; exists {
			wanted[key] = true
		}
	}
	for route, found := range wanted {
		if !found {
			t.Errorf("route %s is not registered", route)
		}
	}
}

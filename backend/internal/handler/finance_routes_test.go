package handler

import (
	"testing"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestFinanceRoutesExposeChannelModelBatchDelete(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterFinanceRoutes(router.Group("/api"), &service.Service{})

	const wanted = "POST /api/admin/channels/:id/models/batch-delete"
	for _, route := range router.Routes() {
		if route.Method+" "+route.Path == wanted {
			return
		}
	}
	t.Fatalf("route %s is not registered", wanted)
}

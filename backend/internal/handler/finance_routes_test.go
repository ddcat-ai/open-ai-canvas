package handler

import (
	"net/http"
	"net/http/httptest"
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

func TestFinanceRoutesExposeChannelModelBatchReprice(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterFinanceRoutes(router.Group("/api"), &service.Service{})
	const wanted = "POST /api/admin/channels/:id/models/batch-reprice"
	found := false
	for _, route := range router.Routes() {
		if route.Method+" "+route.Path == wanted {
			found = true
		}
	}
	if !found {
		t.Fatalf("route %s is not registered", wanted)
	}
	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/admin/channels/channel/models/batch-reprice", nil))
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, body = %s", response.Code, response.Body.String())
	}
}

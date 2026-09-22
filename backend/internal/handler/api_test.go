package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestRegisterCanvasAPIExposesOpenAPIAndProjects(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterCanvasAPI(router.Group("/api"), &service.Service{})

	wanted := map[string]bool{
		"GET /api/openapi.yaml":              false,
		"GET /api/projects":                  false,
		"POST /api/tasks":                    false,
		"GET /api/resources":                 false,
		"POST /api/developer/api-keys":       false,
		"GET /api/developer/api-keys":        false,
		"DELETE /api/developer/api-keys/:id": false,
		"GET /api/v1/models":                 false,
		"POST /api/v1/generations":           false,
		"GET /api/v1/generations/:id":        false,
		"POST /api/tasks/:id/recover-media":  false,
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

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/openapi.yaml", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "openapi: 3.0.3") || !strings.Contains(recorder.Body.String(), "url: /api") {
		t.Fatalf("openapi.yaml status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestPublicAPIReturnsBearerErrorShape(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterPublicAPIRoutes(router.Group("/api"), &service.Service{})

	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/v1/models", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	if !strings.Contains(recorder.Body.String(), `"error"`) || strings.Contains(recorder.Body.String(), `"code":0`) {
		t.Fatalf("unexpected public API error body: %s", recorder.Body.String())
	}
}

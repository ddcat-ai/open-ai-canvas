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
		"GET /api/openapi.yaml":             false,
		"GET /api/projects":                 false,
		"POST /api/tasks":                   false,
		"POST /api/tasks/:id/recover-media": false,
		"GET /api/resources":                false,
		"GET /api/skills/presets":           false,
		"GET /api/agent/skills/usage":       false,
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

	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/skills/presets", nil))
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), `"presets"`) {
		t.Fatalf("skills presets status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

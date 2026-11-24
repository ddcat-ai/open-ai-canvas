package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestTaskRoutesRetireManualEditorAdmission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterTaskRoutes(router.Group("/api"), nil)
	for _, path := range []string{"/api/timeline/renders", "/api/timeline/transcriptions"} {
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodPost, path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("retired endpoint %s returned %d", path, response.Code)
		}
	}
	for _, expected := range []struct{ method, path string }{
		{http.MethodPost, "/api/tasks"},
		{http.MethodGet, "/api/tasks/:id"},
	} {
		found := false
		for _, route := range router.Routes() {
			if route.Method == expected.method && route.Path == expected.path {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("core task route missing: %s %s", expected.method, expected.path)
		}
	}
}

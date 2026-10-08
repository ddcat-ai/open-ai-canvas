package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestSystemReadinessTracksStartupAndDrain(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:system-status?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	status := newSystemStatus(db, svc)
	router := gin.New()
	registerSystemStatusRoutes(router.Group("/api"), status)

	assertStatus(t, router, "/api/health/live", http.StatusOK)
	assertStatus(t, router, "/api/health/ready", http.StatusServiceUnavailable)
	status.markStarted()
	assertStatus(t, router, "/api/health/ready", http.StatusOK)
	status.beginDrain()
	assertStatus(t, router, "/api/health/ready", http.StatusServiceUnavailable)
	assertStatus(t, router, "/api/health/live", http.StatusOK)
}

func TestSystemReadinessRejectsMissingSchemaVersion(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: "file:system-status-schema?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	status := newSystemStatus(db, svc)
	status.markStarted()
	router := gin.New()
	registerSystemStatusRoutes(router.Group("/api"), status)
	assertStatus(t, router, "/api/health/ready", http.StatusServiceUnavailable)
}

func assertStatus(t *testing.T, handler http.Handler, path string, want int) {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, path, nil)
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != want {
		t.Fatalf("GET %s status = %d, want %d; body=%s", path, recorder.Code, want, recorder.Body.String())
	}
}

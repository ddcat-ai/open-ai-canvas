package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestWelcomeAvailabilityPublicRoute(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	RegisterFeatureAvailabilityRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	for _, enabled := range []bool{true, false, true} {
		payload, _ := json.Marshal(map[string]bool{"welcomeEnabled": enabled})
		if err := db.Save(&model.SystemSetting{Key: "feature_availability", ValueJSON: string(payload)}).Error; err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/public/welcome", nil))
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("unexpected public response: %d %s", response.Code, response.Body.String())
		}
		var body struct {
			Code int             `json:"code"`
			Data map[string]bool `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Code != 0 || len(body.Data) != 1 || body.Data["welcomeEnabled"] != enabled {
			t.Fatalf("unexpected public payload: %s", response.Body.String())
		}
	}
}

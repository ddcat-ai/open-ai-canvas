package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"
)

func TestAgentCapabilitiesDescribeNativeHistoryAndCreationSurface(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.User{ID: "cap-user", Username: "cap-user", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "cap-session", UserID: "cap-user", TokenHash: auth.HashToken("cap-token"), ExpiresAt: time.Now().Add(time.Hour)},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	RegisterAgentRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	r := httptest.NewRequest(http.MethodGet, "/api/agent/capabilities", nil)
	r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "cap-session.cap-token"})
	w := httptest.NewRecorder()
	router.ServeHTTP(w, r)
	var response struct {
		Data struct {
			Surfaces               []string `json:"surfaces"`
			ContextCompaction      string   `json:"contextCompaction"`
			MaxHistoryPairs        *int     `json:"maxHistoryPairs"`
			MaxHistoryBytes        *int     `json:"maxHistoryBytes"`
			MaxRuntimeRequestBytes int      `json:"maxRuntimeRequestBytes"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil || w.Code != http.StatusOK {
		t.Fatalf("capabilities response: status=%d body=%s err=%v", w.Code, w.Body.String(), err)
	}
	data := response.Data
	if !slices.Contains(data.Surfaces, "creation") || !slices.Contains(data.Surfaces, "canvas") || data.ContextCompaction != "pi_native" {
		t.Fatalf("capabilities omitted current execution contract: %+v", data)
	}
	if data.MaxHistoryPairs != nil || data.MaxHistoryBytes != nil || data.MaxRuntimeRequestBytes != 8<<20 {
		t.Fatalf("capabilities still advertise legacy history truncation: %+v", data)
	}
}

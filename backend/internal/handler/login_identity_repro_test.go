package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestLoginIdentityAliasSharesThrottle(t *testing.T) {
	testLoginIdentityAttempts(t, []string{"member", "member", "member@example.com"})
}

func TestLoginIdentityUnknownAndKnownResponses(t *testing.T) {
	known := testLoginIdentityAttempts(t, []string{"member@example.com", " MEMBER ", "MEMBER@EXAMPLE.COM"})
	unknown := testLoginIdentityAttempts(t, []string{"missing", " MISSING ", "missing"})
	for i := range known {
		if known[i] != unknown[i] {
			t.Fatalf("attempt %d reveals account existence: known=%s unknown=%s", i+1, known[i], unknown[i])
		}
	}
}

func testLoginIdentityAttempts(t *testing.T, accounts []string) []string {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.Create(&model.User{ID: "member", Username: "member", Email: "member@example.com", Status: model.UserStatusActive, PasswordHash: "invalid-hash"}).Error; err != nil {
		t.Fatal(err)
	}
	policy := platform.DefaultRuntimePolicy()
	policy.Request.LoginAccountPerTenMinutes = 2
	data, _ := json.Marshal(policy)
	if err := db.Create(&model.SystemSetting{Key: "runtime_policy", ValueJSON: string(data)}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { runtimeService = previous })
	gin.SetMode(gin.TestMode)
	router := gin.New()
	RegisterAuthRoutes(router.Group("/api"), svc)
	var bodies []string
	for i, account := range accounts {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(fmt.Sprintf(`{"username":%q,"password":"wrong"}`, account)))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		want := http.StatusUnauthorized
		if i == 2 {
			want = http.StatusTooManyRequests
		}
		if w.Code != want {
			t.Fatalf("attempt %d account=%s status=%d want=%d body=%s", i+1, account, w.Code, want, w.Body.String())
		}
		bodies = append(bodies, w.Body.String())
	}
	return bodies
}

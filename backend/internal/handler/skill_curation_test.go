package handler

import (
	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestSkillCurationHTTP(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	if err := db.AutoMigrate(&model.SkillCurationRoot{}, &model.SkillCurationRootAssignment{}); err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	defer sqlDB.Close()
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.Skill{}, &model.SkillCurationSetting{}, &model.SkillCurationCategory{}, &model.SkillCurationAssignment{}, &model.AdminAuditEvent{}); err != nil {
		t.Fatal(err)
	}
	db.Create(&model.SkillCurationSetting{ID: 1})
	for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
		db.Create(&model.User{ID: string(role), Username: string(role), Role: role, Status: model.UserStatusActive})
		db.Create(&model.AuthSession{ID: string(role), UserID: string(role), TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)})
	}
	router := gin.New()
	RegisterSkillRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	for _, tc := range []struct {
		role, method, path, body string
		status                   int
	}{
		{"", "GET", "/api/skills/curation", "", 401},
		{"user", "GET", "/api/admin/skill-curation", "", 403},
		{"user", "PUT", "/api/admin/skill-curation", `{"expectedRevision":0,"enabled":true}`, 403},
		{"user", "GET", "/api/skills/curation", "", 200},
		{"admin", "PUT", "/api/admin/skill-curation", `{"enabled":true}`, 400},
		{"admin", "PUT", "/api/admin/skill-curation", `{"expectedRevision":0,"enabled":true,"requestId":"forged"}`, 400},
		{"admin", "PUT", "/api/admin/skill-curation", `{"expectedRevision":0,"enabled":true} {}`, 400},
		{"admin", "PUT", "/api/admin/skill-curation", `{"expectedRevision":0,"enabled":true}`, 200},
		{"admin", "PUT", "/api/admin/skill-curation", `{"expectedRevision":0,"enabled":false}`, 409},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		if tc.role != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: tc.role + ".test-token"})
		}
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		if out.Code != tc.status {
			t.Fatalf("%s %s %s: %d %s", tc.role, tc.method, tc.path, out.Code, out.Body.String())
		}
	}
}

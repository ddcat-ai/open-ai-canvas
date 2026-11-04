package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestEcommerceFeatureRoutesKeepHistoryAndAdminConfiguration(t *testing.T) {
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
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	for _, value := range []any{
		&model.User{ID: "commerce-owner", Username: "commerce-owner", Role: model.UserRoleAdmin, Status: model.UserStatusActive},
		&model.AuthSession{ID: "commerce-session", UserID: "commerce-owner", TokenHash: auth.HashToken("fixture-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.EcommerceProject{ID: "commerce-project", UserID: "commerce-owner", Name: "history", DraftJSON: "{}", PlanJSON: "{}", Revision: 1},
	} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	// 写接口先经过限流协调器；本用例自行配置，不依赖同进程其它用例遗留的全局状态。
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	router := gin.New()
	group := router.Group("/api")
	RegisterEcommerceRoutes(group, svc)
	RegisterWorkbenchRoutes(group, svc)
	RegisterYoruAssistantRoutes(group, svc)
	for _, tc := range []struct {
		method, path, body string
		anonymous          bool
		status             int
	}{
		{method: "POST", path: "/ecommerce/projects", anonymous: true, status: 401},
		{method: "POST", path: "/ecommerce/projects", status: 403},
		{method: "PUT", path: "/ecommerce/projects/commerce-project", body: `{}`, status: 403},
		{method: "POST", path: "/ecommerce/projects/commerce-project/tasks", body: `{}`, status: 403},
		{method: "POST", path: "/ecommerce/creative-directions", body: `{}`, status: 403},
		{method: "POST", path: "/workbench/tasks", body: `{"kind":"image","ecommerceProjectId":"commerce-project","prompt":"test"}`, status: 403},
		{method: "POST", path: "/yoru/messages", body: `{"message":"test"}`, status: 403},
		{method: "GET", path: "/ecommerce/projects", status: 200},
		{method: "GET", path: "/ecommerce/projects/commerce-project", status: 200},
		{method: "GET", path: "/workbench/tasks?kind=image", status: 200},
		{method: "GET", path: "/ecommerce/agent-setting", status: 200},
		{method: "GET", path: "/admin/ecommerce/skills", status: 200},
		{method: "GET", path: "/admin/ecommerce/categories", status: 200},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/api"+tc.path, strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			if !tc.anonymous {
				req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "commerce-session.fixture-token"})
			}
			out := httptest.NewRecorder()
			router.ServeHTTP(out, req)
			if out.Code != tc.status {
				t.Fatalf("status=%d, want=%d: %s", out.Code, tc.status, out.Body.String())
			}
		})
	}
}

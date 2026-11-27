package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestMembershipRoutesRequireOwnerAndExplicitSettings(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	conn.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = conn.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	if err := svc.EnsureDefaultUserGroup(); err != nil {
		t.Fatal(err)
	}
	for _, role := range []model.UserRole{model.UserRoleAdmin, model.UserRoleUser} {
		id := string(role)
		for _, row := range []any{&model.User{ID: id, Username: id, Role: role, Status: model.UserStatusActive}, &model.AuthSession{ID: id, UserID: id, TokenHash: auth.HashToken("test"), ExpiresAt: time.Now().Add(time.Hour)}} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	router := gin.New()
	RegisterPaymentRoutes(router.Group("/api"), svc)
	call := func(method, path, role, body string, want int) string {
		t.Helper()
		req := httptest.NewRequest(method, "/api/"+path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if role != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: role + ".test"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		if w.Code != want {
			t.Fatalf("%s %s: %d %s", method, path, w.Code, w.Body.String())
		}
		return w.Body.String()
	}
	const card = "admin/payments/membership/cards/week"
	const valid = `{"enabled":true,"creditsMicrocredits":0,"currency":"CNY","amountFen":199,"membershipGroup":"default"}`
	call("GET", "payments/membership", "", "", 401)
	call("PUT", card, "user", valid, 403)
	call("PUT", card, "admin", `{"currency":"CNY","amountFen":199,"membershipGroup":"default"}`, 400)
	call("PUT", card, "admin", strings.Replace(valid, "default", "missing", 1), 400)
	call("PUT", card, "admin", valid, 200)
	call("PUT", "admin/payments/membership/sales", "user", `{"enabled":true}`, 403)
	call("PUT", "admin/payments/membership/sales", "admin", `{"enabled":true}`, 200)
	if got := call("GET", "payments/products", "user", "", 200); !strings.Contains(got, "membership-week") {
		t.Fatal(got)
	}
	call("PUT", "admin/payments/membership/sales", "admin", `{"enabled":false}`, 200)
	if got := call("GET", "payments/products", "user", "", 200); strings.Contains(got, "membership-week") {
		t.Fatal(got)
	}
}

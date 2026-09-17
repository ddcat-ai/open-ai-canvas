package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func TestImpersonationHTTPRoundTrip(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { sqlDB.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	actor := model.User{ID: "admin", Username: "admin", DisplayName: "Admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive, CreatedAt: time.Now().Add(-time.Hour)}
	target := model.User{ID: "user", Username: "user", DisplayName: "User", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: time.Now()}
	if err := db.Create(&[]model.User{actor, target}).Error; err != nil {
		t.Fatal(err)
	}
	session := model.AuthSession{ID: "original", UserID: actor.ID, TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)}
	if err := db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	RegisterAuthRoutes(router.Group("/api"), svc)
	RegisterAdminRoutes(router.Group("/api"), svc)

	request := func(method, path string, cookie *http.Cookie) *httptest.ResponseRecorder {
		t.Helper()
		req := httptest.NewRequest(method, path, nil)
		if cookie != nil {
			req.AddCookie(cookie)
		}
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, req)
		return recorder
	}
	readSession := func(cookie *http.Cookie, userID string, impersonating bool) {
		t.Helper()
		response := request(http.MethodGet, "/api/auth/session", cookie)
		var body struct {
			Code int `json:"code"`
			Data struct {
				User           *model.User `json:"user"`
				CanImpersonate bool        `json:"canImpersonateUsers"`
				Impersonation  *struct {
					ActorUsername string `json:"actorUsername"`
				} `json:"impersonation"`
			} `json:"data"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if response.Code != http.StatusOK || body.Code != 0 || body.Data.User == nil || body.Data.User.ID != userID {
			t.Fatalf("session response: %d %s", response.Code, response.Body.String())
		}
		if (body.Data.Impersonation != nil) != impersonating || body.Data.CanImpersonate == impersonating {
			t.Fatalf("wrong capability: %s", response.Body.String())
		}
		if impersonating && body.Data.Impersonation.ActorUsername != actor.Username {
			t.Fatal("missing actor")
		}
	}
	readCookie := func(response *httptest.ResponseRecorder) *http.Cookie {
		t.Helper()
		if response.Code != http.StatusOK {
			t.Fatalf("switch response: %d %s", response.Code, response.Body.String())
		}
		for _, cookie := range response.Result().Cookies() {
			if cookie.Name == service.SessionCookieName {
				if !cookie.HttpOnly || cookie.Path != "/" || cookie.SameSite != http.SameSiteLaxMode {
					t.Fatalf("unsafe cookie: %+v", cookie)
				}
				return cookie
			}
		}
		t.Fatal("missing session cookie")
		return nil
	}
	initial := &http.Cookie{Name: service.SessionCookieName, Value: "original.test-token"}
	readSession(initial, actor.ID, false)
	if response := request(http.MethodPost, "/api/admin/users/user/impersonation", nil); response.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous switch: %d", response.Code)
	}
	entered := readCookie(request(http.MethodPost, "/api/admin/users/user/impersonation", initial))
	readSession(entered, target.ID, true)
	if response := request(http.MethodGet, "/api/admin/users", entered); response.Code != http.StatusForbidden {
		t.Fatalf("impersonated admin access: %d", response.Code)
	}
	if response := request(http.MethodPost, "/api/admin/users/user/impersonation", initial); response.Code != http.StatusUnauthorized {
		t.Fatalf("old cookie reused: %d", response.Code)
	}
	returned := readCookie(request(http.MethodPost, "/api/auth/impersonation/exit", entered))
	readSession(returned, actor.ID, false)
	if response := request(http.MethodPost, "/api/auth/impersonation/exit", entered); response.Code != http.StatusUnauthorized {
		t.Fatalf("old impersonation reused: %d", response.Code)
	}
}

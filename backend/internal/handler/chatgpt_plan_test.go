package handler

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func TestChatGPTPlanHTTPAuthenticationAndFeatureControl(t *testing.T) {
	router, db, userCookie := profileHandlerFixture(t)
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	api := router.Group("/api")
	registerChatGPTPlanRoutes(api, svc)
	RegisterFeatureAvailabilityRoutes(api, svc)
	if err := db.Create(&model.User{ID: "plan-admin", Username: "plan-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "plan-admin-session", UserID: "plan-admin", TokenHash: auth.HashToken("plan-admin-token"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	adminCookie := "plan-admin-session.plan-admin-token"
	for _, route := range []struct{ method, path string }{
		{"GET", "/api/chatgpt-plan"}, {"POST", "/api/chatgpt-plan/start"}, {"GET", "/api/chatgpt-plan/models"}, {"POST", "/api/chatgpt-plan/models"}, {"POST", "/api/chatgpt-plan/disconnect"},
	} {
		if response := profileRequest(router, route.method, route.path, "{}", ""); response.Code != http.StatusUnauthorized {
			t.Fatalf("anonymous %s returned %d", route.path, response.Code)
		}
	}
	status := profileRequest(router, "GET", "/api/chatgpt-plan", "", userCookie)
	var body struct {
		Code int `json:"code"`
		Data struct {
			Enabled   bool `json:"enabled"`
			Connected bool `json:"connected"`
		} `json:"data"`
	}
	if err := json.Unmarshal(status.Body.Bytes(), &body); err != nil || status.Code != 200 || body.Code != 0 || body.Data.Enabled || body.Data.Connected {
		t.Fatalf("default status = %s", status.Body.String())
	}
	for _, route := range []struct{ method, path string }{{"POST", "/api/chatgpt-plan/start"}, {"GET", "/api/chatgpt-plan/models"}, {"POST", "/api/chatgpt-plan/models"}} {
		response := profileRequest(router, route.method, route.path, `{"slug":"test"}`, userCookie)
		if response.Code != http.StatusForbidden {
			t.Fatalf("disabled %s returned %d: %s", route.path, response.Code, response.Body.String())
		}
	}
	if response := profileRequest(router, "PATCH", "/api/admin/settings/features", `{"chatGPTPlanEnabled":true}`, userCookie); response.Code != 403 {
		t.Fatal("user changed system switch")
	}
	if response := profileRequest(router, "PATCH", "/api/admin/settings/features", `{"chatGPTPlanEnabled":true}`, adminCookie); response.Code != 200 {
		t.Fatalf("admin enable: %s", response.Body.String())
	}
	status = profileRequest(router, "GET", "/api/chatgpt-plan", "", userCookie)
	if err := json.Unmarshal(status.Body.Bytes(), &body); err != nil || !body.Data.Enabled || body.Data.Connected {
		t.Fatalf("enabled status = %s", status.Body.String())
	}
	if response := profileRequest(router, "PATCH", "/api/admin/settings/features", `{"chatGPTPlanEnabled":false}`, adminCookie); response.Code != 200 {
		t.Fatal("admin disable failed")
	}
	if response := profileRequest(router, "POST", "/api/chatgpt-plan/disconnect", "{}", userCookie); response.Code != 200 {
		t.Fatalf("disconnect must remain available: %s", response.Body.String())
	}
	features, err := svc.FeatureAvailability()
	if err != nil || features.ChatGPTPlanEnabled || !features.CustomChannelsEnabled {
		t.Fatal("partial switch update changed unrelated features")
	}
}

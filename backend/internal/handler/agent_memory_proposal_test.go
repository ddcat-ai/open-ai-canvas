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
)

func TestAgentMemoryProposalHTTPVersionAndOwnership(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := database.Open(database.Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.User{ID: "memory-user", Username: "memory-user", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "memory-session", UserID: "memory-user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.AgentMemoryProposal{ID: "owned", UserID: "memory-user", Status: model.AgentMemoryProposalPending, Version: 2, InputJSON: "[]", ChangesJSON: "[]", SummaryJSON: "{}"},
		&model.AgentMemoryProposal{ID: "foreign", UserID: "other", Status: model.AgentMemoryProposalPending, Version: 2, InputJSON: "[]", ChangesJSON: "[]", SummaryJSON: "{}"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	previous := runtimeService
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(previous) })
	router := gin.New()
	RegisterAgentMemoryRoutes(router.Group("/api"), svc)
	for _, tc := range []struct {
		method, path, body string
		authenticated      bool
		status             int
	}{
		{"GET", "/api/agent/memories/proposals", "", false, 401},
		{"GET", "/api/agent/memories/proposals", "", true, 200},
		{"GET", "/api/agent/memories/revisions", "", true, 200},
		{"POST", "/api/agent/memories/proposals/foreign/decide", `{"decision":"reject","version":2}`, true, 404},
		{"POST", "/api/agent/memories/proposals/owned/decide", `{"decision":"reject"}`, true, 400},
		{"POST", "/api/agent/memories/proposals/owned/decide", `{"decision":"reject","version":1}`, true, 409},
		{"POST", "/api/agent/memories/proposals/owned/decide", `{"decision":"reject","version":2,"userId":"other"}`, true, 400},
		{"POST", "/api/agent/memories/proposals/owned/decide", `{"decision":"reject","version":2}`, true, 200},
		{"POST", "/api/agent/memories/proposals/owned/decide", `{"decision":"approve","version":2}`, true, 409},
		{"POST", "/api/agent/memories/revisions/missing/restore", `{"version":1}`, true, 404},
	} {
		r := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		r.Header.Set("Content-Type", "application/json")
		if tc.authenticated {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "memory-session.test-token"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Fatalf("%s %s: %d expected %d: %s", tc.method, tc.path, w.Code, tc.status, w.Body.String())
		}
	}
}

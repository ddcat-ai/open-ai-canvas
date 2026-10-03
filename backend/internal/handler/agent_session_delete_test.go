package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"
)

func agentSessionDeleteFixture(t *testing.T) (*gorm.DB, func(string, string, bool) *httptest.ResponseRecorder) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
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
	for _, row := range []any{
		&model.User{ID: "user", Username: "agent-delete", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "auth", UserID: "user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
		&model.AgentSession{ID: "session", UserID: "user", Surface: "creation", Status: "active", Revision: 1},
		&model.AgentSession{ID: "foreign", UserID: "other", Surface: "creation", Status: "active", Revision: 1},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	router := gin.New()
	RegisterAgentRoutes(router.Group("/api"), service.New(repository.New(db), t.TempDir()))
	return db, func(method, path string, authenticated bool) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "/api"+path, nil)
		if authenticated {
			r.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "auth.test-token"})
		}
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		return w
	}
}

func TestAgentSessionDeleteHidesHistoryAndPreservesArtifacts(t *testing.T) {
	db, call := agentSessionDeleteFixture(t)
	preserved := []any{
		&model.CloudAgentExecution{ID: "run", UserID: "user", SessionID: "session", CanvasID: "canvas", Status: "completed"},
		&model.CloudAgentEventRecord{RunID: "run", UserID: "user", Sequence: 1, EventJSON: `{"type":"completed"}`},
		&model.CloudAgentMessageRecord{RunID: "run", UserID: "user", Kind: "user", Sequence: 1, MessageJSON: `{"text":"保留记录"}`},
		&model.Task{ID: "run", UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusSucceeded},
		&model.BillingOrder{ID: "bill", UserID: "user", TaskID: "run"},
		&model.Asset{ID: "asset", UserID: "user", PayloadJSON: `{"resourceId":"resource"}`},
		&model.Resource{ID: "resource", UserID: "user", ObjectKey: "retained.png"},
	}
	for _, row := range preserved {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		w := call(http.MethodDelete, "/agent/sessions/session", true)
		var body struct {
			Code int `json:"code"`
			Data struct {
				ID      string `json:"id"`
				Deleted bool   `json:"deleted"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || w.Code != http.StatusOK || body.Code != 0 || body.Data.ID != "session" || !body.Data.Deleted {
			t.Fatalf("delete attempt %d: status=%d body=%s err=%v", attempt, w.Code, w.Body.String(), err)
		}
	}
	for _, path := range []string{"/agent/sessions", "/agent/sessions?surface=creation", "/agent/sessions?status=deleted", "/agent/sessions?canvasId=canvas"} {
		w := call(http.MethodGet, path, true)
		var body struct {
			Data struct {
				Sessions []service.CloudAgentSession `json:"sessions"`
			} `json:"data"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil || w.Code != 200 || len(body.Data.Sessions) != 0 {
			t.Fatalf("deleted history visible: %s status=%d body=%s", path, w.Code, w.Body.String())
		}
	}
	for _, path := range []string{"/agent/sessions/session", "/agent/sessions/session/runs"} {
		if w := call(http.MethodGet, path, true); w.Code != http.StatusNotFound {
			t.Fatalf("deleted session remains readable: %s status=%d body=%s", path, w.Code, w.Body.String())
		}
	}
	for _, row := range preserved {
		var count int64
		if err := db.Model(row).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("delete changed retained %T: count=%d err=%v", row, count, err)
		}
	}
	var session model.AgentSession
	if err := db.First(&session, "id = ?", "session").Error; err != nil || session.Status != "deleted" {
		t.Fatalf("missing deletion marker: %+v err=%v", session, err)
	}
}

func TestAgentSessionDeleteRequiresOwnership(t *testing.T) {
	db, call := agentSessionDeleteFixture(t)
	for _, tc := range []struct {
		id            string
		authenticated bool
		want          int
	}{
		{"session", false, http.StatusUnauthorized}, {"foreign", true, http.StatusNotFound}, {"missing", true, http.StatusNotFound},
	} {
		if w := call(http.MethodDelete, "/agent/sessions/"+tc.id, tc.authenticated); w.Code != tc.want {
			t.Fatalf("delete %s auth=%v: status=%d body=%s", tc.id, tc.authenticated, w.Code, w.Body.String())
		}
	}
	var changed int64
	if err := db.Model(&model.AgentSession{}).Where("status <> ?", "active").Count(&changed).Error; err != nil || changed != 0 {
		t.Fatalf("unauthorized deletion changed sessions: %d err=%v", changed, err)
	}
}

func TestAgentSessionDeleteRejectsOutstandingWork(t *testing.T) {
	for _, tc := range []struct {
		name, status                    string
		cleanup, legacy, media, pending bool
	}{
		{name: "queued", status: "queued"}, {name: "running", status: "running"}, {name: "approval", status: "waiting_approval"},
		{name: "cleanup", status: "completed", cleanup: true}, {name: "legacy", status: "running", legacy: true},
		{name: "media", status: "completed", media: true}, {name: "admitted", pending: true},
		{name: "uninitialized completed root", status: "succeeded", pending: true},
		{name: "uninitialized failed root", status: "failed", pending: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, call := agentSessionDeleteFixture(t)
			if tc.pending {
				status := model.TaskStatus(tc.status)
				if status == "" {
					status = model.TaskStatusTextReplay
				}
				if err := db.Create(&model.Task{ID: "run", UserID: "user", Operation: "cloud_agent", Status: status, InputJSON: `{"cloudAgent":{"request":{"sessionId":"session"}}}`}).Error; err != nil {
					t.Fatal(err)
				}
			} else {
				run := &model.CloudAgentExecution{ID: "run", UserID: "user", SessionID: "session", Status: tc.status, CleanupPending: tc.cleanup}
				if tc.legacy {
					run.SessionID, run.ConversationID = "", "session"
				}
				if err := db.Create(run).Error; err != nil {
					t.Fatal(err)
				}
				if tc.media {
					if err := db.Create(&model.Task{ID: "media", UserID: "user", AgentRunID: "run", Status: model.TaskStatusRunning}).Error; err != nil {
						t.Fatal(err)
					}
				}
			}
			if w := call(http.MethodDelete, "/agent/sessions/session", true); w.Code != http.StatusConflict {
				t.Fatalf("outstanding work was not rejected: status=%d body=%s", w.Code, w.Body.String())
			}
			var session model.AgentSession
			if err := db.First(&session, "id = ?", "session").Error; err != nil || session.Status != "active" || session.Revision != 1 {
				t.Fatalf("rejected delete changed session: %+v err=%v", session, err)
			}
		})
	}
}

package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

func newCanvasOperationsHTTPTest(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	t.Setenv("REDIS_URL", "")
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
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.User{ID: "user", Username: "canvas-operations", Role: model.UserRoleUser, Status: model.UserStatusActive},
		&model.AuthSession{ID: "session", UserID: "user", TokenHash: auth.HashToken("test-token"), ExpiresAt: time.Now().Add(time.Hour)},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := service.New(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	previousRuntime := runtimeService
	runtimeService = svc
	t.Cleanup(func() { runtimeService = previousRuntime })
	router := gin.New()
	router.Use(RequestCorrelationMiddleware())
	RegisterCanvasAPI(router.Group("/api"), svc)
	return router, db
}

func TestCanvasOperationsHTTPCreateRenameAndReload(t *testing.T) {
	router, db := newCanvasOperationsHTTPTest(t)
	request := func(t *testing.T, method, path, body string) []byte {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "session.test-token"})
		out := httptest.NewRecorder()
		router.ServeHTTP(out, req)
		if out.Code != http.StatusOK {
			t.Fatalf("%s %s: status %d: %s", method, path, out.Code, out.Body.String())
		}
		return out.Body.Bytes()
	}
	for index, patch := range []string{
		`{"title":"新画布"}`,
		`{"title":"新画布","projectId":""}`,
		`{"title":"新画布","projectId":null}`,
		`{"title":"新画布","chatSessions":[],"activeChatId":null,"backgroundMode":"dots","showImageInfo":false,"previsScenes":[],"timeline":null}`,
		`{"title":"新画布","projectId":null,"chatSessions":[],"activeChatId":null,"starterMode":null,"appearance":null,"backgroundMode":"dots","showImageInfo":false,"previsScenes":[],"timeline":null}`,
	} {
		t.Run(fmt.Sprintf("patch-%d", index), func(t *testing.T) {
			id := fmt.Sprintf("canvas-%d", index)
			body := fmt.Sprintf(`{"mutationId":"create-%s","operations":[{"type":"create_canvas","id":%q,"patch":%s}]}`, id, id, patch)
			request(t, http.MethodPatch, "/api/canvas-projects/"+id+"/operations", body)
			request(t, http.MethodPatch, "/api/canvas-projects/"+id+"/operations", body)
			var stored model.CanvasProject
			if err := db.First(&stored, "id = ?", id).Error; err != nil {
				t.Fatal(err)
			}
			if stored.Title != "新画布" || stored.Revision != 1 {
				t.Fatalf("created canvas lost metadata: %+v", stored)
			}
			request(t, http.MethodPatch, "/api/canvas-projects/"+id+"/operations", fmt.Sprintf(`{"mutationId":"rename-%s","operations":[{"type":"set_field","field":"title","value":"改名后","beforeValue":"新画布"}]}`, id))
			var reloaded struct {
				Data struct {
					Project struct {
						Title    string `json:"title"`
						Revision int64  `json:"revision"`
					} `json:"project"`
				} `json:"data"`
			}
			if err := json.Unmarshal(request(t, http.MethodGet, "/api/canvas-projects/"+id, ""), &reloaded); err != nil {
				t.Fatal(err)
			}
			if reloaded.Data.Project.Title != "改名后" || reloaded.Data.Project.Revision != 2 {
				t.Fatalf("reloaded canvas lost title: %+v", reloaded.Data.Project)
			}
			for _, path := range []string{"/api/canvas-projects", "/api/canvas-projects?page=1&pageSize=40"} {
				var listed struct {
					Data struct {
						Projects []service.UserDataSummary `json:"projects"`
					} `json:"data"`
				}
				if err := json.Unmarshal(request(t, http.MethodGet, path, ""), &listed); err != nil {
					t.Fatal(err)
				}
				found := false
				for _, project := range listed.Data.Projects {
					if project.ID == id {
						found = project.Title == "改名后"
					}
				}
				if !found {
					t.Fatalf("%s lost renamed canvas: %+v", path, listed.Data.Projects)
				}
			}
			request(t, http.MethodGet, "/api/canvas-projects/"+id+"/sync-status", "")
			request(t, http.MethodGet, "/api/agent/profile?canvasId="+id, "")
			request(t, http.MethodGet, "/api/agent/conversations?canvasId="+id, "")
		})
	}
}

func TestCanvasOperationsHTTPFailureDiagnostics(t *testing.T) {
	router, db := newCanvasOperationsHTTPTest(t)
	var logs bytes.Buffer
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&logs, nil)))
	t.Cleanup(func() { slog.SetDefault(previousLogger) })
	for _, test := range []struct {
		name  string
		body  string
		stage string
		field string
		want  string
	}{
		{"incomplete JSON", `{"mutationId":"rejected","operations":[`, "decode_request", "", "JSON 请求不完整"},
		{"invalid JSON", `{"mutationId":"private-sentinel","operations":]}`, "decode_request", "", "JSON 语法错误"},
		{"invalid patch type", `{"mutationId":"rejected","operations":[{"type":"create_canvas","patch":"private-sentinel"}]}`, "decode_request", "operations.patch", "JSON 字段类型不匹配"},
		{"unknown create field", `{"mutationId":"rejected","editProofs":[{"nodeId":"node","sessionId":"window","token":"private-sentinel"}],"operations":[{"type":"create_canvas","patch":{"title":"private-sentinel","unknownField":true}}]}`, "apply_operations", "", "unknownField"},
		{"invalid projectId type", `{"mutationId":"rejected","operations":[{"type":"create_canvas","patch":{"title":"private-sentinel","projectId":{"apiKey":"private-sentinel"}}}]}`, "apply_operations", "projectId", "JSON 字段类型不匹配"},
		{"oversized JSON", `{"mutationId":"rejected","operations":[],"padding":"` + strings.Repeat("x", 5<<20) + `"}`, "decode_request", "", "画布操作请求超过大小限制"},
	} {
		t.Run(test.name, func(t *testing.T) {
			logs.Reset()
			req := httptest.NewRequest(http.MethodPatch, "/api/canvas-projects/rejected/operations", strings.NewReader(test.body))
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer private-sentinel")
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "session.test-token"})
			out := httptest.NewRecorder()
			router.ServeHTTP(out, req)
			if out.Code != http.StatusBadRequest {
				t.Fatalf("status %d: %s", out.Code, out.Body.String())
			}
			var entry struct {
				Message   string `json:"msg"`
				Stage     string `json:"stage"`
				CanvasID  string `json:"canvas_id"`
				RequestID string `json:"request_id"`
				Status    int    `json:"status"`
				Error     string `json:"error"`
				Field     string `json:"field"`
			}
			if err := json.Unmarshal(bytes.TrimSpace(logs.Bytes()), &entry); err != nil {
				t.Fatalf("missing structured rejection log: %v: %s", err, logs.String())
			}
			if entry.Message != "canvas operations rejected" || entry.Stage != test.stage || entry.CanvasID != "rejected" || entry.Status != http.StatusBadRequest || entry.Field != test.field || !strings.Contains(entry.Error, test.want) {
				t.Fatalf("incomplete rejection diagnostics: %+v", entry)
			}
			if entry.RequestID == "" || entry.RequestID != out.Header().Get("X-Request-ID") {
				t.Fatalf("rejection log lost request correlation: %+v", entry)
			}
			if strings.Contains(logs.String(), "private-sentinel") || strings.Contains(logs.String(), "test-token") || strings.Contains(out.Body.String(), "private-sentinel") {
				t.Fatalf("request data leaked: logs=%s response=%s", logs.String(), out.Body.String())
			}
			for _, row := range []any{&model.CanvasProject{}, &model.CanvasMutationReceipt{}} {
				var count int64
				if err := db.Model(row).Count(&count).Error; err != nil || count != 0 {
					t.Fatalf("rejected request persisted %T: count=%d err=%v", row, count, err)
				}
			}
		})
	}
}

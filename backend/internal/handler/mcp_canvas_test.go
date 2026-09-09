package handler

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type mcpHTTPFixture struct {
	db       *gorm.DB
	server   *httptest.Server
	projects map[string]model.CanvasProject
}

func newMCPHTTPFixture(t *testing.T) *mcpHTTPFixture {
	t.Helper()
	db, err := database.Open(database.Config{Driver: "sqlite", DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.MCPDeviceSession{}, &model.MCPToken{}, &model.CanvasProject{}, &model.MCPAuditEvent{}, &model.Task{}); err != nil {
		t.Fatal(err)
	}
	f := &mcpHTTPFixture{db: db, projects: map[string]model.CanvasProject{}}
	for _, owner := range []string{"a", "b"} {
		if err := db.Create(&model.User{ID: owner, Username: owner, Status: model.UserStatusActive}).Error; err != nil {
			t.Fatal(err)
		}
		sum := sha256.Sum256([]byte("test-session-" + owner))
		if err := db.Create(&model.AuthSession{ID: "session-" + owner, UserID: owner, TokenHash: hex.EncodeToString(sum[:]), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
			t.Fatal(err)
		}
		payload := `{"id":"canvas-` + owner + `","title":"private-` + owner + `","nodes":[{"id":"node-1","type":"image","position":{"x":0,"y":0},"width":100,"height":100}],"connections":[]}`
		hash, err := model.CanvasStateHash([]byte(payload))
		if err != nil {
			t.Fatal(err)
		}
		project := model.CanvasProject{ID: "canvas-" + owner, UserID: owner, Title: "private-" + owner, PayloadJSON: payload, Revision: 7, StateHash: hash}
		if err := db.Create(&project).Error; err != nil {
			t.Fatal(err)
		}
		f.projects[owner] = project
	}
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(RequestCorrelationMiddleware())
	svc := service.New(repository.New(db), t.TempDir())
	RegisterMCPAuthRoutes(r.Group("/api"), svc)
	RegisterMCPCanvasRoutes(r.Group("/api"), svc)
	f.server = httptest.NewServer(r)
	t.Cleanup(f.server.Close)
	return f
}

// All requests traverse HTTP, the real route handlers and an isolated database.
func (f *mcpHTTPFixture) request(t *testing.T, method, path, token, cookie string, body any, want int) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req, err := http.NewRequest(method, f.server.URL+"/api/mcp"+path, bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: cookie})
	}
	resp, err := f.server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var envelope struct {
		Code int             `json:"code"`
		Data json.RawMessage `json:"data"`
		Msg  string          `json:"msg"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != want {
		t.Fatalf("%s %s: status=%d code=%d, want %d", method, path, resp.StatusCode, envelope.Code, want)
	}
	if want == http.StatusOK {
		if envelope.Code != 0 {
			t.Fatalf("%s: unexpected business code %d", path, envelope.Code)
		}
	} else if envelope.Code != want || string(envelope.Data) != "null" || envelope.Msg == "" {
		t.Fatalf("%s: invalid error envelope code=%d data=%s", path, envelope.Code, envelope.Data)
	}
	return envelope.Data
}

func (f *mcpHTTPFixture) token(t *testing.T, owner string, scopes []string) string {
	t.Helper()
	raw := f.request(t, "POST", "/auth/device", "", "", map[string]any{"scope": scopes}, 200)
	var device service.MCPDeviceSessionResponse
	if err := json.Unmarshal(raw, &device); err != nil {
		t.Fatal(err)
	}
	f.request(t, "POST", "/auth/device/"+device.UserCode+"/approve", "", "session-"+owner+".test-session-"+owner, map[string]any{"approve": true}, 200)
	raw = f.request(t, "POST", "/auth/device/token", "", "", map[string]any{"device_code": device.DeviceCode}, 200)
	var pair service.MCPTokenResponse
	if err := json.Unmarshal(raw, &pair); err != nil {
		t.Fatal(err)
	}
	if pair.AccessToken == "" {
		t.Fatal("device exchange did not issue an access token")
	}
	return pair.AccessToken
}

func TestMCPCanvasHTTPScopes(t *testing.T) {
	f := newMCPHTTPFixture(t)
	for mask := 1; mask < 8; mask++ {
		scopes := []string{}
		for i, scope := range []string{"canvas:read", "canvas:write", "canvas:generate"} {
			if mask&(1<<i) != 0 {
				scopes = append(scopes, scope)
			}
		}
		token := f.token(t, "a", scopes)
		for _, route := range []struct {
			method, path string
			body         any
			allowed      bool
			status       int
		}{
			{"GET", "/projects", nil, mask&1 != 0, 200},
			{"GET", "/projects/canvas-a", nil, mask&1 != 0, 200},
			{"POST", "/projects/canvas-a/tools/validate", map[string]any{"ops": []any{}}, mask&2 != 0, 200},
			{"POST", "/projects/canvas-a/tools/apply", map[string]any{}, mask&2 != 0, 428},
			{"POST", "/projects/canvas-a/tools/generate", map[string]any{"nodeId": "node-1"}, mask&6 == 6, 428},
			{"POST", "/projects/canvas-a/tools/apply", map[string]any{"ops": []any{map[string]any{"type": "run_generation", "id": "op-1", "nodeId": "node-1", "mode": "image", "prompt": "test"}}}, mask&6 == 6, 428},
		} {
			want := route.status
			if !route.allowed {
				want = 403
			}
			f.request(t, route.method, route.path, token, "", route.body, want)
		}
	}
}

func (f *mcpHTTPFixture) assertStored(t *testing.T, want model.CanvasProject, audits, tasks int64) {
	t.Helper()
	var got model.CanvasProject
	if err := f.db.First(&got, "id = ? AND user_id = ?", want.ID, want.UserID).Error; err != nil {
		t.Fatal(err)
	}
	if got.PayloadJSON != want.PayloadJSON || got.Revision != want.Revision || got.StateHash != want.StateHash || got.Title != want.Title {
		t.Fatal("stored canvas differs from expected state")
	}
	for _, row := range []struct {
		model any
		want  int64
	}{{&model.MCPAuditEvent{}, audits}, {&model.Task{}, tasks}} {
		var count int64
		if err := f.db.Model(row.model).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != row.want {
			t.Fatalf("%T count=%d want=%d", row.model, count, row.want)
		}
	}
}

func TestMCPCanvasHTTPCrossUserIsolation(t *testing.T) {
	f := newMCPHTTPFixture(t)
	for _, owner := range []string{"a", "b"} {
		token := f.token(t, owner, []string{"canvas:read", "canvas:write", "canvas:generate"})
		foreign := "b"
		if owner == "b" {
			foreign = "a"
		}
		project := f.projects[foreign]
		raw := f.request(t, "GET", "/projects", token, "", nil, 200)
		var projects []service.CanvasMCPProjectSummary
		if err := json.Unmarshal(raw, &projects); err != nil {
			t.Fatal(err)
		}
		if len(projects) != 1 || projects[0].ID != f.projects[owner].ID {
			t.Fatal("project list leaked another user's canvas")
		}
		f.request(t, "GET", "/projects/"+project.ID, token, "", nil, 404)
		for _, tool := range []string{"validate", "apply", "generate"} {
			// Even a correct foreign version and a forged body user ID cannot grant access.
			body := map[string]any{"userId": foreign, "expectedRevision": project.Revision, "expectedStateHash": project.StateHash,
				"nodeId": "node-1", "mode": "image", "prompt": "test", "idempotencyKey": "same-operation",
				"ops": []any{map[string]any{"type": "update_node", "id": "node-1", "patch": map[string]any{"title": "unauthorized"}}}}
			f.request(t, "POST", "/projects/"+project.ID+"/tools/"+tool, token, "", body, 404)
		}
		f.assertStored(t, project, 0, 0)
	}
}

func TestMCPCanvasHTTPBatchGenerationRequiresGenerateScope(t *testing.T) {
	f := newMCPHTTPFixture(t)
	token := f.token(t, "a", []string{"canvas:write"})
	p := f.projects["a"]
	f.request(t, "POST", "/projects/"+p.ID+"/tools/apply", token, "", map[string]any{
		"expectedRevision": p.Revision, "expectedStateHash": p.StateHash,
		"ops": []any{
			map[string]any{"type": "update_node", "id": "node-1", "patch": map[string]any{"title": "must not persist"}},
			map[string]any{"type": "run_generation", "id": "op-1", "nodeId": "node-1", "mode": "image", "prompt": "test"},
		},
	}, 403)
	f.assertStored(t, p, 0, 0)
}

func TestMCPCanvasHTTPVersionPreconditions(t *testing.T) {
	f := newMCPHTTPFixture(t)
	token := f.token(t, "a", []string{"canvas:read", "canvas:write", "canvas:generate"})
	base := f.projects["a"]
	ops := []any{map[string]any{"type": "update_node", "id": "node-1", "patch": map[string]any{"title": "first write"}}}
	result := f.request(t, "POST", "/projects/"+base.ID+"/tools/apply", token, "", map[string]any{
		"expectedRevision": base.Revision, "expectedStateHash": base.StateHash, "ops": ops,
	}, 200)
	var version struct {
		Revision  int64  `json:"revision"`
		StateHash string `json:"stateHash"`
	}
	if err := json.Unmarshal(result, &version); err != nil {
		t.Fatal(err)
	}
	var stored model.CanvasProject
	if err := f.db.First(&stored, "id = ?", base.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Revision != base.Revision+1 || stored.StateHash == base.StateHash || version.Revision != stored.Revision || version.StateHash != stored.StateHash {
		t.Fatal("successful write returned an inconsistent version")
	}
	for _, tool := range []string{"apply", "generate"} {
		for _, tc := range []struct {
			name     string
			revision any
			hash     string
			status   int
		}{
			{"stale pair", base.Revision, base.StateHash, 409},
			{"stale revision", base.Revision, stored.StateHash, 409},
			{"stale hash", stored.Revision, base.StateHash, 409},
			{"missing revision", nil, stored.StateHash, 428},
			{"missing hash", stored.Revision, "", 428},
		} {
			t.Run(tool+"/"+tc.name, func(t *testing.T) {
				f.request(t, "POST", "/projects/"+base.ID+"/tools/"+tool, token, "", map[string]any{
					"expectedRevision": tc.revision, "expectedStateHash": tc.hash, "ops": ops,
					"nodeId": "node-1", "mode": "image", "prompt": "test", "idempotencyKey": "op-1",
				}, tc.status)
				f.assertStored(t, stored, 1, 0)
			})
		}
	}
	var audit model.MCPAuditEvent
	if err := f.db.First(&audit).Error; err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256([]byte(token))
	var access model.MCPToken
	if err := f.db.First(&access, "token_hash = ?", hex.EncodeToString(sum[:])).Error; err != nil {
		t.Fatal(err)
	}
	if audit.UserID != "a" || audit.CanvasID != base.ID || audit.TokenFamilyID != access.TokenFamilyID || audit.RequestID == "" || audit.RevisionBefore != base.Revision || audit.RevisionAfter != stored.Revision {
		t.Fatal("audit is not bound to the successful caller and version")
	}
}

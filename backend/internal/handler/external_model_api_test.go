package handler

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
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

func externalAPIFixture(t *testing.T) (*gin.Engine, *service.Service, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	dir := t.TempDir()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "api.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "external-user", Username: "external-user", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "external-session", UserID: "external-user", TokenHash: auth.HashToken("cookie-secret"), ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), dir)
	ConfigureRuntime(svc)
	t.Cleanup(func() { ConfigureRuntime(nil); svc.Close(); sqlDB, _ := db.DB(); _ = sqlDB.Close() })
	router := gin.New()
	RegisterExternalModelAPIRoutes(router.Group("/api"), svc)
	return router, svc, db
}

func TestModelCallCatalogSessionAndBearerStayIsolated(t *testing.T) {
	router, svc, _ := externalAPIFixture(t)
	issued, err := svc.CreateAPIKey("external-user", service.CreateAPIKeyRequest{Name: "catalog"})
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		cookie, bearer string
		status         int
	}{
		{"", "", 401}, {"external-session.cookie-secret", "", 200}, {"", issued.Key, 200}, {"external-session.cookie-secret", "invalid", 401},
	} {
		req := httptest.NewRequest("GET", "/api/model-calls/models", nil)
		if tc.cookie != "" {
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: tc.cookie})
		}
		if tc.bearer != "" {
			req.Header.Set("Authorization", "Bearer "+tc.bearer)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != tc.status {
			t.Fatalf("catalog status=%d want %d body=%s", rec.Code, tc.status, rec.Body)
		}
	}
	req := httptest.NewRequest("POST", "/api/model-calls", strings.NewReader(`{"model":"channel::model","prompt":"hello"}`))
	req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: "external-session.cookie-secret"})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("paid call accepted Cookie: %d", rec.Code)
	}
}

func TestExternalModelMediaDeliversOnlyThisCallsOwnedOutputs(t *testing.T) {
	router, svc, db := externalAPIFixture(t)
	issued, err := svc.CreateAPIKey("external-user", service.CreateAPIKeyRequest{Name: "media"})
	if err != nil {
		t.Fatal(err)
	}
	png, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=")
	if err != nil {
		t.Fatal(err)
	}
	resource, err := svc.UploadResourceFile("external-user", "test.png", int64(len(png)), "image", 1, 1, 0, bytes.NewReader(png))
	if err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "media-call", UserID: "external-user", Type: "canvas_image", Status: model.TaskStatusSucceeded, ResultJSON: fmt.Sprintf(`{"images":[{"resourceId":%q,"url":"https://upstream.invalid/private?key=secret"}]}`, resource.ID)}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	rec := externalRequest(router, "GET", "/api/model-calls/media-call", "", issued.Key)
	if rec.Code != 200 || strings.Contains(rec.Body.String(), "upstream.invalid") || !strings.Contains(rec.Body.String(), "/api/model-calls/media-call/media/") {
		t.Fatalf("unsafe media output=%s", rec.Body)
	}
	rec = externalRequest(router, "GET", "/api/model-calls/media-call/media/"+resource.ID, "", issued.Key)
	if rec.Code != 200 || !bytes.Equal(rec.Body.Bytes(), png) {
		t.Fatalf("media=%d %s", rec.Code, rec.Body)
	}
	rec = externalRequest(router, "GET", "/api/model-calls/media-call/media/unrelated", "", issued.Key)
	if rec.Code != 404 {
		t.Fatalf("unrelated media=%d", rec.Code)
	}
	if err := db.Model(&task).Update("user_id", "other-owner").Error; err != nil {
		t.Fatal(err)
	}
	rec = externalRequest(router, "GET", "/api/model-calls/media-call/media/"+resource.ID, "", issued.Key)
	if rec.Code != 404 {
		t.Fatalf("foreign task media=%d", rec.Code)
	}
}

func externalRequest(router http.Handler, method, path, body, token string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestExternalAPIKeyManagementRequiresCookieAndNeverReturnsStoredSecret(t *testing.T) {
	router, svc, _ := externalAPIFixture(t)
	if rec := externalRequest(router, "POST", "/api/api-keys", `{"name":"ci"}`, ""); rec.Code != 401 {
		t.Fatalf("anonymous status=%d", rec.Code)
	}
	rec := profileRequest(router, "POST", "/api/api-keys", `{"name":"ci"}`, "external-session.cookie-secret")
	var issued struct {
		Data service.CreatedAPIKey `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &issued); err != nil || rec.Code != 201 || issued.Data.Key == "" {
		t.Fatalf("create %d %s", rec.Code, rec.Body)
	}
	token := issued.Data.Key
	if rec := externalRequest(router, "POST", "/api/api-keys", `{"name":"escalate"}`, token); rec.Code != 401 {
		t.Fatal("key could mint another key")
	}
	rec = profileRequest(router, "GET", "/api/api-keys", "", "external-session.cookie-secret")
	if rec.Code != 200 || strings.Contains(rec.Body.String(), token) || strings.Contains(rec.Body.String(), "tokenHash") {
		t.Fatalf("list %d %s", rec.Code, rec.Body)
	}
	rec = profileRequest(router, "DELETE", "/api/api-keys/"+issued.Data.ID, "", "external-session.cookie-secret")
	if rec.Code != 200 {
		t.Fatalf("revoke %d %s", rec.Code, rec.Body)
	}
	if _, err := svc.AuthenticateAPIKey(token); err == nil {
		t.Fatal("revoked credential still valid")
	}
	if rec := externalRequest(router, "GET", "/api/model-calls/models", "", token); rec.Code != 401 {
		t.Fatal("revoked route access")
	}
}

func TestExternalModelCallRejectsUnsafeInputAndUsesAccountOwnership(t *testing.T) {
	router, svc, db := externalAPIFixture(t)
	issued, err := svc.CreateAPIKey("external-user", service.CreateAPIKeyRequest{Name: "one"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.CreateAPIKey("external-user", service.CreateAPIKeyRequest{Name: "two"})
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{
		`{}`, `{"model":"x","messages":[{"role":"tool","content":"x"}]}`,
		`{"model":"x","messages":[{"role":"user","content":{"url":"https://example.com"}}]}`,
		`{"model":"x","prompt":"hello","apiKey":"leak"}`,
		`{"model":"x","prompt":"hello","parameters":{"baseUrl":"http://localhost"}}`,
		`{"model":"channel::model","prompt":"hello","parameters":{"maxOutputTokens":64}}`,
		`{"model":"x","prompt":"hello"} {}`, `null`,
	} {
		rec := externalRequest(router, "POST", "/api/model-calls", body, issued.Key)
		if rec.Code != 400 {
			t.Fatalf("unsafe body accepted: %s status=%d %s", body, rec.Code, rec.Body)
		}
	}
	rec := externalRequest(router, "POST", "/api/model-calls", `{"prompt":"`+strings.Repeat("x", 1<<20)+`"}`, issued.Key)
	if rec.Code != 413 {
		t.Fatalf("oversize=%d", rec.Code)
	}
	task := model.Task{ID: "owned-call", UserID: "external-user", Type: "canvas_text", Status: model.TaskStatusSucceeded, ResultJSON: `{"text":"hello","config":{"apiKey":"secret"},"providerTaskId":"upstream"}`}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	rec = externalRequest(router, "GET", "/api/model-calls/owned-call", "", issued.Key)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"text":"hello"`) || strings.Contains(rec.Body.String(), "upstream") || strings.Contains(rec.Body.String(), "secret") {
		t.Fatalf("output=%d %s", rec.Code, rec.Body)
	}
	rec = externalRequest(router, "GET", "/api/model-calls/owned-call", "", second.Key)
	if rec.Code != 200 {
		t.Fatalf("same-account read=%d", rec.Code)
	}
	if err := svc.RevokeAPIKey("external-user", issued.ID); err != nil {
		t.Fatal(err)
	}
	if rec := externalRequest(router, "GET", "/api/model-calls/owned-call", "", issued.Key); rec.Code != 401 {
		t.Fatalf("revoked key read=%d", rec.Code)
	}
	if err := db.Model(&task).Update("user_id", "other-owner").Error; err != nil {
		t.Fatal(err)
	}
	if rec := externalRequest(router, "GET", "/api/model-calls/owned-call", "", second.Key); rec.Code != 404 {
		t.Fatalf("cross-account read=%d", rec.Code)
	}
	if err := db.Model(&task).Updates(map[string]any{"user_id": "external-user", "type": "cloud_agent"}).Error; err != nil {
		t.Fatal(err)
	}
	if rec := externalRequest(router, "GET", "/api/model-calls/owned-call", "", second.Key); rec.Code != 404 {
		t.Fatalf("non-generation task read=%d", rec.Code)
	}
}

func TestExternalModelCallExecutesThroughWorker(t *testing.T) {
	router, svc, db := externalAPIFixture(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model     string                           `json:"model"`
			Messages  []struct{ Role, Content string } `json:"messages"`
			MaxTokens int                              `json:"max_tokens"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		if body.Model != "demo-text" || body.MaxTokens != 512 || len(body.Messages) != 2 || body.Messages[0].Content != "Be concise" || body.Messages[1].Content != "hello" {
			t.Errorf("unexpected upstream request: %+v", body)
		}
		if r.Header.Get("Authorization") != "Bearer upstream-test-secret" {
			t.Error("wrong upstream credential")
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"choices":[{"message":{"role":"assistant","content":"worker reply"}}],"usage":{"prompt_tokens":4,"completion_tokens":3,"total_tokens":7}}`)
	}))
	defer upstream.Close()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	channel := model.ModelChannel{ID: "external-channel", Name: "test", Scope: model.ChannelScopeSystem, Enabled: true, BaseURL: upstream.URL, APIKey: "upstream-test-secret", APIFormat: "openai"}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	profile := service.DefaultModelCapabilityConfigForModel("chat-completion", "demo-text")
	profile.Text.MaxOutputTokens = 512
	capability, _ := json.Marshal(profile)
	cm := model.ChannelModel{ID: "external-model", ChannelID: channel.ID, ModelKey: "demo-text", ProviderModelKey: "demo-text", Capability: "text", Protocol: "chat-completion", Enabled: true, CapabilityConfigJSON: string(capability)}
	if err := db.Create(&cm).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ChannelModelPriceTier{ID: "external-price", ChannelModelID: cm.ID, SelectorKey: "{}", SelectorJSON: "{}", ProviderModelKey: "demo-text", BillingMode: "fixed_request", UnitPriceMicrocredits: 10, PriceConfigured: true, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := repository.New(db).GrantCreditsOnce("external-user", model.CreditLedgerAdminGrant, 1000, "external-test-grant", "test"); err != nil {
		t.Fatal(err)
	}
	issued, err := svc.CreateAPIKey("external-user", service.CreateAPIKeyRequest{Name: "worker"})
	if err != nil {
		t.Fatal(err)
	}
	catalog := externalRequest(router, "GET", "/api/model-calls/models", "", issued.Key)
	if catalog.Code != 200 || !strings.Contains(catalog.Body.String(), `"outputTokenLimit":512`) || !strings.Contains(catalog.Body.String(), `"external-channel::demo-text"`) || strings.Contains(catalog.Body.String(), "upstream-test-secret") || strings.Contains(catalog.Body.String(), upstream.URL) {
		t.Fatalf("invalid or unsafe model specification: %d %s", catalog.Code, catalog.Body)
	}
	rec := externalRequest(router, "POST", "/api/model-calls", `{"model":"external-channel::demo-text","messages":[{"role":"system","content":"Be concise"},{"role":"user","content":"hello"}]}`, issued.Key)
	if rec.Code != 202 {
		t.Fatalf("create=%d %s", rec.Code, rec.Body)
	}
	var created struct {
		Data struct{ ID string } `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if err := svc.ProcessNextTask(); err != nil {
		t.Fatal(err)
	}
	rec = externalRequest(router, "GET", "/api/model-calls/"+created.Data.ID, "", issued.Key)
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"status":"succeeded"`) || !strings.Contains(rec.Body.String(), "worker reply") {
		t.Fatalf("worker result=%d %s", rec.Code, rec.Body)
	}
	account, err := repository.New(db).CreditAccount("external-user")
	if err != nil {
		t.Fatal(err)
	}
	if account.AvailableMicrocredits != 990 || account.ReservedMicrocredits != 0 {
		t.Fatalf("billing was bypassed: %+v", account)
	}
}

package app

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestAssistantCatalogContract(t *testing.T) {
	seen := map[string]bool{}
	modules := map[string]bool{}
	for _, op := range assistantCatalog() {
		if op.Module == "" {
			t.Errorf("missing permission module: %s", op.Method)
		}
		if seen[op.Method] {
			t.Fatalf("duplicate %s", op.Method)
		}
		seen[op.Method] = true
		modules[op.Module] = true
		schema, err := assistantOperationSchema(op)
		if err != nil {
			t.Errorf("%s: %v", op.Method, err)
			continue
		}
		if _, err = schema.Resolve(nil); err != nil {
			t.Errorf("%s schema: %v", op.Method, err)
		}
		if op.HighRisk && !op.Write {
			t.Errorf("read marked dangerous: %s", op.Method)
		}
		for _, word := range []string{"Delete", "Bulk", "AdjustCredits", "StartUpdate", "RollbackUpdate", "InstallPlugin", "Revoke", "CompleteLibTVOAuthCallback"} {
			if strings.Contains(op.Method, word) && (!op.Write || !op.HighRisk) {
				t.Errorf("dangerous operation lacks confirmation: %s", op.Method)
			}
		}
	}
	for _, module := range []string{"users", "channels", "plugins", "skills", "mcp", "settings", "payments", "system-update", "api-logs", "resources", "ecommerce", "workbench", "official-assets"} {
		if !modules[module] {
			t.Errorf("missing module %s", module)
		}
	}
	for _, name := range []string{"SaveMCPConnection", "SetPluginPlatformAvailability", "AdminUsers", "SetWorkbenchToolEnabled"} {
		if !seen[name] {
			t.Errorf("missing operation %s", name)
		}
	}
	op, _ := assistantOperation("SaveMCPConnection")
	schema, err := assistantOperationSchema(op)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := schema.Properties["admin"]; ok {
		t.Fatal("caller can choose MCP admin scope")
	}
}

func TestAssistantCatalogMatchesInventory(t *testing.T) {
	// The generator reads paths relative to backend/.
	command := exec.Command("go", "run", "./cmd/admin-assistant-catalog")
	command.Dir = "../.."
	data, err := command.Output()
	if err != nil {
		t.Fatal(err)
	}
	var got, want any
	if json.Unmarshal(data, &got) != nil || json.Unmarshal(assistantCatalogJSON, &want) != nil {
		t.Fatal("invalid catalog JSON")
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatal("admin surface changed; regenerate and review admin_assistant_catalog.json")
	}
}
func TestAssistantSkillPackage(t *testing.T) {
	m, data, err := AssistantSkillPackage()
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(data)
	if m.SHA256 != hex.EncodeToString(hash[:]) || m.Size != len(data) || m.APIVersion != 1 {
		t.Fatal("invalid manifest")
	}
	_, other, _ := AssistantSkillPackage()
	if !bytes.Equal(data, other) {
		t.Fatal("package is not deterministic")
	}
	r, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	names := map[string]bool{}
	for _, f := range r.File {
		if !strings.HasPrefix(f.Name, "canvas-admin/") || strings.Contains(f.Name, "..") {
			t.Fatal("invalid archive path")
		}
		names[f.Name] = true
		reader, _ := f.Open()
		content, _ := io.ReadAll(reader)
		_ = reader.Close()
		if strings.Contains(string(content), "cat_") && strings.Contains(f.Name, "SKILL.md") {
			t.Fatal("credential in skill")
		}
	}
	if !names["canvas-admin/SKILL.md"] || !names["canvas-admin/scripts/canvas_admin.py"] {
		t.Fatal("incomplete skill")
	}
}
func TestAssistantCanonicalOriginAndRedirects(t *testing.T) {
	for _, v := range []string{"", "https://user:pass@example.com", "https://example.com/path", "https://example.com?x=y", "http://public.example"} {
		t.Setenv("CANVAS_PUBLIC_BASE_URL", v)
		if _, err := AssistantBaseURL(); err == nil {
			t.Errorf("accepted origin %q", v)
		}
	}
	for _, v := range []string{"https://canvas.example.test", "http://127.0.0.1:3456"} {
		t.Setenv("CANVAS_PUBLIC_BASE_URL", v)
		if _, err := AssistantBaseURL(); err != nil {
			t.Errorf("rejected origin %q", v)
		}
	}
	for _, v := range []string{"https://client.example/callback", "http://127.0.0.1:1234/callback"} {
		if !validAssistantRedirect(v) {
			t.Errorf("rejected redirect %s", v)
		}
	}
	for _, v := range []string{"javascript:alert(1)", "http://public.example/callback", "https://user:pass@example.com", "https://example.com/#fragment"} {
		if validAssistantRedirect(v) {
			t.Errorf("accepted redirect %s", v)
		}
	}
}

func assistantTestService(t *testing.T) (*Service, *gorm.DB, *model.User) {
	t.Helper()
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.test")
	var db *gorm.DB
	if dsn := os.Getenv("CANVAS_ASSISTANT_TEST_POSTGRES_DSN"); dsn != "" {
		base, err := database.Open(database.Config{Driver: "postgres", DSN: dsn})
		if err != nil {
			t.Fatal(err)
		}
		baseSQL, _ := base.DB()
		schema := "assistant_app_" + strings.ReplaceAll(newID(), "-", "")
		if err = base.Exec(`CREATE SCHEMA "` + schema + `"`).Error; err != nil {
			t.Fatal(err)
		}
		u, err := url.Parse(dsn)
		if err != nil || u.Scheme != "postgres" {
			t.Fatal("test PostgreSQL DSN must be a postgres:// URL")
		}
		q := u.Query()
		q.Set("search_path", schema)
		u.RawQuery = q.Encode()
		db, err = database.Open(database.Config{Driver: "postgres", DSN: u.String()})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, _ := db.DB()
		t.Cleanup(func() {
			_ = sqlDB.Close()
			base.Exec(`DROP SCHEMA "` + schema + `" CASCADE`)
			_ = baseSQL.Close()
		})
	} else {
		db = newSQLiteTestDB(t)
	}
	if err := database.MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: newID(), Username: "assistant-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: t.TempDir()}, db, admin
}
func assistantTestToken(t *testing.T, s *Service, u *model.User, scopes ...string) (*AssistantPrincipal, string) {
	t.Helper()
	_, token, err := s.CreateAssistantToken(u, AssistantTokenRequest{Name: "test", Scopes: scopes})
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.AuthenticateAssistant(token)
	if err != nil {
		t.Fatal(err)
	}
	return p, token
}
func TestAssistantTokenLifecycle(t *testing.T) {
	s, db, admin := assistantTestService(t)
	p, token := assistantTestToken(t, s, admin)
	if p.Credential.TokenHash == token || strings.Contains(p.Credential.ScopesJSON, ":write") {
		t.Fatal("unsafe default token")
	}
	if _, err := s.DescribeAssistantOperation(p, "UpdateUser"); err == nil {
		t.Fatal("read token can write")
	}
	if err := s.RevokeAssistantAccess(admin, p.Credential.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AuthenticateAssistant(token); err == nil {
		t.Fatal("revoked token accepted")
	}
	if _, err := s.ListAssistantOperations(p, "", "", 1); err == nil {
		t.Fatal("stale principal accepted")
	}
	p, token = assistantTestToken(t, s, admin, "users:read")
	if err := db.Model(&model.User{}).Where("id = ?", admin.ID).Update("role", "user").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.AuthenticateAssistant(token); err == nil {
		t.Fatal("demoted admin accepted")
	}
	_ = p
}

func TestAssistantExpiredAndDisabledAccess(t *testing.T) {
	s, db, admin := assistantTestService(t)
	p, token := assistantTestToken(t, s, admin, "users:read")
	if err := db.Model(&model.AssistantCredential{}).Where("id = ?", p.Credential.ID).Update("expires_at", time.Now().Add(-time.Second)).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.AuthenticateAssistant(token); err == nil {
		t.Fatal("expired token accepted")
	}
	_, token = assistantTestToken(t, s, admin, "users:read")
	if err := db.Model(&model.User{}).Where("id = ?", admin.ID).Update("status", "disabled").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.AuthenticateAssistant(token); err == nil {
		t.Fatal("disabled administrator accepted")
	}
}
func TestAssistantConfirmationAndIdempotency(t *testing.T) {
	s, db, admin := assistantTestService(t)
	target := &model.User{ID: newID(), Username: "target", Role: "user", Status: "active"}
	if err := db.Create(target).Error; err != nil {
		t.Fatal(err)
	}
	p, _ := assistantTestToken(t, s, admin, "users:read", "users:write")
	args := json.RawMessage(assistantJSON(map[string]any{"userID": target.ID, "req": map[string]any{"displayName": "changed"}}))
	req := AssistantExecuteRequest{Operation: "UpdateUser", Arguments: args, IdempotencyKey: "update-user-once"}
	pending, err := s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil || pending.Status != "pending_confirmation" {
		t.Fatalf("pending=%+v err=%v", pending, err)
	}
	var original model.User
	_ = db.First(&original, "id = ?", target.ID).Error
	if original.DisplayName == "changed" {
		t.Fatal("executed before confirmation")
	}
	changed := req
	changed.Arguments = json.RawMessage(strings.Replace(string(args), "changed", "tampered", 1))
	if _, err = s.ExecuteAssistantOperation(context.Background(), p, changed, "test"); err == nil {
		t.Fatal("same key accepted changed args")
	}
	if err = s.ConfirmAssistantCall(admin, pending.ID, true); err != nil {
		t.Fatal(err)
	}
	if err = s.ConfirmAssistantCall(admin, pending.ID, true); err == nil {
		t.Fatal("confirmed twice")
	}
	var wg sync.WaitGroup
	statuses := make(chan string, 6)
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, e := s.ExecuteAssistantOperation(context.Background(), p, req, "test")
			if e == nil {
				statuses <- out.Status
			}
		}()
	}
	wg.Wait()
	close(statuses)
	success := false
	for status := range statuses {
		if status == "succeeded" {
			success = true
		}
	}
	if !success {
		t.Fatal("no invocation completed")
	}
	out, err := s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil || out.Status != "succeeded" {
		t.Fatalf("replay=%+v %v", out, err)
	}
	var count int64
	db.Model(&model.AdminAuditEvent{}).Where("action = 'user.update' AND target_id = ?", target.ID).Count(&count)
	if count != 1 {
		t.Fatalf("side effect executed %d times", count)
	}
	db.First(&original, "id = ?", target.ID)
	if original.DisplayName != "changed" {
		t.Fatal("business method not invoked")
	}
}
func TestAssistantExpiredRejectedAndUnknown(t *testing.T) {
	s, db, admin := assistantTestService(t)
	p, _ := assistantTestToken(t, s, admin, "users:write")
	req := AssistantExecuteRequest{Operation: "DeleteUser", Arguments: json.RawMessage(`{"userID":"unrelated"}`), IdempotencyKey: "expired-call"}
	pending, err := s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil {
		t.Fatal(err)
	}
	db.Model(&model.AssistantInvocation{}).Where("id = ?", pending.ID).Update("expires_at", time.Now().Add(-time.Minute))
	if err = s.ConfirmAssistantCall(admin, pending.ID, true); err == nil {
		t.Fatal("expired confirmation accepted")
	}
	req.IdempotencyKey = "rejected-call"
	pending, err = s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.ConfirmAssistantCall(admin, pending.ID, false); err != nil {
		t.Fatal(err)
	}
	out, err := s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil || out.Status != "rejected" {
		t.Fatal("rejected operation executed")
	}
	req.IdempotencyKey = "unknown-call"
	pending, err = s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil {
		t.Fatal(err)
	}
	db.Model(&model.AssistantInvocation{}).Where("id = ?", pending.ID).Update("status", "running")
	out, err = s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil || out.Status != "unknown" {
		t.Fatal("unknown invocation retried")
	}
}
func TestAssistantOAuthPKCEAndRefreshReplay(t *testing.T) {
	s, _, admin := assistantTestService(t)
	client, err := s.RegisterAssistantClient("test", []string{"http://127.0.0.1:12345/callback"})
	if err != nil {
		t.Fatal(err)
	}
	verifier := strings.Repeat("a", 64)
	h := sha256.Sum256([]byte(verifier))
	resource, _ := AssistantResource()
	req := AssistantOAuthRequest{ClientID: client.ID, RedirectURI: "http://127.0.0.1:12345/callback", ResponseType: "code", Resource: resource, Scope: "users:read", State: "test-state", Challenge: base64.RawURLEncoding.EncodeToString(h[:]), ChallengeMethod: "S256"}
	bad := req
	bad.Resource += "/other"
	if _, err = s.AuthorizeAssistant(admin, bad, true); err == nil {
		t.Fatal("wrong resource authorized")
	}
	bad = req
	bad.ChallengeMethod = "plain"
	if _, err = s.AuthorizeAssistant(admin, bad, true); err == nil {
		t.Fatal("plain PKCE authorized")
	}
	bad = req
	bad.Scope = "unknown:write"
	if _, err = s.AuthorizeAssistant(admin, bad, true); err == nil {
		t.Fatal("unknown permission authorized")
	}
	bad = req
	bad.RedirectURI += "/bad"
	if _, err = s.AuthorizeAssistant(admin, bad, true); err == nil {
		t.Fatal("unregistered redirect accepted")
	}
	target, err := s.AuthorizeAssistant(admin, req, true)
	if err != nil {
		t.Fatal(err)
	}
	callback, _ := url.Parse(target)
	if callback.Query().Get("state") != "test-state" {
		t.Fatal("state lost")
	}
	exchange := AssistantOAuthTokenRequest{GrantType: "authorization_code", ClientID: client.ID, Code: callback.Query().Get("code"), RedirectURI: req.RedirectURI, Verifier: strings.Repeat("b", 64), Resource: resource}
	if _, err = s.ExchangeAssistantToken(exchange); err == nil {
		t.Fatal("wrong PKCE accepted")
	}
	exchange.Verifier = verifier
	tokens, err := s.ExchangeAssistantToken(exchange)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.ExchangeAssistantToken(exchange); err == nil {
		t.Fatal("authorization code reused")
	}
	if _, err = s.AuthenticateAssistant(tokens.AccessToken); err != nil {
		t.Fatal(err)
	}
	refresh := AssistantOAuthTokenRequest{GrantType: "refresh_token", ClientID: client.ID, RefreshToken: tokens.RefreshToken, Resource: resource}
	fresh, err := s.ExchangeAssistantToken(refresh)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.RefreshToken == tokens.RefreshToken {
		t.Fatal("refresh token not rotated")
	}
	if _, err = s.ExchangeAssistantToken(refresh); err == nil {
		t.Fatal("refresh token replay accepted")
	}
	if _, err = s.AuthenticateAssistant(fresh.AccessToken); err == nil {
		t.Fatal("grant survived refresh replay")
	}
}
func TestAssistantOAuthOptionalResource(t *testing.T) {
	s, _, admin := assistantTestService(t)
	resource, _ := AssistantResource()
	for _, authorizeResource := range []string{"", resource} {
		for _, tokenResource := range []string{"", resource} {
			t.Run(fmt.Sprintf("authorize=%t/token=%t", authorizeResource != "", tokenResource != ""), func(t *testing.T) {
				client, err := s.RegisterAssistantClient("optional resource", []string{"http://127.0.0.1:12345/callback"})
				if err != nil {
					t.Fatal(err)
				}
				verifier := strings.Repeat("r", 64)
				h := sha256.Sum256([]byte(verifier))
				req := AssistantOAuthRequest{ClientID: client.ID, RedirectURI: "http://127.0.0.1:12345/callback", ResponseType: "code", Resource: authorizeResource, Challenge: base64.RawURLEncoding.EncodeToString(h[:]), ChallengeMethod: "S256"}
				preview, err := s.PreviewAssistantAuthorization(admin, req)
				if err != nil || preview["resource"] != resource {
					t.Fatalf("consent must show canonical resource: %v %v", preview, err)
				}
				bad := req
				bad.Resource = resource + "/other"
				if _, err = s.PreviewAssistantAuthorization(admin, bad); err == nil {
					t.Fatal("explicit wrong resource accepted")
				}
				target, err := s.AuthorizeAssistant(admin, req, true)
				if err != nil {
					t.Fatal(err)
				}
				callback, _ := url.Parse(target)
				code := callback.Query().Get("code")
				stored, err := s.repo.AssistantCode(assistantHash(code))
				if err != nil || stored.Resource != resource {
					t.Fatal("authorization code not bound to canonical resource")
				}
				exchange := AssistantOAuthTokenRequest{GrantType: "authorization_code", ClientID: client.ID, Code: code, RedirectURI: req.RedirectURI, Verifier: verifier, Resource: resource + "/other"}
				if _, err = s.ExchangeAssistantToken(exchange); err == nil {
					t.Fatal("explicit wrong token resource accepted")
				}
				exchange.Resource = tokenResource
				tokens, err := s.ExchangeAssistantToken(exchange)
				if err != nil {
					t.Fatal(err)
				}
				p, err := s.AuthenticateAssistant(tokens.AccessToken)
				if err != nil {
					t.Fatal(err)
				}
				for _, scope := range p.Scopes {
					if !strings.HasSuffix(scope, ":read") {
						t.Fatal("omitted scope granted write access")
					}
				}
				refresh := AssistantOAuthTokenRequest{GrantType: "refresh_token", ClientID: client.ID, RefreshToken: tokens.RefreshToken, Resource: resource + "/other"}
				if _, err = s.ExchangeAssistantToken(refresh); err == nil {
					t.Fatal("explicit wrong refresh resource accepted")
				}
				refresh.Resource = tokenResource
				fresh, err := s.ExchangeAssistantToken(refresh)
				if err != nil {
					t.Fatal(err)
				}
				if _, err = s.AuthenticateAssistant(fresh.AccessToken); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}

func TestAssistantAttachmentIsolationAndRedaction(t *testing.T) {
	s, db, admin := assistantTestService(t)
	p, _ := assistantTestToken(t, s, admin, "users:read")
	other, _ := assistantTestToken(t, s, admin, "users:read")
	file, err := s.StoreAssistantAttachment(p, "../../evil\n.txt", "text/plain", []byte("hello"))
	if err != nil {
		t.Fatal(err)
	}
	if file.Name != "evil.txt" {
		t.Fatalf("unsafe filename %q", file.Name)
	}
	if _, err = s.ReadAssistantAttachment(other, file.ID); err == nil {
		t.Fatal("cross credential download allowed")
	}
	db.Model(&model.AssistantAttachment{}).Where("id = ?", file.ID).Update("expires_at", time.Now().Add(-time.Minute))
	if _, err = s.ReadAssistantAttachment(p, file.ID); err == nil {
		t.Fatal("expired attachment accepted")
	}
	safe := assistantJSON(assistantRedact(map[string]any{"apiKey": "sensitive-test-value", "nested": map[string]any{"Authorization": "Bearer sensitive-test-value"}, "url": "https://example.test?token=sensitive-test-value"}))
	if strings.Contains(safe, "sensitive-test-value") {
		t.Fatal("secret in preview")
	}
}

func TestAssistantOrdinaryWriteAndRevokedConfirmation(t *testing.T) {
	s, db, admin := assistantTestService(t)
	p, _ := assistantTestToken(t, s, admin, "announcements:write", "users:write")
	req := AssistantExecuteRequest{Operation: "CreateAnnouncement", Arguments: json.RawMessage(`{"req":{"title":"Assistant test","content":"ordinary write","level":"info"}}`), IdempotencyKey: "ordinary-announcement"}
	for range 2 {
		out, err := s.ExecuteAssistantOperation(context.Background(), p, req, "test")
		if err != nil || out.Status != "succeeded" {
			t.Fatalf("ordinary write required confirmation or failed: %+v %v", out, err)
		}
	}
	var count int64
	db.Model(&model.Announcement{}).Where("title = ?", "Assistant test").Count(&count)
	if count != 1 {
		t.Fatalf("ordinary write repeated %d times", count)
	}
	req = AssistantExecuteRequest{Operation: "DeleteUser", Arguments: json.RawMessage(`{"userID":"unrelated"}`), IdempotencyKey: "revoked-confirmation"}
	out, err := s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil || out.Status != "pending_confirmation" {
		t.Fatalf("missing confirmation: %+v %v", out, err)
	}
	if err = s.RevokeAssistantAccess(admin, p.Credential.ID, false); err != nil {
		t.Fatal(err)
	}
	if err = s.ConfirmAssistantCall(admin, out.ID, true); err == nil {
		t.Fatal("revoked credential confirmation accepted")
	}
	if _, err = s.ExecuteAssistantOperation(context.Background(), p, req, "test"); err == nil {
		t.Fatal("revoked credential executed")
	}
}

func TestAssistantConfirmationPreservesIntegerPrecision(t *testing.T) {
	s, _, admin := assistantTestService(t)
	p, _ := assistantTestToken(t, s, admin, "users:write")
	req := AssistantExecuteRequest{Operation: "AdminAdjustCredits", Arguments: json.RawMessage(`{"userID":"target","req":{"amountMicrocredits":9007199254740992,"note":"precision"}}`), IdempotencyKey: "precision-confirmation"}
	out, err := s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil || out.Status != "pending_confirmation" {
		t.Fatalf("missing confirmation: %+v %v", out, err)
	}
	if err = s.ConfirmAssistantCall(admin, out.ID, true); err != nil {
		t.Fatal(err)
	}
	req.Arguments = json.RawMessage(`{"userID":"target","req":{"amountMicrocredits":9007199254740993,"note":"precision"}}`)
	if _, err = s.ExecuteAssistantOperation(context.Background(), p, req, "test"); err == nil {
		t.Fatal("different int64 input reused the same confirmation")
	}
}

func TestAssistantPendingPreviewRedactsConfigurationSecrets(t *testing.T) {
	s, db, admin := assistantTestService(t)
	p, _ := assistantTestToken(t, s, admin, "settings:write", "integrations:write", "payments:write")
	for _, tc := range []struct{ operation, arguments string }{
		{"UpdateOSSSetting", `{"req":{"bucket":"visible-bucket","sessionToken":"private-session-value","accessKeySecret":"private-access-value"}}`},
		{"SaveFeishuFeedbackSettings", `{"input":{"appSecret":"private-app-value","verificationToken":"private-verification-value","encryptKey":"private-encryption-value"}}`},
		{"UpdatePaymentProviderConfig", `{"providerID":"plugin","request":{"values":{"customPluginPrivateField":"private-plugin-value"}}}`},
	} {
		out, err := s.ExecuteAssistantOperation(context.Background(), p, AssistantExecuteRequest{Operation: tc.operation, Arguments: json.RawMessage(tc.arguments), IdempotencyKey: "redaction-" + tc.operation}, "test")
		if err != nil || out.Status != "pending_confirmation" {
			t.Fatalf("%s: %+v %v", tc.operation, out, err)
		}
		var stored model.AssistantInvocation
		if err = db.First(&stored, "id = ?", out.ID).Error; err != nil {
			t.Fatal(err)
		}
		listed, err := s.AssistantCall(admin, out.ID)
		if err != nil || strings.Contains(stored.PreviewJSON, "private-") || strings.Contains(listed.PreviewJSON, "private-") {
			t.Fatalf("%s leaked configuration secret", tc.operation)
		}
		if tc.operation == "UpdateOSSSetting" && !strings.Contains(stored.PreviewJSON, "visible-bucket") {
			t.Fatal("non-sensitive confirmation detail removed")
		}
	}
	for _, key := range []string{"sessionToken", "session_token", "app-secret", "verificationToken", "encryptKey", "tldrawLicenseKey"} {
		value := assistantJSON(assistantRedact(map[string]any{"nested": []any{map[string]any{key: "private-nested-value"}}}))
		if strings.Contains(value, "private-nested-value") {
			t.Fatalf("nested %s not redacted", key)
		}
	}
}

func TestAssistantAccessPaginationIncludesOldActiveCredentials(t *testing.T) {
	s, db, admin := assistantTestService(t)
	p, token := assistantTestToken(t, s, admin, "users:read")
	now := time.Now()
	credentials := []model.AssistantCredential{}
	grants := []model.AssistantGrant{}
	for i := range 205 {
		created := now.Add(time.Duration(i+1) * time.Second)
		credentials = append(credentials, model.AssistantCredential{ID: newID(), UserID: admin.ID, TokenHash: fmt.Sprintf("revoked-%d", i), CreatedAt: created, ExpiresAt: now.Add(time.Hour), RevokedAt: &now})
		grants = append(grants, model.AssistantGrant{ID: newID(), UserID: admin.ID, RefreshHash: fmt.Sprintf("refresh-%d", i), CreatedAt: created, ExpiresAt: now.Add(time.Hour), RevokedAt: &now})
	}
	oldGrant := model.AssistantGrant{ID: newID(), UserID: admin.ID, RefreshHash: "old-active-grant", CreatedAt: now.Add(-time.Hour), ExpiresAt: now.Add(time.Hour)}
	grants = append(grants, oldGrant)
	credentials = append(credentials, model.AssistantCredential{ID: newID(), UserID: "other-admin", TokenHash: "unrelated-token", CreatedAt: now, ExpiresAt: now.Add(time.Hour)})
	grants = append(grants, model.AssistantGrant{ID: newID(), UserID: "other-admin", RefreshHash: "unrelated-grant", CreatedAt: now, ExpiresAt: now.Add(time.Hour)})
	if err := db.CreateInBatches(credentials, 40).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.CreateInBatches(grants, 40).Error; err != nil {
		t.Fatal(err)
	}
	seenTokens, seenGrants := map[string]bool{}, map[string]bool{}
	for page := 1; page <= 5; page++ {
		rows, more, err := s.AssistantTokens(admin, page)
		if err != nil || more != (page < 5) {
			t.Fatalf("token page %d: %v %v", page, more, err)
		}
		for _, row := range rows {
			if row.UserID != admin.ID || seenTokens[row.ID] {
				t.Fatal("credential isolation or pagination failed")
			}
			seenTokens[row.ID] = true
		}
		grantRows, more, err := s.AssistantGrants(admin, page)
		if err != nil || more != (page < 5) {
			t.Fatalf("grant page %d: %v %v", page, more, err)
		}
		for _, row := range grantRows {
			if row.UserID != admin.ID || seenGrants[row.ID] {
				t.Fatal("grant isolation or pagination failed")
			}
			seenGrants[row.ID] = true
		}
	}
	if len(seenTokens) != 206 || len(seenGrants) != 206 || !seenTokens[p.Credential.ID] || !seenGrants[oldGrant.ID] {
		t.Fatal("old active access hidden by revoked history")
	}
	if err := s.RevokeAssistantAccess(admin, p.Credential.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AuthenticateAssistant(token); err == nil {
		t.Fatal("old token remains valid after revocation")
	}
	if err := s.RevokeAssistantAccess(admin, oldGrant.ID, true); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.AssistantTokens(admin, 10001); err == nil {
		t.Fatal("unbounded pagination accepted")
	}
}

func TestAssistantAttachmentConcurrentQuota(t *testing.T) {
	s, _, admin := assistantTestService(t)
	p, _ := assistantTestToken(t, s, admin, "users:read")
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			row := &model.AssistantAttachment{ID: newID(), CredentialID: p.bindingID(), Name: "test", Size: 8, Data: []byte("12345678"), CreatedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour)}
			_ = s.repo.CreateAssistantAttachmentWithinLimit(row, false, 16)
		}()
	}
	wg.Wait()
	total, err := s.repo.AssistantAttachmentBytes(p.bindingID())
	if err != nil || total != 16 {
		t.Fatalf("concurrent quota: %d %v", total, err)
	}
}

package app

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestAssistantAuthorizationModeTransitions(t *testing.T) {
	s, db, admin := assistantTestService(t)
	target := &model.User{ID: newID(), Username: "mode-target", Role: "user", Status: "active"}
	if err := db.Create(target).Error; err != nil {
		t.Fatal(err)
	}
	p, _ := assistantTestToken(t, s, admin, "users:write")
	req := AssistantExecuteRequest{Operation: "UpdateUser", Arguments: json.RawMessage(assistantJSON(map[string]any{"userID": target.ID, "req": map[string]any{"displayName": "full-mode"}})), IdempotencyKey: "mode-pending-upgrade"}
	pending, err := s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil || pending.Status != "pending_confirmation" {
		t.Fatalf("pending=%+v err=%v", pending, err)
	}
	if err = s.UpdateAssistantAuthorization(admin, p.Credential.ID, AssistantFullAccess, false); err != nil {
		t.Fatal(err)
	}
	out, err := s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil || out.Status != "succeeded" || out.ID != pending.ID {
		t.Fatalf("upgraded=%+v err=%v", out, err)
	}
	var saved model.User
	if err = db.First(&saved, "id = ?", target.ID).Error; err != nil || saved.DisplayName != "full-mode" {
		t.Fatalf("business write missing: %+v %v", saved, err)
	}
	var count int64
	db.Model(&model.AdminAuditEvent{}).Where("action = 'user.update' AND target_id = ?", target.ID).Count(&count)
	if count != 1 {
		t.Fatalf("audited writes=%d", count)
	}
	if err = s.UpdateAssistantAuthorization(admin, p.Credential.ID, AssistantRequestApproval, false); err != nil {
		t.Fatal(err)
	}
	// 模拟完全访问时准备完成但尚未抢占的调用，降级后同键必须恢复审批。
	req.IdempotencyKey = "mode-ready-downgrade"
	op, _ := assistantOperation(req.Operation)
	var args map[string]any
	_ = json.Unmarshal(req.Arguments, &args)
	ready := &model.AssistantInvocation{ID: newID(), UserID: admin.ID, CredentialID: p.bindingID(), IdempotencyKey: req.IdempotencyKey, Operation: req.Operation, ArgumentsHash: assistantHash(op.Method + "\n" + assistantJSON(args)), Status: "ready", CreatedAt: time.Now(), ExpiresAt: time.Now().Add(time.Hour)}
	if err = db.Create(ready).Error; err != nil {
		t.Fatal(err)
	}
	out, err = s.ExecuteAssistantOperation(context.Background(), p, req, "test")
	if err != nil || out.Status != "pending_confirmation" || out.ID != ready.ID {
		t.Fatalf("downgraded=%+v err=%v", out, err)
	}
	if err = s.UpdateAssistantAuthorization(admin, p.Credential.ID, "invalid", false); err == nil {
		t.Fatal("invalid mode accepted")
	}
	other := &model.User{ID: newID(), Username: "other-mode-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err = db.Create(other).Error; err != nil {
		t.Fatal(err)
	}
	if err = s.UpdateAssistantAuthorization(other, p.Credential.ID, AssistantFullAccess, false); err == nil {
		t.Fatal("other administrator changed token")
	}
	if err = s.RevokeAssistantAccess(admin, p.Credential.ID, false); err != nil {
		t.Fatal(err)
	}
	if err = s.UpdateAssistantAuthorization(admin, p.Credential.ID, AssistantFullAccess, false); err == nil {
		t.Fatal("revoked token upgraded")
	}
}

func TestAssistantFullAccessCreationAndLegacyDefault(t *testing.T) {
	s, db, admin := assistantTestService(t)
	view, token, err := s.CreateAssistantToken(admin, AssistantTokenRequest{Name: "full", ApprovalMode: AssistantFullAccess})
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.AuthenticateAssistant(token)
	if err != nil || view.ApprovalMode != AssistantFullAccess || !p.allows(AssistantOperation{Module: "future-module", Write: true}) {
		t.Fatalf("full=%+v err=%v", view, err)
	}
	if _, _, err = s.CreateAssistantToken(admin, AssistantTokenRequest{Name: "bad", ApprovalMode: "invalid"}); err == nil {
		t.Fatal("invalid create mode accepted")
	}
	if err = db.Model(&model.AssistantCredential{}).Where("id = ?", view.ID).Update("approval_mode", "").Error; err != nil {
		t.Fatal(err)
	}
	p, err = s.AuthenticateAssistant(token)
	if err != nil || p.allows(AssistantOperation{Module: "future-module", Write: true}) {
		t.Fatal("legacy empty mode gained full access")
	}
	rows, _, err := s.AssistantTokens(admin, 1)
	if err != nil || rows[0].ApprovalMode != AssistantRequestApproval {
		t.Fatalf("legacy list=%+v err=%v", rows, err)
	}
	other := &model.User{ID: newID(), Username: "other-mode-admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err = db.Create(other).Error; err != nil {
		t.Fatal(err)
	}
	if err = s.UpdateAssistantAuthorization(other, view.ID, AssistantFullAccess, false); err == nil {
		t.Fatal("another admin modified owner's token")
	}
	if err = s.UpdateAssistantAuthorization(admin, view.ID, "invalid", false); err == nil {
		t.Fatal("invalid update mode accepted")
	}
	if err = s.RevokeAssistantAccess(admin, view.ID, false); err != nil {
		t.Fatal(err)
	}
	if err = s.UpdateAssistantAuthorization(admin, view.ID, AssistantFullAccess, false); err == nil {
		t.Fatal("revoked token reauthorized")
	}
}

func TestAssistantOAuthAuthorizationModeAndRefresh(t *testing.T) {
	s, _, admin := assistantTestService(t)
	client, err := s.RegisterAssistantClient("modes", []string{"http://127.0.0.1:12345/callback"})
	if err != nil {
		t.Fatal(err)
	}
	verifier := strings.Repeat("a", 64)
	h := sha256.Sum256([]byte(verifier))
	req := AssistantOAuthRequest{ClientID: client.ID, RedirectURI: "http://127.0.0.1:12345/callback", ResponseType: "code", Scope: "users:read", Challenge: base64.RawURLEncoding.EncodeToString(h[:]), ChallengeMethod: "S256", ApprovalMode: AssistantFullAccess}
	preview, err := s.PreviewAssistantAuthorization(admin, req)
	if err != nil || len(preview["scopeOptions"].([]string)) < 2 {
		t.Fatalf("preview=%+v err=%v", preview, err)
	}
	target, err := s.AuthorizeAssistant(admin, req, true)
	if err != nil {
		t.Fatal(err)
	}
	callback, _ := url.Parse(target)
	tokens, err := s.ExchangeAssistantToken(AssistantOAuthTokenRequest{GrantType: "authorization_code", ClientID: client.ID, Code: callback.Query().Get("code"), RedirectURI: req.RedirectURI, Verifier: verifier})
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.AuthenticateAssistant(tokens.AccessToken)
	if err != nil || p.Credential.ApprovalMode != AssistantFullAccess {
		t.Fatalf("oauth full=%+v err=%v", p, err)
	}
	if err = s.UpdateAssistantAuthorization(admin, p.Credential.ID, AssistantFullAccess, false); err == nil {
		t.Fatal("OAuth credential changed outside grant")
	}
	if err = s.UpdateAssistantAuthorization(admin, p.Credential.GrantID, AssistantRequestApproval, true); err != nil {
		t.Fatal(err)
	}
	old, err := s.AuthenticateAssistant(tokens.AccessToken)
	if err != nil || old.Credential.ApprovalMode != AssistantRequestApproval {
		t.Fatal("old access token retained full mode")
	}
	fresh, err := s.ExchangeAssistantToken(AssistantOAuthTokenRequest{GrantType: "refresh_token", ClientID: client.ID, RefreshToken: tokens.RefreshToken})
	if err != nil {
		t.Fatal(err)
	}
	p, err = s.AuthenticateAssistant(fresh.AccessToken)
	if err != nil || p.Credential.ApprovalMode != AssistantRequestApproval {
		t.Fatal("refresh elevated downgraded grant")
	}
	if err = s.UpdateAssistantAuthorization(admin, p.Credential.GrantID, AssistantFullAccess, true); err != nil {
		t.Fatal(err)
	}
	p, err = s.AuthenticateAssistant(fresh.AccessToken)
	if err != nil || p.Credential.ApprovalMode != AssistantFullAccess {
		t.Fatal("grant upgrade not reflected")
	}
	if err = s.RevokeAssistantAccess(admin, p.Credential.GrantID, true); err != nil {
		t.Fatal(err)
	}
	if _, err = s.AuthenticateAssistant(fresh.AccessToken); err == nil {
		t.Fatal("revoked full grant accepted")
	}
	if _, err = s.ExchangeAssistantToken(AssistantOAuthTokenRequest{GrantType: "refresh_token", ClientID: client.ID, RefreshToken: fresh.RefreshToken}); err == nil {
		t.Fatal("revoked grant refreshed")
	}
}

func TestAssistantOAuthUpgradeRefreshWithCachedReadScope(t *testing.T) {
	s, _, admin := assistantTestService(t)
	client, err := s.RegisterAssistantClient("cached-scope", []string{"http://127.0.0.1:12345/callback"})
	if err != nil {
		t.Fatal(err)
	}
	verifier := strings.Repeat("a", 64)
	h := sha256.Sum256([]byte(verifier))
	req := AssistantOAuthRequest{ClientID: client.ID, RedirectURI: "http://127.0.0.1:12345/callback", ResponseType: "code", Scope: "users:read", Challenge: base64.RawURLEncoding.EncodeToString(h[:]), ChallengeMethod: "S256"}
	target, err := s.AuthorizeAssistant(admin, req, true)
	if err != nil {
		t.Fatal(err)
	}
	callback, _ := url.Parse(target)
	tokens, err := s.ExchangeAssistantToken(AssistantOAuthTokenRequest{GrantType: "authorization_code", ClientID: client.ID, Code: callback.Query().Get("code"), RedirectURI: req.RedirectURI, Verifier: verifier})
	if err != nil {
		t.Fatal(err)
	}
	p, err := s.AuthenticateAssistant(tokens.AccessToken)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.UpdateAssistantAuthorization(admin, p.Credential.GrantID, AssistantFullAccess, true); err != nil {
		t.Fatal(err)
	}
	refresh := AssistantOAuthTokenRequest{GrantType: "refresh_token", ClientID: client.ID, RefreshToken: tokens.RefreshToken, Scope: tokens.Scope}
	fresh, err := s.ExchangeAssistantToken(refresh)
	if err != nil {
		t.Fatalf("网页升级后携带旧 scope 刷新失败: %v", err)
	}
	p, err = s.AuthenticateAssistant(fresh.AccessToken)
	if err != nil || p.Credential.ApprovalMode != AssistantFullAccess || !p.allows(AssistantOperation{Module: "users", Write: true}) {
		t.Fatalf("刷新丢失全权委托: %+v %v", p, err)
	}
	refresh.RefreshToken, refresh.Scope = fresh.RefreshToken, "arbitrary:write"
	if _, err = s.ExchangeAssistantToken(refresh); err == nil {
		t.Fatal("刷新接受未知权限")
	}
	if err = s.UpdateAssistantAuthorization(admin, p.Credential.GrantID, AssistantRequestApproval, true); err != nil {
		t.Fatal(err)
	}
	refresh.Scope = tokens.Scope
	downgraded, err := s.ExchangeAssistantToken(refresh)
	if err != nil {
		t.Fatalf("降级后旧 scope 应可继续刷新: %v", err)
	}
	p, err = s.AuthenticateAssistant(downgraded.AccessToken)
	if err != nil || p.Credential.ApprovalMode != AssistantRequestApproval {
		t.Fatalf("刷新不应撤销降级: %+v %v", p, err)
	}
}

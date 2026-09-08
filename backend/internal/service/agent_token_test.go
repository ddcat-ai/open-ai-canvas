package service

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func newAgentTokenTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:agent-token-test-%d?mode=memory&cache=shared", time.Now().UnixNano())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AgentToken{}); err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), t.TempDir()), db
}

func seedAgentTokenUser(t *testing.T, db *gorm.DB, id string, status model.UserStatus) {
	t.Helper()
	now := time.Now().UTC()
	user := model.User{ID: id, Username: id + "-name", DisplayName: id, Role: model.UserRoleUser, Status: status, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
}

func appErrorStatus(t *testing.T, err error) int {
	t.Helper()
	var appErr *AppError
	if !errors.As(err, &appErr) {
		t.Fatalf("期望 AppError，实际 %v", err)
	}
	return appErr.Status
}

// 1. 签发：明文只出现一次，库里只存 hash
func TestAgentTokenIssueStoresOnlyHash(t *testing.T) {
	svc, db := newAgentTokenTestService(t)
	seedAgentTokenUser(t, db, "user-1", model.UserStatusActive)

	view, secret, err := svc.IssueAgentToken("user-1", "test", []string{AgentScopeShotRead, AgentScopeGenerationSubmit}, 24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if secret == "" || len(secret) < 20 || secret[:5] != AgentTokenSecretPrefix {
		t.Fatalf("明文令牌形态异常：%q", secret)
	}
	var stored model.AgentToken
	if err := db.Where("id = ?", view.ID).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.TokenHash == secret {
		t.Fatal("禁止明文入库")
	}
	if stored.TokenHash != hashToken(secret) {
		t.Fatal("库内必须是 hash(secret)")
	}
	if len(view.Scopes) != 2 {
		t.Fatalf("作用域未正确返回：%#v", view.Scopes)
	}
}

// 2. 有效令牌 → 解析成功；未知令牌 → 401
func TestAgentTokenResolveValidAndInvalid(t *testing.T) {
	svc, db := newAgentTokenTestService(t)
	seedAgentTokenUser(t, db, "user-1", model.UserStatusActive)
	_, secret, err := svc.IssueAgentToken("user-1", "test", []string{AgentScopeShotRead}, 0)
	if err != nil {
		t.Fatal(err)
	}
	record, err := svc.ResolveAgentToken(secret)
	if err != nil || record == nil {
		t.Fatalf("有效令牌应解析成功：%v", err)
	}
	if _, err := svc.ResolveAgentToken("ycat_notexist"); appErrorStatus(t, err) != 401 {
		t.Fatalf("未知令牌应 401，实际 %v", err)
	}
	if _, err := svc.ResolveAgentToken(""); appErrorStatus(t, err) != 401 {
		t.Fatalf("空令牌应 401，实际 %v", err)
	}
}

// 3. 吊销 → 401
func TestAgentTokenRevokedReturns401(t *testing.T) {
	svc, db := newAgentTokenTestService(t)
	seedAgentTokenUser(t, db, "user-1", model.UserStatusActive)
	view, secret, err := svc.IssueAgentToken("user-1", "test", []string{AgentScopeShotRead}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.RevokeAgentToken("user-1", view.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResolveAgentToken(secret); appErrorStatus(t, err) != 401 {
		t.Fatalf("已吊销令牌应 401，实际 %v", err)
	}
	// 别人不能吊销
	seedAgentTokenUser(t, db, "user-2", model.UserStatusActive)
	view2, _, err := svc.IssueAgentToken("user-2", "other", []string{AgentScopeShotRead}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.RevokeAgentToken("user-1", view2.ID); appErrorStatus(t, err) != 404 {
		t.Fatalf("越权吊销应 404（视为不存在），实际 %v", err)
	}
}

// 4. 过期 → 401
func TestAgentTokenExpiredReturns401(t *testing.T) {
	svc, db := newAgentTokenTestService(t)
	seedAgentTokenUser(t, db, "user-1", model.UserStatusActive)
	view, secret, err := svc.IssueAgentToken("user-1", "test", []string{AgentScopeShotRead}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-time.Minute)
	if err := db.Model(&model.AgentToken{}).Where("id = ?", view.ID).Update("expires_at", past).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResolveAgentToken(secret); appErrorStatus(t, err) != 401 {
		t.Fatalf("过期令牌应 401，实际 %v", err)
	}
}

// 5. 作用域：未知作用域拒签（400）；缺失作用域判定为 false
func TestAgentTokenScopeRules(t *testing.T) {
	svc, db := newAgentTokenTestService(t)
	seedAgentTokenUser(t, db, "user-1", model.UserStatusActive)

	if _, _, err := svc.IssueAgentToken("user-1", "bad", []string{"yingce.admin.all"}, 0); appErrorStatus(t, err) != 400 {
		t.Fatalf("未知作用域应 400，实际 %v", err)
	}
	if _, _, err := svc.IssueAgentToken("user-1", "empty", nil, 0); appErrorStatus(t, err) != 400 {
		t.Fatalf("空作用域应 400，实际 %v", err)
	}

	_, secret, err := svc.IssueAgentToken("user-1", "read-only", []string{AgentScopeShotRead}, 0)
	if err != nil {
		t.Fatal(err)
	}
	record, err := svc.ResolveAgentToken(secret)
	if err != nil {
		t.Fatal(err)
	}
	if !AgentTokenHasScope(record, AgentScopeShotRead) {
		t.Fatal("应持有 shot.read")
	}
	if AgentTokenHasScope(record, AgentScopeGenerationSubmit) {
		t.Fatal("不应持有 generation.submit")
	}
	// 作用域目录里没有 admin
	for _, scope := range AgentScopeCatalog {
		if scope == "admin" || scope == "yingce.admin.all" {
			t.Fatalf("作用域目录不得包含 admin：%s", scope)
		}
	}
}

// 6. 归属用户被禁用 → 令牌立即失效
func TestAgentTokenPrincipalDisabledUser(t *testing.T) {
	svc, db := newAgentTokenTestService(t)
	seedAgentTokenUser(t, db, "user-1", model.UserStatusActive)
	_, secret, err := svc.IssueAgentToken("user-1", "test", []string{AgentScopeShotRead}, 0)
	if err != nil {
		t.Fatal(err)
	}
	record, err := svc.ResolveAgentToken(secret)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", "user-1").Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AgentTokenPrincipal(record); appErrorStatus(t, err) != 401 {
		t.Fatalf("所属用户被禁用应 401，实际 %v", err)
	}
}

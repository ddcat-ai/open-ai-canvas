package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// D-057A 验收矩阵（裁决要求）：
//
//	valid token                  → 200
//	wrong scope                  → 403
//	admin endpoint               → 403
//	令牌管理接口（Agent 令牌访问）→ 403
//	revoked                      → 401
//	expired                      → 401
//	无凭据                        → 非 200
type agentTokenHTTPFixture struct {
	svc    *service.Service
	db     *gorm.DB
	router *gin.Engine
}

func newAgentTokenHTTPFixture(t *testing.T) *agentTokenHTTPFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:agent-token-http-%d?mode=memory&cache=shared", time.Now().UnixNano())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AgentToken{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := db.Create(&model.User{ID: "user-1", Username: "user-1-name", DisplayName: "user-1", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	svc := service.New(repository.New(db), t.TempDir())

	router := gin.New()
	api := router.Group("/api")
	api.Use(AgentTokenMiddleware(svc))
	RegisterAgentTokenRoutes(api, svc)
	// 模拟管理端端点（与真实 /admin/* 一样走 currentUser）
	api.GET("/admin/users", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": user.ID})
	})
	// 需要 generation.submit 作用域的生产端点（D-057B 形态预演）
	api.GET("/agent-protected", AgentScopeGuard(service.AgentScopeGenerationSubmit), func(c *gin.Context) {
		ok(c, gin.H{"ok": true})
	})
	// 任何已认证身份都可访问的普通端点
	api.GET("/agent-open", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": user.ID})
	})
	return &agentTokenHTTPFixture{svc: svc, db: db, router: router}
}

func (f *agentTokenHTTPFixture) get(t *testing.T, path string, bearer string) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, req)
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	t.Logf("%s (bearer=%t) → %d %v", path, bearer != "", rec.Code, body["msg"])
	return rec.Code
}

func TestAgentTokenHTTPAcceptanceMatrix(t *testing.T) {
	f := newAgentTokenHTTPFixture(t)

	// 1. 有效令牌
	view, secret, err := f.svc.IssueAgentToken("user-1", "acceptance", []string{service.AgentScopeShotRead, service.AgentScopeGenerationSubmit}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if code := f.get(t, "/api/agent-open", secret); code != http.StatusOK {
		t.Fatalf("有效令牌访问普通端点应 200，实际 %d", code)
	}
	if code := f.get(t, "/api/agent-protected", secret); code != http.StatusOK {
		t.Fatalf("有效令牌+正确作用域应 200，实际 %d", code)
	}

	// 2. 缺少作用域 → 403
	_, readSecret, err := f.svc.IssueAgentToken("user-1", "read-only", []string{service.AgentScopeShotRead}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if code := f.get(t, "/api/agent-protected", readSecret); code != http.StatusForbidden {
		t.Fatalf("缺少作用域应 403，实际 %d", code)
	}

	// 3. admin 端点 → 403
	if code := f.get(t, "/api/admin/users", secret); code != http.StatusForbidden {
		t.Fatalf("Agent 令牌访问 admin 端点应 403，实际 %d", code)
	}

	// 4. 令牌管理接口，Agent 令牌也不得触碰 → 403
	if code := f.get(t, "/api/agent-tokens", secret); code != http.StatusForbidden {
		t.Fatalf("Agent 令牌访问令牌管理接口应 403，实际 %d", code)
	}

	// 5. 吊销 → 401
	if err := f.svc.RevokeAgentToken("user-1", view.ID); err != nil {
		t.Fatal(err)
	}
	if code := f.get(t, "/api/agent-open", secret); code != http.StatusUnauthorized {
		t.Fatalf("已吊销令牌应 401，实际 %d", code)
	}

	// 6. 过期 → 401
	_, expiringSecret, err := f.svc.IssueAgentToken("user-1", "expiring", []string{service.AgentScopeShotRead}, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	past := time.Now().UTC().Add(-time.Minute)
	if err := f.db.Model(&model.AgentToken{}).Where("user_id = ? AND expires_at IS NOT NULL", "user-1").Update("expires_at", past).Error; err != nil {
		t.Fatal(err)
	}
	if code := f.get(t, "/api/agent-open", expiringSecret); code != http.StatusUnauthorized {
		t.Fatalf("过期令牌应 401，实际 %d", code)
	}

	// 7. 无凭据 → 非 200（沿用既有会话鉴权行为，未被放宽）
	if code := f.get(t, "/api/agent-open", ""); code == http.StatusOK {
		t.Fatalf("无凭据不应 200，实际 %d", code)
	}
}

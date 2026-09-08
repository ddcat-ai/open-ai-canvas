package handler

import (
	"bytes"
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

/* ------------------------------------------------------------------ *
 * D-057C：Server Executor 端点的路由级验收（真实 HTTP 往返）
 *
 * 重点回答三个问题：
 *  1. 端点真的挂上了吗？（404 vs 401）
 *  2. 会话态（浏览器 cookie）会不会被作用域门禁误伤？（403 vs 401）
 *  3. 作用域是否真的生效？（只带 shot.read 必须 403）
 * ------------------------------------------------------------------ */

type agentShotHTTPFixture struct {
	svc    *service.Service
	db     *gorm.DB
	router *gin.Engine
}

func newAgentShotHTTPFixture(t *testing.T) *agentShotHTTPFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(fmt.Sprintf("file:agent-shot-http-%d?mode=memory&cache=shared", time.Now().UnixNano())), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AgentToken{}, &model.Project{}, &model.Shot{}, &model.ShotRevision{}, &model.ModelChannel{}, &model.ChannelModel{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := db.Create(&model.User{ID: "user-1", Username: "zhuren", DisplayName: "主人", Role: model.UserRoleUser, Status: model.UserStatusActive, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	// 正常镜头：有修订版但没写 videoPrompt（用于验证提示词护栏）
	db.Create(&model.Shot{ID: "SHOT_NOPROMPT", ProjectID: "PROJ_1", Title: "没提示词的镜头", DurationMs: 3000})
	db.Create(&model.ShotRevision{ID: "REV_1", ShotID: "SHOT_NOPROMPT", Version: 1, VideoPrompt: "", DurationMs: 3000})

	svc := service.New(repository.New(db), t.TempDir())
	router := gin.New()
	api := router.Group("/api")
	api.Use(AgentTokenMiddleware(svc))
	RegisterAgentShotRoutes(api, svc)
	return &agentShotHTTPFixture{svc: svc, db: db, router: router}
}

func (f *agentShotHTTPFixture) post(t *testing.T, path string, bearer string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewBufferString(`{"videoSeconds":1}`))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	rec := httptest.NewRecorder()
	f.router.ServeHTTP(rec, req)
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	t.Logf("POST %s (bearer=%t) → %d %v", path, bearer != "", rec.Code, body["msg"])
	return rec.Code, body
}

func (f *agentShotHTTPFixture) issueToken(t *testing.T, scopes []string) string {
	t.Helper()
	_, secret, err := f.svc.IssueAgentToken("user-1", "route-test", scopes, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	return secret
}

// 1. 端点已挂载：无凭据应 401「请先登录」，而不是 404（说明路由真的注册了）
func TestAgentShotRouteExistsBehindAuth(t *testing.T) {
	f := newAgentShotHTTPFixture(t)
	status, body := f.post(t, "/api/agent/projects/PROJ_1/shots/SHOT_X/generate", "")
	if status != http.StatusUnauthorized {
		t.Fatalf("无凭据应 401，实际 %d", status)
	}
	if body["msg"] != "请先登录" {
		t.Fatalf("应提示先登录（说明走的是会话鉴权分支），实际 %v", body["msg"])
	}
}

// 2. ★ 会话态不被误伤：无 Agent 令牌时作用域门禁必须放行，交给会话鉴权。
//    这决定了浏览器（cookie）能不能用同一个端点——D-057C 收口的前提。
func TestAgentShotScopeGuardPassesThroughWithoutAgentToken(t *testing.T) {
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	if err := RequireAgentScope(c, service.AgentScopeGenerationSubmit); err != nil {
		t.Fatalf("无 Agent 令牌时作用域门禁应放行（会话态走 currentUser），实际拦截：%v", err)
	}
}

// 3. 作用域真生效：只有 shot.read 的令牌调生成端点 → 403
func TestAgentShotRouteRejectsWrongScope(t *testing.T) {
	f := newAgentShotHTTPFixture(t)
	token := f.issueToken(t, []string{service.AgentScopeShotRead})
	status, _ := f.post(t, "/api/agent/projects/PROJ_1/shots/SHOT_NOPROMPT/generate", token)
	if status != http.StatusForbidden {
		t.Fatalf("缺少 generation.submit 应 403，实际 %d", status)
	}
}

// 5. 不存在的镜头 → 400「镜头不存在」，**不是 500**。
//    回归护栏：gorm 的 ErrRecordNotFound 是"查无此镜"（业务 400），
//    不能当成基础设施故障（500）。2026-09-08 生产冒烟抓到过这个语义倒退。
func TestAgentShotRouteMissingShotIsBadRequestNotServerError(t *testing.T) {
	f := newAgentShotHTTPFixture(t)
	token := f.issueToken(t, []string{service.AgentScopeShotRead, service.AgentScopeGenerationSubmit})
	status, body := f.post(t, "/api/agent/projects/PROJ_1/shots/SHOT_NOT_EXIST/generate", token)
	if status != http.StatusBadRequest {
		t.Fatalf("镜头不存在应 400（不能是 500），实际 %d msg=%v", status, body["msg"])
	}
	if body["msg"] != "镜头不存在或不属于该项目" {
		t.Fatalf("文案应为「镜头不存在或不属于该项目」，实际 %v", body["msg"])
	}
}

// 4. 正确 scope 进入业务校验：镜头缺 videoPrompt → 400 且给出可行动文案（不是 500）
func TestAgentShotRouteSurfacesActionableBusinessError(t *testing.T) {
	f := newAgentShotHTTPFixture(t)
	token := f.issueToken(t, []string{service.AgentScopeShotRead, service.AgentScopeGenerationSubmit})
	status, body := f.post(t, "/api/agent/projects/PROJ_1/shots/SHOT_NOPROMPT/generate", token)
	if status != http.StatusBadRequest {
		t.Fatalf("业务校验失败应 400（不是裸 500），实际 %d", status)
	}
	message, _ := body["msg"].(string)
	if !bytes.Contains([]byte(message), []byte("videoPrompt")) {
		t.Fatalf("错误文案应点名 videoPrompt 以便 Agent 行动，实际 %q", message)
	}
}

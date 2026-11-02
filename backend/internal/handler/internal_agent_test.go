package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

type internalAgentFixture struct {
	router   *gin.Engine
	token    string
	workerID string
	secret   string
	userID   string
}

// Full flows construct a real Service: seeding/claiming/leasing uses the
// database backing store; the sqlite schema is the same set of v83 tables.
func newInternalAgentTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+name+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err != nil {
		t.Fatal(err)
	} else {
		sqlDB.SetMaxOpenConns(1)
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	return db
}

func newInternalAgentFlow(t *testing.T) internalAgentFixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db := newInternalAgentTestDB(t, "internal-agent-flow")
	if err := db.AutoMigrate(&model.CloudAgentExecution{}, &model.AgentWorker{}, &model.AgentRuntimeInstance{}, &model.AgentSchedulerSetting{}, &model.AgentAdmissionCounter{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CloudAgentExecution{ID: "run-1", UserID: "user-1", Status: "queued", Revision: 1, Engine: "pi"}).Error; err != nil {
		t.Fatal(err)
	}
	fixture := internalAgentFixture{
		token:    strings.Repeat("t", 32),
		workerID: "compose",
		secret:   strings.Repeat("w", 32),
		userID:   "user-1",
	}
	t.Setenv("CANVAS_AGENT_INTERNAL_TOKEN", fixture.token)
	t.Setenv("CANVAS_AGENT_WORKER_ID", fixture.workerID)
	t.Setenv("CANVAS_AGENT_WORKER_TOKEN", fixture.secret)
	router := gin.New()
	RegisterInternalAgentRoutes(router, service.New(repository.New(db), t.TempDir()))
	fixture.router = router
	return fixture
}

// Mounting assertions: /internal-agent is mounted at the engine root (not under /api),
// and the public proxy and OpenAPI contract do not touch that prefix.
func TestInternalAgentRoutePlacement(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db := newInternalAgentTestDB(t, "internal-agent-placement")
	if err := db.AutoMigrate(&model.CloudAgentExecution{}, &model.AgentWorker{}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CANVAS_AGENT_INTERNAL_TOKEN", strings.Repeat("t", 32))
	t.Setenv("CANVAS_AGENT_WORKER_ID", "compose")
	t.Setenv("CANVAS_AGENT_WORKER_TOKEN", strings.Repeat("w", 32))
	router := gin.New()
	RegisterInternalAgentRoutes(router, service.New(repository.New(db), t.TempDir()))
	for _, route := range router.Routes() {
		if strings.Contains(route.Path, "/internal-agent") && strings.Contains(route.Path, "/api") {
			t.Fatalf("internal-agent routes must stay outside /api: %s %s", route.Method, route.Path)
		}
	}
	found := map[string]bool{}
	for _, route := range router.Routes() {
		found[route.Method+" "+route.Path] = true
	}
	for _, needed := range []string{"GET /internal-agent/health", "GET /internal-agent/config", "POST /internal-agent/capacity", "POST /internal-agent/claim", "POST /internal-agent/runs/:id/renew", "POST /internal-agent/runs/:id/release", "POST /internal-agent/runs/:id/phase", "GET /internal-agent/runs/:id", "GET /internal-agent/runs/:id/control", "POST /internal-agent/runs/:id/fail", "POST /internal-agent/runs/:id/bridge/request", "POST /internal-agent/runs/:id/bridge/model", "POST /internal-agent/runs/:id/bridge/tool", "POST /internal-agent/runs/:id/bridge/event"} {
		if !found[needed] {
			t.Fatalf("internal-agent route missing: %s", needed)
		}
	}
}

func TestInternalAgentClaimRenewReleaseFlow(t *testing.T) {
	fixture := newInternalAgentFlow(t)
	identity := fixture.identityHeaders(fixture.secret)

	// Wrong worker secret → bare 401; wire version mismatch → 426.
	wrong := mapOverride(identity, "Authorization", "Bearer dXNsRepeat")
	if got := performAgentRequest(t, fixture.router, http.MethodGet, "/internal-agent/health", "", wrong).Code; got != http.StatusUnauthorized {
		t.Fatalf("wrong worker secret must 401, got %d", got)
	}
	old := mapOverride(identity, "X-Agent-Protocol-Version", "canvas-pi-wire/v3")
	if got := performAgentRequest(t, fixture.router, http.MethodGet, "/internal-agent/health", "", old).Code; got != http.StatusUpgradeRequired {
		t.Fatalf("wire mismatch must 426, got %d", got)
	}

	// Owner does not belong to the identity → 403.
	foreign := agentJSONCall(t, fixture.router, http.MethodPost, "/internal-agent/claim", `{"owner":"other:0"}`, identity)
	if foreign.Code != http.StatusForbidden {
		t.Fatalf("foreign owner must 403, got %d body=%s", foreign.Code, foreign.Body.String())
	}

	// Claim run-1 → ticket + run grant; claiming again yields an empty ticket.
	claim := agentJSONCall(t, fixture.router, http.MethodPost, "/internal-agent/claim", `{"owner":"compose:0"}`, identity)
	if claim.Code != http.StatusOK {
		t.Fatalf("claim failed: %d %s", claim.Code, claim.Body.String())
	}
	var claimed struct {
		Data struct {
			Run struct {
				RunID      string `json:"runId"`
				UserID     string `json:"userId"`
				Status     string `json:"status"`
				LeaseEpoch int64  `json:"leaseEpoch"`
			} `json:"run"`
			RunAuthorization string `json:"runAuthorization"`
		} `json:"data"`
	}
	if err := json.Unmarshal(claim.Body.Bytes(), &claimed); err != nil {
		t.Fatalf("claim payload malformed: %s", claim.Body.String())
	}
	if claimed.Data.Run.RunID != "run-1" || claimed.Data.Run.LeaseEpoch != 1 || claimed.Data.Run.Status != "running" || !strings.HasPrefix(claimed.Data.RunAuthorization, "run.") {
		t.Fatalf("claim ticket wrong: run=%+v grant=%q", claimed.Data.Run, claimed.Data.RunAuthorization)
	}
	second := agentJSONCall(t, fixture.router, http.MethodPost, "/internal-agent/claim", `{"owner":"compose:0"}`, identity)
	if !strings.Contains(second.Body.String(), `"run":null`) {
		t.Fatalf("held lease must yield an empty claim, got %s", second.Body.String())
	}

	// Renewal: same grant + same epoch → renewed true and a new run grant is returned.
	renew := agentPerform(t, fixture.router, http.MethodPost, "/internal-agent/runs/run-1/renew", "", fixture.runHeaders(claimed.Data.RunAuthorization, "1"))
	if renew.Code != http.StatusOK || !strings.Contains(renew.Body.String(), `"renewed":true`) {
		t.Fatalf("renew must succeed: %d %s", renew.Code, renew.Body.String())
	}
	var renewedPayload struct {
		Data struct {
			RunAuthorization string `json:"runAuthorization"`
		} `json:"data"`
	}
	if err := json.Unmarshal(renew.Body.Bytes(), &renewedPayload); err != nil || !strings.HasPrefix(renewedPayload.Data.RunAuthorization, "run.") {
		t.Fatalf("renew must mint a fresh authorization: %s", renew.Body.String())
	}

	// Release → 200; re-claiming after release can re-acquire the same run, with epoch advancing (fencing).
	release := agentPerform(t, fixture.router, http.MethodPost, "/internal-agent/runs/run-1/release", "", fixture.runHeaders(claimed.Data.RunAuthorization, "1"))
	if release.Code != http.StatusOK || !strings.Contains(release.Body.String(), `"released":true`) {
		t.Fatalf("release must succeed: %d %s", release.Code, release.Body.String())
	}
	reclaim := agentJSONCall(t, fixture.router, http.MethodPost, "/internal-agent/claim", `{"owner":"compose:0"}`, identity)
	var reclamed struct {
		Data struct {
			Run *struct {
				LeaseEpoch int64 `json:"leaseEpoch"`
			} `json:"run"`
		} `json:"data"`
	}
	if err := json.Unmarshal(reclaim.Body.Bytes(), &reclamed); err != nil || reclamed.Data.Run == nil || reclamed.Data.Run.LeaseEpoch != 2 {
		t.Fatalf("release must make the run reclaimable at the next epoch: code=%d body=%s err=%v", reclaim.Code, reclaim.Body.String(), err)
	}
}

func TestInternalAgentRunAuthRejectsHeaderDrift(t *testing.T) {
	fixture := newInternalAgentFlow(t)
	claim := agentJSONCall(t, fixture.router, http.MethodPost, "/internal-agent/claim", `{"owner":"compose:0"}`, fixture.identityHeaders(fixture.secret))
	var claimed struct {
		Data struct {
			Run *struct {
				RunID string `json:"runId"`
			} `json:"run"`
			RunAuthorization string `json:"runAuthorization"`
		} `json:"data"`
	}
	if err := json.Unmarshal(claim.Body.Bytes(), &claimed); err != nil || claimed.Data.Run == nil {
		t.Fatalf("setup claim failed: %d %s", claim.Code, claim.Body.String())
	}
	// The worker header is missing → 401 (one of the last gates of run-level one authorization).
	headers := fixture.runHeaders(claimed.Data.RunAuthorization, "1")
	headers["X-Agent-Worker-ID"] = ""
	if got := agentPerform(t, fixture.router, http.MethodPost, "/internal-agent/runs/run-1/renew", "", headers).Code; got != http.StatusUnauthorized {
		t.Fatalf("missing worker header must 401, got %d", got)
	}
	// Missing run grant → 401.
	headers = fixture.runHeaders("", "1")
	if got := agentPerform(t, fixture.router, http.MethodPost, "/internal-agent/runs/run-1/renew", "", headers).Code; got != http.StatusUnauthorized {
		t.Fatalf("missing run grant must 401, got %d", got)
	}
	// Over-capacity request body → 400. The claim body limit is 8KiB.
	huge := strings.Repeat("x", 10<<10)
	if got := agentPerform(t, fixture.router, http.MethodPost, "/internal-agent/claim", `{"owner":"`+huge+`"}`, fixture.identityHeaders(fixture.secret)).Code; got != http.StatusBadRequest {
		t.Fatalf("oversized body must 400, got %d", got)
	}
}

func (f internalAgentFixture) identityHeaders(secret string) map[string]string {
	return map[string]string{
		"X-Agent-Identity":         f.workerID,
		"Authorization":            "Bearer " + secret,
		"X-Agent-Protocol-Version": "canvas-pi-wire/v4",
		"X-Pi-SDK-Version":         "0.87.1",
		"X-Pi-Session-Format":      "3",
	}
}

func (f internalAgentFixture) runHeaders(token string, epoch string) map[string]string {
	// 运行级 X-Agent-Worker-ID 携带槽位（claim body 的 owner）；身份头保持 worker 名。
	return map[string]string{
		"X-Agent-Identity":         f.workerID,
		"X-Agent-Worker-ID":        f.workerID + ":0",
		"X-Agent-User-ID":          f.userID,
		"X-Agent-Session-Epoch":    epoch,
		"Authorization":            "Bearer " + token,
		"X-Agent-Protocol-Version": "canvas-pi-wire/v4",
		"X-Pi-SDK-Version":         "0.87.1",
		"X-Pi-Session-Format":      "3",
	}
}

func mapOverride(headers map[string]string, name, override string) map[string]string {
	out := map[string]string{}
	for key, value := range headers {
		out[key] = value
	}
	out[name] = override
	return out
}

func agentJSONCall(t *testing.T, router *gin.Engine, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	return performAgentRequest(t, router, method, target, body, headers)
}

func agentPerform(t *testing.T, router *gin.Engine, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	return performAgentRequest(t, router, method, target, body, headers)
}

func performAgentRequest(t *testing.T, router *gin.Engine, method, target, body string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, target, strings.NewReader(body))
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}

package app

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	agentruntime "yingce/backend/internal/agent/runtime"
	"yingce/backend/internal/agent/session"
)

type recordingAgentRuntime struct {
	starts, resumes, stops, recovers, closes, inspections int
	limits                                                []int
}

func (r *recordingAgentRuntime) Start(userID, runID string)  { r.starts++ }
func (r *recordingAgentRuntime) Resume(userID, runID string) { r.resumes++ }
func (r *recordingAgentRuntime) Stop(runID string)           { r.stops++ }
func (r *recordingAgentRuntime) Recover()                    { r.recovers++ }
func (r *recordingAgentRuntime) Close()                      { r.closes++ }
func (r *recordingAgentRuntime) SetSessionLimit(ctx context.Context, limit int) error {
	r.limits = append(r.limits, limit)
	return nil
}
func (r *recordingAgentRuntime) Inspect(ctx context.Context) session.Status {
	r.inspections++
	return session.Status{Mode: "worker", Healthy: true}
}

func TestAgentRuntimeSeamUsesOverrideWhenSet(t *testing.T) {
	recorder := &recordingAgentRuntime{}
	s := &Service{agentRuntimeOverride: recorder}
	s.agentRuntime().Start("user-a", "run-a")
	s.agentRuntime().Resume("user-a", "run-a")
	s.agentRuntime().Stop("run-a")
	s.agentRuntime().Recover()
	s.agentRuntime().Close()
	if recorder.starts != 1 || recorder.resumes != 1 || recorder.stops != 1 || recorder.recovers != 1 || recorder.closes != 1 {
		t.Fatalf("seam did not route lifecycle calls to the override: %+v", recorder)
	}
}

// 默认实现必须保持既有协调器语义：重复 Start 不取消活会话、Resume 在退出中登记
// 重启、Stop 取消、Recover/Close 空跑不 panic。与 cloud_agent_pi_runner_test 的
// 既有断言同口径，只是改从 seam 进入。
func TestAgentRuntimeSeamDefaultsToPushRuntime(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s := &Service{piRunners: map[string]context.CancelFunc{"run-a": cancel}}
	if _, ok := s.agentRuntime().(piPushRuntime); !ok {
		t.Fatalf("default runtime must be piPushRuntime, got %T", s.agentRuntime())
	}
	s.agentRuntime().Start("user-a", "run-a")
	if err := ctx.Err(); err != nil {
		t.Fatal("duplicate start via seam cancelled the active runner")
	}
	s.agentRuntime().Resume("user-a", "run-a")
	if _, queued := s.piRunnerRestarts["run-a"]; !queued {
		t.Fatal("resume via seam dropped the restart request")
	}
	s.agentRuntime().Stop("run-a")
	if err := ctx.Err(); err == nil {
		t.Fatal("stop via seam did not cancel the runner")
	}
	s.agentRuntime().Recover()
	s.agentRuntime().Close()
}

func TestAgentRuntimeInspectEmbeddedParity(t *testing.T) {
	t.Setenv("YINGCE_AGENT_URL", "")
	s := &Service{}
	status := s.agentRuntime().Inspect(context.Background())
	_, limit := agentruntime.ProcessUsage()
	if status.Mode != "embedded" || status.Endpoint != "本进程" || !status.Healthy || status.Limit != limit {
		t.Fatalf("embedded inspect mismatch: %+v (want limit %d)", status, limit)
	}
	if status.Message != "本地开发由后端进程直接启动，不单独占用容器。" {
		t.Fatalf("embedded inspect message drifted: %q", status.Message)
	}
}

func TestAgentRuntimeInspectRemoteParity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true,"active":2,"limit":5,"queued":1}`)
	}))
	defer server.Close()
	t.Setenv("YINGCE_AGENT_URL", server.URL)
	s := &Service{}
	status := s.agentRuntime().Inspect(context.Background())
	if !status.Healthy || status.Active != 2 || status.Limit != 5 || status.Queued != 1 || status.Mode != "remote" || status.Endpoint != server.URL {
		t.Fatalf("remote inspect mismatch: %+v", status)
	}

	closed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	closed.Close()
	t.Setenv("YINGCE_AGENT_URL", closed.URL)
	degraded := s.agentRuntime().Inspect(context.Background())
	// 既有怪癖：remote 不可达不是 error，而是 Healthy=false 且计数全零的降级快照。
	if degraded.Healthy || degraded.Active != 0 || degraded.Limit != 0 || degraded.Queued != 0 {
		t.Fatalf("unreachable inspect must degrade with zero counts: %+v", degraded)
	}
	if degraded.Message != "独立 Agent 服务不可达。正在进行的对话会失败，不会自动改回本进程执行。" {
		t.Fatalf("unreachable inspect message drifted: %q", degraded.Message)
	}
}

func TestAgentRuntimeSetSessionLimitParity(t *testing.T) {
	t.Setenv("YINGCE_AGENT_URL", "")
	s := &Service{}
	// embedded 部分永不失败且先行执行；用当前上限回写避免污染进程级状态。
	_, current := agentruntime.ProcessUsage()
	if err := s.agentRuntime().SetSessionLimit(context.Background(), current); err != nil {
		t.Fatalf("embedded SetSessionLimit must not fail: %v", err)
	}

	token := strings.Repeat("t", 32)
	var limitBody, sawAuth, sawMethod, sawPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		limitBody, sawAuth, sawMethod, sawPath = string(body), r.Header.Get("Authorization"), r.Method, r.URL.Path
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	t.Setenv("YINGCE_AGENT_URL", server.URL)
	t.Setenv("YINGCE_AGENT_TOKEN", token)
	if err := s.agentRuntime().SetSessionLimit(context.Background(), 7); err != nil {
		t.Fatalf("remote SetSessionLimit failed: %v", err)
	}
	if sawMethod != http.MethodPut || sawPath != "/v1/limit" || limitBody != `{"maxSessions":7}` || sawAuth != "Bearer "+token {
		t.Fatalf("remote limit request mismatch: method=%s path=%s body=%q auth=%q", sawMethod, sawPath, limitBody, sawAuth)
	}
}

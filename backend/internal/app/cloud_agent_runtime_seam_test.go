package app

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	agentruntime "yingce/backend/internal/agent/runtime"
	"yingce/backend/internal/agent/session"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
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
	return session.Status{ID: "recorder", Mode: session.ModeWorker, Healthy: true}
}

// seam 十处生产接入中，这里锁生命周期与限额/观测的完整路由：任一调用点回退为
// 直接调用旧方法，计数断言即失败（override 计数归零或缺失）。
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
	if err := s.agentRuntime().SetSessionLimit(context.Background(), 9); err != nil {
		t.Fatalf("SetSessionLimit via seam returned error: %v", err)
	}
	if len(recorder.limits) != 1 || recorder.limits[0] != 9 {
		t.Fatalf("limits recorded = %v, want [9]", recorder.limits)
	}
	if status := s.agentRuntime().Inspect(context.Background()); status.ID != "recorder" {
		t.Fatalf("Inspect via seam did not hit the override: %+v", status)
	}
	if recorder.inspections != 1 {
		t.Fatalf("inspections = %d, want 1", recorder.inspections)
	}
}

// Service.Close 的关闭序依赖 agentRuntime().Close()：调用点回退成直调
// closeCloudAgentPiRunners 时 override 计数不会增加，本用例即失败。
func TestServiceCloseRoutesThroughSeam(t *testing.T) {
	recorder := &recordingAgentRuntime{}
	s := &Service{agentRuntimeOverride: recorder}
	if err := s.Close(); err != nil {
		t.Fatalf("Service.Close returned error: %v", err)
	}
	if recorder.closes != 1 {
		t.Fatalf("Service.Close did not route through the seam: closes=%d", recorder.closes)
	}
}

// collectAgentServices 必须消费 seam 的 Inspect：回退为直调 yingceagent/ProcessUsage
// 时 override 计数不变。RuntimePolicy 读取需要真实 sqlite（空 SystemSetting 表
// 回落默认策略，无外部依赖）。
func TestCollectAgentServicesRoutesThroughSeamInspect(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	t.Setenv("YINGCE_AGENT_URL", "http://127.0.0.1:1") // 不影响结果：实现被 override
	recorder := &recordingAgentRuntime{}
	s := &Service{repo: repository.New(db), agentRuntimeOverride: recorder}
	agents := s.collectAgentServices(context.Background())
	if recorder.inspections != 1 {
		t.Fatalf("inspections = %d, want 1", recorder.inspections)
	}
	if len(agents) != 1 || agents[0].ID != "recorder" || agents[0].Mode != string(session.ModeWorker) {
		t.Fatalf("collectAgentServices did not map the override status: %+v", agents)
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

// 映射表驱动：锁定 Mode→ID/文案的既有行为，并约束未来 Worker 模式不被误标——
// 它报什么 ID 就展示什么，未申报 LimitMismatch 就不出现限额不一致提示。
func TestAgentServiceStatusFromSession(t *testing.T) {
	const configured = 30
	const label = "画布 Agent"
	cases := []struct {
		name     string
		status   session.Status
		wantID   string
		wantMode string
		wantMsg  string
	}{
		{
			name:   "embedded keeps fixed message",
			status: session.Status{ID: "embedded", Mode: session.ModeEmbedded, Endpoint: "本进程", Healthy: true, Limit: 30, Message: "本地开发由后端进程直接启动，不单独占用容器。"},
			wantID: "embedded", wantMode: "embedded", wantMsg: "本地开发由后端进程直接启动，不单独占用容器。",
		},
		{
			name:   "embedded limit mismatch is not reported",
			status: session.Status{ID: "embedded", Mode: session.ModeEmbedded, Endpoint: "本进程", Healthy: true, Limit: 8, Message: "本地开发由后端进程直接启动，不单独占用容器。"},
			wantID: "embedded", wantMode: "embedded", wantMsg: "本地开发由后端进程直接启动，不单独占用容器。",
		},
		{
			name:   "remote reachable reports mismatch when limits differ",
			status: session.Status{ID: "yingce-agent", Mode: session.ModeRemote, Endpoint: "http://agent", Healthy: true, LimitMismatch: true, Limit: 16},
			wantID: "yingce-agent", wantMode: "remote", wantMsg: "运行中的上限与已保存配置不一致，重新保存一次即可应用。",
		},
		{
			name:   "remote reachable with matching limit stays silent",
			status: session.Status{ID: "yingce-agent", Mode: session.ModeRemote, Endpoint: "http://agent", Healthy: true, LimitMismatch: true, Limit: configured},
			wantID: "yingce-agent", wantMode: "remote", wantMsg: "",
		},
		{
			name:   "remote unreachable keeps degraded message despite limit difference",
			status: session.Status{ID: "yingce-agent", Mode: session.ModeRemote, Endpoint: "http://agent", Healthy: false, Message: "独立 Agent 服务不可达。正在进行的对话会失败，不会自动改回本进程执行。"},
			wantID: "yingce-agent", wantMode: "remote", wantMsg: "独立 Agent 服务不可达。正在进行的对话会失败，不会自动改回本进程执行。",
		},
		{
			name:   "worker mode keeps its own identity without inherited mismatch",
			status: session.Status{ID: "agent-worker", Mode: session.ModeWorker, Endpoint: "internal", Healthy: true, Limit: 1},
			wantID: "agent-worker", wantMode: "worker", wantMsg: "",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := agentServiceStatusFromSession(tc.status, configured)
			if got.ID != tc.wantID || got.Name != label || got.Mode != tc.wantMode || got.StatusMessage != tc.wantMsg {
				t.Fatalf("mapped = %+v, want id=%q mode=%q msg=%q", got, tc.wantID, tc.wantMode, tc.wantMsg)
			}
			if got.Endpoint != tc.status.Endpoint || got.Healthy != tc.status.Healthy || got.Active != tc.status.Active || got.Limit != tc.status.Limit || got.Queued != tc.status.Queued || got.ConfiguredLimit != configured {
				t.Fatalf("pass-through fields drifted: mapped=%+v status=%+v", got, tc.status)
			}
		})
	}
}

func TestAgentRuntimeInspectEmbeddedParity(t *testing.T) {
	t.Setenv("YINGCE_AGENT_URL", "")
	s := &Service{}
	status := s.agentRuntime().Inspect(context.Background())
	_, limit := agentruntime.ProcessUsage()
	if status.ID != "embedded" || status.Mode != session.ModeEmbedded || status.Endpoint != "本进程" || !status.Healthy || status.Limit != limit || status.LimitMismatch {
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
	if status.ID != "yingce-agent" || !status.Healthy || !status.LimitMismatch || status.Active != 2 || status.Limit != 5 || status.Queued != 1 || status.Mode != session.ModeRemote || status.Endpoint != server.URL {
		t.Fatalf("remote inspect mismatch: %+v", status)
	}

	closed := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	closed.Close()
	t.Setenv("YINGCE_AGENT_URL", closed.URL)
	degraded := s.agentRuntime().Inspect(context.Background())
	// 既有怪癖：remote 不可达不是 error，而是 Healthy=false 且计数全零的降级快照；
	// 也不申报限额比对候选。
	if degraded.ID != "yingce-agent" || degraded.Healthy || degraded.LimitMismatch || degraded.Active != 0 || degraded.Limit != 0 || degraded.Queued != 0 {
		t.Fatalf("unreachable inspect must degrade with zero counts: %+v", degraded)
	}
	if degraded.Message != "独立 Agent 服务不可达。正在进行的对话会失败，不会自动改回本进程执行。" {
		t.Fatalf("unreachable inspect message drifted: %q", degraded.Message)
	}
}

// restoreProcessLimit 记录并恢复进程级会话闸门：remote 分支也会先行执行
// agentruntime.SetProcessLimit，用例结束必须还原，避免污染同包其他测试。
func restoreProcessLimit(t *testing.T) func() {
	t.Helper()
	_, current := agentruntime.ProcessUsage()
	return func() { agentruntime.SetProcessLimit(current) }
}

func TestAgentRuntimeSetSessionLimit(t *testing.T) {
	embeddedApply := func(t *testing.T) (int, int) {
		restore := restoreProcessLimit(t)
		t.Cleanup(restore)
		s := &Service{}
		if err := s.agentRuntime().SetSessionLimit(context.Background(), 9); err != nil {
			t.Fatalf("embedded SetSessionLimit must not fail: %v", err)
		}
		_, limit := agentruntime.ProcessUsage()
		return limit, 9
	}
	t.Run("embedded applies the process gate", func(t *testing.T) {
		if limit, want := embeddedApply(t); limit != want {
			t.Fatalf("process gate limit = %d, want %d", limit, want)
		}
	})
	t.Run("remote ok applies gate and forwards to the service", func(t *testing.T) {
		restore := restoreProcessLimit(t)
		t.Cleanup(restore)
		var sawAuth, sawBody string
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			sawAuth, sawBody = r.Header.Get("Authorization"), string(body)
			w.WriteHeader(http.StatusOK)
		}))
		defer server.Close()
		token := strings.Repeat("t", 32)
		t.Setenv("YINGCE_AGENT_URL", server.URL)
		t.Setenv("YINGCE_AGENT_TOKEN", token)
		s := &Service{}
		if err := s.agentRuntime().SetSessionLimit(context.Background(), 7); err != nil {
			t.Fatalf("remote SetSessionLimit failed: %v", err)
		}
		if sawBody != `{"maxSessions":7}` || sawAuth != "Bearer "+token {
			t.Fatalf("remote limit request mismatch: body=%q auth=%q", sawBody, sawAuth)
		}
		if _, limit := agentruntime.ProcessUsage(); limit != 7 {
			t.Fatalf("process gate after remote apply = %d, want 7", limit)
		}
	})
	t.Run("remote non-200 returns the service error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusForbidden)
			_, _ = io.WriteString(w, "forbidden")
		}))
		defer server.Close()
		t.Setenv("YINGCE_AGENT_URL", server.URL)
		t.Setenv("YINGCE_AGENT_TOKEN", strings.Repeat("t", 32))
		err := (&Service{}).agentRuntime().SetSessionLimit(context.Background(), 7)
		if err == nil || !strings.Contains(err.Error(), "yingce-agent limit returned HTTP 403") {
			t.Fatalf("want HTTP 403 error, got %v", err)
		}
	})
	t.Run("weak service token is rejected before the request", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		defer server.Close()
		t.Setenv("YINGCE_AGENT_URL", server.URL)
		t.Setenv("YINGCE_AGENT_TOKEN", "short")
		err := (&Service{}).agentRuntime().SetSessionLimit(context.Background(), 7)
		if err == nil || !strings.Contains(err.Error(), "at least 32 characters") {
			t.Fatalf("want weak-token error, got %v", err)
		}
	})
	t.Run("unreachable service returns the network error", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
		server.Close()
		t.Setenv("YINGCE_AGENT_URL", server.URL)
		t.Setenv("YINGCE_AGENT_TOKEN", strings.Repeat("t", 32))
		err := (&Service{}).agentRuntime().SetSessionLimit(context.Background(), 7)
		if err == nil || errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("want network error, got %v", err)
		}
	})
}

package app

import (
	"context"
	"os"
	"strings"

	agentruntime "yingce/backend/internal/agent/runtime"
	"yingce/backend/internal/agent/session"
	"yingce/backend/internal/agent/yingceagent"
)

// agentRuntime 返回云端 Agent 会话运行时的控制面（RFC #943 的唯一选择点）。
//
// 三分支按显式性排优先级：显式远程 push（YINGCE_AGENT_URL）最先——同时配置两个
// 执行面时 push 赢，避免部署歧义；其次 worker（CANVAS_AGENT_INTERNAL_TOKEN ≥32
// 字符，挂载 /internal-agent）；最后内嵌 push（本机 spawn）。
// agentRuntimeOverride 只由测试注入，用于断言调用方走了 seam。
func (s *Service) agentRuntime() session.Runtime {
	if s.agentRuntimeOverride != nil {
		return s.agentRuntimeOverride
	}
	if strings.TrimSpace(os.Getenv("YINGCE_AGENT_URL")) != "" {
		return piPushRuntime{s: s}
	}
	if len(strings.TrimSpace(os.Getenv("CANVAS_AGENT_INTERNAL_TOKEN"))) >= 32 {
		return piWorkerRuntime{s: s}
	}
	return piPushRuntime{s: s}
}

// agentRuntimeMode exposes the same priority to creation-time decisions (which
// engine value a new run stamps) without exposing the concrete runtime types.
func (s *Service) agentRuntimeMode() session.Mode {
	if strings.TrimSpace(os.Getenv("YINGCE_AGENT_URL")) != "" {
		return session.ModeRemote
	}
	if len(strings.TrimSpace(os.Getenv("CANVAS_AGENT_INTERNAL_TOKEN"))) >= 32 {
		return session.ModeWorker
	}
	return session.ModeEmbedded
}

// piWorkerRuntime 是 pull（Worker 领取）模型的 seam 实现：会话不在本进程托管，
// 「启动」意味着运行进入可领取状态，「恢复」意味着允许重新领取，「停止」清理
// 租约，「Close」无事可做——磁盘上的租约靠 45s 过期加周期清扫收敛。
type piWorkerRuntime struct {
	s *Service
}

// Start/Resume 只保证运行可被领取：worker 模式下运行创建即 engine='pi'、
// 无租约，因此无需额外动作；这里仍顺带释放残留租约，让审批/插话后的运行
// 回到领取池。
func (r piWorkerRuntime) Start(_, runID string)  { r.s.releaseRunLeaseByRunID(runID) }
func (r piWorkerRuntime) Resume(_, runID string) { r.s.releaseRunLeaseByRunID(runID) }

// Recover 周期对账：双清扫推进租约过期的运行（stalled/unclaimed）。60s 节流
// 把 P1 传递来的 3s ticker 归一到 watchdog 节奏，调用方无感。
func (r piWorkerRuntime) Recover() { r.s.sweepPiAgentPeriodically() }

func (r piWorkerRuntime) Stop(runID string) {
	// 用户取消：无 worker epoch 概念，直接释放租约；终态化由取消流程完成。
	r.s.releaseRunLeaseByRunID(runID)
}

func (r piWorkerRuntime) Close() {}

func (r piWorkerRuntime) SetSessionLimit(ctx context.Context, limit int) error {
	policy, err := r.s.AgentSchedulerConfig()
	if err != nil {
		return err
	}
	_, err = r.s.repo.SetAgentSchedulerSessionLimit(limit, policy.Revision)
	return err
}

// Inspect 汇总 worker 池的健康与容量：文案沿用 AgentAvailability 的四段现状
// 说明；计数与 worker 自报一致（45s 心跳窗口内）。
func (r piWorkerRuntime) Inspect(ctx context.Context) session.Status {
	availability, err := r.s.AgentAvailability()
	if err != nil {
		return session.Status{ID: "agent-worker", Mode: session.ModeWorker, Endpoint: "/internal-agent", Healthy: false, Message: "Agent Worker 状态不可用；请检查数据库连接"}
	}
	_ = ctx
	return session.Status{
		ID: "agent-worker", Mode: session.ModeWorker, Endpoint: "/internal-agent",
		Healthy: availability.QueueReason == "", Active: r.s.workerActiveWithinWindow(),
		Limit: r.s.currentResidentSessionLimit(), Queued: r.s.currentClaimableRunCount(),
		Message: availability.Reason,
	}
}

var _ session.Runtime = piWorkerRuntime{}

// piPushRuntime 是 push 模型（内嵌进程 + yingce-agent）的 seam 实现。
// 生命周期五方法纯委托到既有协调器方法，零逻辑改写；SetSessionLimit/Inspect
// 的分支体从 admin_system_performance.go 原样迁入。
type piPushRuntime struct {
	s *Service
}

func (r piPushRuntime) Start(userID, runID string)  { r.s.startCloudAgentPi(userID, runID) }
func (r piPushRuntime) Resume(userID, runID string) { r.s.resumeCloudAgentPi(userID, runID) }
func (r piPushRuntime) Stop(runID string)           { r.s.stopCloudAgentPi(runID) }
func (r piPushRuntime) Recover()                    { r.s.recoverCloudAgentPiRunners() }
func (r piPushRuntime) Close()                      { r.s.closeCloudAgentPiRunners() }

func (r piPushRuntime) SetSessionLimit(ctx context.Context, limit int) error {
	agentruntime.SetProcessLimit(limit)
	endpoint := strings.TrimSpace(os.Getenv("YINGCE_AGENT_URL"))
	if endpoint == "" {
		return nil
	}
	return yingceagent.SetLimit(ctx, endpoint, os.Getenv("YINGCE_AGENT_TOKEN"), limit)
}

// Inspect 保持既有怪癖：embedded 分支不读 yingceagent 健康数据，remote 分支不读
// ProcessUsage；remote 不可达不是 error，而是 Healthy=false 且计数全零的降级快照。
// ID 与「限额不一致候选」由实现申报（Status.ID / Status.LimitMismatch），消费方
// 不按 Mode 字面量推导，避免新增托管方式时被误标成既有服务。
func (r piPushRuntime) Inspect(ctx context.Context) session.Status {
	endpoint := strings.TrimSpace(os.Getenv("YINGCE_AGENT_URL"))
	if endpoint == "" {
		active, limit := agentruntime.ProcessUsage()
		return session.Status{ID: "embedded", Mode: session.ModeEmbedded, Endpoint: "本进程", Healthy: true, Active: active, Limit: limit, Message: "本地开发由后端进程直接启动，不单独占用容器。"}
	}
	status, err := yingceagent.Inspect(ctx, endpoint)
	if err != nil {
		return session.Status{ID: "yingce-agent", Mode: session.ModeRemote, Endpoint: endpoint, Healthy: false, Message: "独立 Agent 服务不可达。正在进行的对话会失败，不会自动改回本进程执行。"}
	}
	return session.Status{ID: "yingce-agent", Mode: session.ModeRemote, Endpoint: endpoint, Healthy: status.OK, LimitMismatch: true, Active: status.Active, Limit: status.Limit, Queued: status.Queued}
}

var _ session.Runtime = piPushRuntime{}

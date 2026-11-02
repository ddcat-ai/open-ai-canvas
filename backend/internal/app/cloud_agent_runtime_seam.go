package app

import (
	"context"
	"os"
	"strings"

	agentruntime "yingce/backend/internal/agent/runtime"
	"yingce/backend/internal/agent/session"
	"yingce/backend/internal/agent/yingceagent"
)

// agentRuntime 返回云端 Agent 会话运行时的控制面。
//
// P1 阶段唯一实现是 piPushRuntime（本机 spawn 内嵌运行时或远程 yingce-agent，
// 由 YINGCE_AGENT_URL 分发，行为与直接调用旧方法逐字节一致）。后续引入
// Worker 拉取运行时（RFC #943 的 P2+）时，在这里按配置选择实现；
// agentRuntimeOverride 只由测试注入，用于断言调用方走了 seam。
func (s *Service) agentRuntime() session.Runtime {
	if s.agentRuntimeOverride != nil {
		return s.agentRuntimeOverride
	}
	return piPushRuntime{s: s}
}

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

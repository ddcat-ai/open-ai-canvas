package app

import (
	"errors"
	"os"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// AgentSchedulerConfig returns the effective dispatch policy validated against
// the builtin bounds. Admin writes land with the admin surface (P4); worker
// mode only reads.
func (s *Service) AgentSchedulerConfig() (model.AgentSchedulerSetting, error) {
	p, err := s.repo.AgentSchedulerSetting(model.DefaultAgentSchedulerSetting())
	if err != nil {
		return p, err
	}
	return p, validateAgentSchedulerSetting(p)
}

func validateAgentSchedulerSetting(p model.AgentSchedulerSetting) error {
	bounds := []struct {
		label string
		value int
		min   int
		max   int
	}{
		{"dispatchConcurrency", p.DispatchConcurrency, 1, 32},
		{"maxResidentSessions", p.MaxResidentSessions, 1, 512},
		{"maxResidentPerUser", p.MaxResidentPerUser, 1, 128},
		{"maxResidentPerCanvas", p.MaxResidentPerCanvas, 1, 128},
	}
	for _, bound := range bounds {
		if bound.value < bound.min || bound.value > bound.max {
			return kernel.BadAuthRequest("Agent 调度配置项越界：" + bound.label)
		}
	}
	return nil
}

// PiCapacityReport records a worker's capacity heartbeat. Values are bounded
// server-side: workers are flawed inputs, not authorities.
func (s *Service) PiCapacityReport(owner string, p model.AgentCapacityReport) error {
	if p.Readiness == "" {
		p.Readiness = "starting"
	}
	if !validAgentCapacityReport(owner, p) {
		return kernel.BadAuthRequest("Agent 容量上报无效")
	}
	return s.repo.AgentCapacityReport(owner, p)
}

// validAgentCapacityReport bounds every worker-reported counter and accepts
// only the known readiness states; a draining worker may exceed capacity.
func validAgentCapacityReport(owner string, p model.AgentCapacityReport) bool {
	if owner == "" || len(owner) > 80 || len(p.ReadinessReason) > 512 {
		return false
	}
	if p.Active < 0 || p.Active > 64 || p.Capacity < 1 || p.Capacity > 64 || (p.Active > p.Capacity && !p.Draining) {
		return false
	}
	if p.ClaimReservations < 0 || p.ClaimReservations > 16 || p.DispatchActive < 0 || p.DispatchActive > 16 || p.ReadyQueued < 0 || p.AppliedConfigRevision < 0 {
		return false
	}
	return p.Readiness == "starting" || p.Readiness == "ready" || p.Readiness == "degraded" || p.Readiness == "draining"
}

// AgentAvailability summarizes worker-mode readiness for the admin surface and
// the runtime Inspect. The four outcome texts are part of the operator-facing
// contract; keep them verbatim when amending.
type AgentAvailability struct {
	Configured   bool   `json:"configured"`
	ReadyWorkers int    `json:"readyWorkers"`
	QueueReason  string `json:"queueReason"`
	Reason       string `json:"reason"`
}

func (s *Service) AgentAvailability() (AgentAvailability, error) {
	status := AgentAvailability{Configured: len(strings.TrimSpace(os.Getenv("CANVAS_AGENT_INTERNAL_TOKEN"))) >= 32}
	if !status.Configured {
		status.QueueReason, status.Reason = "not_configured", "Agent 未配置：请设置 CANVAS_AGENT_INTERNAL_TOKEN 并部署 Worker"
		return status, nil
	}
	rows, err := s.repo.AgentRuntimeInstances()
	if err != nil {
		return status, err
	}
	var online, free int
	for _, row := range rows {
		// Worker 在线窗口为 45 秒内的心跳；容量上报每 5 秒一次。
		if !row.UpdatedAt.After(time.Now().UTC().Add(-45 * time.Second)) {
			continue
		}
		online++
		if row.Readiness == "ready" && !row.Draining {
			status.ReadyWorkers++
			if row.Active+row.ClaimReservations < row.Capacity {
				free++
			}
		}
	}
	switch {
	case status.ReadyWorkers == 0 && online == 0:
		status.QueueReason, status.Reason = "worker_offline", "Agent Worker 离线；请检查容器、令牌和后端连接，任务将在限定时间内等待"
	case status.ReadyWorkers == 0:
		status.QueueReason, status.Reason = "worker_not_ready", "Agent Worker 在线但未就绪；请检查协议、Harness 和配置"
	case free == 0:
		status.QueueReason, status.Reason = "capacity", "Agent Worker 已满载，任务正在排队"
	}
	return status, nil
}

var errClaimNeedsOwner = errors.New("Pi worker owner is required")

// workerActiveWithinWindow sums heartbeat-newest active counts (45s window).
func (s *Service) workerActiveWithinWindow() int {
	rows, err := s.repo.AgentRuntimeInstances()
	if err != nil {
		return 0
	}
	window := time.Now().UTC().Add(-45 * time.Second)
	total := 0
	for _, row := range rows {
		if row.UpdatedAt.After(window) {
			total += row.Active
		}
	}
	return total
}

// currentResidentSessionLimit reports the persisted cap; reads failing fall
// back to defaults (the admin page keeps a degraded line, not zero).
func (s *Service) currentResidentSessionLimit() int {
	if policy, err := s.AgentSchedulerConfig(); err == nil {
		return policy.MaxResidentSessions
	}
	return model.DefaultAgentSchedulerSetting().MaxResidentSessions
}

// currentClaimableRunCount counts runs any worker could claim right now.
func (s *Service) currentClaimableRunCount() int {
	return s.repo.ClaimablePiAgentRunCount()
}

// AgentWorkerStatus 是 /internal-agent/health 里每个 worker 进程的观测行，
// 形状刻意不与 admin 面重用（worker 协议独立演进）。
type AgentWorkerStatus struct {
	ID        string `json:"id"`
	Readiness string `json:"readiness"`
	Online    bool   `json:"online"`
	Active    int    `json:"active"`
	Capacity  int    `json:"capacity"`
}

// AgentWorkersView snapshots the worker pool for the health probe.
func (s *Service) AgentWorkersView() ([]AgentWorkerStatus, error) {
	rows, err := s.repo.AgentRuntimeInstances()
	if err != nil {
		return nil, err
	}
	window := time.Now().UTC().Add(-45 * time.Second)
	view := make([]AgentWorkerStatus, 0, len(rows))
	for _, row := range rows {
		view = append(view, AgentWorkerStatus{ID: row.ID, Readiness: row.Readiness, Online: row.UpdatedAt.After(window), Active: row.Active, Capacity: row.Capacity})
	}
	return view, nil
}

package app

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// allowedAgentPhases 是 Worker 上报的运行相位白名单（fork wire 合同原文）。
// wait_kind/wait_id/wait_reason 三组细分在 fork 批量迁移（v78–v82）合入后恢复
// 持久化；本阶段 phase 状态面只有 runtime_phase 一列。
var allowedAgentPhases = map[string]bool{
	"ready": true, "advancing": true, "waiting_model": true, "waiting_tool": true,
	"waiting_approval": true, "waiting_compaction": true, "waiting_resource": true,
	"retry_delay": true,
}

type PiRuntimePhaseRequest struct {
	Phase  string `json:"phase"`
	Kind   string `json:"kind"`
	WaitID string `json:"waitId"`
	Reason string `json:"reason"`
}

// PiRuntimePhase 把 Worker 的会话相位写入运行行。非租约持有者无权改写；
// 审批态以运行 Status 为准，Worker 报的 waiting_tool 在审批等待里自动归一为
// waiting_approval，避免前端因为时序闪回"执行中"。
func (s *Service) PiRuntimePhase(userID, runID, owner string, input PiRuntimePhaseRequest) error {
	run, err := s.piLeasedRun(userID, runID, owner)
	if err != nil {
		if run != nil {
			if _, terminal := piTerminalRunAfterLeaseFailure(run, owner); terminal {
				return nil
			}
		}
		return err
	}
	if cloudAgentRunTerminal(run.Status) {
		return nil
	}
	if _, ok := allowedAgentPhases[strings.TrimSpace(input.Phase)]; !ok {
		return kernel.BadAuthRequest("Invalid Agent runtime phase")
	}
	if len(input.Kind) > 32 || len(input.WaitID) > 240 || len(input.Reason) > 160 {
		return kernel.BadAuthRequest("Invalid Agent wait reference")
	}
	phase := input.Phase
	// fork 合同行为：审批等待期间报 waiting_tool 归一为 waiting_approval。
	if run.Status == "waiting_approval" && phase == "waiting_tool" {
		phase = "waiting_approval"
	}
	workerID, epoch, _, err := parsePiAgentLeaseOwner(owner)
	if err != nil {
		return err
	}
	if err := s.repo.SetAgentRunPhase(userID, runID, workerID, epoch, phase); err != nil {
		if err == repository.ErrCreationConflict {
			return kernel.AgentLeaseLost("Agent runtime phase lease conflict")
		}
		return err
	}
	return nil
}

// PiRunInspection 是运行级快照的窄化版：Worker 只需要会话驱动的判定字段。
// 完整快照（Pi 会话条目树 / 工具 / Harness）随后续阶段与会话条目树迁移一起进入。
type PiRunInspection struct {
	RunID          string `json:"runId"`
	UserID         string `json:"userId"`
	Revision       int64  `json:"revision"`
	Status         string `json:"status"`
	RuntimePhase   string `json:"runtimePhase"`
	LeaseEpoch     int64  `json:"leaseEpoch"`
	LeaseExpiresAt *struct {
		Seconds int64 `json:"seconds"`
	} `json:"leaseExpiresAt"`
	ApprovalID           string                      `json:"approvalId,omitempty"`
	PendingInterjections []PiPendingInterjection     `json:"pendingInterjections"`
	ContextCompaction    *PiPendingContextCompaction `json:"pendingContextCompaction,omitempty"`
}

type PiPendingInterjection struct {
	ID        string    `json:"id"`
	Text      string    `json:"text"`
	Source    string    `json:"source,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

type PiPendingContextCompaction struct {
	Status    string `json:"status"`
	Resume    bool   `json:"resume,omitempty"`
	TurnCount int    `json:"turnCount"`
}

// PiAgentInspection 服务已租约运行的快照读取。审批等待时附带审批 ID，Worker
// 把它回传给用户界面唤醒语义（还原 fork 的 /control 同功能）。
func (s *Service) PiAgentInspection(userID, runID, owner string) (*PiRunInspection, error) {
	run, err := s.piLeasedRun(userID, runID, owner)
	if err != nil {
		if run != nil {
			if terminal, _ := piTerminalRunAfterLeaseFailure(run, owner); terminal != nil {
				return s.piTerminalInspection(run)
			}
		}
		return nil, err
	}
	// 与 fork 的 /control 一致：局部结构体直读 StateJSON 的协作字段，
	// 不做全量运行态 decode——完整状态损坏不应拖垮 Worker 的轮询读数。
	var control struct {
		Approval *struct {
			ID string `json:"approvalId"`
		} `json:"approval"`
		PendingInterjections []cloudAgentInterjection     `json:"pendingInterjections"`
		ContextCompaction    *cloudAgentContextCompaction `json:"contextCompaction"`
	}
	_ = json.Unmarshal([]byte(run.StateJSON), &control)
	inspection := &PiRunInspection{RunID: run.ID, UserID: run.UserID, Revision: run.Revision, Status: run.Status, RuntimePhase: run.RuntimePhase, LeaseEpoch: run.LeaseEpoch, PendingInterjections: piPendingInterjectionViews(control.PendingInterjections)}
	if run.LeaseExpiresAt != nil {
		inspection.LeaseExpiresAt = &struct {
			Seconds int64 `json:"seconds"`
		}{Seconds: run.LeaseExpiresAt.Unix()}
	}
	if control.Approval != nil {
		inspection.ApprovalID = control.Approval.ID
	}
	if c := control.ContextCompaction; c != nil && c.Status == "running" {
		inspection.ContextCompaction = &PiPendingContextCompaction{Status: c.Status, Resume: c.Resume, TurnCount: c.TurnCount}
	}
	return inspection, nil
}

func (s *Service) piTerminalInspection(run *model.CloudAgentExecution) (*PiRunInspection, error) {
	return &PiRunInspection{
		RunID: run.ID, UserID: run.UserID, Revision: run.Revision, Status: run.Status,
		RuntimePhase: run.RuntimePhase, LeaseEpoch: run.LeaseEpoch,
	}, nil
}

func piPendingInterjectionViews(items []cloudAgentInterjection) []PiPendingInterjection {
	pending := make([]PiPendingInterjection, 0, len(items))
	for _, item := range items {
		pending = append(pending, PiPendingInterjection{ID: item.ID, Text: item.Text, CreatedAt: item.CreatedAt})
	}
	return pending
}

// PiFailRun 让 Worker 上报无法重试的致命错误（工具 Schema 与制品不一致、
// Harness 读取失败等）。这类错误重试都一样；只打 stderr 会让前端永远显示
// "Agent 运行中"。非租约持有者上报是拒绝的；终态幂等。
func (s *Service) PiFailRun(userID, runID, owner, reason string) error {
	run, err := s.piLeasedRun(userID, runID, owner)
	if err != nil {
		if run != nil {
			if _, terminal := piTerminalRunAfterLeaseFailure(run, owner); terminal {
				return nil
			}
		}
		return err
	}
	if cloudAgentRunTerminal(run.Status) {
		return nil
	}
	message := truncateRunes(strings.TrimSpace(reason), 300)
	if message == "" {
		message = "Pi worker 无法继续本轮（未提供原因）"
	}
	return s.failWorkerModeRun(run, "pi_worker_fatal", message)
}

// PiToolAdvanceSync 是 worker 模式的同步工具推进：与 fork 的 /tool 桥同一执行器
// （权限、审批、计费、画布写入全部在 advanceCloudAgentRuntimeTool 治理），只是
// 调用方从 push 桥换成持运行租约的 Worker HTTP。请求体与 push 桥的 /tool 相同
// （callId/name/arguments 别名兼容），pause/终态语义原样传回 worker。
func (s *Service) PiToolAdvanceSync(ctx context.Context, userID, runID, owner string, payload map[string]json.RawMessage) (any, error) {
	run, err := s.piLeasedRun(userID, runID, owner)
	if err != nil {
		if run != nil {
			if terminal, _ := piTerminalRunAfterLeaseFailure(run, owner); terminal != nil {
				return map[string]any{"callId": "", "terminated": true, "status": run.Status}, nil
			}
		}
		return nil, err
	}
	if cloudAgentRunTerminal(run.Status) {
		return nil, kernel.Forbidden("Agent 运行已结束；工具调用不能推进")
	}
	return s.cloudAgentPiTool(ctx, userID, runID, payload)
}

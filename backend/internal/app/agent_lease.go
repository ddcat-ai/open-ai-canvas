package app

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// piAgentLeaseDuration 是运行租约窗口；worker 以 15s 心跳续租，健康 worker 在
// 租约失效前有约 3 次机会。
const piAgentLeaseDuration = 45 * time.Second

// piStalledLeasePeriods 是「多久没进展就判定 worker 已死」的租约倍数。留足余量，
// 避免把正常慢步骤（长模型调用、等待审批）误判为停滞。
const piStalledLeasePeriods = 6

// piUnclaimedRunTimeout 是「从未被任何 worker 领取」的运行被判失败的等待时间。
// 与 piStalledLeasePeriods 分开，是因为两者语义完全不同：租约过期 = worker 领取
// 后失联；从未领取 = 根本没有 worker（未部署、token 未配置、容器重启），这是
// **部署状态**而不是崩溃。30 分钟既容忍重启，又能让配置错误在可接受时间内暴露。
const piUnclaimedRunTimeout = 30 * time.Minute

// PiAgentRunTicket 是 claim 的返回体：运行租约票据。完整运行快照属于下一阶段
// 的合同；现在只有领取与心跳需要的字段，客户端不得依赖票据之外的形状。
type PiAgentRunTicket struct {
	RunID          string     `json:"runId"`
	UserID         string     `json:"userId"`
	Revision       int64      `json:"revision"`
	Status         string     `json:"status"`
	LeaseEpoch     int64      `json:"leaseEpoch"`
	LeaseExpiresAt *time.Time `json:"leaseExpiresAt"`
	Owner          string     `json:"-"`
}

// runGrantOwner 是 worker 身份到租约 owner 的拼装：handler 从三组头合成
// "workerID@epoch"，运行行的全部租约操作都按该形态解析。
func runGrantOwner(workerID string, epoch int64) string {
	return workerID + "@" + strconv.FormatInt(epoch, 10)
}

// parsePiAgentLeaseOwner splits "workerID@epoch". Epoch is optional in the
// owner string, but any lease-mutating request must carry a positive one:
// rows start at epoch 0 and the first claim bumps them to 1, so zero can
// never match a live lease.
func parsePiAgentLeaseOwner(owner string) (string, int64, bool, error) {
	separator := strings.LastIndex(owner, "@")
	if separator < 0 {
		if strings.TrimSpace(owner) == "" {
			return "", 0, false, errors.New("empty Pi worker owner")
		}
		return owner, 0, false, nil
	}
	workerID := strings.TrimSpace(owner[:separator])
	epochText := strings.TrimSpace(owner[separator+1:])
	epoch, err := strconv.ParseInt(epochText, 10, 64)
	if workerID == "" || err != nil || epoch < 1 {
		return "", 0, true, errors.New("invalid Pi run lease epoch")
	}
	return workerID, epoch, true, nil
}

// ClaimPiAgentForWorker leases one runnable run to the calling worker slot.
// 崩溃恢复预算在领取点直接消费：接管无进展的消费已入账，预算耗尽立即终化，
// 不允许「重领 → 立即失败 → 等租约过期」无限循环。
func (s *Service) ClaimPiAgentForWorker(owner, userScope string) (*PiAgentRunTicket, error) {
	if owner == "" {
		return nil, kernel.BadAuthRequest("Pi worker owner is required")
	}
	policy, err := s.AgentSchedulerConfig()
	if err != nil {
		return nil, err
	}
	run, err := s.repo.ClaimPiAgentRun(owner, time.Now().UTC().Add(piAgentLeaseDuration), policy, userScope)
	if err != nil || run == nil {
		return nil, err
	}
	if run.WorkerRecoveryExhausted(time.Now().UTC()) {
		if err := s.failWorkerModeRun(run, "pi_worker_recovery_exhausted", "Pi worker 连续接管仍无进展，本轮已停止，请重试"); err != nil {
			return nil, err
		}
		return nil, kernel.BadAuthRequest("Pi worker 恢复预算已耗尽，本轮已停止")
	}
	return &PiAgentRunTicket{RunID: run.ID, UserID: run.UserID, Revision: run.Revision, Status: run.Status, LeaseEpoch: run.LeaseEpoch, LeaseExpiresAt: run.LeaseExpiresAt, Owner: owner}, nil
}

// piLeasedRun revalidates the run row against the lease owner the worker
// attached to the request; engine, ownership, liveness and fencing epoch must
// all match before any lease-mutating request proceeds.
func (s *Service) piLeasedRun(userID, runID, owner string) (*model.CloudAgentExecution, error) {
	run, err := s.repo.CloudAgent(userID, runID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("Agent 运行不存在")
	}
	if err != nil {
		return nil, err
	}
	return piAgentLeaseRow(run, owner)
}

func piAgentLeaseRow(run *model.CloudAgentExecution, owner string) (*model.CloudAgentExecution, error) {
	// 全 UTC：与租约列比较不得混入本地时区（v83 迁移说明）。
	workerID, epoch, hasEpoch, ownerErr := parsePiAgentLeaseOwner(owner)
	if ownerErr != nil || run.Engine != "pi" || run.LeaseOwner != workerID || run.LeaseExpiresAt == nil || !run.LeaseExpiresAt.After(time.Now().UTC()) {
		return nil, kernel.AgentLeaseLost("Pi Agent 运行租约无效")
	}
	if hasEpoch && run.LeaseEpoch != epoch {
		return nil, kernel.AgentLeaseLost("Pi Agent 运行租约已失效")
	}
	return run, nil
}

// RenewPiAgentLease extends an in-date lease. Terminal runs renew idempotently
// as no-ops; a lapsed lease (takeover, release, or sweep) fails closed. Grant
// re-issue is the handler's job: it holds the original grant for re-minting.
func (s *Service) RenewPiAgentLease(userID, runID, owner string) error {
	run, err := s.repo.CloudAgent(userID, runID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NotFound("Agent 运行不存在")
	}
	if err != nil {
		return err
	}
	if cloudAgentRunTerminal(run.Status) {
		return nil
	}
	workerID, epoch, _, ownerErr := parsePiAgentLeaseOwner(owner)
	if ownerErr != nil {
		return kernel.AgentLeaseLost("Pi Agent 运行租约无效")
	}
	renewed, err := s.repo.RenewPiAgentLease(userID, runID, workerID, epoch, time.Now().UTC().Add(piAgentLeaseDuration))
	if err != nil {
		return err
	}
	if !renewed {
		if _, terminal := piTerminalRunAfterLeaseFailure(run, owner); terminal {
			return nil
		}
		return kernel.AgentLeaseLost("Pi Agent 运行租约已失效")
	}
	return nil
}

// PiRelease drops the lease so another worker can take over immediately.
// Status is untouched: release is not termination. The epoch stays in place —
// the next claim advances it, fencing the releasing worker's grant out.
func (s *Service) PiRelease(userID, runID, owner string) error {
	run, err := s.repo.CloudAgent(userID, runID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NotFound("Agent 运行不存在")
	}
	if err != nil {
		return err
	}
	if _, err := piAgentLeaseRow(run, owner); err != nil {
		if _, terminal := piTerminalRunAfterLeaseFailure(run, owner); terminal {
			return nil
		}
		return err
	}
	if cloudAgentRunTerminal(run.Status) {
		return nil
	}
	workerID, epoch, _, err := parsePiAgentLeaseOwner(owner)
	if err != nil {
		return err
	}
	return s.repo.ReleasePiAgentLease(userID, runID, workerID, epoch)
}

// releaseRunLeaseByRunID clears any lease on the run from the control plane
// (worker Start/Resume/Stop paths). It is not reachable from user HTTP input
// and does not need the fencing epoch: instant reclaimability is the point,
// and billed side effects live on billed tasks, not on the run row.
func (s *Service) releaseRunLeaseByRunID(runID string) {
	_ = s.repo.ReleasePiAgentLeaseAny(runID)
}

// piTerminalRunAfterLeaseFailure lets in-flight worker callbacks finish against
// already-terminal runs. These idempotent worker calls may race the terminal
// transition; the fallback never mutates an active run.
func piTerminalRunAfterLeaseFailure(run *model.CloudAgentExecution, owner string) (*model.CloudAgentExecution, bool) {
	workerID, epoch, hasEpoch, ownerErr := parsePiAgentLeaseOwner(owner)
	if ownerErr != nil || run.Engine != "pi" || run.LeaseOwner != workerID || !cloudAgentRunTerminal(run.Status) {
		return nil, false
	}
	if hasEpoch && run.LeaseEpoch != epoch {
		return nil, false
	}
	return run, true
}

// failWorkerModeRun finalizes a worker-mode run that crossed its recovery
// budget (the delivering kernel message is Chinese operator text). A
// decodable blob goes through the checkpoint transaction so billing cleanup
// and the run_failed journal ride along; undecodable ones fall back to the
// decode-free terminal CAS, which marks cleanup pending without rewriting
// StateJSON.
func (s *Service) failWorkerModeRun(run *model.CloudAgentExecution, reason, message string) error {
	mutateErr := s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state, decodeErr := cloudAgentDecode(current)
		if decodeErr != nil {
			return decodeErr
		}
		current.Status = "failed"
		current.FailureMessage = truncateRunes(message, 1000)
		current.CleanupPending = true
		state.event(run.ID, "run_failed", map[string]any{"text": truncateRunes(message, 120), "reason": reason})
		return cloudAgentSave(current, &state)
	})
	if mutateErr == nil || errors.Is(mutateErr, repository.ErrCreationConflict) {
		// 成功或让位并发推进方：本调用不重复终化。
		return nil
	}
	// 不可解码或持久化失败走 decode-free 终态 CAS 兜底；仍然冲突时交给并发方。
	if err := s.repo.MarkCloudAgentFailed(run.UserID, run.ID, run.Revision, message); errors.Is(err, repository.ErrCreationConflict) {
		return nil
	}
	return nil
}

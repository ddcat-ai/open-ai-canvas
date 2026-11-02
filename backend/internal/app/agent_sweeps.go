package app

import (
	"errors"
	"sync"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// sweepPiAgentOnce throttles the periodic sweeps regardless of how often the
// caller pumps Recover() (the P1 seam drains every 3s; the watchdog cadence is
// 60s). 同步执行、不出错：清扫是尽力而为的对账，失败打日志由下轮重试。
var sweepPiAgentOnce struct {
	sync.Mutex
	last time.Time
}

func (s *Service) SweepStalledPiAgentRuns() int {
	cutoff := time.Now().UTC().Add(-piStalledLeasePeriods * piAgentLeaseDuration)
	runs, err := s.repo.StalledPiAgentRuns(cutoff, 50)
	if err != nil {
		return 0
	}
	return s.sweepPiRuns(runs, "pi_worker_stalled",
		"Pi worker 长时间未推进本轮（租约过期且无进展），已停止；请检查 agent 服务日志后重试")
}

// SweepUnclaimedPiAgentRuns 终结「长时间没有任何 worker 领取」的 Pi 运行。
// 与 SweepStalledPiAgentRuns 的区别只有两点：阈值更长、失败原因不同。原因必须
// 不同，否则运维无法区分「agent 服务没起来」与「agent 服务跑挂了」。
func (s *Service) SweepUnclaimedPiAgentRuns() int {
	cutoff := time.Now().UTC().Add(-piUnclaimedRunTimeout)
	runs, err := s.repo.UnclaimedPiAgentRuns(cutoff, 50)
	if err != nil {
		return 0
	}
	return s.sweepPiRuns(runs, "pi_worker_unavailable",
		"本轮长时间没有 Pi worker 领取，已停止；请确认 agent 服务已启动且 CANVAS_AGENT_INTERNAL_TOKEN 与后端一致，然后重试")
}

// sweepPiRuns 是两种清扫共用的终结逻辑。
//
// 必须同时置 CleanupPending：收尾入口的条件是 CleanupPending && 终态。此前只写
// failed 会既不取消子任务、也不退占位预留 —— 那部分工作会永久丢失。
//
// 终态幂等跳过；并发推进（ErrCreationConflict）让位。
func (s *Service) sweepPiRuns(runs []model.CloudAgentExecution, reason, message string) int {
	swept := 0
	for index := range runs {
		run := runs[index]
		if cloudAgentRunTerminal(run.Status) {
			continue
		}
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
		if mutateErr == nil {
			swept++
			continue
		}
		if errors.Is(mutateErr, repository.ErrCreationConflict) {
			continue // 有并发推进，交给它
		}
		// 不可解码或持久化失败：decode-free 终态 CAS 兜底（带 CleanupPending）。
		if err := s.repo.MarkCloudAgentFailed(run.UserID, run.ID, run.Revision, message); !errors.Is(err, repository.ErrCreationConflict) {
			swept++
		}
	}
	return swept
}

// sweepPiAgentPeriodically 是 seam Recover 的节流壳：无论 3s ticker 还是显式
// 唤醒，清扫本体至多每 60s 执行一次（与 fork watchdog 同节奏）。
func (s *Service) sweepPiAgentPeriodically() {
	sweepPiAgentOnce.Lock()
	defer sweepPiAgentOnce.Unlock()
	now := time.Now()
	if now.Sub(sweepPiAgentOnce.last) < 60*time.Second {
		return
	}
	sweepPiAgentOnce.last = now
	s.SweepStalledPiAgentRuns()
	s.SweepUnclaimedPiAgentRuns()
}

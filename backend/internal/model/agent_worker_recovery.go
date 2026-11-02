package model

import "time"

// Worker recovery budget: an unprogressed takeover spends a persisted attempt.
// 恢复列由认领、续租与派发路径以 UTC 写入与比较。
const AgentWorkerRecoveryLimit = 5
const AgentWorkerRecoveryWindow = 10 * time.Minute

func (run *CloudAgentExecution) WorkerRecoveryExhausted(now time.Time) bool {
	return run.RecoveryAttempts >= AgentWorkerRecoveryLimit ||
		(run.RecoveryStartedAt != nil && !now.Before(run.RecoveryStartedAt.Add(AgentWorkerRecoveryWindow)))
}

package model

import "time"

// AgentSchedulerSetting is the worker dispatch policy. Admin writes land in a
// later phase; worker mode reads it via the repository fallback.
type AgentSchedulerSetting struct {
	ID                   int       `gorm:"primaryKey" json:"-"`
	DispatchConcurrency  int       `json:"dispatchConcurrency"`
	MaxResidentSessions  int       `json:"maxResidentSessions"`
	MaxResidentPerUser   int       `gorm:"default:32" json:"maxResidentPerUser"`
	MaxResidentPerCanvas int       `json:"maxResidentPerCanvas"`
	Revision             int64     `json:"revision"`
	UpdatedBy            string    `json:"updatedBy,omitempty"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

// DefaultAgentSchedulerSetting mirrors the embedded push defaults: four
// concurrent dispatches per worker process, 64 resident sessions overall,
// 32 per user and 16 per canvas.
func DefaultAgentSchedulerSetting() AgentSchedulerSetting {
	return AgentSchedulerSetting{ID: 1, DispatchConcurrency: 4, MaxResidentSessions: 64, MaxResidentPerUser: 32, MaxResidentPerCanvas: 16, Revision: 1}
}

// AgentAdmissionCounter is the claim serialization point. Its row is updated
// inside the producer transaction; unlike a database sequence its lock
// survives until commit, which also holds SQLite's write lock.
type AgentAdmissionCounter struct {
	ID    int   `gorm:"primaryKey"`
	Value int64 `gorm:"not null"`
}

// AgentRuntimeInstance is one worker process's last capacity heartbeat. All
// timestamps are written in UTC by the capacity endpoint (SQLite text
// comparison of lease/heartbeat columns must not mix time zones).
type AgentRuntimeInstance struct {
	ID                    string    `gorm:"primaryKey;size:80" json:"instanceId"`
	Active                int       `json:"resident"`
	Capacity              int       `json:"capacity"`
	ClaimReservations     int       `json:"claimReservations"`
	DispatchActive        int       `json:"dispatchActive"`
	ReadyQueued           int       `json:"readyQueued"`
	Draining              bool      `json:"draining"`
	Readiness             string    `gorm:"size:16" json:"readiness"`
	ReadinessReason       string    `gorm:"size:512" json:"readinessReason,omitempty"`
	AppliedConfigRevision int64     `json:"appliedConfigRevision"`
	UpdatedAt             time.Time `gorm:"index" json:"lastHeartbeatAt"`
}

// AgentCapacityReport is the request body of POST /internal-agent/capacity.
type AgentCapacityReport struct {
	Active                int    `json:"active"`
	Capacity              int    `json:"capacity"`
	ClaimReservations     int    `json:"claimReservations"`
	DispatchActive        int    `json:"dispatchActive"`
	ReadyQueued           int    `json:"readyQueued"`
	Draining              bool   `json:"draining"`
	Readiness             string `json:"readiness"`
	ReadinessReason       string `json:"readinessReason,omitempty"`
	AppliedConfigRevision int64  `json:"appliedConfigRevision"`
}

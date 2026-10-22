package model

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"time"
)

const (
	AgentMemoryProposalGenerating = "generating"
	AgentMemoryProposalPending    = "pending"
	AgentMemoryProposalApproved   = "approved"
	AgentMemoryProposalRejected   = "rejected"
	AgentMemoryProposalNoChanges  = "no_changes"
	AgentMemoryProposalFailed     = "failed"
)

// AgentMemoryProposal retains the exact model input and proposed edits. A model
// completion never writes AgentLesson rows; only the owner's decision applies it.
type AgentMemoryProposal struct {
	ID          string    `gorm:"primaryKey;size:36"`
	UserID      string    `gorm:"size:36;not null;index:idx_memory_proposal_owner_created,priority:1"`
	TaskID      string    `gorm:"size:36;index"`
	Status      string    `gorm:"size:16;not null;index"`
	Version     int64     `gorm:"not null"`
	InputJSON   string    `gorm:"type:text;not null"`
	ChangesJSON string    `gorm:"type:text;not null"`
	SummaryJSON string    `gorm:"type:text;not null"`
	CreatedAt   time.Time `gorm:"index:idx_memory_proposal_owner_created,priority:2"`
	UpdatedAt   time.Time
	DecidedAt   *time.Time
}

// AgentMemoryRevision is an immutable before/after snapshot of one approved
// batch. Version and RestoredAt guard a single atomic restore of that batch.
type AgentMemoryRevision struct {
	ID         string    `gorm:"primaryKey;size:36"`
	UserID     string    `gorm:"size:36;not null;index:idx_memory_revision_owner_created,priority:1"`
	ProposalID string    `gorm:"size:36;not null;uniqueIndex"`
	Version    int64     `gorm:"not null"`
	BeforeJSON string    `gorm:"type:text;not null"`
	AfterJSON  string    `gorm:"type:text;not null"`
	CreatedAt  time.Time `gorm:"index:idx_memory_revision_owner_created,priority:2"`
	RestoredAt *time.Time
}

// AgentMemorySnapshot preserves editor-visible data and provenance. Counters are
// retained for deleted rows, but do not form a version: telemetry is not an edit.
type AgentMemorySnapshot struct {
	ID             string     `json:"id"`
	Topic          string     `json:"topic"`
	Category       string     `json:"category"`
	Situation      string     `json:"situation"`
	Lesson         string     `json:"lesson"`
	Source         string     `json:"source"`
	OriginRunID    string     `json:"originRunId"`
	EvidenceJSON   string     `json:"evidenceJson"`
	StepsJSON      string     `json:"stepsJson"`
	Status         string     `json:"status"`
	Hits           int64      `json:"hits"`
	Injected       int64      `json:"injected"`
	LastVerifiedAt *time.Time `json:"lastVerifiedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

type AgentMemoryChange struct {
	Kind   string                `json:"kind"`
	Before []AgentMemorySnapshot `json:"before"`
	After  AgentMemorySnapshot   `json:"after"`
}

func SnapshotAgentMemory(lesson AgentLesson) AgentMemorySnapshot {
	return AgentMemorySnapshot{
		ID: lesson.ID, Topic: lesson.Topic, Category: lesson.Category,
		Situation: lesson.Situation, Lesson: lesson.Lesson, Source: lesson.Source,
		OriginRunID: lesson.OriginRunID, EvidenceJSON: lesson.EvidenceJSON,
		StepsJSON: lesson.StepsJSON, Status: lesson.Status, Hits: lesson.Hits,
		Injected: lesson.Injected, LastVerifiedAt: lesson.LastVerifiedAt,
		CreatedAt: lesson.CreatedAt.UTC(), UpdatedAt: lesson.UpdatedAt.UTC(),
	}
}

func (s AgentMemorySnapshot) LessonForUser(userID string) AgentLesson {
	return AgentLesson{
		ID: s.ID, AuthorUserID: userID, Topic: s.Topic, Category: s.Category,
		Situation: s.Situation, Lesson: s.Lesson, Source: s.Source,
		OriginRunID: s.OriginRunID, EvidenceJSON: s.EvidenceJSON,
		StepsJSON: s.StepsJSON, Status: s.Status, Hits: s.Hits,
		Injected: s.Injected, LastVerifiedAt: s.LastVerifiedAt,
		CreatedAt: s.CreatedAt, UpdatedAt: s.UpdatedAt,
	}
}

func (s AgentMemorySnapshot) ContentVersion() string {
	s.Hits, s.Injected = 0, 0
	s.CreatedAt, s.UpdatedAt = s.CreatedAt.UTC(), s.UpdatedAt.UTC()
	if s.LastVerifiedAt != nil {
		verified := s.LastVerifiedAt.UTC()
		s.LastVerifiedAt = &verified
	}
	raw, _ := json.Marshal(s)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

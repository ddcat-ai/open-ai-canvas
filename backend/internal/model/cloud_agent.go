package model

import "time"

// CloudAgentExecution checkpoints orchestration independently of billed tasks.
type CloudAgentExecution struct {
	ExecutionFence *CloudAgentFence `gorm:"-" json:"-"`
	ID             string           `gorm:"primaryKey;size:80"`
	UserID         string           `gorm:"index;size:36"`
	// SessionID groups immutable model turns into one durable conversation.
	// ConversationID remains for backwards compatibility with existing rows.
	SessionID            string `gorm:"index;size:80"`
	Surface              string `gorm:"index;size:64"`
	ContextSelectionJSON string `gorm:"type:text"`
	Status               string `gorm:"index;size:32"`
	Revision             int64
	CheckpointVersion    int    `gorm:"not null;default:0"`
	ConversationID       string `gorm:"index;size:80"`
	ParentID             string `gorm:"index;size:80"`
	Title                string `gorm:"size:240"`
	EventCount           int
	MessageCount         int
	Journal              []CloudAgentEventRecord   `gorm:"foreignKey:RunID;references:ID" json:"-"`
	Transcript           []CloudAgentMessageRecord `gorm:"foreignKey:RunID;references:ID" json:"-"`
	// Control fields remain writable even when the transcript cannot be decoded or saved.
	CanvasID       string `gorm:"size:80"`
	ActiveTaskID   string `gorm:"size:80"`
	MediaTaskID    string `gorm:"size:80"`
	CleanupPending bool   `gorm:"not null;default:false;index"`
	FailureMessage string `gorm:"size:1000"`
	StateJSON      string `gorm:"type:text"`
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// AgentSession is the durable conversation identity shared by multiple runs.
// Run state and transcripts remain owned by CloudAgentExecution; this row is
// a small index for cross-device recovery.
type AgentSession struct {
	ID             string `gorm:"primaryKey;size:80"`
	UserID         string `gorm:"index;size:36"`
	Title          string `gorm:"size:240"`
	Surface        string `gorm:"index;size:64"`
	LastSurface    string `gorm:"size:64"`
	Status         string `gorm:"index;size:32"`
	CheckpointJSON string `gorm:"type:text"`
	Revision       int64
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

type CloudAgentFence struct {
	Token string `json:"token"`
	Epoch int64  `json:"epoch"`
}

type CloudAgentExecutionLease struct {
	CloudAgentFence
	LeaseUntil int64 `json:"leaseUntil"`
}

// CloudAgentPiSession stores Pi's native JSONL session independently from the
// bounded control checkpoint. Pi owns transcript and compaction semantics;
// Go only persists the opaque session snapshot and its revision.
type CloudAgentPiSession struct {
	RunID        string `gorm:"primaryKey;size:80"`
	UserID       string `gorm:"index;size:36;not null"`
	SessionJSONL string `gorm:"column:session_jsonl;type:text;not null"`
	Revision     int64  `gorm:"not null;default:1"`
	UpdatedAt    time.Time
}

// CloudAgentReceipt survives transcript compaction and session replacement.
type CloudAgentReceipt struct {
	RunID        string `gorm:"primaryKey;size:80"`
	Kind         string `gorm:"primaryKey;size:24"`
	OperationKey string `gorm:"primaryKey;size:160"`
	UserID       string `gorm:"size:36;not null"`
	Name         string `gorm:"size:160;not null"`
	InputSHA256  string `gorm:"size:64;not null"`
	Status       string `gorm:"size:24;not null"`
	Content      string `gorm:"type:text;not null"`
	IsError      bool   `gorm:"not null"`
	TaskID       string `gorm:"size:80"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// Journal rows are append-only and commit in the same transaction as the run.
type CloudAgentEventRecord struct {
	RunID     string `gorm:"primaryKey;size:80"`
	Sequence  int    `gorm:"primaryKey;autoIncrement:false"`
	UserID    string `gorm:"index;size:36"`
	EventJSON string `gorm:"type:text;not null"`
	CreatedAt time.Time
}

// Transcript bodies do not share the bounded execution checkpoint. Canonical
// messages may be compacted; the append-only journal retains execution receipts.
type CloudAgentMessageRecord struct {
	RunID       string `gorm:"primaryKey;size:80"`
	Kind        string `gorm:"primaryKey;size:24"`
	Sequence    int    `gorm:"primaryKey;autoIncrement:false"`
	UserID      string `gorm:"index;size:36"`
	MessageJSON string `gorm:"type:text;not null"`
}

// CloudAgentCanvasMutation records one atomic canvas change made by an Agent.
// BeforeJSON is intentionally bounded by the application layer; mutations that
// cannot retain a safe snapshot are marked not_undoable instead of truncating it.
type CloudAgentCanvasMutation struct {
	ID                 string     `json:"id" gorm:"primaryKey;size:80"`
	RunID              string     `json:"runId" gorm:"index;size:80"`
	UserID             string     `json:"userId" gorm:"index;size:36"`
	CanvasID           string     `json:"canvasId" gorm:"index;size:80"`
	StepID             string     `json:"stepId" gorm:"index;size:160"`
	Operation          string     `json:"operation" gorm:"size:64"`
	BeforeSnapshotHash string     `json:"beforeSnapshotHash" gorm:"size:64"`
	AfterSnapshotHash  string     `json:"afterSnapshotHash" gorm:"size:64"`
	BeforeJSON         string     `json:"-" gorm:"type:text"`
	HasSubmittedTask   bool       `json:"hasSubmittedTask"`
	Status             string     `json:"status" gorm:"index;size:24"`
	CreatedAt          time.Time  `json:"createdAt" gorm:"index"`
	UndoneAt           *time.Time `json:"undoneAt,omitempty"`
}

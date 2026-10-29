package model

import "time"

const (
	// AgentMemoryDocumentModeAuto 让 Agent 直接改写记忆文件，每次修改留修订并可撤销。
	AgentMemoryDocumentModeAuto = "auto"
	// AgentMemoryDocumentModeReview 把 Agent 的修改暂存为待确认修订，用户采纳后才生效。
	AgentMemoryDocumentModeReview = "review"
	// AgentMemoryDocumentModeOff 关闭记忆：不注入、不暴露写入工具。
	AgentMemoryDocumentModeOff = "off"

	AgentMemorySectionUser  = "user"
	AgentMemorySectionNotes = "notes"

	AgentMemoryRevisionApplied  = "applied"
	AgentMemoryRevisionPending  = "pending"
	AgentMemoryRevisionRejected = "rejected"

	AgentMemoryActorAgent   = "agent"
	AgentMemoryActorUser    = "user"
	AgentMemoryActorRestore = "restore"
	AgentMemoryActorSeed    = "seed"
	AgentMemoryActorAdmin   = "admin"
)

// AgentMemoryEntry 是记忆文件里的一条记录。ID 只在本文件内唯一，供 Agent 精确修改或删除。
type AgentMemoryEntry struct {
	ID          string    `json:"id"`
	Section     string    `json:"section"`
	Text        string    `json:"text"`
	Source      string    `json:"source,omitempty"`
	OriginRunID string    `json:"originRunId,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// AgentMemoryDocument 是每个用户一份、有容量上限的长期记忆。它只是参考数据，
// 每轮开始时冻结快照注入上下文，不构成权限、审批或收费授权。
type AgentMemoryDocument struct {
	UserID      string `json:"userId" gorm:"primaryKey;size:36"`
	EntriesJSON string `json:"-" gorm:"type:text"`
	// NextEntrySeq 单调递增，删除后的条目 ID 不会被新条目复用，旧快照里的 ID 不会指向别的内容。
	NextEntrySeq int64     `json:"-"`
	Revision     int64     `json:"revision"`
	Hash         string    `json:"hash" gorm:"size:64"`
	CharCount    int       `json:"charCount"`
	Mode         string    `json:"mode" gorm:"size:16"`
	Capacity     int       `json:"capacity"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt" gorm:"index"`
}

// AgentMemoryDocumentRevision 记录一次修改的前后快照。applied 可撤销；pending 等待用户采纳。
type AgentMemoryDocumentRevision struct {
	ID           string `json:"id" gorm:"primaryKey;size:36"`
	UserID       string `json:"userId" gorm:"size:36;index:idx_agent_memory_doc_revisions_owner,priority:1"`
	BaseRevision int64  `json:"baseRevision"`
	Revision     int64  `json:"revision"`
	Actor        string `json:"actor" gorm:"size:16"`
	RunID        string `json:"runId,omitempty" gorm:"size:80;index"`
	// CallID 是 Agent 工具调用 ID：同一调用重放时返回已有结果，不重复写入。
	CallID     string     `json:"-" gorm:"size:120;index"`
	Status     string     `json:"status" gorm:"size:16;index"`
	Summary    string     `json:"summary" gorm:"size:500"`
	OpsJSON    string     `json:"-" gorm:"type:text"`
	BeforeJSON string     `json:"-" gorm:"type:text"`
	AfterJSON  string     `json:"-" gorm:"type:text"`
	CreatedAt  time.Time  `json:"createdAt" gorm:"index:idx_agent_memory_doc_revisions_owner,priority:2"`
	DecidedAt  *time.Time `json:"decidedAt,omitempty"`
	RestoredAt *time.Time `json:"restoredAt,omitempty"`
}

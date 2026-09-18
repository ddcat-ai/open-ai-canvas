package model

import "time"

const (
	AgentLessonStatusPending  = "pending"
	AgentLessonStatusApproved = "approved"
	AgentLessonStatusRejected = "rejected"
)

// AgentLessonStep 是一条记忆路线里的一步。
type AgentLessonStep struct {
	Tool   string `json:"tool"`
	Action string `json:"action"`
	Note   string `json:"note,omitempty"`
}

// AgentLesson 是用户私有的 Agent 记忆。只有该用户批准后才会注入自己的会话。
type AgentLesson struct {
	ID             string     `json:"id" gorm:"primaryKey;size:36"`
	Topic          string     `json:"topic" gorm:"size:120;index"`
	Category       string     `json:"category" gorm:"size:32;index"`
	Situation      string     `json:"situation" gorm:"type:text"`
	Lesson         string     `json:"lesson" gorm:"type:text"`
	Source         string     `json:"source" gorm:"size:200"`
	StepsJSON      string     `json:"-" gorm:"column:steps_json;type:text"`
	Status         string     `json:"status" gorm:"size:16;index:idx_agent_lessons_author_status,priority:2;index"`
	AuthorUserID   string     `json:"-" gorm:"size:36;index:idx_agent_lessons_author_status,priority:1;index"`
	Hits           int64      `json:"hits"`
	Injected       int64      `json:"injected"`
	LastVerifiedAt *time.Time `json:"lastVerifiedAt,omitempty"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
}

package model

import "time"

type Task struct {
	ID                        string               `json:"id" gorm:"primaryKey;size:36"`
	UserID                    string               `json:"userId" gorm:"index;size:36;index:idx_tasks_user_created,priority:1"`
	SessionID                 string               `json:"sessionId" gorm:"index;size:36"`
	ProjectID                 string               `json:"projectId" gorm:"index;size:80"`
	Type                      string               `json:"type" gorm:"index;size:64"`
	Status                    TaskStatus           `json:"status" gorm:"index;size:24;index:idx_tasks_status_created,priority:1;index:idx_tasks_claim,priority:1;index:idx_tasks_provider_cancel,priority:1"`
	Stage                     string               `json:"stage" gorm:"size:80"`
	Progress                  int                  `json:"progress"`
	Prompt                    string               `json:"prompt"`
	Operation                 string               `json:"operation" gorm:"size:64"`
	Provider                  string               `json:"provider" gorm:"size:64"`
	Model                     string               `json:"model" gorm:"size:120"`
	BillingOrderID            string               `json:"billingOrderId,omitempty" gorm:"index;size:36"`
	ProviderRequestID         string               `json:"providerRequestId,omitempty" gorm:"index;size:160"`
	ProviderCancelStatus      ProviderCancelStatus `json:"providerCancelStatus,omitempty" gorm:"index;size:24;index:idx_tasks_provider_cancel,priority:2"`
	ProviderCancelError       string               `json:"providerCancelError,omitempty" gorm:"type:text"`
	ProviderCancelAttempts    int                  `json:"providerCancelAttempts,omitempty"`
	ProviderCancelRequestedAt *time.Time           `json:"providerCancelRequestedAt,omitempty"`
	ProviderCancelledAt       *time.Time           `json:"providerCancelledAt,omitempty"`
	ProviderCancelNextCheckAt *time.Time           `json:"providerCancelNextCheckAt,omitempty" gorm:"index:idx_tasks_provider_cancel,priority:3"`
	PollStage                 string               `json:"pollStage,omitempty" gorm:"size:32"`
	NextPollAt                *time.Time           `json:"nextPollAt,omitempty" gorm:"index"`
	LeaseOwner                string               `json:"-" gorm:"index;size:120"`
	LeaseExpiresAt            *time.Time           `json:"-" gorm:"index;index:idx_tasks_claim,priority:2"`
	InputJSON                 string               `json:"inputJson" gorm:"type:text"`
	ResultJSON                string               `json:"resultJson" gorm:"type:text"`
	TextDraft                 string               `json:"textDraft,omitempty" gorm:"type:text"`
	Error                     string               `json:"error"`
	Attempts                  int                  `json:"attempts"`
	StartedAt                 *time.Time           `json:"startedAt"`
	CompletedAt               *time.Time           `json:"completedAt"`
	CreatedAt                 time.Time            `json:"createdAt" gorm:"index:idx_tasks_user_created,priority:2;index:idx_tasks_status_created,priority:2;index:idx_tasks_claim,priority:3"`
	UpdatedAt                 time.Time            `json:"updatedAt"`
}

// TaskTextDelta 只保存可回放窗口内的文本增量；最终正文和失败草稿分别归并到 Task.ResultJSON 与 Task.TextDraft。
type TaskTextDelta struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36;index:idx_task_text_deltas_user_created,priority:1"`
	TaskID    string    `json:"taskId" gorm:"index;size:36;uniqueIndex:idx_task_text_deltas_sequence,priority:1"`
	Sequence  int64     `json:"sequence" gorm:"uniqueIndex:idx_task_text_deltas_sequence,priority:2"`
	Content   string    `json:"content" gorm:"type:text"`
	ByteCount int64     `json:"byteCount"`
	CreatedAt time.Time `json:"createdAt" gorm:"index:idx_task_text_deltas_user_created,priority:2"`
	ExpiresAt time.Time `json:"expiresAt" gorm:"index"`
}

type Session struct {
	ID                 string        `json:"id" gorm:"primaryKey;size:36"`
	UserID             string        `json:"userId" gorm:"index;size:36"`
	ProjectID          string        `json:"projectId" gorm:"index;size:80"`
	Status             SessionStatus `json:"status" gorm:"index;size:24"`
	Prompt             string        `json:"prompt"`
	CanvasSnapshotJSON string        `json:"canvasSnapshotJson" gorm:"type:text"`
	CanvasOpsJSON      string        `json:"canvasOpsJson" gorm:"type:text"`
	CreatedAt          time.Time     `json:"createdAt"`
	UpdatedAt          time.Time     `json:"updatedAt"`
}

type Message struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	SessionID string    `json:"sessionId" gorm:"index;size:36"`
	Role      string    `json:"role" gorm:"size:24"`
	Content   string    `json:"content"`
	Payload   string    `json:"payload" gorm:"type:text"`
	CreatedAt time.Time `json:"createdAt"`
}

type TaskLog struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	TaskID    string    `json:"taskId" gorm:"index;size:36"`
	Level     string    `json:"level" gorm:"size:24"`
	Message   string    `json:"message"`
	Payload   string    `json:"payload" gorm:"type:text"`
	CreatedAt time.Time `json:"createdAt"`
}

type SessionFile struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	SessionID string    `json:"sessionId" gorm:"index;size:36"`
	FileName  string    `json:"fileName"`
	MimeType  string    `json:"mimeType"`
	Path      string    `json:"-"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"createdAt"`
}

type Result struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"index;size:36"`
	TaskID    string    `json:"taskId" gorm:"index;size:36"`
	SessionID string    `json:"sessionId" gorm:"index;size:36"`
	Kind      string    `json:"kind" gorm:"size:64"`
	URL       string    `json:"url"`
	Payload   string    `json:"payload" gorm:"type:text"`
	CreatedAt time.Time `json:"createdAt"`
}

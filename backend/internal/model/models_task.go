package model

import "time"

type Task struct {
	ID                     string     `json:"id" gorm:"primaryKey;size:36"`
	UserID                 string     `json:"userId" gorm:"index;size:36;index:idx_tasks_user_created,priority:1;index:idx_tasks_user_project_created,priority:1"`
	TraceID                string     `json:"-" gorm:"index;size:96"`
	RequestID              string     `json:"-" gorm:"index;size:96"`
	SessionID              string     `json:"sessionId" gorm:"index;size:36"`
	ProjectID              string     `json:"projectId" gorm:"index;size:80;index:idx_tasks_user_project_created,priority:2"`
	Type                   string     `json:"type" gorm:"index;size:64"`
	Status                 TaskStatus `json:"status" gorm:"index;size:24;index:idx_tasks_status_created,priority:1;index:idx_tasks_claim,priority:1;index:idx_tasks_provider_cancel,priority:1"`
	Stage                  string     `json:"stage" gorm:"size:80"`
	Progress               int        `json:"progress"`
	Prompt                 string     `json:"prompt"`
	Operation              string     `json:"operation" gorm:"size:64"`
	Provider               string     `json:"provider" gorm:"size:64"`
	Model                  string     `json:"model" gorm:"size:120"`
	LogicalModelID         string     `json:"logicalModelId,omitempty" gorm:"size:36;index"`
	LogicalModelRevisionID string     `json:"logicalModelRevisionId,omitempty" gorm:"size:36;index"`
	RouteID                string     `json:"routeId,omitempty" gorm:"size:36;index"`
	ChannelModelID         string     `json:"channelModelId,omitempty" gorm:"size:36;index"`
	// RouteRun 只在用户主动重试时递增；worker 租约恢复不应创建新的路由选择世代。
	RouteRun                  int                  `json:"-" gorm:"index"`
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
	CreatedAt                 time.Time            `json:"createdAt" gorm:"index:idx_tasks_user_created,priority:2;index:idx_tasks_status_created,priority:2;index:idx_tasks_claim,priority:3;index:idx_tasks_user_project_created,priority:3"`
	UpdatedAt                 time.Time            `json:"updatedAt"`

	// W1-01（影策 2.0 任务链，D-022：Task 即 GenerationTask）
	// ShotID / CanvasNodeID / WorkflowStepID 把生成任务挂到画布分镜节点与工作流步骤上。
	// 这三者是查询加速用的冗余——权威关系仍在 ProductionTaskLink（D-026 并轨后确认），
	// 但 ProductionTaskLink 只在工作流上下文才建，非工作流任务没有 link，故此处保留。
	// D-039（D-025 升级）：所有新增业务代码**禁止**通过 Task.InputJSON.metadata.workflowStepId
	// 获取 workflow step，只能读本列。旧数据 fallback 只允许出现在 migration / compatibility helper，
	// 且应逐步消灭——否则会退化成「一半读 column、一半读 metadata」，canonical 化白做。
	ShotID         string `json:"shotId,omitempty" gorm:"index:idx_task_shot;size:64"`
	CanvasNodeID   string `json:"canvasNodeId,omitempty" gorm:"index:idx_task_node;size:64"`
	WorkflowStepID string `json:"workflowStepId,omitempty" gorm:"index:idx_task_step;size:36"`

	// Agent 溯源（D-031：不建 AgentRun/Action 表，只加两列）
	// AgentSessionID = WorkBuddy（codebuddy CLI）会话标识，canvas-agent 用 --resume 维护多轮。
	// AgentTurnID = 一次用户/Agent turn 的关联标识。
	// D-038：agent_turn_id **不加 UNIQUE**——不同 Runtime 的 turn ID 格式与唯一性不保证；
	// 将来若要唯一，须用复合键 (agent_runtime, agent_session_id, agent_turn_id)。
	AgentSessionID string `json:"agentSessionId,omitempty" gorm:"index:idx_task_agent_session;size:64"`
	AgentTurnID    string `json:"agentTurnId,omitempty" gorm:"index:idx_task_agent_turn;size:64"`
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
	TraceID   string    `json:"-" gorm:"index;size:96"`
	RequestID string    `json:"-" gorm:"index;size:96"`
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

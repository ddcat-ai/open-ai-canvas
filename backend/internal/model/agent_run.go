package model

import "time"

// AgentRun 记录一次真实的 Canvas/Director Agent 执行轮次。
// 只持久化可审计的动作和可观测的执行结果，不存储原始工具输入输出或敏感凭证。
type AgentRun struct {
	ID            string     `json:"id" gorm:"primaryKey;size:36"`
	UserID        string     `json:"userId" gorm:"index;size:36;index:idx_agent_runs_user_project,priority:1"`
	ProjectID     string     `json:"projectId" gorm:"index;size:36;index:idx_agent_runs_user_project,priority:2"`
	AgentKind     string     `json:"agentKind" gorm:"index;size:32"`
	ThreadID      string     `json:"threadId,omitempty" gorm:"index;size:120"`
	Status        string     `json:"status" gorm:"index;size:24"`
	InputSummary  string     `json:"inputSummary,omitempty" gorm:"type:text"`
	ErrorMessage  string     `json:"errorMessage,omitempty" gorm:"type:text"`
	StartedAt     time.Time  `json:"startedAt"`
	CompletedAt   *time.Time `json:"completedAt,omitempty"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

func (AgentRun) TableName() string { return "agent_runs" }

// AgentRunStep 记录 AgentRun 中单个可观测工具调用的审计条目。
// 当前切片仅建表，步骤拦截在后续切片接入。
type AgentRunStep struct {
	ID                   string     `json:"id" gorm:"primaryKey;size:36"`
	RunID                string     `json:"runId" gorm:"index;size:36;index:idx_agent_run_steps_run_tool_call,priority:1"`
	Sequence             int        `json:"sequence" gorm:"index"`
	ToolCallID           string     `json:"toolCallId,omitempty" gorm:"size:120;index:idx_agent_run_steps_run_tool_call,priority:2"`
	ToolName             string     `json:"toolName" gorm:"index;size:80"`
	Status               string     `json:"status" gorm:"index;size:24"`
	InputSummary         string     `json:"inputSummary,omitempty" gorm:"type:text"`
	InputHash            string     `json:"inputHash,omitempty" gorm:"size:96"`
	OutputSummary        string     `json:"outputSummary,omitempty" gorm:"type:text"`
	OutputHash           string     `json:"outputHash,omitempty" gorm:"size:96"`
	AffectedEntitiesJSON string     `json:"affectedEntitiesJson,omitempty" gorm:"type:text"`
	AffectedNodeIDsJSON  string     `json:"affectedNodeIdsJson,omitempty" gorm:"type:text"`
	ErrorCode            string     `json:"errorCode,omitempty" gorm:"size:80"`
	ErrorMessage         string     `json:"errorMessage,omitempty" gorm:"type:text"`
	StartedAt            time.Time  `json:"startedAt"`
	CompletedAt          *time.Time `json:"completedAt,omitempty"`
	CreatedAt            time.Time  `json:"createdAt"`
}

func (AgentRunStep) TableName() string { return "agent_run_steps" }

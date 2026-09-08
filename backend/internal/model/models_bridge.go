package model

import "time"

// ComfyBridge 是用户电脑上本地 Bridge 的持久化身份。Token 只在创建时返回明文，数据库只保存摘要。
type ComfyBridge struct {
	ID               string     `json:"id" gorm:"primaryKey;size:64"`
	UserID           string     `json:"userId" gorm:"index;size:36"`
	Name             string     `json:"name" gorm:"size:80"`
	TokenHash        string     `json:"-" gorm:"uniqueIndex;size:128"`
	Enabled          bool       `json:"enabled" gorm:"index"`
	LastSeenAt       *time.Time `json:"lastSeenAt,omitempty"`
	LastTaskAt       *time.Time `json:"lastTaskAt,omitempty"`
	CapabilitiesJSON string     `json:"-" gorm:"type:text"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
}

// ComfyBridgeRequest 是云端任务与本地 Bridge 之间的持久化交接记录。
// Payload 和 Result 只保存工作流执行协议，不包含 Bridge Token。
//
// W1-01（影策 2.0 任务链，D-020）：本表同时是逻辑实体 ComfyJob 的持久化实现，
// 不再另建 comfy_jobs 表；一个 GenerationTask（model.Task）可因重试产生多条记录。
type ComfyBridgeRequest struct {
	ID          string     `json:"id" gorm:"primaryKey;size:64"`
	TaskID      string     `json:"taskId" gorm:"index;size:64"`
	UserID      string     `json:"userId" gorm:"index;size:36"`
	BridgeID    string     `json:"bridgeId" gorm:"index:idx_comfy_bridge_request_queue,priority:1;size:64"`
	Kind        string     `json:"kind" gorm:"size:32"`
	Status      string     `json:"status" gorm:"index:idx_comfy_bridge_request_queue,priority:2;size:24"`
	PayloadJSON string     `json:"-" gorm:"type:text"`
	ResultJSON  string     `json:"-" gorm:"type:text"`
	Error       string     `json:"error,omitempty" gorm:"type:text"`
	ClaimedAt   *time.Time `json:"claimedAt,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	ExpiresAt   time.Time  `json:"expiresAt" gorm:"index"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`

	// 任务链字段
	GenerationTaskID string `json:"generationTaskId,omitempty" gorm:"index:idx_cbr_task;size:36"`
	ShotID           string `json:"shotId,omitempty" gorm:"index:idx_cbr_shot;size:64"`
	CanvasNodeID     string `json:"canvasNodeId,omitempty" gorm:"index:idx_cbr_node;size:64"`
	// AttemptNo 属于执行尝试（Job），不属于用户意图（Task），因此放在这里
	AttemptNo     int    `json:"attemptNo" gorm:"default:1"`
	ComfyPromptID string `json:"comfyPromptId,omitempty" gorm:"index;size:64"`
	// ErrorCode 取值：NETWORK/AUTH/QUEUE/GPU/WORKFLOW/MODEL/TIMEOUT/OUTPUT/UNKNOWN
	ErrorCode string `json:"errorCode,omitempty" gorm:"size:24"`
}

// BridgeOutputAsset 是 Bridge 回调结果里解析出的原始产出描述（W1-01 / D-026 并轨）。
// 它不是数据库表——只是 service → repository 之间的传递结构。
// 落库时由 repository 按分镜上下文转成 ShotArtifact：
//   有 ShotID 且能解析出 Shot → 写入 shot_artifacts（ResourceID 留空，URI 存 MetadataJSON）
//   无分镜上下文（画布自由生成）→ 跳过落库，不阻断任务完成
type BridgeOutputAsset struct {
	AssetType  string  `json:"assetType"`
	StorageURI string  `json:"storageUri"`
	PreviewURI string  `json:"previewUri,omitempty"`
	Mime       string  `json:"mime,omitempty"`
	Checksum   string  `json:"checksum,omitempty"`
	FileSize   int64   `json:"fileSize"`
	Provider   string  `json:"provider,omitempty"`
	DurationMs float64 `json:"durationMs"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`
	FPS        float64 `json:"fps"`
}

// 注：W1-01 初版曾在此新建 ShotRegistry / OutputAsset / BridgeWorkflow 三张表，
// 后发现后端已有完整生产域模型（Shot / ShotArtifact / WorkflowTemplateVersion / ProductionTaskLink），
// 属于重复造轮子（决策台账 Q-09）。已改为扩展既有模型，详见 models_project.go 的 W1-01 段落（D-026）。

package model

import "time"

// IDSequence 为需要可读、稳定 ID 的业务对象提供数据库级自增序列。
// 对象关联始终使用独立外键，不允许从带前缀 ID 中解析父子关系。
type IDSequence struct {
	Name      string    `json:"name" gorm:"primaryKey;size:40"`
	Value     int64     `json:"value"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type LogicalModel struct {
	ID          string `json:"id" gorm:"primaryKey;size:36"`
	Code        string `json:"code" gorm:"size:80;uniqueIndex"`
	Name        string `json:"name" gorm:"size:120"`
	Icon        string `json:"icon" gorm:"size:80"`
	Description string `json:"description" gorm:"size:500"`
	Capability  string `json:"capability" gorm:"size:32;index"`
	Enabled     bool   `json:"enabled" gorm:"index"`
	SortOrder   int    `json:"sortOrder" gorm:"index"`
	// RevisionSequence 记录已经分配的 revision 版本号，由数据库原子递增。
	RevisionSequence int    `json:"-" gorm:"not null;default:0"`
	ActiveRevisionID string `json:"activeRevisionId" gorm:"size:36;index"`
	// SourceChannelModelID 标识这个前台目录项由哪个系统渠道模型投影而来。
	// 管理员不再重复维护能力和价格，渠道模型保存时会创建新的前台 revision。
	SourceChannelModelID    string `json:"sourceChannelModelId,omitempty" gorm:"size:36;index"`
	PricePolicy             string `json:"pricePolicy" gorm:"size:24;default:unified"`
	BillingMode             string `json:"billingMode" gorm:"size:32"`
	UnitPriceMicrocredits   int64  `json:"unitPriceMicrocredits"`
	InputPriceMicrocredits  int64  `json:"inputPriceMicrocredits"`
	OutputPriceMicrocredits int64  `json:"outputPriceMicrocredits"`
	CachedPriceMicrocredits int64  `json:"cachedPriceMicrocredits"`
	// LegacyModelIDsJSON 用于创作端把已保存的旧 SKU 选择无缝映射到新的模型家族。
	// 这只是目录兼容信息，任务、路由尝试和账单仍固定引用其创建时的 ID 快照。
	LegacyModelIDsJSON string `json:"-" gorm:"type:text"`
	// ArchivedAt 仅从可选目录隐藏模型；历史任务、计费和审计仍需读取主体及不可变 revision。
	ArchivedAt *time.Time `json:"-" gorm:"index"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
}

// LogicalModelRevision 固化一次可发布的前台能力合同。默认值属于前台模型，不能由供应商隐式决定。
type LogicalModelRevision struct {
	ID                 string    `json:"id" gorm:"primaryKey;size:36"`
	LogicalModelID     string    `json:"logicalModelId" gorm:"size:36;index;uniqueIndex:idx_logical_revision_version,priority:1"`
	Version            int       `json:"version" gorm:"uniqueIndex:idx_logical_revision_version,priority:2"`
	CapabilitySpecJSON string    `json:"-" gorm:"type:text"`
	DefaultOptionsJSON string    `json:"-" gorm:"type:text"`
	CreatedBy          string    `json:"createdBy" gorm:"size:36;index"`
	CreatedAt          time.Time `json:"createdAt"`
}

type LogicalModelRoute struct {
	ID                     string    `json:"id" gorm:"primaryKey;size:36"`
	LogicalModelRevisionID string    `json:"logicalModelRevisionId" gorm:"size:36;index;uniqueIndex:idx_logical_route_member,priority:1"`
	ChannelModelID         string    `json:"channelModelId" gorm:"size:36;index;uniqueIndex:idx_logical_route_member,priority:2"`
	Enabled                bool      `json:"enabled" gorm:"index"`
	Priority               int       `json:"priority" gorm:"index"`
	Weight                 int       `json:"weight"`
	CreatedAt              time.Time `json:"createdAt"`
	UpdatedAt              time.Time `json:"updatedAt"`
}

type RouteAttempt struct {
	ID                     string     `json:"id" gorm:"primaryKey;size:36"`
	TaskID                 string     `json:"taskId" gorm:"size:36;index;uniqueIndex:idx_route_attempt_run_number,priority:1"`
	RouteRun               int        `json:"routeRun" gorm:"index;uniqueIndex:idx_route_attempt_run_number,priority:2"`
	AttemptNumber          int        `json:"attemptNumber" gorm:"uniqueIndex:idx_route_attempt_run_number,priority:3"`
	LogicalModelID         string     `json:"logicalModelId" gorm:"size:36;index"`
	LogicalModelRevisionID string     `json:"logicalModelRevisionId" gorm:"size:36;index"`
	RouteID                string     `json:"routeId" gorm:"size:36;index"`
	ChannelModelID         string     `json:"channelModelId" gorm:"size:36;index"`
	ChannelID              string     `json:"channelId" gorm:"size:36;index"`
	Status                 string     `json:"status" gorm:"size:32;index"`
	DispatchState          string     `json:"dispatchState" gorm:"size:32;index"`
	ProviderRequestID      string     `json:"providerRequestId" gorm:"size:160;index"`
	FailureCode            string     `json:"failureCode" gorm:"size:80"`
	FailureMessage         string     `json:"failureMessage" gorm:"size:1000"`
	StartedAt              time.Time  `json:"startedAt"`
	CompletedAt            *time.Time `json:"completedAt"`
}

// LogicalModelPriceSKU 表示前台模型在统一定价模式下的独立售价 SKU。
// 当 pricePolicy = unified 时，用户价格由此 SKU 决定，而非渠道价格。
// SelectorJSON 统一使用结构化意图选择器，支持复杂的能力组合定价。
type LogicalModelPriceSKU struct {
	ID                           string     `json:"id" gorm:"primaryKey;size:36"`
	LogicalModelRevisionID       string     `json:"logicalModelRevisionId" gorm:"size:36;index;uniqueIndex:idx_logical_sku_active,priority:1,where:deleted_at IS NULL"`
	Code                         string     `json:"code" gorm:"size:80"`
	Name                         string     `json:"name" gorm:"size:160"`
	SelectorKey                  string     `json:"selectorKey" gorm:"size:500;not null;default:{};uniqueIndex:idx_logical_sku_active,priority:2,where:deleted_at IS NULL"`
	SelectorJSON                 string     `json:"-" gorm:"type:text;not null;default:{}"`
	BillingMode                  string     `json:"billingMode" gorm:"size:32"`
	UnitPriceMicrocredits        int64      `json:"unitPriceMicrocredits"`
	InputTokenPriceMicrocredits  int64      `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits int64      `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits int64      `json:"cachedTokenPriceMicrocredits"`
	Priority                     int        `json:"priority" gorm:"index"`
	Enabled                      bool       `json:"enabled" gorm:"index"`
	Version                      int        `json:"version"`
	CreatedAt                    time.Time  `json:"createdAt"`
	UpdatedAt                    time.Time  `json:"updatedAt"`
	DeletedAt                    *time.Time `json:"-" gorm:"index"`
}

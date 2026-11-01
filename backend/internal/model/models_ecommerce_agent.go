package model

import "time"

type EcommerceAgentAnalysis struct {
	ID          string    `json:"id" gorm:"primaryKey;size:36"`
	UserID      string    `json:"-" gorm:"size:36;not null;uniqueIndex:idx_ecommerce_agent_analysis,priority:1"`
	Signature   string    `json:"-" gorm:"size:64;not null;uniqueIndex:idx_ecommerce_agent_analysis,priority:2"`
	PayloadJSON string    `json:"-" gorm:"type:jsonb;not null"`
	CreatedAt   time.Time `json:"createdAt"`
}

// EcommerceAgentRun is a durable, owner-scoped generation receipt. A run owns
// its page records and one existing billing order; the idempotency key is
// unique per user, including when the caller did not supply one.
type EcommerceAgentRun struct {
	ID               string     `json:"id" gorm:"primaryKey;size:36"`
	UserID           string     `json:"-" gorm:"size:36;not null;uniqueIndex:idx_ecommerce_agent_user_key,priority:1;index"`
	IdempotencyKey   string     `json:"-" gorm:"size:160;not null;uniqueIndex:idx_ecommerce_agent_user_key,priority:2"`
	ProjectID        string     `json:"projectId" gorm:"size:36;index"`
	BillingOrderID   string     `json:"-" gorm:"size:36;index"`
	Status           string     `json:"status" gorm:"size:24;index"`
	Mode             string     `json:"mode" gorm:"size:12"`
	Platform         string     `json:"platform" gorm:"size:48"`
	Language         string     `json:"language" gorm:"size:48"`
	GenerateType     int        `json:"generateType"`
	PageCount        int        `json:"pageCount"`
	SuccessPages     int        `json:"successPages"`
	CancelRequested  bool       `json:"cancelRequested" gorm:"not null;default:false"`
	UnitMicrocredits int64      `json:"unitMicrocredits"`
	BriefJSON        string     `json:"-" gorm:"type:text"`
	CopyJSON         string     `json:"-" gorm:"type:text"`
	CanvasJSON       string     `json:"-" gorm:"type:jsonb"`
	ErrorCode        string     `json:"errorCode,omitempty" gorm:"size:48"`
	CreatedAt        time.Time  `json:"createdAt"`
	UpdatedAt        time.Time  `json:"updatedAt"`
	FinishedAt       *time.Time `json:"finishedAt,omitempty"`
}

type EcommerceAgentPage struct {
	ID        string    `json:"-" gorm:"primaryKey;size:36"`
	RunID     string    `json:"-" gorm:"size:36;not null;uniqueIndex:idx_ecommerce_agent_page,priority:1;index"`
	Index     int       `json:"index" gorm:"uniqueIndex:idx_ecommerce_agent_page,priority:2"`
	Role      string    `json:"role" gorm:"size:32"`
	Title     string    `json:"title" gorm:"size:160"`
	Headline  string    `json:"headline" gorm:"size:500"`
	Prompt    string    `json:"prompt" gorm:"type:text"`
	URL       string    `json:"url" gorm:"type:text"`
	Status    string    `json:"status" gorm:"size:24"`
	Error     string    `json:"error,omitempty" gorm:"size:500"`
	Ratio     string    `json:"aspectRatio" gorm:"size:12"`
	NeedText  bool      `json:"needText"`
	LatencyMs int64     `json:"latencyMs"`
	CreatedAt time.Time `json:"-"`
	UpdatedAt time.Time `json:"-"`
}

type EcommerceAgentCanvasVersion struct {
	ID         string    `json:"id" gorm:"primaryKey;size:36"`
	UserID     string    `json:"-" gorm:"size:36;not null;index"`
	ProjectID  string    `json:"projectId" gorm:"size:36;not null;uniqueIndex:idx_ecommerce_agent_canvas_version,priority:1"`
	Version    int64     `json:"version" gorm:"uniqueIndex:idx_ecommerce_agent_canvas_version,priority:2"`
	CanvasJSON string    `json:"-" gorm:"type:jsonb;not null"`
	CreatedAt  time.Time `json:"createdAt"`
}

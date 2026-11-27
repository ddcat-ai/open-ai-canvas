package model

import "time"

// Failure content is a strict metadata allowlist, never arbitrary error text.
type ClientFailure struct {
	UserID      string    `json:"userId" gorm:"primaryKey;size:36"`
	EventID     string    `json:"eventId" gorm:"primaryKey;size:96"`
	RunID       string    `json:"runId" gorm:"index;size:80"`
	StepID      string    `json:"stepId" gorm:"size:160"`
	Code        string    `json:"code" gorm:"index;size:48"`
	Phase       string    `json:"phase" gorm:"size:24"`
	BuildCommit string    `json:"buildCommit" gorm:"size:80"`
	HTTPStatus  int       `json:"httpStatus"`
	Epoch       int64     `json:"epoch"`
	OccurredAt  time.Time `json:"occurredAt"`
	CreatedAt   time.Time `json:"receivedAt" gorm:"index"`
	FramesJSON  string    `json:"frames" gorm:"type:text"`
}

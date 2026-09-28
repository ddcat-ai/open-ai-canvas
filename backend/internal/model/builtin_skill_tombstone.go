package model

import "time"

// BuiltinSkillTombstone prevents a removed platform skill from being recreated
// by the next startup sync while retaining an auditable deletion record.
type BuiltinSkillTombstone struct {
	SkillID   string    `json:"skillId" gorm:"primaryKey;size:36"`
	DeletedBy string    `json:"deletedBy" gorm:"size:36"`
	DeletedAt time.Time `json:"deletedAt"`
}

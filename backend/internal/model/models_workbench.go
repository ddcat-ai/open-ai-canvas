package model

import "time"

const (
	WorkbenchKindImage = "image"
	WorkbenchKindVideo = "video"
)

// WorkbenchTool is an administrator-managed public generation entry.
type WorkbenchTool struct {
	ID              string    `json:"id" gorm:"primaryKey;size:36"`
	Kind            string    `json:"kind" gorm:"size:16;index:idx_workbench_tools_kind_enabled_sort,priority:1"`
	CategoryID      string    `json:"categoryId" gorm:"size:64;index"`
	Name            string    `json:"name" gorm:"size:120;not null"`
	Subtitle        string    `json:"subtitle" gorm:"size:240"`
	Description     string    `json:"description" gorm:"type:text"`
	IconResourceID  string    `json:"iconResourceId" gorm:"size:36"`
	CoverResourceID string    `json:"coverResourceId" gorm:"size:36"`
	SortOrder       int       `json:"sortOrder" gorm:"not null;default:0;index:idx_workbench_tools_kind_enabled_sort,priority:3"`
	CapabilityJSON  string    `json:"capabilityJson" gorm:"type:text"`
	GuideJSON       string    `json:"guideJson" gorm:"type:text"`
	Enabled         bool      `json:"enabled" gorm:"index:idx_workbench_tools_kind_enabled_sort,priority:2"`
	Version         int       `json:"version" gorm:"not null;default:1"`
	CreatedBy       string    `json:"createdBy" gorm:"size:36;index"`
	UpdatedBy       string    `json:"updatedBy" gorm:"size:36;index"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

// WorkbenchPreset is a versioned prompt/configuration preset owned by a tool.
type WorkbenchPreset struct {
	ID                string    `json:"id" gorm:"primaryKey;size:36"`
	ToolID            string    `json:"toolId" gorm:"size:36;index:idx_workbench_presets_tool_enabled_sort,priority:1"`
	Name              string    `json:"name" gorm:"size:120;not null"`
	Summary           string    `json:"summary" gorm:"size:500"`
	PromptTemplate    string    `json:"promptTemplate" gorm:"type:text"`
	DefaultParamsJSON string    `json:"defaultParameters" gorm:"type:text"`
	SortOrder         int       `json:"sortOrder" gorm:"not null;default:0;index:idx_workbench_presets_tool_enabled_sort,priority:3"`
	Enabled           bool      `json:"enabled" gorm:"index:idx_workbench_presets_tool_enabled_sort,priority:2"`
	Version           int       `json:"version" gorm:"not null;default:1"`
	CreatedBy         string    `json:"createdBy" gorm:"size:36;index"`
	UpdatedBy         string    `json:"updatedBy" gorm:"size:36;index"`
	CreatedAt         time.Time `json:"createdAt"`
	UpdatedAt         time.Time `json:"updatedAt"`
}

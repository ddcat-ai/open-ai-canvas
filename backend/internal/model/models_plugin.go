package model

import "time"

// PluginPlatformState stores the administrator-controlled availability of a
// plugin. User activation can never make an unavailable plugin effective.
type PluginPlatformState struct {
	PluginID  string    `json:"pluginId" gorm:"primaryKey;size:120"`
	Available bool      `json:"available" gorm:"index"`
	UpdatedBy string    `json:"updatedBy" gorm:"index;size:36"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// UserPluginState stores one user's activation choice for an application
// plugin. System-scoped protocol and uploaded plugins do not use this table.
type UserPluginState struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"size:36;index;uniqueIndex:idx_user_plugin_state_user_plugin,priority:1"`
	PluginID  string    `json:"pluginId" gorm:"size:120;index;uniqueIndex:idx_user_plugin_state_user_plugin,priority:2"`
	Enabled   bool      `json:"enabled" gorm:"index"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

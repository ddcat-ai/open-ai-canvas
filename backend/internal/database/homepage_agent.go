package database

import (
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func migrateHomepageAgentWorkflow(tx *gorm.DB) error {
	return tx.AutoMigrate(
		&model.AgentSession{},
		&model.CloudAgentReceipt{},
		&model.CloudAgentExecution{},
		&model.CreationPreferences{},
		&model.Resource{},
		&model.ResourceTransfer{},
		&model.Task{},
	)
}

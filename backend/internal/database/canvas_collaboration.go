package database

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func migrateCanvasCollaboration(tx *gorm.DB) error {
	if err := tx.AutoMigrate(&model.CanvasEditLease{}); err != nil {
		return err
	}
	return migrateCanvasAgentActivityIndexes(tx)
}

func migrateCanvasAgentActivityIndexes(tx *gorm.DB) error {
	if !tx.Migrator().HasColumn(&model.Task{}, "AgentExecutionReady") {
		if err := tx.Migrator().AddColumn(&model.Task{}, "AgentExecutionReady"); err != nil {
			return err
		}
	}
	if err := tx.Exec(`UPDATE tasks SET agent_execution_ready = true
        WHERE operation = 'cloud_agent' AND agent_execution_ready = false
        AND EXISTS (SELECT 1 FROM cloud_agent_executions e WHERE e.id = tasks.id AND e.user_id = tasks.user_id)`).Error; err != nil {
		return err
	}
	for _, statement := range []string{
		`CREATE INDEX IF NOT EXISTS idx_cloud_agent_canvas_active ON cloud_agent_executions (user_id, id)
            WHERE status NOT IN ('completed', 'failed', 'cancelled', 'rejected') OR cleanup_pending = true`,
		`CREATE INDEX IF NOT EXISTS idx_tasks_canvas_agent_reservation ON tasks (user_id, project_id, created_at, id)
			WHERE operation = 'cloud_agent' AND agent_execution_ready = false AND status NOT IN ('succeeded', 'failed', 'cancelled')`,
	} {
		if err := tx.Exec(statement).Error; err != nil {
			return err
		}
	}
	return nil
}

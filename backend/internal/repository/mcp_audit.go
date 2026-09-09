package repository

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ApplyCanvasMCPAtomic compares the server version inside one transaction,
// updates the canvas only after the caller has validated a complete copy, and
// appends the audit row in the same transaction.
func (r *Repository) ApplyCanvasMCPAtomic(userID string, canvasID string, expectedRevision int64, expectedHash string, project *model.CanvasProject, audit *model.MCPAuditEvent) (*model.CanvasProject, bool, error) {
	var current model.CanvasProject
	applied := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id = ? AND user_id = ?", canvasID, userID).Error; err != nil {
			return err
		}
		if current.Revision != expectedRevision || current.StateHash != strings.TrimSpace(expectedHash) {
			return nil
		}
		result := tx.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ? AND revision = ? AND state_hash = ?", canvasID, userID, expectedRevision, expectedHash).Updates(map[string]any{
			"project_id": project.ProjectID, "title": project.Title, "payload_json": project.PayloadJSON,
			"revision": project.Revision, "state_hash": project.StateHash, "updated_at": project.UpdatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}
		if audit != nil {
			if err := tx.Create(audit).Error; err != nil {
				return err
			}
		}
		current = *project
		applied = true
		return nil
	})
	if err != nil {
		return nil, false, err
	}
	return &current, applied, nil
}

// RollbackCanvasMCPAtomic restores the previous project only while the
// conditional revision/hash still identifies the MCP write being compensated.
// A concurrent user write therefore wins and is never overwritten.
func (r *Repository) RollbackCanvasMCPAtomic(userID, canvasID string, expectedRevision int64, expectedHash string, previous *model.CanvasProject, auditID string) (bool, error) {
	rolledBack := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var current model.CanvasProject
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id = ? AND user_id = ?", canvasID, userID).Error; err != nil {
			return err
		}
		if current.Revision != expectedRevision || current.StateHash != strings.TrimSpace(expectedHash) {
			return nil
		}
		result := tx.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ? AND revision = ? AND state_hash = ?", canvasID, userID, expectedRevision, expectedHash).Updates(map[string]any{
			"project_id": previous.ProjectID, "title": previous.Title, "payload_json": previous.PayloadJSON,
			"revision": previous.Revision, "state_hash": previous.StateHash, "updated_at": previous.UpdatedAt,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return nil
		}
		if strings.TrimSpace(auditID) != "" {
			if err := tx.Delete(&model.MCPAuditEvent{}, "id = ? AND user_id = ? AND canvas_id = ?", auditID, userID, canvasID).Error; err != nil {
				return err
			}
		}
		rolledBack = true
		return nil
	})
	return rolledBack, err
}

func (r *Repository) DeleteMCPTask(userID, taskID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("user_id = ? AND task_id = ?", userID, taskID).Delete(&model.TaskTextDelta{}).Error; err != nil {
			return err
		}
		return tx.Delete(&model.Task{}, "id = ? AND user_id = ?", taskID, userID).Error
	})
}

func (r *Repository) MCPAuditEventsForUser(userID string, limit int) ([]model.MCPAuditEvent, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	var rows []model.MCPAuditEvent
	err := r.db.Where("user_id = ?", userID).Order("created_at desc").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *Repository) CreateMCPAuditEvent(event *model.MCPAuditEvent) error {
	return r.db.Create(event).Error
}

// MCPTaskByIdempotency inspects only the safe task input metadata. It is used
// to make a repeated MCP generate request return the original queued task.
func (r *Repository) MCPTaskByIdempotency(userID, canvasID, nodeID, identity string) (*model.Task, error) {
	identity = strings.TrimSpace(identity)
	if identity == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var tasks []model.Task
	if err := r.db.Where("user_id = ? AND project_id = ?", userID, canvasID).Order("created_at desc").Limit(200).Find(&tasks).Error; err != nil {
		return nil, err
	}
	for _, task := range tasks {
		var input map[string]any
		if json.Unmarshal([]byte(task.InputJSON), &input) != nil {
			continue
		}
		metadata, _ := input["metadata"].(map[string]any)
		if strings.TrimSpace(stringValue(metadata["clientOperationId"])) == identity && strings.TrimSpace(stringValue(metadata["nodeId"])) == strings.TrimSpace(nodeID) {
			copy := task
			return &copy, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func stringValue(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

package repository

import (
	"encoding/json"
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *Repository) EnsureAgentMemoryPreferences(setting *model.AgentMemorySetting) error {
	if setting == nil || strings.TrimSpace(setting.UserID) == "" {
		return gorm.ErrRecordNotFound
	}
	return r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, DoNothing: true}).Create(setting).Error
}

func (r *Repository) FailAgentMemoryCompactStart(setting model.AgentMemorySetting, message string, now time.Time) error {
	if strings.TrimSpace(setting.UserID) == "" {
		return gorm.ErrRecordNotFound
	}
	return r.db.Model(&model.AgentMemorySetting{}).
		Where("user_id = ? AND updated_at = ?", setting.UserID, setting.UpdatedAt).
		Updates(map[string]any{"last_status": model.AgentMemoryCompactStatusFailed, "last_error": message, "last_compact_at": now, "updated_at": now}).Error
}

// Candidates advance by stable ID, independent of Hits, so low-use entries are
// eventually reviewed. Input byte limits are applied by the service afterwards.
func (r *Repository) AgentMemoryCompactCandidates(userID, cursor string, limit int) ([]model.AgentLesson, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" || limit <= 0 || limit > 80 {
		return nil, gorm.ErrRecordNotFound
	}
	base := r.db.Where("author_user_id = ? AND status = ?", userID, model.AgentLessonStatusApproved)
	var rows []model.AgentLesson
	if err := base.Session(&gorm.Session{}).Where("id > ?", cursor).Order("id ASC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}
	if cursor != "" && len(rows) < limit {
		var wrapped []model.AgentLesson
		if err := base.Session(&gorm.Session{}).Where("id <= ?", cursor).Order("id ASC").Limit(limit - len(rows)).Find(&wrapped).Error; err != nil {
			return nil, err
		}
		rows = append(rows, wrapped...)
	}
	return rows, nil
}

// Claim the job and persist its exact input before creating the asynchronous
// text task. The callback can then finish safely even if it beats task-ID linking.
func (r *Repository) ClaimAgentMemoryCompact(setting *model.AgentMemorySetting, proposal *model.AgentMemoryProposal, nextCursor string) error {
	if setting == nil || proposal == nil || strings.TrimSpace(setting.UserID) == "" || proposal.UserID != setting.UserID {
		return gorm.ErrRecordNotFound
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.AgentMemorySetting{}).Where("user_id = ? AND updated_at = ? AND COALESCE(compact_proposal_id, '') = ?", setting.UserID, setting.UpdatedAt, setting.CompactProposalID).
			Updates(map[string]any{
				"logical_model_id": setting.LogicalModelID, "channel_id": setting.ChannelID,
				"channel_model_key": setting.ChannelModelKey, "model": setting.Model,
				"compact_proposal_id": proposal.ID, "compact_task_id": "", "compact_cursor": nextCursor,
				"compact_started_at": proposal.CreatedAt, "last_status": model.AgentMemoryCompactStatusQueued,
				"last_error": "", "last_summary_json": "", "updated_at": proposal.CreatedAt,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCreationConflict
		}
		return tx.Create(proposal).Error
	})
}

func (r *Repository) LinkAgentMemoryCompactTask(userID, proposalID, taskID string) error {
	if strings.TrimSpace(userID) == "" || proposalID == "" || taskID == "" {
		return gorm.ErrRecordNotFound
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.AgentMemoryProposal{}).
			Where("user_id = ? AND id = ? AND (task_id = '' OR task_id = ?)", userID, proposalID, taskID).
			Update("task_id", taskID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCreationConflict
		}
		return tx.Model(&model.AgentMemorySetting{}).Where("user_id = ? AND compact_proposal_id = ?", userID, proposalID).
			UpdateColumn("compact_task_id", taskID).Error
	})
}

func (r *Repository) AgentMemoryProposalForUser(userID, id string) (*model.AgentMemoryProposal, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(id) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var row model.AgentMemoryProposal
	err := r.db.Where("user_id = ? AND id = ?", userID, id).First(&row).Error
	return &row, err
}

func (r *Repository) UserAgentMemoryProposals(userID string, limit int) ([]model.AgentMemoryProposal, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	var rows []model.AgentMemoryProposal
	err := r.db.Where("user_id = ?", userID).Order("created_at DESC, id DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *Repository) FinishAgentMemoryProposal(row *model.AgentMemoryProposal, taskID, lastStatus, lastError string, now time.Time) error {
	if row == nil || strings.TrimSpace(row.UserID) == "" || row.ID == "" {
		return gorm.ErrRecordNotFound
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.AgentMemoryProposal{}).
			Where("id = ? AND user_id = ? AND version = ? AND status = ? AND (task_id = '' OR task_id = ?)", row.ID, row.UserID, row.Version, model.AgentMemoryProposalGenerating, taskID).
			Updates(map[string]any{"status": row.Status, "task_id": taskID, "changes_json": row.ChangesJSON, "summary_json": row.SummaryJSON, "version": row.Version + 1, "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCreationConflict
		}
		return tx.Model(&model.AgentMemorySetting{}).Where("user_id = ? AND compact_proposal_id = ?", row.UserID, row.ID).
			Updates(map[string]any{"compact_task_id": taskID, "last_status": lastStatus, "last_error": lastError, "last_summary_json": row.SummaryJSON, "last_compact_at": now, "updated_at": now}).Error
	})
}

func (r *Repository) MarkAgentMemoryProposalRunning(userID, proposalID, taskID string, now time.Time) error {
	if strings.TrimSpace(userID) == "" || proposalID == "" || taskID == "" {
		return gorm.ErrRecordNotFound
	}
	return r.db.Model(&model.AgentMemorySetting{}).
		Where("user_id = ? AND compact_proposal_id = ? AND last_status IN ?", userID, proposalID, []string{model.AgentMemoryCompactStatusQueued, model.AgentMemoryCompactStatusRunning}).
		Updates(map[string]any{"compact_task_id": taskID, "last_status": model.AgentMemoryCompactStatusRunning, "updated_at": now}).Error
}

func (r *Repository) UpdateAgentMemoryPreferences(setting *model.AgentMemorySetting) error {
	if setting == nil || strings.TrimSpace(setting.UserID) == "" {
		return gorm.ErrRecordNotFound
	}
	return r.db.Model(&model.AgentMemorySetting{}).Where("user_id = ?", setting.UserID).Updates(map[string]any{
		"compact_interval": setting.CompactInterval, "logical_model_id": setting.LogicalModelID,
		"channel_id": setting.ChannelID, "channel_model_key": setting.ChannelModelKey,
		"model": setting.Model, "updated_at": setting.UpdatedAt,
	}).Error
}

func decodeAgentMemorySnapshots(raw string) ([]model.AgentMemorySnapshot, error) {
	var snapshots []model.AgentMemorySnapshot
	if err := json.Unmarshal([]byte(raw), &snapshots); err != nil {
		return nil, err
	}
	return snapshots, nil
}

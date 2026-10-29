package repository

import (
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AgentMemoryDocumentWrite 是一次记忆文件写入：按 ExpectedRevision 做 CAS，同事务写修订记录。
// ApplyPendingID 非空时把这条待确认修订改为已生效，否则插入 Revision；MarkRestoredID 非空时
// 同时标记被撤销的修订。三者在一个事务里完成，避免文件和修订历史互相对不上。
type AgentMemoryDocumentWrite struct {
	UserID           string
	ExpectedRevision int64
	EntriesJSON      string
	NextEntrySeq     int64
	Hash             string
	CharCount        int
	Now              time.Time
	Revision         *model.AgentMemoryDocumentRevision
	ApplyPendingID   string
	MarkRestoredID   string
	Keep             int
}

func (r *Repository) AgentMemoryDocument(userID string) (*model.AgentMemoryDocument, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var doc model.AgentMemoryDocument
	if err := r.db.Where("user_id = ?", userID).First(&doc).Error; err != nil {
		return nil, err
	}
	return &doc, nil
}

// CreateAgentMemoryDocument 只在用户还没有记忆文件时创建（并发创建以先到者为准），返回库中的那份。
func (r *Repository) CreateAgentMemoryDocument(doc *model.AgentMemoryDocument, seed *model.AgentMemoryDocumentRevision) (*model.AgentMemoryDocument, error) {
	if doc == nil || strings.TrimSpace(doc.UserID) == "" {
		return nil, gorm.ErrRecordNotFound
	}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}}, DoNothing: true}).Create(doc)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 && seed != nil {
			return tx.Create(seed).Error
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return r.AgentMemoryDocument(doc.UserID)
}

// WriteAgentMemoryDocument 返回写入后的 revision；文件已被并发修改时返回 ErrTaskStateConflict。
func (r *Repository) WriteAgentMemoryDocument(write AgentMemoryDocumentWrite) (int64, error) {
	userID := strings.TrimSpace(write.UserID)
	if userID == "" || write.ExpectedRevision <= 0 {
		return 0, gorm.ErrRecordNotFound
	}
	next := write.ExpectedRevision + 1
	err := r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.AgentMemoryDocument{}).
			Where("user_id = ? AND revision = ?", userID, write.ExpectedRevision).
			Updates(map[string]any{
				"entries_json": write.EntriesJSON, "next_entry_seq": write.NextEntrySeq, "revision": next, "hash": write.Hash,
				"char_count": write.CharCount, "updated_at": write.Now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		if write.ApplyPendingID != "" {
			if write.Revision == nil {
				return gorm.ErrInvalidData
			}
			applied := tx.Model(&model.AgentMemoryDocumentRevision{}).
				Where("id = ? AND user_id = ? AND status = ?", write.ApplyPendingID, userID, model.AgentMemoryRevisionPending).
				Updates(map[string]any{
					"status": model.AgentMemoryRevisionApplied, "base_revision": write.ExpectedRevision, "revision": next,
					"before_json": write.Revision.BeforeJSON, "after_json": write.Revision.AfterJSON,
					"summary": write.Revision.Summary, "decided_at": write.Now,
				})
			if applied.Error != nil {
				return applied.Error
			}
			if applied.RowsAffected != 1 {
				return ErrTaskStateConflict
			}
		} else if write.Revision != nil {
			write.Revision.UserID = userID
			write.Revision.BaseRevision = write.ExpectedRevision
			write.Revision.Revision = next
			write.Revision.Status = model.AgentMemoryRevisionApplied
			if err := tx.Create(write.Revision).Error; err != nil {
				return err
			}
		}
		if write.MarkRestoredID != "" {
			restored := tx.Model(&model.AgentMemoryDocumentRevision{}).
				Where("id = ? AND user_id = ? AND status = ? AND restored_at IS NULL", write.MarkRestoredID, userID, model.AgentMemoryRevisionApplied).
				Update("restored_at", write.Now)
			if restored.Error != nil {
				return restored.Error
			}
			if restored.RowsAffected != 1 {
				return ErrTaskStateConflict
			}
		}
		if write.Keep > 0 {
			return pruneAgentMemoryDocumentRevisions(tx, userID, write.Keep)
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	return next, nil
}

// 只保留最近 keep 条已结束的修订；待确认修订不参与裁剪。
func pruneAgentMemoryDocumentRevisions(tx *gorm.DB, userID string, keep int) error {
	var stale []string
	if err := tx.Model(&model.AgentMemoryDocumentRevision{}).
		Where("user_id = ? AND status <> ?", userID, model.AgentMemoryRevisionPending).
		Order("created_at DESC").Order("id DESC").Offset(keep).Limit(500).
		Pluck("id", &stale).Error; err != nil {
		return err
	}
	if len(stale) == 0 {
		return nil
	}
	return tx.Where("user_id = ? AND id IN ?", userID, stale).Delete(&model.AgentMemoryDocumentRevision{}).Error
}

func (r *Repository) UpdateAgentMemoryDocumentSettings(userID, mode string, capacity int, now time.Time) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return gorm.ErrRecordNotFound
	}
	result := r.db.Model(&model.AgentMemoryDocument{}).Where("user_id = ?", userID).
		Updates(map[string]any{"mode": mode, "capacity": capacity, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) CreateAgentMemoryDocumentRevision(revision *model.AgentMemoryDocumentRevision) error {
	if revision == nil || strings.TrimSpace(revision.UserID) == "" {
		return gorm.ErrRecordNotFound
	}
	return r.db.Create(revision).Error
}

func (r *Repository) AgentMemoryDocumentRevisions(userID, status string, limit int) ([]model.AgentMemoryDocumentRevision, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query := r.db.Where("user_id = ?", userID)
	if status != "" {
		query = query.Where("status = ?", status)
	}
	var rows []model.AgentMemoryDocumentRevision
	err := query.Order("created_at DESC").Order("id DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

func (r *Repository) AgentMemoryDocumentRevision(userID, id string) (*model.AgentMemoryDocumentRevision, error) {
	userID, id = strings.TrimSpace(userID), strings.TrimSpace(id)
	if userID == "" || id == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var row model.AgentMemoryDocumentRevision
	if err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

// AgentMemoryDocumentRevisionByCall 查找某个 Agent 工具调用已经产生的修订，用于重放幂等。
func (r *Repository) AgentMemoryDocumentRevisionByCall(userID, callID string) (*model.AgentMemoryDocumentRevision, error) {
	userID, callID = strings.TrimSpace(userID), strings.TrimSpace(callID)
	if userID == "" || callID == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var row model.AgentMemoryDocumentRevision
	if err := r.db.Where("user_id = ? AND call_id = ?", userID, callID).Order("created_at ASC").First(&row).Error; err != nil {
		return nil, err
	}
	return &row, nil
}

func (r *Repository) CountAgentMemoryDocumentRevisions(userID, status string) (int64, error) {
	var count int64
	err := r.db.Model(&model.AgentMemoryDocumentRevision{}).Where("user_id = ? AND status = ?", strings.TrimSpace(userID), status).Count(&count).Error
	return count, err
}

// RejectAgentMemoryDocumentRevision 只能拒绝仍在待确认的修订。
func (r *Repository) RejectAgentMemoryDocumentRevision(userID, id string, now time.Time) error {
	result := r.db.Model(&model.AgentMemoryDocumentRevision{}).
		Where("id = ? AND user_id = ? AND status = ?", strings.TrimSpace(id), strings.TrimSpace(userID), model.AgentMemoryRevisionPending).
		Updates(map[string]any{"status": model.AgentMemoryRevisionRejected, "decided_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrTaskStateConflict
	}
	return nil
}

// AdminAgentMemoryDocuments 按最近更新排序列出记忆文件；userID 为空时列出全部。
func (r *Repository) AdminAgentMemoryDocuments(userID string, limit int) ([]model.AgentMemoryDocument, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	query := r.db.Model(&model.AgentMemoryDocument{})
	if userID = strings.TrimSpace(userID); userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	var rows []model.AgentMemoryDocument
	err := query.Order("updated_at DESC").Limit(limit).Find(&rows).Error
	return rows, err
}

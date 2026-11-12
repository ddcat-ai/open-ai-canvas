package repository

import (
	"database/sql"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func (r *Repository) ReadCreationConversationSnapshot(fn func(*Repository) error) error {
	options := &sql.TxOptions{ReadOnly: true}
	if r.Dialect() == "postgres" {
		options.Isolation = sql.LevelRepeatableRead
	}
	return r.db.Transaction(func(tx *gorm.DB) error { return fn(New(tx)) }, options)
}

func (r *Repository) CreationConversation(userID, id string) (*model.CreationConversation, error) {
	var row model.CreationConversation
	err := r.db.First(&row, "user_id = ? AND id = ?", userID, id).Error
	return &row, err
}

func (r *Repository) CreationConversationPage(userID, after string) ([]model.CreationConversation, error) {
	rows := []model.CreationConversation{}
	err := r.db.Where("user_id = ? AND id > ?", userID, after).Order("id").Limit(100).Find(&rows).Error
	return rows, err
}

func (r *Repository) CreationConversationMessages(userID, id string) ([]model.CreationConversationMessage, error) {
	rows := []model.CreationConversationMessage{}
	err := r.db.Where("user_id = ? AND conversation_id = ?", userID, id).Order("sequence, id").Find(&rows).Error
	return rows, err
}

func (r *Repository) MutateCreationConversation(userID, id string, fn func(*model.CreationConversation, *Repository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		row := model.CreationConversation{UserID: userID, ID: id}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&row).Error; err != nil {
			return err
		}
		// Acquire the same row write lock on SQLite and PostgreSQL before reading revisions.
		if err := tx.Model(&row).Where("user_id = ? AND id = ?", userID, id).UpdateColumn("revision", gorm.Expr("revision")).Error; err != nil {
			return err
		}
		scoped := New(tx)
		current, err := scoped.CreationConversation(userID, id)
		if err != nil {
			return err
		}
		if err := fn(current, scoped); err != nil {
			return err
		}
		return tx.Save(current).Error
	})
}

func (r *Repository) SaveCreationConversationMessage(row *model.CreationConversationMessage, resources []string) error {
	if err := r.db.Save(row).Error; err != nil {
		return err
	}
	if err := r.db.Where("user_id = ? AND conversation_id = ? AND message_id = ?", row.UserID, row.ConversationID, row.ID).Delete(&model.CreationConversationResource{}).Error; err != nil {
		return err
	}
	for _, id := range resources {
		link := model.CreationConversationResource{UserID: row.UserID, ConversationID: row.ConversationID, MessageID: row.ID, ResourceID: id}
		if err := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&link).Error; err != nil {
			return err
		}
	}
	return nil
}

// Serialize media attachment with the resource cleanup transaction.
func (r *Repository) CreationHistoryResources(userID string, ids []string) ([]model.Resource, error) {
	rows := []model.Resource{}
	if len(ids) == 0 {
		return rows, nil
	}
	query := r.db.Where("user_id = ? AND id IN ?", userID, ids).Order("id")
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.Find(&rows).Error
	return rows, err
}

func (r *Repository) ClearCreationConversationMessages(userID, id string) error {
	if err := r.db.Where("user_id = ? AND conversation_id = ?", userID, id).Delete(&model.CreationConversationResource{}).Error; err != nil {
		return err
	}
	return r.db.Where("user_id = ? AND conversation_id = ?", userID, id).Delete(&model.CreationConversationMessage{}).Error
}

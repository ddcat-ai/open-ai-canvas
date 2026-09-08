package repository

import (
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
	"slices"
	"time"
)

var ErrChannelOrderChanged = errors.New("列表已发生变化，请重新打开排序后再保存")

// 全量顺序在事务中保存；拒绝过期快照，避免覆盖另一管理员的调整。
func (r *Repository) SaveChannelOrder(channelID string, ids, expected []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var current []string
		var target any = &model.ModelChannel{}
		query := tx.Model(target).Where("scope = ?", model.ChannelScopeSystem)
		if channelID != "" {
			if err := r.lockSystemChannelForModelMutation(tx, channelID); err != nil {
				return err
			}
			target = &model.ChannelModel{}
			query = tx.Model(target).Where("channel_id = ?", channelID)
		}
		if tx.Dialector.Name() == "postgres" {
			// Lock in a stable order, then read a fresh ordered snapshot after waiting.
			// PostgreSQL can otherwise return pre-wait ORDER BY results after another sort commits.
			var locked []string
			if err := query.Session(&gorm.Session{}).Clauses(clause.Locking{Strength: "UPDATE"}).Order("id asc").Pluck("id", &locked).Error; err != nil {
				return err
			}
		}
		if err := query.Order("sort_order asc, created_at asc, id asc").Pluck("id", &current).Error; err != nil {
			return err
		}
		if !slices.Equal(current, expected) || len(ids) != len(current) {
			return ErrChannelOrderChanged
		}
		allowed := make(map[string]bool, len(current))
		for _, id := range current {
			allowed[id] = true
		}
		for _, id := range ids {
			if !allowed[id] {
				return ErrChannelOrderChanged
			}
			delete(allowed, id)
		}
		now := time.Now()
		for index, id := range ids {
			if err := tx.Model(target).Where("id = ?", id).Updates(map[string]any{"sort_order": index, "updated_at": now}).Error; err != nil {
				return err
			}
		}
		if channelID != "" {
			return refreshChannelModelNames(tx, channelID, now)
		}
		return nil
	})
}

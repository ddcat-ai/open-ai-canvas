package repository

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"yingce/backend/internal/model"
)

const inspirationFeedBatchSize = 400

// InspirationFeedContentHashes 按 ID 读取已收录条目的内容摘要，同步时据此区分新增、更新与未变。
func (r *Repository) InspirationFeedContentHashes(ids []string) (map[string]string, error) {
	hashes := make(map[string]string, len(ids))
	for start := 0; start < len(ids); start += inspirationFeedBatchSize {
		end := min(start+inspirationFeedBatchSize, len(ids))
		var rows []struct {
			ID          string
			ContentHash string
		}
		if err := r.db.Model(&model.InspirationFeedEntry{}).Select("id", "content_hash").Where("id IN ?", ids[start:end]).Find(&rows).Error; err != nil {
			return nil, err
		}
		for _, row := range rows {
			hashes[row.ID] = row.ContentHash
		}
	}
	return hashes, nil
}

// SaveInspirationFeedEntries 在一个事务里写入新条目和内容有变化的条目；首次收录时间只在新增时写入。
func (r *Repository) SaveInspirationFeedEntries(created []model.InspirationFeedEntry, updated []model.InspirationFeedEntry) error {
	if len(created) == 0 && len(updated) == 0 {
		return nil
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if len(created) > 0 {
			// 同步锁保证通常只有一个写入者；锁过期后另一实例重复写入同一条时，保留先写入的那行。
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(created, 100).Error; err != nil {
				return err
			}
		}
		for index := range updated {
			entry := &updated[index]
			if err := tx.Model(&model.InspirationFeedEntry{ID: entry.ID}).
				Select("source_id", "mode", "title", "description", "image", "prompt", "category", "tags", "credit", "source_url", "content_hash", "published_at", "updated_at").
				Updates(entry).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// InspirationFeedEntries 返回已收录的条目，最近收录的在前。
func (r *Repository) InspirationFeedEntries(limit int) ([]model.InspirationFeedEntry, error) {
	var entries []model.InspirationFeedEntry
	err := r.db.Order("first_seen_at desc, id asc").Limit(limit).Find(&entries).Error
	return entries, err
}

// InspirationFeedCounts 返回各来源已收录的条目数。
func (r *Repository) InspirationFeedCounts() (map[string]int64, error) {
	var rows []struct {
		SourceID string
		Total    int64
	}
	if err := r.db.Model(&model.InspirationFeedEntry{}).Select("source_id, COUNT(*) AS total").Group("source_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.SourceID] = row.Total
	}
	return counts, nil
}

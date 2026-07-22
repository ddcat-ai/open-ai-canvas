package repository

import (
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *Repository) AdminAnnouncements(keyword string, status model.AnnouncementStatus, limit int, offset int) ([]model.Announcement, int64, error) {
	var announcements []model.Announcement
	var total int64
	query := r.db.Model(&model.Announcement{})
	if value := strings.TrimSpace(keyword); value != "" {
		pattern := "%" + strings.ToLower(value) + "%"
		query = query.Where("lower(title) LIKE ? OR lower(content) LIKE ?", pattern, pattern)
	}
	if status == model.AnnouncementStatusActive || status == model.AnnouncementStatusClosed {
		query = query.Where("status = ?", status)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("published_at desc").Limit(limit).Offset(offset).Find(&announcements).Error; err != nil {
		return nil, 0, err
	}
	return announcements, total, nil
}

func (r *Repository) AnnouncementFeed(userID string) ([]model.Announcement, int64, error) {
	var announcements []model.Announcement
	var unreadCount int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("status = ?", model.AnnouncementStatusActive).Order("published_at desc").Find(&announcements).Error; err != nil {
			return err
		}
		return tx.Model(&model.Announcement{}).
			Joins("LEFT JOIN user_announcement_reads ON user_announcement_reads.announcement_id = announcements.id AND user_announcement_reads.user_id = ?", userID).
			Where("announcements.status = ? AND user_announcement_reads.id IS NULL", model.AnnouncementStatusActive).
			Count(&unreadCount).Error
	})
	return announcements, unreadCount, err
}

func (r *Repository) Announcement(id string) (*model.Announcement, error) {
	var announcement model.Announcement
	if err := r.db.First(&announcement, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &announcement, nil
}

func (r *Repository) CloseAnnouncement(id string, closedAt time.Time) (bool, error) {
	result := r.db.Model(&model.Announcement{}).
		Where("id = ? AND status = ?", id, model.AnnouncementStatusActive).
		Updates(map[string]any{"status": model.AnnouncementStatusClosed, "closed_at": closedAt, "updated_at": closedAt})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) MarkAnnouncementsRead(userID string, announcementIDs []string, readAt time.Time) error {
	if len(announcementIDs) == 0 {
		return nil
	}
	var activeIDs []string
	if err := r.db.Model(&model.Announcement{}).Where("id IN ? AND status = ?", announcementIDs, model.AnnouncementStatusActive).Pluck("id", &activeIDs).Error; err != nil {
		return err
	}
	if len(activeIDs) == 0 {
		return nil
	}
	reads := make([]model.UserAnnouncementRead, 0, len(activeIDs))
	for _, id := range activeIDs {
		reads = append(reads, model.UserAnnouncementRead{ID: newRepositoryID(), UserID: userID, AnnouncementID: id, ReadAt: readAt})
	}
	return r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "announcement_id"}}, DoNothing: true}).Create(&reads).Error
}

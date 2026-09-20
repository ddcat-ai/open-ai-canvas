package repository

import (
	"encoding/json"
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
	if err := query.Order("pinned desc, published_at desc").Limit(limit).Offset(offset).Find(&announcements).Error; err != nil {
		return nil, 0, err
	}
	return announcements, total, nil
}

func (r *Repository) AnnouncementFeed(userID string) ([]model.Announcement, int64, error) {
	var announcements []model.Announcement
	var unreadCount int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("status = ?", model.AnnouncementStatusActive).Order("pinned desc, published_at desc").Find(&announcements).Error; err != nil {
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

func (r *Repository) ActiveBannerAnnouncements(now time.Time) ([]model.BannerAnnouncement, error) {
	var banners []model.BannerAnnouncement
	err := r.db.Model(&model.BannerAnnouncement{}).
		Where("status = ?", "active").
		Where("starts_at IS NULL OR starts_at <= ?", now).
		Where("ends_at IS NULL OR ends_at >= ?", now).
		Order("created_at desc").
		Find(&banners).Error
	decodeBannerTitleRuns(banners)
	return banners, err
}

func (r *Repository) AdminBannerAnnouncements(keyword string, status string, limit int, offset int) ([]model.BannerAnnouncement, int64, error) {
	var banners []model.BannerAnnouncement
	var total int64
	query := r.db.Model(&model.BannerAnnouncement{})
	if k := strings.TrimSpace(keyword); k != "" {
		query = query.Where("title LIKE ?", "%"+k+"%")
	}
	if status == "active" || status == "disabled" {
		query = query.Where("status = ?", status)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("created_at desc").Limit(limit).Offset(offset).Find(&banners).Error; err != nil {
		return nil, 0, err
	}
	decodeBannerTitleRuns(banners)
	return banners, total, nil
}

func (r *Repository) BannerAnnouncement(id string) (*model.BannerAnnouncement, error) {
	var banner model.BannerAnnouncement
	if err := r.db.First(&banner, "id = ?", id).Error; err != nil {
		return nil, err
	}
	banner.TitleRuns = bannerTitleRunsFromJSON(banner.TitleRunsJSON)
	return &banner, nil
}

// encodeBannerTitleRuns 把样式分段写入 title_runs 文本列；无分段时写空串，与「纯文本标题」区分。
func encodeBannerTitleRuns(banner *model.BannerAnnouncement) error {
	if len(banner.TitleRuns) == 0 {
		banner.TitleRunsJSON = ""
		return nil
	}
	encoded, err := json.Marshal(banner.TitleRuns)
	if err != nil {
		return err
	}
	banner.TitleRunsJSON = string(encoded)
	return nil
}

// decodeBannerTitleRuns 回填列表项的样式分段。
func decodeBannerTitleRuns(banners []model.BannerAnnouncement) {
	for index := range banners {
		banners[index].TitleRuns = bannerTitleRunsFromJSON(banners[index].TitleRunsJSON)
	}
}

// bannerTitleRunsFromJSON 解析 title_runs 列文本；空值或内容损坏时返回 nil，降级为纯文本标题，不阻断通知条展示。
func bannerTitleRunsFromJSON(raw string) []model.BannerTitleRun {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var runs []model.BannerTitleRun
	if err := json.Unmarshal([]byte(raw), &runs); err != nil {
		return nil
	}
	return runs
}

func (r *Repository) CreateBannerAnnouncement(banner *model.BannerAnnouncement) error {
	if err := encodeBannerTitleRuns(banner); err != nil {
		return err
	}
	return r.db.Create(banner).Error
}

func (r *Repository) UpdateBannerAnnouncement(banner *model.BannerAnnouncement) error {
	if err := encodeBannerTitleRuns(banner); err != nil {
		return err
	}
	updates := map[string]any{
		"title":       banner.Title,
		"title_runs":  banner.TitleRunsJSON,
		"notice_type": banner.NoticeType,
		"link":        banner.Link,
		"status":      banner.Status,
		"updated_at":  banner.UpdatedAt,
		"starts_at":   banner.StartsAt,
		"ends_at":     banner.EndsAt,
	}
	return r.db.Model(&model.BannerAnnouncement{}).
		Where("id = ?", banner.ID).
		Updates(updates).Error
}

func (r *Repository) DeleteBannerAnnouncement(id string) error {
	return r.db.Where("id = ?", id).Delete(&model.BannerAnnouncement{}).Error
}

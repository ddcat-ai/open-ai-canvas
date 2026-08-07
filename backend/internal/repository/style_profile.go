package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) StyleProfiles(userID string) ([]model.StyleProfile, error) {
	var profiles []model.StyleProfile
	err := r.db.Where("user_id = ?", userID).Order("favorite desc, updated_at desc").Find(&profiles).Error
	return profiles, err
}

func (r *Repository) StyleProfileCount(userID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.StyleProfile{}).Where("user_id = ?", userID).Count(&count).Error
	return count, err
}

func (r *Repository) StyleProfileForUser(userID string, id string) (*model.StyleProfile, error) {
	var profile model.StyleProfile
	if err := r.db.First(&profile, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &profile, nil
}

func (r *Repository) CreateStyleProfile(profile *model.StyleProfile) error {
	return r.db.Create(profile).Error
}

func (r *Repository) UpdateStyleProfile(profile *model.StyleProfile) error {
	return r.db.Model(&model.StyleProfile{}).Where("id = ? AND user_id = ?", profile.ID, profile.UserID).Updates(map[string]any{
		"name": profile.Name, "description": profile.Description, "cover_url": profile.CoverURL,
		"tags_json": profile.TagsJSON, "profile_json": profile.ProfileJSON, "revision": profile.Revision, "updated_at": profile.UpdatedAt,
	}).Error
}

func (r *Repository) SetStyleProfileFavorite(userID string, id string, favorite bool) error {
	result := r.db.Model(&model.StyleProfile{}).Where("id = ? AND user_id = ?", id, userID).Update("favorite", favorite)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) TouchStyleProfile(userID string, id string, usedAt time.Time) error {
	result := r.db.Model(&model.StyleProfile{}).Where("id = ? AND user_id = ?", id, userID).Update("last_used_at", usedAt)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) DeleteStyleProfile(userID string, id string) error {
	result := r.db.Delete(&model.StyleProfile{}, "id = ? AND user_id = ?", id, userID)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

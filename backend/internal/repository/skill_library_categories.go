package repository

import (
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const platformSkillLibraryCategoryOwnerID = "__platform__"

func (r *Repository) SkillLibraryCategories(userID string) ([]model.SkillLibraryCategory, error) {
	var categories []model.SkillLibraryCategory
	err := r.db.Where("scope = ? OR (scope = ? AND owner_id = ?)", "platform", "personal", userID).
		Order("CASE WHEN scope = 'platform' THEN 0 ELSE 1 END, normalized_name ASC, created_at ASC").
		Find(&categories).Error
	return categories, err
}

func (r *Repository) SkillLibraryCategory(id string) (*model.SkillLibraryCategory, error) {
	var category model.SkillLibraryCategory
	if err := r.db.First(&category, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &category, nil
}

// CreateSkillLibraryCategoryIfAvailable checks the user's visible namespace
// and inserts the category atomically. Platform names conflict with every
// personal name; personal names conflict with platform names and that user's
// personal names.
func (r *Repository) CreateSkillLibraryCategoryIfAvailable(userID string, category *model.SkillLibraryCategory) (bool, error) {
	if category.Scope == "platform" {
		category.OwnerID = platformSkillLibraryCategoryOwnerID
	}
	created := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		switch tx.Dialector.Name() {
		case "postgres":
			if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?)::bigint)", category.NormalizedName).Error; err != nil {
				return err
			}
		case "sqlite":
			// SQLite has no advisory locks. Begin with a write statement so
			// concurrent name checks cannot both pass before either insert.
			if err := tx.Exec("UPDATE skill_library_categories SET updated_at = updated_at WHERE 1 = 0").Error; err != nil {
				return err
			}
		default:
			return gorm.ErrInvalidData
		}

		query := tx.Model(&model.SkillLibraryCategory{}).Where("normalized_name = ?", category.NormalizedName)
		if category.Scope == "personal" {
			query = query.Where("(scope = ? OR (scope = ? AND owner_id = ?))", "platform", "personal", userID)
		}
		var count int64
		if err := query.Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return nil
		}
		if err := tx.Create(category).Error; err != nil {
			return err
		}
		created = true
		return nil
	})
	return created, err
}

func (r *Repository) DeleteSkillLibraryCategory(id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.UserSkillState{}).
			Where("library_category_id = ?", id).
			Update("library_category_id", "").Error; err != nil {
			return err
		}
		return tx.Delete(&model.SkillLibraryCategory{}, "id = ?", id).Error
	})
}

func (r *Repository) SkillLibraryCategoryCounts(userID string, scope string) (map[string]int64, error) {
	type categoryCount struct {
		CategoryID string `gorm:"column:library_category_id"`
		Count      int64  `gorm:"column:count"`
	}
	var rows []categoryCount
	query := r.db.Table("skills").
		Select("COALESCE(user_skill_states.library_category_id, '') AS library_category_id, COUNT(*) AS count").
		Joins("LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ?", userID).
		Where("skills.status = ?", 1)
	switch scope {
	case "mine":
		query = query.Where("skills.owner_id = ? OR (user_skill_states.added = ? AND skills.is_private = ?)", userID, true, false)
	case "created":
		query = query.Where("skills.owner_id = ?", userID)
	default:
		return nil, gorm.ErrInvalidData
	}
	if err := query.Group("user_skill_states.library_category_id").Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.CategoryID] = row.Count
	}
	return counts, nil
}

func (r *Repository) SetUserSkillLibraryCategory(state *model.UserSkillState) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "skill_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"library_category_id", "updated_at"}),
	}).Create(state).Error
}

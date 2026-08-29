package repository

import (
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func (r *Repository) CreateSkillWithPackage(skill *model.Skill, version *model.SkillVersion, files []model.SkillFile, ownerState *model.UserSkillState) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(skill).Error; err != nil {
			return err
		}
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if len(files) > 0 {
			if err := tx.Create(&files).Error; err != nil {
				return err
			}
		}
		return tx.Create(ownerState).Error
	})
}

func (r *Repository) AddSkillVersion(skill *model.Skill, version *model.SkillVersion, files []model.SkillFile) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if len(files) > 0 {
			if err := tx.Create(&files).Error; err != nil {
				return err
			}
		}
		return tx.Save(skill).Error
	})
}

func (r *Repository) SkillVersion(id string) (*model.SkillVersion, error) {
	var version model.SkillVersion
	if err := r.db.First(&version, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &version, nil
}

func (r *Repository) SkillFiles(versionID string) ([]model.SkillFile, error) {
	var files []model.SkillFile
	err := r.db.Where("skill_version_id = ?", versionID).Order("path asc").Find(&files).Error
	return files, err
}

func (r *Repository) SkillsForPackageEnsure(userSource int) ([]model.Skill, error) {
	var skills []model.Skill
	err := r.db.Where("status = ? AND (current_version_id = '' OR source <> ?)", 1, userSource).Find(&skills).Error
	return skills, err
}

func (r *Repository) AutoUpdatingGitHubSkills() ([]model.Skill, error) {
	var skills []model.Skill
	err := r.db.Where("status = ? AND source_type = ? AND auto_update = ?", 1, "github", true).Find(&skills).Error
	return skills, err
}

func (r *Repository) SaveSkill(skill *model.Skill) error {
	return r.db.Save(skill).Error
}

package repository

import (
	"time"

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

// SkillVersionByContentHash 按内容寻址查找某技能是否已存在相同内容的版本，用于安装/同步幂等。
func (r *Repository) SkillVersionByContentHash(skillID string, contentHash string) (*model.SkillVersion, error) {
	if contentHash == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var version model.SkillVersion
	err := r.db.Where("skill_id = ? AND content_hash = ?", skillID, contentHash).First(&version).Error
	if err != nil {
		return nil, err
	}
	return &version, nil
}

// ListSkillVersions 按创建时间倒序列出一个技能的全部历史版本。
func (r *Repository) ListSkillVersions(skillID string) ([]model.SkillVersion, error) {
	var versions []model.SkillVersion
	err := r.db.Where("skill_id = ?", skillID).Order("created_at DESC, id DESC").Find(&versions).Error
	return versions, err
}

// ActivateSkillVersion 在一个事务内把技能当前版本指针切换到指定版本，
// 并校验该版本确实属于该技能，避免跨技能误激活。
func (r *Repository) ActivateSkillVersion(skillID string, versionID string) (*model.SkillVersion, error) {
	var target model.SkillVersion
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&target, "id = ? AND skill_id = ?", versionID, skillID).Error; err != nil {
			return err
		}
		updates := map[string]interface{}{
			"current_version_id": target.ID,
			"version_label":      target.VersionLabel,
			"content_hash":       target.ContentHash,
			"file_count":         target.FileCount,
			"total_bytes":        target.TotalBytes,
			"updated_at":         time.Now(),
		}
		if err := tx.Model(&model.Skill{}).Where("id = ?", skillID).Updates(updates).Error; err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &target, nil
}

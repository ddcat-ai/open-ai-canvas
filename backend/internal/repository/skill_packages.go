package repository

import (
	"yingce/backend/internal/model"

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
		return tx.Omit(skillStatusColumn).Save(skill).Error
	})
}

// AddSkillVersionIfCurrent 以 current_version_id 做乐观锁：只有技能当前版本仍是 baseVersionID 时
// 才写入新版本、文件清单和技能行；返回 false 表示已被并发修改，事务内不做任何写入。
func (r *Repository) AddSkillVersionIfCurrent(skill *model.Skill, version *model.SkillVersion, files []model.SkillFile, baseVersionID string) (bool, error) {
	applied := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.Skill{}).Where("id = ? AND current_version_id = ?", skill.ID, baseVersionID).Update("current_version_id", version.ID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return nil
		}
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if len(files) > 0 {
			if err := tx.Create(&files).Error; err != nil {
				return err
			}
		}
		if err := tx.Omit(skillStatusColumn).Save(skill).Error; err != nil {
			return err
		}
		applied = true
		return nil
	})
	return applied, err
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

func (r *Repository) SkillsForPackageEnsure() ([]model.Skill, error) {
	var skills []model.Skill
	err := r.db.Where("status = ?", 1).Find(&skills).Error
	return skills, err
}

func (r *Repository) AutoUpdatingGitHubSkills() ([]model.Skill, error) {
	var skills []model.Skill
	err := r.db.Where("status = ? AND source_type = ? AND auto_update = ?", 1, "github", true).Find(&skills).Error
	return skills, err
}

// skillStatusColumn 只由 UpdateSkillStatus 修改：同步、编辑等整行保存可能持有下架前读出的旧行，不能把下架改回上架。
const skillStatusColumn = "status"

func (r *Repository) SaveSkill(skill *model.Skill) error {
	return r.db.Omit(skillStatusColumn).Save(skill).Error
}

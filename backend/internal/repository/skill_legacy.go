package repository

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// LegacySkillRetirement 描述一个旧内置技能要并入的稳定技能。
type LegacySkillRetirement struct {
	LegacyID string
	TargetID string
}

type LegacySkillRetirementReport struct {
	RetiredSkills []string
	SkippedSkills []string
	CreatedStates int
	MergedStates  int
}

const legacySkillMigrationPassLimit = 20

// RetireLegacyBuiltinSkills 在一个事务里把旧技能的用户状态并入稳定包，
// 然后删除旧包的状态、版本、文件和技能行。目标包不存在、下架或已删除时整条映射跳过，
// 保留旧数据供目标恢复后再次迁移。
func (r *Repository) RetireLegacyBuiltinSkills(items []LegacySkillRetirement, now time.Time) (LegacySkillRetirementReport, error) {
	return r.retireLegacyBuiltinSkills(items, now, legacySkillMigrationPassLimit)
}

func (r *Repository) retireLegacyBuiltinSkills(items []LegacySkillRetirement, now time.Time, migrationPasses int) (LegacySkillRetirementReport, error) {
	report := LegacySkillRetirementReport{}
	if len(items) == 0 {
		return report, nil
	}
	if now.IsZero() {
		now = time.Now().UTC()
	}
	err := r.db.Transaction(func(tx *gorm.DB) error {
		targetIDs := make([]string, 0, len(items))
		for _, item := range items {
			targetIDs = append(targetIDs, item.TargetID)
		}
		var targets []model.Skill
		if err := tx.Select("id", "status", "current_version_id").Where("id IN ?", targetIDs).Find(&targets).Error; err != nil {
			return err
		}
		targetByID := make(map[string]model.Skill, len(targets))
		for _, target := range targets {
			targetByID[target.ID] = target
		}
		var tombstones []model.BuiltinSkillTombstone
		if err := tx.Select("skill_id").Where("skill_id IN ?", targetIDs).Find(&tombstones).Error; err != nil {
			return err
		}
		tombstoned := make(map[string]struct{}, len(tombstones))
		for _, tombstone := range tombstones {
			tombstoned[tombstone.SkillID] = struct{}{}
		}

		for _, item := range items {
			target, exists := targetByID[item.TargetID]
			if !exists || target.Status != 1 || strings.TrimSpace(target.CurrentVersionID) == "" {
				report.SkippedSkills = append(report.SkippedSkills, item.LegacyID)
				continue
			}
			if _, deleted := tombstoned[item.TargetID]; deleted {
				report.SkippedSkills = append(report.SkippedSkills, item.LegacyID)
				continue
			}
			created, merged, err := migrateLegacySkillStates(tx, item.LegacyID, item.TargetID, target.CurrentVersionID, now, migrationPasses)
			if err != nil {
				return err
			}
			removed, err := retireLegacySkillRows(tx, item.LegacyID)
			if err != nil {
				return err
			}
			report.CreatedStates += created
			report.MergedStates += merged
			if removed || created+merged > 0 {
				report.RetiredSkills = append(report.RetiredSkills, item.LegacyID)
			}
		}
		return nil
	})
	return report, err
}

// migrateLegacySkillStates 分批合并用户状态；每批只读当前用户之后的行，
// 避免一次性把热门旧技能的全部用户读进内存。
func migrateLegacySkillStates(tx *gorm.DB, legacyID string, targetID string, targetVersion string, now time.Time, passLimit int) (int, int, error) {
	createdTotal := 0
	mergedTotal := 0
	// 第二轮用于兜底迁移期间并发写入的残留状态；正常情况下第二轮为空。
	for pass := 0; pass < passLimit; pass++ {
		processed := 0
		lastUserID := ""
		for {
			query := tx.Where("skill_id = ?", legacyID)
			if lastUserID != "" {
				query = query.Where("user_id > ?", lastUserID)
			}
			var states []model.UserSkillState
			if err := query.Order("user_id ASC").Limit(200).Find(&states).Error; err != nil {
				return createdTotal, mergedTotal, err
			}
			if len(states) == 0 {
				break
			}
			for index := range states {
				created, err := migrateLegacySkillState(tx, &states[index], targetID, targetVersion, now)
				if err != nil {
					return createdTotal, mergedTotal, err
				}
				if created {
					createdTotal++
				} else {
					mergedTotal++
				}
			}
			processed += len(states)
			lastUserID = states[len(states)-1].UserID
		}
		if processed == 0 {
			break
		}
	}
	var remaining int64
	if err := tx.Model(&model.UserSkillState{}).Where("skill_id = ?", legacyID).Count(&remaining).Error; err != nil {
		return createdTotal, mergedTotal, err
	}
	if remaining > 0 {
		return createdTotal, mergedTotal, fmt.Errorf("旧技能 %s 仍有 %d 条用户状态未迁移", legacyID, remaining)
	}
	return createdTotal, mergedTotal, nil
}

// migrateLegacySkillState 把一条旧状态并入目标状态；目标已有状态时按保守规则合并。
func migrateLegacySkillState(tx *gorm.DB, legacy *model.UserSkillState, targetID string, targetVersion string, now time.Time) (bool, error) {
	var target model.UserSkillState
	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		First(&target, "user_id = ? AND skill_id = ?", legacy.UserID, targetID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		created := model.UserSkillState{
			ID:                 kernel.NewID(),
			UserID:             legacy.UserID,
			SkillID:            targetID,
			LibraryCategoryID:  legacy.LibraryCategoryID,
			InstalledVersionID: targetVersion,
			AutoUpdate:         legacy.AutoUpdate,
			Added:              legacy.Added,
			Liked:              legacy.Liked,
			AgentMode:          legacy.AgentMode,
			AgentUseCount:      legacy.AgentUseCount,
			AgentLastUsedAt:    legacy.AgentLastUsedAt,
			CreatedAt:          legacy.CreatedAt,
			UpdatedAt:          now,
		}
		if created.CreatedAt.IsZero() {
			created.CreatedAt = now
		}
		result := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&created)
		if result.Error != nil {
			return false, result.Error
		}
		if result.RowsAffected > 0 {
			return true, tx.Delete(&model.UserSkillState{}, "id = ?", legacy.ID).Error
		}
		// 并发迁移先插入了目标状态，改为读回后合并。
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			First(&target, "user_id = ? AND skill_id = ?", legacy.UserID, targetID).Error; err != nil {
			return false, err
		}
	} else if err != nil {
		return false, err
	}

	mergeLegacySkillState(&target, legacy, targetVersion, now)
	if err := tx.Model(&model.UserSkillState{}).Where("id = ?", target.ID).Updates(map[string]any{
		"added":                target.Added,
		"liked":                target.Liked,
		"auto_update":          target.AutoUpdate,
		"agent_mode":           target.AgentMode,
		"agent_use_count":      target.AgentUseCount,
		"agent_last_used_at":   target.AgentLastUsedAt,
		"library_category_id":  target.LibraryCategoryID,
		"installed_version_id": target.InstalledVersionID,
		"created_at":           target.CreatedAt,
		"updated_at":           target.UpdatedAt,
	}).Error; err != nil {
		return false, err
	}
	return false, tx.Delete(&model.UserSkillState{}, "id = ?", legacy.ID).Error
}

func mergeLegacySkillState(target *model.UserSkillState, legacy *model.UserSkillState, targetVersion string, now time.Time) {
	target.Added = target.Added || legacy.Added
	target.Liked = target.Liked || legacy.Liked
	target.AutoUpdate = target.AutoUpdate || legacy.AutoUpdate
	switch {
	case target.AgentMode == model.UserSkillAgentModeManual || legacy.AgentMode == model.UserSkillAgentModeManual:
		// 任一旧状态要求手动，就保持手动，避免整合后 Agent 突然自动使用。
		target.AgentMode = model.UserSkillAgentModeManual
	case target.AgentMode == model.UserSkillAgentModeAuto || legacy.AgentMode == model.UserSkillAgentModeAuto:
		target.AgentMode = model.UserSkillAgentModeAuto
	default:
		target.AgentMode = ""
	}
	target.AgentUseCount += legacy.AgentUseCount
	if legacy.AgentLastUsedAt != nil && (target.AgentLastUsedAt == nil || legacy.AgentLastUsedAt.After(*target.AgentLastUsedAt)) {
		target.AgentLastUsedAt = legacy.AgentLastUsedAt
	}
	if target.LibraryCategoryID == "" {
		target.LibraryCategoryID = legacy.LibraryCategoryID
	}
	if targetVersion != "" {
		target.InstalledVersionID = targetVersion
	}
	if target.CreatedAt.IsZero() || (!legacy.CreatedAt.IsZero() && legacy.CreatedAt.Before(target.CreatedAt)) {
		target.CreatedAt = legacy.CreatedAt
	}
	target.UpdatedAt = now
}

// retireLegacySkillRows 删除旧技能的目录引用、版本文件和技能行，
// 返回值表示数据库里是否还有旧包痕迹需要清理。
func retireLegacySkillRows(tx *gorm.DB, skillID string) (bool, error) {
	var skillRows int64
	if err := tx.Model(&model.Skill{}).Where("id = ?", skillID).Count(&skillRows).Error; err != nil {
		return false, err
	}
	if err := tx.Delete(&model.SkillCurationAssignment{}, "skill_id = ?", skillID).Error; err != nil {
		return false, err
	}
	if err := tx.Delete(&model.SkillCurationRootAssignment{}, "skill_id = ?", skillID).Error; err != nil {
		return false, err
	}
	var versions []model.SkillVersion
	if err := tx.Select("id").Where("skill_id = ?", skillID).Find(&versions).Error; err != nil {
		return false, err
	}
	versionIDs := make([]string, 0, len(versions))
	for _, version := range versions {
		versionIDs = append(versionIDs, version.ID)
	}
	if len(versionIDs) > 0 {
		if err := tx.Delete(&model.SkillFile{}, "skill_version_id IN ?", versionIDs).Error; err != nil {
			return false, err
		}
	}
	if err := tx.Delete(&model.SkillVersion{}, "skill_id = ?", skillID).Error; err != nil {
		return false, err
	}
	result := tx.Delete(&model.Skill{}, "id = ?", skillID)
	if result.Error != nil && !errors.Is(result.Error, gorm.ErrRecordNotFound) {
		return false, result.Error
	}
	return skillRows > 0 || len(versionIDs) > 0, nil
}

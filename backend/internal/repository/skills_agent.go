package repository

import (
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// AgentSkillCatalogRow 是 Agent 技能目录需要的最小字段集：不取正文，避免每轮建目录时搬运整份 SKILL.md。
type AgentSkillCatalogRow struct {
	ID                string     `gorm:"column:id"`
	Name              string     `gorm:"column:name"`
	Description       string     `gorm:"column:description"`
	Tag               string     `gorm:"column:tag"`
	CurrentVersionID  string     `gorm:"column:current_version_id"`
	VersionLabel      string     `gorm:"column:version_label"`
	ContentHash       string     `gorm:"column:content_hash"`
	FileCount         int        `gorm:"column:file_count"`
	SortWeight        int        `gorm:"column:sort_weight"`
	OwnerID           string     `gorm:"column:owner_id"`
	InitialAddedCount int64      `gorm:"column:initial_added_count"`
	Added             bool       `gorm:"column:added"`
	AgentMode         string     `gorm:"column:agent_mode"`
	AgentUseCount     int64      `gorm:"column:agent_use_count"`
	AgentLastUsedAt   *time.Time `gorm:"column:agent_last_used_at"`
	InstalledAt       *time.Time `gorm:"column:installed_at"`
}

// SkillFilePathRow 是某个技能版本里的一个文件路径。
type SkillFilePathRow struct {
	SkillVersionID string `gorm:"column:skill_version_id"`
	Path           string `gorm:"column:path"`
	MimeType       string `gorm:"column:mime_type"`
	Size           int64  `gorm:"column:size"`
}

const agentSkillCatalogColumns = "skills.id, skills.name, skills.description, skills.tag, skills.current_version_id, skills.version_label, " +
	"skills.content_hash, skills.file_count, skills.sort_weight, skills.owner_id, skills.initial_added_count, " +
	"COALESCE(user_skill_states.added, false) AS added, " +
	"user_skill_states.agent_mode, COALESCE(user_skill_states.agent_use_count, 0) AS agent_use_count, " +
	"user_skill_states.agent_last_used_at, user_skill_states.created_at AS installed_at"

// AgentSkillCatalogRows 返回用户技能库中启用的技能（自建 + 已安装的公开技能），口径与“我的技能”一致。
func (r *Repository) AgentSkillCatalogRows(userID string) ([]AgentSkillCatalogRow, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, gorm.ErrRecordNotFound
	}
	var rows []AgentSkillCatalogRow
	err := r.db.Model(&model.Skill{}).
		Select(agentSkillCatalogColumns).
		Joins("LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ?", userID).
		Where("skills.status = ?", 1).
		Where("skills.owner_id = ? OR (user_skill_states.added = ? AND skills.is_private = ?)", userID, true, false).
		Order("skills.id ASC").
		Scan(&rows).Error
	return rows, err
}

// AgentSkillCatalogRowsByIDs 只取指定技能的目录字段，范围仍限于该用户可见的启用技能。
func (r *Repository) AgentSkillCatalogRowsByIDs(userID string, ids []string) ([]AgentSkillCatalogRow, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if len(ids) == 0 {
		return nil, nil
	}
	var rows []AgentSkillCatalogRow
	err := r.db.Model(&model.Skill{}).
		Select(agentSkillCatalogColumns).
		Joins("LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ?", userID).
		Where("skills.status = ? AND skills.id IN ?", 1, ids).
		Where("skills.owner_id = ? OR skills.is_private = ?", userID, false).
		Scan(&rows).Error
	return rows, err
}

// MarketSkillCatalogRows 返回该用户尚未安装的公开启用技能，用于在对话里推荐安装。
func (r *Repository) MarketSkillCatalogRows(userID string, limit int) ([]AgentSkillCatalogRow, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if limit <= 0 || limit > 2000 {
		limit = 2000
	}
	var rows []AgentSkillCatalogRow
	err := r.db.Model(&model.Skill{}).
		Select(agentSkillCatalogColumns).
		Joins("LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ?", userID).
		Where("skills.status = ? AND skills.is_private = ? AND skills.owner_id <> ?", 1, false, userID).
		Where("COALESCE(user_skill_states.added, ?) = ?", false, false).
		Order("skills.sort_weight DESC").Order("skills.id ASC").
		Limit(limit).
		Scan(&rows).Error
	return rows, err
}

// SetUserSkillAgentMode 只改 agent_mode，不触碰安装、收藏和分类状态。
func (r *Repository) SetUserSkillAgentMode(state *model.UserSkillState) error {
	if state == nil || strings.TrimSpace(state.UserID) == "" || strings.TrimSpace(state.SkillID) == "" {
		return gorm.ErrRecordNotFound
	}
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "skill_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"agent_mode", "updated_at"}),
	}).Create(state).Error
}

// RecordUserSkillAgentUse 记录 Agent 实际读取过这些技能；没有安装状态行的技能（如自建技能旧数据）忽略。
func (r *Repository) RecordUserSkillAgentUse(userID string, skillIDs []string, at time.Time) error {
	userID = strings.TrimSpace(userID)
	if userID == "" || len(skillIDs) == 0 {
		return nil
	}
	return r.db.Model(&model.UserSkillState{}).
		Where("user_id = ? AND skill_id IN ?", userID, skillIDs).
		Updates(map[string]any{"agent_use_count": gorm.Expr("COALESCE(agent_use_count, 0) + 1"), "agent_last_used_at": at}).Error
}

// SkillFilePathsByVersionIDs 一次取回多个技能版本的文件清单（不含内容）。
func (r *Repository) SkillFilePathsByVersionIDs(versionIDs []string) (map[string][]SkillFilePathRow, error) {
	result := make(map[string][]SkillFilePathRow, len(versionIDs))
	if len(versionIDs) == 0 {
		return result, nil
	}
	var rows []SkillFilePathRow
	if err := r.db.Model(&model.SkillFile{}).
		Select("skill_version_id, path, mime_type, size").
		Where("skill_version_id IN ?", versionIDs).
		Order("path ASC").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.SkillVersionID] = append(result[row.SkillVersionID], row)
	}
	return result, nil
}

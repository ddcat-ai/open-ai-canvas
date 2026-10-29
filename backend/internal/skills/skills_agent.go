package skills

import (
	"path"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// AgentSkillCatalogEntry 是 Agent 技能目录与检索使用的技能元数据，不含正文。
type AgentSkillCatalogEntry struct {
	SkillID     string     `json:"skillId"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Tag         string     `json:"tag"`
	VersionID   string     `json:"versionId"`
	Version     string     `json:"version"`
	ContentHash string     `json:"contentHash"`
	FileCount   int        `json:"fileCount"`
	SortWeight  int        `json:"sortWeight"`
	Owned       bool       `json:"owned"`
	Installed   bool       `json:"installed"`
	AgentMode   string     `json:"agentMode"`
	UseCount    int64      `json:"useCount"`
	LastUsedAt  *time.Time `json:"lastUsedAt,omitempty"`
	InstalledAt *time.Time `json:"installedAt,omitempty"`
	AddedCount  int64      `json:"addedCount,omitempty"`
}

// NormalizeSkillAgentMode 把空值和未知值都归为 auto，只有显式 manual 才退出自动发现。
func NormalizeSkillAgentMode(mode string) string {
	if strings.TrimSpace(mode) == model.UserSkillAgentModeManual {
		return model.UserSkillAgentModeManual
	}
	return model.UserSkillAgentModeAuto
}

func agentSkillCatalogEntry(userID string, row repository.AgentSkillCatalogRow) AgentSkillCatalogEntry {
	return AgentSkillCatalogEntry{
		SkillID: row.ID, Name: strings.TrimSpace(row.Name), Description: strings.TrimSpace(row.Description), Tag: row.Tag,
		VersionID: row.CurrentVersionID, Version: row.VersionLabel, ContentHash: row.ContentHash, FileCount: row.FileCount,
		SortWeight: row.SortWeight, Owned: row.OwnerID == userID, Installed: row.OwnerID == userID || row.Added, AgentMode: NormalizeSkillAgentMode(row.AgentMode),
		UseCount: row.AgentUseCount, LastUsedAt: row.AgentLastUsedAt, InstalledAt: row.InstalledAt, AddedCount: row.InitialAddedCount,
	}
}

// AgentSkillCatalog 返回用户技能库中所有已安装或自建、且启用的技能。
func (s *Service) AgentSkillCatalog(userID string) ([]AgentSkillCatalogEntry, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	rows, err := s.repo.AgentSkillCatalogRows(userID)
	if err != nil {
		return nil, err
	}
	entries := make([]AgentSkillCatalogEntry, 0, len(rows))
	for _, row := range rows {
		if strings.TrimSpace(row.CurrentVersionID) == "" {
			continue
		}
		entries = append(entries, agentSkillCatalogEntry(userID, row))
	}
	return entries, nil
}

// AgentSkillCatalogByIDs 只返回仍然可见且启用的指定技能。
func (s *Service) AgentSkillCatalogByIDs(userID string, ids []string) ([]AgentSkillCatalogEntry, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	rows, err := s.repo.AgentSkillCatalogRowsByIDs(userID, ids)
	if err != nil {
		return nil, err
	}
	entries := make([]AgentSkillCatalogEntry, 0, len(rows))
	for _, row := range rows {
		entries = append(entries, agentSkillCatalogEntry(userID, row))
	}
	return entries, nil
}

// MarketSkillCatalog 返回用户还没装的公开技能，只用于推荐安装，不授予读取正文的权限。
func (s *Service) MarketSkillCatalog(userID string) ([]AgentSkillCatalogEntry, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	rows, err := s.repo.MarketSkillCatalogRows(userID, 0)
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	metrics, err := s.repo.SkillMetrics(ids)
	if err != nil {
		return nil, err
	}
	entries := make([]AgentSkillCatalogEntry, 0, len(rows))
	for _, row := range rows {
		entry := agentSkillCatalogEntry(userID, row)
		entry.AddedCount = row.InitialAddedCount + metrics[row.ID].AddedCount
		entries = append(entries, entry)
	}
	return entries, nil
}

// SetSkillAgentMode 设置已安装技能是否允许 Agent 自动发现。
func (s *Service) SetSkillAgentMode(userID, id, mode string) (*SkillItem, error) {
	mode = strings.TrimSpace(mode)
	if mode != model.UserSkillAgentModeAuto && mode != model.UserSkillAgentModeManual {
		return nil, kernel.BadAuthRequest("Agent 使用方式只能是 auto 或 manual")
	}
	skill, err := s.visibleSkill(userID, id)
	if err != nil {
		return nil, err
	}
	state, err := s.skillState(userID, skill.ID)
	if err != nil {
		return nil, err
	}
	if skill.OwnerID != userID && !state.Added {
		return nil, kernel.BadAuthRequest("请先安装该技能，再设置 Agent 使用方式")
	}
	now := time.Now()
	state.AgentMode = mode
	state.UpdatedAt = now
	if state.CreatedAt.IsZero() {
		state.CreatedAt = now
	}
	if err := s.repo.SetUserSkillAgentMode(state); err != nil {
		return nil, err
	}
	return s.SkillDetail(userID, skill.ID)
}

// RecordSkillAgentUse 记录 Agent 本轮实际读取过的技能，用于目录排序；统计失败不影响读取结果。
func (s *Service) RecordSkillAgentUse(userID string, skillIDs []string) error {
	return s.repo.RecordUserSkillAgentUse(userID, skillIDs, time.Now())
}

// SkillVersionTextPaths 返回技能版本中可供 Agent 读取的文本文件路径（含 SKILL.md）。
// 二进制和脚本文件不列出：Agent 只读取文字资料，从不执行包内文件。
func (s *Service) SkillVersionTextPaths(versionIDs []string) (map[string][]string, error) {
	rows, err := s.repo.SkillFilePathsByVersionIDs(versionIDs)
	if err != nil {
		return nil, err
	}
	result := make(map[string][]string, len(rows))
	for versionID, files := range rows {
		paths := make([]string, 0, len(files))
		for _, file := range files {
			if AgentReadableSkillPath(file.Path) {
				paths = append(paths, file.Path)
			}
		}
		result[versionID] = paths
	}
	return result, nil
}

// AgentReadableSkillPath 是 Agent 可读文件的唯一判定：只读 Markdown、纯文本和 JSON。
func AgentReadableSkillPath(filePath string) bool {
	switch strings.ToLower(path.Ext(filePath)) {
	case ".md", ".txt", ".json":
		return true
	default:
		return false
	}
}

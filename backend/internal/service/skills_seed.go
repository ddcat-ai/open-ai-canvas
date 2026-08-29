package service

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

//go:embed seed/skills.json
var builtinSkillsJSON []byte

type builtinSkillDefinition struct {
	SkillID       string               `json:"skill_id"`
	SkillName     string               `json:"skill_name"`
	Description   string               `json:"description"`
	Instruction   string               `json:"instruction"`
	Status        int                  `json:"status"`
	MarkdownURL   string               `json:"markdown_url"`
	CreateTime    int64                `json:"create_time"`
	UpdateTime    int64                `json:"update_time"`
	Source        int                  `json:"source"`
	Tag           string               `json:"tag"`
	SortWeight    int                  `json:"sort_weight"`
	IsPrivate     bool                 `json:"is_private"`
	LikeCount     int64                `json:"like_count"`
	OwnerUID      string               `json:"owner_uid"`
	EffectiveUser SkillEffectiveUser   `json:"effective_user"`
	ShowcaseMedia []SkillShowcaseMedia `json:"showcase_media"`
	AddedCount    int64                `json:"added_count"`
	ExtraInfo     string               `json:"extra_info"`
}

// EnsureBuiltinSkills 校验并同步内置技能正文；用户关系独立保存，因此重复启动不会清空加入或收藏状态。
func (s *Service) EnsureBuiltinSkills() error {
	var definitions []builtinSkillDefinition
	if err := json.Unmarshal(builtinSkillsJSON, &definitions); err != nil {
		return fmt.Errorf("解析内置技能失败: %w", err)
	}
	if len(definitions) == 0 {
		return fmt.Errorf("内置技能不能为空")
	}

	seen := make(map[string]struct{}, len(definitions))
	skills := make([]model.Skill, 0, len(definitions))
	for _, definition := range definitions {
		id := strings.TrimSpace(definition.SkillID)
		ownerID := strings.TrimSpace(definition.OwnerUID)
		if id == "" || len(id) > 36 || ownerID == "" || len(ownerID) > 36 {
			return fmt.Errorf("内置技能 ID 或作者 ID 无效: %q", definition.SkillID)
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("内置技能 ID 重复: %s", id)
		}
		seen[id] = struct{}{}
		if definition.Status != skillStatusEnabled || definition.IsPrivate {
			return fmt.Errorf("内置技能必须为公开启用状态: %s", id)
		}
		if definition.CreateTime <= 0 || definition.UpdateTime <= 0 || definition.LikeCount < 0 || definition.AddedCount < 0 {
			return fmt.Errorf("内置技能时间或计数无效: %s", id)
		}
		authorName := strings.TrimSpace(definition.EffectiveUser.Name)
		authorAvatarURL := strings.TrimSpace(definition.EffectiveUser.AvatarURL)
		if authorName == "" || (authorAvatarURL != "" && !validSkillURL(authorAvatarURL)) {
			return fmt.Errorf("内置技能作者信息无效: %s", id)
		}
		normalized, mediaJSON, err := normalizeSkillMutationRequest(SkillMutationRequest{
			SkillName: definition.SkillName, Description: definition.Description, Instruction: definition.Instruction,
			Tag: definition.Tag, IsPrivate: definition.IsPrivate, MarkdownURL: definition.MarkdownURL,
			ShowcaseMedia: definition.ShowcaseMedia, ExtraInfo: definition.ExtraInfo,
		}, true)
		if err != nil {
			return fmt.Errorf("内置技能 %s 数据无效: %w", id, err)
		}
		skills = append(skills, model.Skill{
			ID: id, OwnerID: ownerID, AuthorName: authorName, AuthorAvatarURL: authorAvatarURL,
			Name: normalized.SkillName, Description: normalized.Description, Instruction: normalized.Instruction,
			Status: skillStatusEnabled, Source: definition.Source, Tag: normalized.Tag, SortWeight: definition.SortWeight,
			IsPrivate: false, MarkdownURL: normalized.MarkdownURL, ShowcaseMediaJSON: mediaJSON, ExtraInfo: normalized.ExtraInfo,
			InitialLikeCount: definition.LikeCount, InitialAddedCount: definition.AddedCount,
			CreatedAt: time.UnixMilli(definition.CreateTime), UpdatedAt: time.UnixMilli(definition.UpdateTime),
		})
	}
	if err := s.repo.UpsertBuiltinSkills(skills); err != nil {
		return fmt.Errorf("同步内置技能失败: %w", err)
	}
	return nil
}

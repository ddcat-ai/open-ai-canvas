package skills

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
)

//go:embed seed/recommendations.json
var builtinSkillRecommendationsJSON []byte

// 按行业推荐的内置技能（只读目录，随技能种子发布）。推荐只决定“建议安装什么”，
// 安装与否、安装后是否允许 Agent 自动使用，仍由用户在技能库里决定。

type skillRecommendationSeed struct {
	SkillID string `json:"skillId"`
	Reason  string `json:"reason"`
}

type skillRecommendationIndustrySeed struct {
	IndustryID  string                    `json:"industryId"`
	Name        string                    `json:"name"`
	Description string                    `json:"description"`
	Icon        string                    `json:"icon"`
	Skills      []skillRecommendationSeed `json:"skills"`
}

type skillRecommendationsFile struct {
	Version    int                               `json:"version"`
	Note       string                            `json:"note"`
	Industries []skillRecommendationIndustrySeed `json:"industries"`
}

type SkillRecommendationItem struct {
	SkillID     string `json:"skillId"`
	SkillName   string `json:"skillName"`
	Description string `json:"description"`
	Tag         string `json:"tag"`
	Reason      string `json:"reason"`
	IsAdded     bool   `json:"isAdded"`
}

type SkillRecommendationIndustry struct {
	IndustryID     string                    `json:"industryId"`
	Name           string                    `json:"name"`
	Description    string                    `json:"description"`
	Icon           string                    `json:"icon"`
	Skills         []SkillRecommendationItem `json:"skills"`
	InstalledCount int                       `json:"installedCount"`
}

type SkillRecommendationList struct {
	Industries []SkillRecommendationIndustry `json:"industries"`
	// InstalledTotal 是用户技能库里可用技能的总数，前端据此决定是否主动展示推荐入口。
	InstalledTotal int `json:"installedTotal"`
}

type SkillRecommendationInstallRequest struct {
	SkillIDs []string `json:"skillIds"`
}

type SkillRecommendationInstallResult struct {
	IndustryID string   `json:"industryId"`
	Installed  []string `json:"installed"`
	Skipped    []string `json:"skipped"`
}

const skillRecommendationMaxPerIndustry = 12

var skillRecommendationIcons = map[string]struct{}{
	"shapes": {}, "film": {}, "shopping-bag": {}, "megaphone": {}, "landmark": {}, "palette": {}, "users": {}, "wrench": {},
}

func loadSkillRecommendations() (skillRecommendationsFile, error) {
	var file skillRecommendationsFile
	if err := json.Unmarshal(builtinSkillRecommendationsJSON, &file); err != nil {
		return file, fmt.Errorf("解析行业推荐技能失败: %w", err)
	}
	if file.Version != 1 {
		return file, fmt.Errorf("行业推荐技能版本必须为 1，当前 %d", file.Version)
	}
	if len(file.Industries) == 0 {
		return file, fmt.Errorf("行业推荐技能不能为空")
	}
	seenIndustry := map[string]struct{}{}
	for _, industry := range file.Industries {
		id := strings.TrimSpace(industry.IndustryID)
		if !skillPresetIDPattern.MatchString(id) {
			return file, fmt.Errorf("行业推荐 ID 非法: %q", industry.IndustryID)
		}
		if _, dup := seenIndustry[id]; dup {
			return file, fmt.Errorf("行业推荐 ID 重复: %s", id)
		}
		seenIndustry[id] = struct{}{}
		if strings.TrimSpace(industry.Name) == "" || utf8.RuneCountInString(industry.Name) > 20 {
			return file, fmt.Errorf("行业推荐 %s 的名称为空或过长", id)
		}
		if _, ok := skillRecommendationIcons[industry.Icon]; !ok {
			return file, fmt.Errorf("行业推荐 %s 的图标非法: %q", id, industry.Icon)
		}
		if len(industry.Skills) == 0 || len(industry.Skills) > skillRecommendationMaxPerIndustry {
			return file, fmt.Errorf("行业推荐 %s 的技能数 %d 超出 1-%d", id, len(industry.Skills), skillRecommendationMaxPerIndustry)
		}
		seenSkill := map[string]struct{}{}
		for _, skill := range industry.Skills {
			if strings.TrimSpace(skill.SkillID) == "" {
				return file, fmt.Errorf("行业推荐 %s 含空技能 ID", id)
			}
			if _, dup := seenSkill[skill.SkillID]; dup {
				return file, fmt.Errorf("行业推荐 %s 的技能重复: %s", id, skill.SkillID)
			}
			seenSkill[skill.SkillID] = struct{}{}
			if reason := strings.TrimSpace(skill.Reason); reason == "" || utf8.RuneCountInString(reason) > 60 {
				return file, fmt.Errorf("行业推荐 %s 的技能 %s 推荐理由为空或超过 60 字", id, skill.SkillID)
			}
		}
	}
	return file, nil
}

// ValidateSkillRecommendations 确认推荐目录只引用内置技能，启动时校验，坏数据不上线。
func ValidateSkillRecommendations() error {
	file, err := loadSkillRecommendations()
	if err != nil {
		return err
	}
	seedIDs, err := builtinSeedSkillIDs()
	if err != nil {
		return fmt.Errorf("校验行业推荐引用失败: %w", err)
	}
	seeded := make(map[string]struct{}, len(seedIDs))
	for _, id := range seedIDs {
		seeded[id] = struct{}{}
	}
	for _, industry := range file.Industries {
		for _, skill := range industry.Skills {
			if _, ok := seeded[skill.SkillID]; !ok {
				return fmt.Errorf("行业推荐 %s 引用了非内置技能: %s", industry.IndustryID, skill.SkillID)
			}
		}
	}
	return nil
}

// SkillRecommendations 返回按行业分组的推荐技能及当前用户的安装状态；已删除或停用的技能不出现。
func (s *Service) SkillRecommendations(userID string) (*SkillRecommendationList, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	file, err := loadSkillRecommendations()
	if err != nil {
		return nil, err
	}
	ids := make([]string, 0, 48)
	for _, industry := range file.Industries {
		for _, skill := range industry.Skills {
			ids = append(ids, skill.SkillID)
		}
	}
	rows, err := s.repo.AgentSkillCatalogRowsByIDs(userID, ids)
	if err != nil {
		return nil, err
	}
	byID := make(map[string]int, len(rows))
	for index, row := range rows {
		byID[row.ID] = index
	}
	states, err := s.repo.UserSkillStatesBySkillIDs(userID, ids)
	if err != nil {
		return nil, err
	}
	added := make(map[string]bool, len(states))
	for _, state := range states {
		added[state.SkillID] = state.Added
	}
	installed, err := s.repo.AgentSkillCatalogRows(userID)
	if err != nil {
		return nil, err
	}
	list := &SkillRecommendationList{Industries: make([]SkillRecommendationIndustry, 0, len(file.Industries)), InstalledTotal: len(installed)}
	for _, industry := range file.Industries {
		group := SkillRecommendationIndustry{IndustryID: industry.IndustryID, Name: industry.Name, Description: industry.Description, Icon: industry.Icon, Skills: []SkillRecommendationItem{}}
		for _, seed := range industry.Skills {
			index, ok := byID[seed.SkillID]
			if !ok {
				continue
			}
			row := rows[index]
			isAdded := added[row.ID] || row.OwnerID == userID
			if isAdded {
				group.InstalledCount++
			}
			group.Skills = append(group.Skills, SkillRecommendationItem{
				SkillID: row.ID, SkillName: row.Name, Description: row.Description, Tag: row.Tag, Reason: seed.Reason, IsAdded: isAdded,
			})
		}
		if len(group.Skills) > 0 {
			list.Industries = append(list.Industries, group)
		}
	}
	return list, nil
}

// InstallSkillRecommendations 安装某个行业的推荐技能；skillIds 为空时安装该行业全部推荐。
// 已安装、已删除或不在该行业推荐里的技能计入 skipped，不报错。
func (s *Service) InstallSkillRecommendations(userID, industryID string, req SkillRecommendationInstallRequest) (*SkillRecommendationInstallResult, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	file, err := loadSkillRecommendations()
	if err != nil {
		return nil, err
	}
	industryID = strings.TrimSpace(industryID)
	var target *skillRecommendationIndustrySeed
	for index := range file.Industries {
		if file.Industries[index].IndustryID == industryID {
			target = &file.Industries[index]
			break
		}
	}
	if target == nil {
		return nil, kernel.NotFound("行业推荐不存在")
	}
	if len(req.SkillIDs) > skillRecommendationMaxPerIndustry {
		return nil, kernel.BadAuthRequest("一次最多安装 12 个推荐技能")
	}
	allowed := make(map[string]struct{}, len(target.Skills))
	for _, skill := range target.Skills {
		allowed[skill.SkillID] = struct{}{}
	}
	wanted := make([]string, 0, len(target.Skills))
	if len(req.SkillIDs) == 0 {
		for _, skill := range target.Skills {
			wanted = append(wanted, skill.SkillID)
		}
	} else {
		seen := map[string]struct{}{}
		for _, id := range req.SkillIDs {
			id = strings.TrimSpace(id)
			if _, dup := seen[id]; dup || id == "" {
				continue
			}
			seen[id] = struct{}{}
			wanted = append(wanted, id)
		}
	}
	result := &SkillRecommendationInstallResult{IndustryID: industryID, Installed: []string{}, Skipped: []string{}}
	for _, id := range wanted {
		if _, ok := allowed[id]; !ok {
			result.Skipped = append(result.Skipped, id)
			continue
		}
		item, err := s.SkillDetail(userID, id)
		if err != nil || item.Status != skillStatusEnabled {
			result.Skipped = append(result.Skipped, id)
			continue
		}
		if item.IsAdded {
			result.Skipped = append(result.Skipped, id)
			continue
		}
		if _, err := s.SetSkillAdded(userID, id, true); err != nil {
			return nil, err
		}
		result.Installed = append(result.Installed, id)
	}
	return result, nil
}

package skills

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

//go:embed seed/presets.json
var builtinSkillPresetsJSON []byte

// 场景预设（Scene Presets）：把「说人话的场景」映射到一组已启用技能，
// 让用户不必在 120+ 个技能里盲挑。v1 为只读目录，与技能种子同源发布。
//
// 分层契约：内容层（组合知识）在 judian-skills 的 presets.json 独立演进，
// 本文件只做加载、校验与分发；preset 引用一律用 skillId（编号一编永不变），
// 因此技能改名不影响预设有效性。
type SkillPreset struct {
	PresetID  string   `json:"presetId"`
	Name      string   `json:"name"`
	Scene     string   `json:"scene"`
	SkillIDs  []string `json:"skillIds"`
	Rationale string   `json:"rationale"`
	Source    string   `json:"source"`
	Evidence  string   `json:"evidence"`
	Upgrade   string   `json:"upgrade"`
}

type skillPresetsFile struct {
	Version int           `json:"version"`
	Updated string        `json:"updated"`
	Note    string        `json:"note"`
	Presets []SkillPreset `json:"presets"`
}

var skillPresetIDPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

var skillPresetScenes = map[string]struct{}{
	"drama": {}, "creative": {}, "ecommerce": {}, "social": {}, "others": {},
}

var skillPresetEvidence = map[string]struct{}{
	"E1": {}, "E2": {}, "E3": {}, "E4": {}, "E5": {},
}

// SkillPresets 返回校验合格的场景预设目录；数据非法时返回错误（启动即失败好过线上坏数据）。
func (s *Service) SkillPresets() ([]SkillPreset, error) {
	var file skillPresetsFile
	if err := json.Unmarshal(builtinSkillPresetsJSON, &file); err != nil {
		return nil, fmt.Errorf("解析场景预设失败: %w", err)
	}
	if file.Version != 1 {
		return nil, fmt.Errorf("场景预设版本必须为 1，当前 %d", file.Version)
	}
	if len(file.Presets) == 0 {
		return nil, fmt.Errorf("场景预设不能为空")
	}
	seeded := make(map[string]struct{}, 128)
	seedIDs, err := builtinSeedSkillIDs()
	if err != nil {
		return nil, fmt.Errorf("校验场景预设引用失败: %w", err)
	}
	for _, definition := range seedIDs {
		seeded[definition] = struct{}{}
	}
	seen := make(map[string]struct{}, len(file.Presets))
	for _, preset := range file.Presets {
		id := strings.TrimSpace(preset.PresetID)
		if !skillPresetIDPattern.MatchString(id) {
			return nil, fmt.Errorf("场景预设 ID 非法: %q", preset.PresetID)
		}
		if _, dup := seen[id]; dup {
			return nil, fmt.Errorf("场景预设 ID 重复: %s", id)
		}
		seen[id] = struct{}{}
		if strings.TrimSpace(preset.Name) == "" {
			return nil, fmt.Errorf("场景预设 %s 缺名称", id)
		}
		if _, ok := skillPresetScenes[preset.Scene]; !ok {
			return nil, fmt.Errorf("场景预设 %s 的分类非法: %q", id, preset.Scene)
		}
		if len(preset.SkillIDs) == 0 || len(preset.SkillIDs) > 8 {
			return nil, fmt.Errorf("场景预设 %s 的技能数 %d 超出 1-8（每轮激活上限）", id, len(preset.SkillIDs))
		}
		presetSeen := make(map[string]struct{}, len(preset.SkillIDs))
		for _, skillID := range preset.SkillIDs {
			if _, dup := presetSeen[skillID]; dup {
				return nil, fmt.Errorf("场景预设 %s 的技能重复: %s", id, skillID)
			}
			presetSeen[skillID] = struct{}{}
			// v1 硬约束：只允许引用种子市场已上架技能，避免用户一键挂载时遇到装不上的技能。
			if _, ok := seeded[skillID]; !ok {
				return nil, fmt.Errorf("场景预设 %s 引用了未上架技能: %s", id, skillID)
			}
		}
		if preset.Source != "hand-curated" {
			return nil, fmt.Errorf("场景预设 %s 的 source 必须为 hand-curated（v1 禁止遥测驱动）", id)
		}
		if _, ok := skillPresetEvidence[preset.Evidence]; !ok {
			return nil, fmt.Errorf("场景预设 %s 的证据等级非法: %q", id, preset.Evidence)
		}
		if rationale := strings.TrimSpace(preset.Rationale); rationale == "" || len([]rune(rationale)) > 200 {
			return nil, fmt.Errorf("场景预设 %s 的推荐理由为空或超过 200 字", id)
		}
	}
	return file.Presets, nil
}

// builtinSeedSkillIDs 从内置种子清单提取全部 skillId，供预设引用对账。
func builtinSeedSkillIDs() ([]string, error) {
	var definitions []builtinSkillDefinition
	if err := json.Unmarshal(builtinSkillsJSON, &definitions); err != nil {
		return nil, fmt.Errorf("解析内置技能失败: %w", err)
	}
	definitions = append(definitions, builtinImageEditingSkillDefinitions()...)
	ids := make([]string, 0, len(definitions))
	for _, definition := range definitions {
		if definition.Status != skillStatusEnabled || definition.IsPrivate {
			continue
		}
		if id := strings.TrimSpace(definition.SkillID); id != "" {
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil, fmt.Errorf("内置种子技能不能为空")
	}
	return ids, nil
}

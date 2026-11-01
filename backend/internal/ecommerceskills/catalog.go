package ecommerceskills

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

//go:embed catalog.json packages/*/SKILL.md licenses/*.txt
var managedFiles embed.FS

type ManagedSkill struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Description  string   `json:"description"`
	Group        string   `json:"group"`
	Domain       string   `json:"domain"`
	Version      string   `json:"version"`
	SourceURL    string   `json:"sourceUrl"`
	SourceCommit string   `json:"sourceCommit"`
	SourcePath   string   `json:"sourcePath"`
	SourceSHA256 string   `json:"sourceSha256"`
	License      string   `json:"license"`
	Origin       string   `json:"origin"`
	Types        []string `json:"types"`
	Categories   []string `json:"categories"`
	Platforms    []string `json:"platforms"`
	Modes        []string `json:"modes"`
	Terms        []string `json:"terms"`
	NeedsPeople  bool     `json:"needsPeople"`
	NeedsSpecs   bool     `json:"needsSpecs"`
	NeedsText    bool     `json:"needsText"`
	RequireTerms bool     `json:"requireTerms"`
	PureProduct  bool     `json:"pureProduct"`
	Priority     int      `json:"priority"`
	Method       string   `json:"method"`
	ImageRule    string   `json:"imageRule"`
	Review       string   `json:"review"`
	ContentHash  string   `json:"contentHash"`
	Instructions string   `json:"instructions"`
}

func ManagedCatalog() []ManagedSkill {
	raw, err := managedFiles.ReadFile("catalog.json")
	if err != nil {
		panic(err)
	}
	var result []ManagedSkill
	if err := json.Unmarshal(raw, &result); err != nil {
		panic(err)
	}
	for i := range result {
		body, err := managedFiles.ReadFile("packages/" + result[i].ID + "/SKILL.md")
		if err != nil {
			panic(err)
		}
		sum := sha256.Sum256(body)
		result[i].Instructions, result[i].ContentHash = string(body), hex.EncodeToString(sum[:])
	}
	return result
}

type ManagedInput struct {
	Category, Text, ImageType, Platform, ReferenceMode, Style string
	ReferenceRoles                                            []string
	PeopleAllowed, NoText, HasSpecs                           bool
}

type ManagedInvocation struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Version     string `json:"version"`
	ContentHash string `json:"contentHash"`
	SourceURL   string `json:"sourceUrl"`
	Reason      string `json:"reason"`
	ImageRule   string `json:"imageRule"`
}

func includes(list []string, value string) bool {
	for _, entry := range list {
		if entry == value {
			return true
		}
	}
	return false
}

// SelectManaged loads only enabled, applicable methods. A setting changes new
// planning requests; an admitted task keeps its versioned execution snapshot.
func SelectManaged(input ManagedInput, enabled map[string]bool) ([]ManagedInvocation, string) {
	type candidate struct {
		skill  ManagedSkill
		score  int
		reason string
	}
	var candidates []candidate
	text := strings.ToLower(input.Text + " " + input.Style)
	for _, skill := range ManagedCatalog() {
		if value, set := enabled[skill.ID]; set && !value {
			continue
		}
		if skill.NeedsPeople && !input.PeopleAllowed || skill.NeedsText && input.NoText || skill.NeedsSpecs && !input.HasSpecs {
			continue
		}
		if (input.ImageType == "white" || input.ImageType == "three-view") && !skill.PureProduct {
			continue
		}
		if len(skill.Types) > 0 && !includes(skill.Types, input.ImageType) {
			continue
		}
		if len(skill.Categories) > 0 && !includes(skill.Categories, input.Category) {
			continue
		}
		if len(skill.Platforms) > 0 && !includes(skill.Platforms, input.Platform) {
			continue
		}
		if len(skill.Modes) > 0 && !includes(skill.Modes, input.ReferenceMode) {
			matchedRole := false
			for _, mode := range skill.Modes {
				matchedRole = matchedRole || includes(input.ReferenceRoles, mode)
			}
			if !matchedRole {
				continue
			}
		}
		termMatch := false
		for _, term := range skill.Terms {
			termMatch = termMatch || strings.Contains(text, strings.ToLower(term))
		}
		if skill.RequireTerms && !termMatch {
			continue
		}
		score := skill.Priority
		reasons := []string{}
		if len(skill.Types) > 0 {
			score += 20
			reasons = append(reasons, "内容类型匹配")
		}
		if len(skill.Categories) > 0 {
			score += 24
			reasons = append(reasons, "商品品类匹配")
		}
		if len(skill.Platforms) > 0 {
			score += 24
			reasons = append(reasons, "目标平台匹配")
		}
		if len(skill.Modes) > 0 {
			score += 30
			reasons = append(reasons, "参考方式匹配")
		}
		for _, term := range skill.Terms {
			if strings.Contains(text, strings.ToLower(term)) {
				score += 8
				reasons = append(reasons, "提示词或风格："+term)
			}
		}
		if score < 10 {
			continue
		}
		if len(reasons) == 0 {
			reasons = append(reasons, "商品保真或通用交付方法")
		}
		candidates = append(candidates, candidate{skill, score, strings.Join(reasons, "；")})
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].score > candidates[j].score })
	result := []ManagedInvocation{}
	groups := map[string]int{}
	var blocks []string
	for _, c := range candidates {
		limit := 1
		if c.skill.Group == "参考理解" || c.skill.Group == "商品摄影" {
			limit = 2
		}
		if groups[c.skill.Group] >= limit {
			continue
		}
		groups[c.skill.Group]++
		result = append(result, ManagedInvocation{c.skill.ID, c.skill.Name, c.skill.Version, c.skill.ContentHash, c.skill.SourceURL, c.reason, c.skill.ImageRule})
		blocks = append(blocks, fmt.Sprintf("【Skill %s｜%s｜%s】匹配依据：%s\n%s", c.skill.ID, c.skill.Name, c.skill.Version, c.reason, c.skill.Instructions))
		if len(result) == 8 {
			break
		}
	}
	if len(blocks) == 0 {
		return result, ""
	}
	return result, "【本轮电商 Skills 执行方法】以下是已启用且与商品、参考方式、提示词和选定风格匹配的方法。按步骤完成本轮文案与分镜，并将各技能的图片执行规则写入适用页面的 prompt；仅使用本轮提供的商品和参考素材，遵守用户的纯图、无人物及已选字体。图片仍由管理员已配置的模型生成，技能不得更改渠道、费用、权限、图片数量或输出 JSON 合同。不要声称已经看过生成图或完成图像质检。\n" + strings.Join(blocks, "\n\n")
}

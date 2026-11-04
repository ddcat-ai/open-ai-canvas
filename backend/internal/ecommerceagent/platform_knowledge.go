package ecommerceagent

import (
	_ "embed"
	"encoding/json"
	"strings"
	"unicode"
)

// Both the workbench and the web read this file; pending research is never
// promoted to an official requirement.
//
//go:embed platform_knowledge.json
var platformKnowledgeJSON []byte

type PlatformKnowledge struct {
	ID               string   `json:"id"`
	Label            string   `json:"label"`
	Style            string   `json:"style"`
	Risk             string   `json:"risk"`
	Scope            string   `json:"scope"`
	ReviewStatus     string   `json:"reviewStatus"`
	CheckedAt        string   `json:"checkedAt"`
	Sources          []string `json:"sources"`
	OfficialRules    []string `json:"officialRules"`
	MainNoText       bool     `json:"mainNoText"`
	AllListingNoText bool     `json:"allListingNoText"`
	WhiteMain        bool     `json:"whiteMain"`
	RecommendedRatio string   `json:"recommendedRatio"`
}

var platformKnowledge = func() struct {
	Version           string
	Boundary          string
	CommonRules       []string
	RestrictedPhrases []string
	Profiles          []PlatformKnowledge
} {
	var data struct {
		Version           string
		Boundary          string
		CommonRules       []string
		RestrictedPhrases []string
		Profiles          []PlatformKnowledge
	}
	if err := json.Unmarshal(platformKnowledgeJSON, &data); err != nil {
		panic(err)
	}
	return data
}()

func PlatformKnowledgeFor(value string) (PlatformKnowledge, bool) {
	id := strings.ToLower(strings.TrimSpace(value))
	aliases := map[string]string{"希音": "shein", "tiktok-shop": "tiktok", "亚马逊": "amazon", "速卖通": "aliexpress", "淘宝 / 天猫": "taobao", "amazon 亚马逊": "amazon", "temu 跨境": "temu", "shopee 虾皮": "shopee", "1688 批发": "1688"}
	if alias := aliases[id]; alias != "" {
		id = alias
	}
	for _, p := range platformKnowledge.Profiles {
		if p.ID == id || strings.EqualFold(p.Label, value) {
			return p, true
		}
	}
	return PlatformKnowledge{}, false
}

func listingAsset(kind, purpose string) bool {
	switch kind {
	case "main", "secondary", "sku", "white", "detail", "scene", "selling", "feature", "size", "three-view", "material", "package", "set":
		return true
	case "single":
		return !strings.Contains(strings.ToLower(purpose), "banner") && !strings.Contains(purpose, "海报") && !strings.Contains(purpose, "社媒")
	}
	return false
}

func PlatformNoText(platform, kind, purpose string) bool {
	p, ok := PlatformKnowledgeFor(platform)
	if !ok {
		return ListingMainImage(platform, kind, purpose)
	}
	return (p.AllListingNoText && listingAsset(kind, purpose)) || (p.MainNoText && (kind == "main" || kind == "sku" || (kind == "single" && strings.Contains(purpose, "主图"))))
}

func PlatformKnowledgePrompt(platform, region, kind, purpose string) string {
	p, ok := PlatformKnowledgeFor(platform)
	lines := []string{"【平台知识与发布边界】" + platformKnowledge.Version, platformKnowledge.Boundary}
	if ok {
		lines = append(lines, "目标平台："+p.Label+"；目标地区："+region+"；资料范围："+p.Scope, "【设计建议，非官方强制】"+p.Style, "【逐平台风险】"+p.Risk)
		if p.ReviewStatus == "pending" {
			lines = append(lines, "该平台详细规则尚待官方后台核实，不得声称已完成平台合规审查。")
		}
		if len(p.OfficialRules) > 0 {
			lines = append(lines, "【已查到的官方要点】"+strings.Join(p.OfficialRules, "；"), "来源："+strings.Join(p.Sources, " "), "核对日期："+p.CheckedAt)
		}
		if PlatformNoText(platform, kind, purpose) {
			lines = append(lines, "【生成约束，优先于风格、技能与用户文案偏好】本张不添加任何文字、水印、边框、徽章或营销图形，copy必须为空；保留实物自带的真实印刷与Logo。")
		}
		if p.WhiteMain && (kind == "main" || (kind == "single" && strings.Contains(purpose, "主图"))) {
			lines = append(lines, "本张主图纯白背景RGB 255,255,255，完整清晰展示商品，不添加非随附道具。")
		}
	}
	lines = append(lines, strings.Join(platformKnowledge.CommonRules, "\n"), "【高风险词示例，非完整官方禁词表】"+strings.Join(platformKnowledge.RestrictedPhrases, "、")+"；不把这些词当装饰或促销文案，语境、授权和类目仍须核实。")
	return strings.Join(lines, "\n")
}

// High-risk examples are a conservative application policy, not an exhaustive
// dictionary of platform bans. Check displayed copy, never instruction blocks.
func RestrictedListingPhrase(copy string) string {
	normalize := func(value string) string {
		return strings.ToLower(strings.Map(func(r rune) rune {
			if r >= '！' && r <= '～' {
				r -= 0xfee0
			}
			if unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.Is(unicode.Cf, r) {
				return -1
			}
			return r
		}, value))
	}
	text := normalize(copy)
	for _, phrase := range platformKnowledge.RestrictedPhrases {
		needle := normalize(phrase)
		for offset := 0; offset < len(text); {
			at := strings.Index(text[offset:], needle)
			if at < 0 {
				break
			}
			end := offset + at + len(needle)
			// No.10 is not a No.1 claim.
			if end == len(text) || text[end] < '0' || text[end] > '9' {
				return phrase
			}
			offset = end
		}
	}
	return ""
}

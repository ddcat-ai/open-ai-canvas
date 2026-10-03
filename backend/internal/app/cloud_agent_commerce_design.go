package app

import (
	"encoding/hex"
	"fmt"
	"strings"
)

type cloudAgentCommerceStyleLock struct {
	FontFamily      string `json:"fontFamily"`
	Typography      string `json:"typography"`
	HeadingColor    string `json:"headingColor"`
	BodyColor       string `json:"bodyColor"`
	AccentColor     string `json:"accentColor"`
	BackgroundColor string `json:"backgroundColor"`
	IconStyle       string `json:"iconStyle"`
}

func cloudAgentCommerceStyleLockSchema() map[string]any {
	properties := map[string]any{}
	for key, description := range map[string]string{
		"fontFamily":   "整套共用的一种字体家族，支持目标语言；不能逐图换字体",
		"typography":   "固定标题/副标题/标签/正文的字重、字号比例与层级；逐图位置变化写入 composition",
		"headingColor": "标题文字颜色", "bodyColor": "正文和标签颜色", "accentColor": "强调与图标颜色", "backgroundColor": "信息模块/图形区域的背景色，不重染产品和实拍场景",
		"iconStyle": "共用图标形状、描边/填充与线条粗细",
	} {
		field := map[string]any{"type": "string", "minLength": 1, "maxLength": 600, "description": description}
		if strings.HasSuffix(key, "Color") {
			field["pattern"] = "^#[0-9A-Fa-f]{6}$"
		}
		properties[key] = field
	}
	return map[string]any{"type": "object", "additionalProperties": false, "description": "整套图片的字体、文字色、强调色和图标锁定。新的图片方案应填写；所有图片引用同一份锁定，优先于逐图 typography/palette。旧计划允许省略。", "properties": properties, "required": []string{"fontFamily", "typography", "headingColor", "bodyColor", "accentColor", "backgroundColor", "iconStyle"}}
}

func validateCloudAgentCommerceStyleLock(lock *cloudAgentCommerceStyleLock) error {
	if lock == nil {
		return nil
	}
	for _, value := range []string{lock.FontFamily, lock.Typography, lock.IconStyle} {
		if strings.TrimSpace(value) == "" || len([]rune(value)) > 600 {
			return BadAuthRequest("风格锁定须填写共用字体、文字层级和图标样式，每项不超过 600 字")
		}
	}
	for _, color := range []string{lock.HeadingColor, lock.BodyColor, lock.AccentColor, lock.BackgroundColor} {
		if len(color) != 7 || color[0] != '#' {
			return BadAuthRequest("风格锁定颜色须为 #RRGGBB，不使用模糊颜色或多选颜色")
		}
		if _, err := hex.DecodeString(color[1:]); err != nil {
			return BadAuthRequest("风格锁定颜色须为 #RRGGBB")
		}
	}
	return nil
}

func cloudAgentCommerceStyleLockPrompt(lock *cloudAgentCommerceStyleLock) string {
	return fmt.Sprintf("Shared set style lock (identical for every image; layout varies, fonts and graphic colors do not):\nFont family: %s\nType hierarchy and weights: %s\nHeading color: %s; body/label color: %s; accent/icon color: %s; graphic-panel background: %s\nIcon system: %s\nApply this lock to designed text, icons and graphic panels. Preserve the product and photographic scene's natural colors. A text-free image remains text-free; Amazon MAIN keeps its required pure white background. Do not print these instructions, font names or color codes.", lock.FontFamily, lock.Typography, lock.HeadingColor, lock.BodyColor, lock.AccentColor, lock.BackgroundColor, lock.IconStyle)
}

// These fields are reviewed and hashed with the plan, then compiled verbatim.
type cloudAgentCommerceDesign struct {
	Role        string `json:"role"`
	Layout      string `json:"layout"`
	FocalPoint  string `json:"focalPoint"`
	Composition string `json:"composition"`
	Typography  string `json:"typography"`
	Palette     string `json:"palette"`
}

var cloudAgentCommerceLayouts = []string{"product_only", "hero_lifestyle", "feature_infographic", "detail_callout", "multi_scene", "comparison", "specification", "lifestyle_finish", "custom"}

func cloudAgentCommerceDesignSchema() map[string]any {
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "maxLength": 2000, "description": description}
	}
	return map[string]any{"type": "object", "additionalProperties": false, "description": "图片交付项必须逐项规划的视觉结构；4 张及以上至少 3 种版式。旧计划可不含此字段。字段为执行模型理解的设计语言，不含中文审核翻译。", "properties": map[string]any{
		"role":        map[string]any{"type": "string", "enum": []string{"main", "secondary", "a_plus", "banner", "other"}},
		"layout":      map[string]any{"type": "string", "enum": cloudAgentCommerceLayouts},
		"focalPoint":  str("一个核心卖点、视觉焦点与证据；不使用空泛的高级好看"),
		"composition": str("具体分区、主体占比、角度/景别、局部特写/信息模块数量和位置、留白与阅读路径"),
		"typography":  str("主副标题位置与大小关系、字重、图标/引线方式、手机可读性；无字主图明确不放文字"),
		"palette":     str("背景、文字和强调色；整套统一，按该图信息目的变化"),
	}, "required": []string{"role", "layout", "focalPoint", "composition", "typography", "palette"}}
}

func validateCloudAgentCommerceDesign(plan *cloudAgentCommercePlan) error {
	if err := validateCloudAgentCommerceStyleLock(plan.StyleLock); err != nil {
		return err
	}
	hasDesign := false
	for _, item := range plan.Items {
		hasDesign = hasDesign || item.Design != nil
	}
	if !hasDesign {
		return nil
	} // Persisted plans retain their original immutable inputs.
	layouts := map[string]bool{}
	images := 0
	for _, item := range plan.Items {
		if item.Type != "image" {
			if item.Design != nil {
				return BadAuthRequest("逐图视觉设计仅适用于图片交付项")
			}
			continue
		}
		images++
		design := item.Design
		if design == nil {
			return BadAuthRequest("图片方案须为每张图填写完整 design 视觉结构，不能只规划部分图片")
		}
		if design.Role != "main" && design.Role != "secondary" && design.Role != "a_plus" && design.Role != "banner" && design.Role != "other" {
			return BadAuthRequest("图片视觉设计的 role 无效")
		}
		validLayout := false
		for _, layout := range cloudAgentCommerceLayouts {
			validLayout = validLayout || layout == design.Layout
		}
		if !validLayout {
			return BadAuthRequest("图片视觉设计的 layout 无效")
		}
		for _, value := range []string{design.FocalPoint, design.Composition, design.Typography, design.Palette} {
			if strings.TrimSpace(value) == "" || len([]rune(value)) > 2000 {
				return BadAuthRequest("逐图视觉设计须包含焦点、构图、排版和配色，每项不超过 2000 字")
			}
		}
		if plan.Platform == "amazon" && design.Role == "main" && (design.Layout != "product_only" || strings.TrimSpace(item.TargetCopy) != "") {
			return BadAuthRequest("Amazon 白底主图采用 product_only 且不能包含营销文案；场景和信息图请标为 secondary")
		}
		layouts[design.Layout] = true
	}
	if images >= 4 && len(layouts) < 3 {
		return BadAuthRequest("套图版式过于重复；4 张及以上图片至少规划 3 种不同版式，不要仅更换同一房间和标题")
	}
	return nil
}

func cloudAgentCommerceDesignPrompt(design *cloudAgentCommerceDesign) string {
	prompt := fmt.Sprintf("Image role: %s; layout family: %s.\nVisual focus: %s\nComposition: %s\nTypography: %s\nPalette: %s", design.Role, design.Layout, design.FocalPoint, design.Composition, design.Typography, design.Palette)
	if design.Role == "secondary" {
		prompt += "\nThis is a secondary gallery image; main-image white-background and 85% occupancy requirements are not this image's layout instructions."
	}
	return prompt
}

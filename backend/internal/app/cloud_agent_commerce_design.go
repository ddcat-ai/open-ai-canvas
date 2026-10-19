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
	return map[string]any{"type": "object", "additionalProperties": false, "description": "可选。仅在本组图片确需共用字体、文字色和图标时填写；无字商品图或用户要求不同风格时可省略。填写后优先于逐图 typography/palette。", "properties": properties, "required": []string{"fontFamily", "typography", "headingColor", "bodyColor", "accentColor", "backgroundColor", "iconStyle"}}
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
	return fmt.Sprintf("Shared set style lock (identical for every image; layout varies, fonts and graphic colors do not):\nFont family: %s\nType hierarchy and weights: %s\nHeading color: %s; body/label color: %s; accent/icon color: %s; graphic-panel background: %s\nIcon system: %s\nApply this lock to designed text, icons and graphic panels. Preserve the product and photographic scene's natural colors. A text-free image remains text-free. Background and composition follow this item's approved purpose. Do not print these instructions, font names or color codes.", lock.FontFamily, lock.Typography, lock.HeadingColor, lock.BodyColor, lock.AccentColor, lock.BackgroundColor, lock.IconStyle)
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

func cloudAgentCommerceDesignSchema() map[string]any {
	str := func(description string) map[string]any {
		return map[string]any{"type": "string", "maxLength": 2000, "description": description}
	}
	return map[string]any{"type": "object", "additionalProperties": false, "description": "可选的逐图视觉结构。用途和版式按用户目标规划；SKU、角度、颜色或语言变体可以保持相同构图，不强制版式数量。字段为设计指令，不含中文审核翻译。", "properties": map[string]any{
		"role":        map[string]any{"type": "string", "minLength": 1, "maxLength": 120, "description": "该图用途，例如 main、secondary、sku、详情长图、社交封面；不限枚举"},
		"layout":      map[string]any{"type": "string", "minLength": 1, "maxLength": 120, "description": "适合该图的版式名称，例如 product_only、场景图、统一正面属性图；不限枚举"},
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
	for _, item := range plan.Items {
		if item.Type != "image" {
			if item.Design != nil {
				return BadAuthRequest("逐图视觉设计仅适用于图片交付项")
			}
			continue
		}
		design := item.Design
		if design == nil {
			continue
		}
		for _, value := range []string{design.Role, design.Layout} {
			if strings.TrimSpace(value) == "" || len([]rune(value)) > 120 {
				return BadAuthRequest("图片视觉用途和版式须为 1 至 120 字")
			}
		}
		for _, value := range []string{design.FocalPoint, design.Composition, design.Typography, design.Palette} {
			if strings.TrimSpace(value) == "" || len([]rune(value)) > 2000 {
				return BadAuthRequest("逐图视觉设计须包含焦点、构图、排版和配色，每项不超过 2000 字")
			}
		}
		if (strings.EqualFold(plan.Platform, "amazon") || plan.Platform == "亚马逊") && design.Role == "main" && (design.Layout != "product_only" || strings.TrimSpace(item.TargetCopy) != "") {
			return BadAuthRequest("Amazon 白底主图采用 product_only 且不能包含营销文案；场景和信息图请标为 secondary")
		}
	}
	return nil
}

func cloudAgentCommerceDesignPrompt(design *cloudAgentCommerceDesign) string {
	return fmt.Sprintf("Image role: %s; layout family: %s.\nVisual focus: %s\nComposition: %s\nTypography: %s\nPalette: %s", design.Role, design.Layout, design.FocalPoint, design.Composition, design.Typography, design.Palette)
}

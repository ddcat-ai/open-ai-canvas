package ecommerceagent

import (
	"encoding/json"
	"fmt"
	"strings"
)

func BuildVisionPrompt(req Request) string {
	query := req.Query
	if query == "" {
		query = "（无文字描述，请完全依据图片判断）"
	}
	parts := []string{"【卖家描述】" + query, "【目标平台】" + req.Platform, "【目标语言】" + req.Language}
	if req.Brand.BrandName != "" {
		brand := "【品牌】" + req.Brand.BrandName
		if req.Brand.StyleDesc != "" {
			brand += "；品牌调性：" + req.Brand.StyleDesc
		}
		parts = append(parts, brand)
	}
	return strings.Join(append(parts, "请输出 JSON。"), "\n")
}

func platformRuleLines(p Platform) string {
	var out []string
	for _, rule := range p.Rules {
		out = append(out, "- "+rule)
	}
	return strings.Join(out, "\n")
}

func prettyJSON(value any) string {
	raw, _ := json.MarshalIndent(value, "", "  ")
	return string(raw)
}

func BuildCopyPrompt(brief Brief, p Platform, language, userSellingPoints string) string {
	prompt := fmt.Sprintf("\n【商品结构化信息】\n%s\n\n【目标平台】%s\n【目标语言】%s\n【平台文案限制】标题 ≤ %d 字符；卖点条数 ≤ %d；调性：%s\n【平台合规红线】\n%s", prettyJSON(brief), p.Label, language, p.TitleMax, p.BulletMax, p.Tone, platformRuleLines(p))
	if userSellingPoints != "" {
		prompt += "\n【卖家自己强调的卖点（优先级最高，必须体现）】\n" + userSellingPoints
	}
	return prompt + "\n" + ProductPlanningKnowledge(brief.Category) + "\n\n请输出 JSON。"
}

func BuildRecommendPrompt(brief Brief, p Platform, language string, styles []Style) string {
	prompt := fmt.Sprintf("\n【商品】%s\n【目标平台】%s｜主图比例 %s｜详情页比例 %s\n【首图是否允许文字】%s\n【平台合规红线】\n%s\n【目标语言】%s", prettyJSON(brief), p.Label, p.Ratio, p.DetailRatio, map[bool]string{true: "否（首图必须纯画面）", false: "是"}[p.ForbidTextOnMain], platformRuleLines(p), language)
	if len(styles) > 0 {
		prompt += "\n【可选风格库（可复用命名，也可自创）】"
		for _, style := range styles {
			prompt += "\n- " + style.Name + "：" + style.Desc
		}
	}
	return prompt + "\n\n请输出 4-6 个方向的 JSON 数组。"
}

func BuildPlannerPrompt(copy any, pages []Page, p Platform, language string, brief Brief) string {
	var lines []string
	lines = append(lines, ProductPlanningKnowledge(brief.Category))
	lines = append(lines, platformRuleLines(p))
	for i, page := range pages {
		mustShow, avoid := strings.Join(page.MustShow, "、"), strings.Join(page.Avoid, "、")
		if mustShow == "" {
			mustShow = "无"
		}
		if avoid == "" {
			avoid = "无"
		}
		allowed := "否"
		if page.NeedText {
			allowed = "是"
		}
		lines = append(lines, fmt.Sprintf("%d. role=%s\n   目标：%s\n   机位：%s\n   文字区：%s\n   必须露出：%s\n   禁止出现：%s\n   允许文字：%s", i+1, page.Role, page.Goal, page.Shot, page.TextZone, mustShow, avoid, allowed))
	}
	mainText := "是"
	if p.ForbidTextOnMain {
		mainText = "否（首图纯画面，禁止任何文字/角标）"
	}
	return fmt.Sprintf("\n【商品】%s\n【文案方案】\n%s\n\n【页面骨架（顺序固定，不要增删，标题可微调但 role 不变）】\n%s\n\n【页数】共 %d 页\n【平台】%s｜主图比例 %s｜详情页比例 %s\n【目标语言】%s\n【首图是否允许文字】%s\n\n请严格输出 JSON 数组，长度必须等于 %d。", brief.Category, prettyJSON(copy), strings.Join(lines, "\n"), len(pages), p.Label, p.Ratio, p.DetailRatio, language, mainText, len(pages))
}

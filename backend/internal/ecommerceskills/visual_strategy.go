package ecommerceskills

import (
	"encoding/json"
	"strings"
)

// VisualStrategySkill turns one creative direction plus its knowledge basis
// (KB03/KB06/KB07/...) into a fixed visual lock that every image of the set
// must repeat.
type VisualStrategySkill struct{}

type VisualStrategyInput struct {
	CategoryKey    string         `json:"categoryKey"`
	DirectionName  string         `json:"directionName"`
	Mode           string         `json:"mode"`
	Palette        []string       `json:"palette"`
	Lighting       string         `json:"lighting"`
	Layout         string         `json:"layout"`
	VisualEmphasis []string       `json:"visualEmphasis"`
	Knowledge      []KnowledgeRef `json:"knowledge"`
}

type VisualStrategyOutput struct {
	DirectionName    string   `json:"directionName"`
	Mode             string   `json:"mode"`
	ColorPalette     []string `json:"colorPalette"`
	LightingApproach string   `json:"lightingApproach"`
	CompositionStyle string   `json:"compositionStyle"`
	LayoutPrinciple  string   `json:"layoutPrinciple"`
	ProductEmphasis  []string `json:"productEmphasis"`
	KnowledgeMethods []string `json:"knowledgeMethods"`
	KnowledgeBasis   []string `json:"knowledgeBasis"`
	PromptLock       string   `json:"promptLock"`
}

var modeComposition = map[string]string{
	"hero":        "商品居中或三分线主位，占画面约 60%，背景单纯、留出标题安全区",
	"lifestyle":   "前中后景分层，人物或环境只做尺度与使用关系，商品不被遮挡",
	"creative":    "对角线或偏轴动势构图，图形元素服务节奏，商品轮廓完整清晰",
	"feature":     "主图加局部放大窗或引线，信息分区明确，移动端可读",
	"macro":       "近景或微距聚焦可见结构与材质，浅景深只虚化背景",
	"editorial":   "杂志式网格与大留白，图文错位，商品为视觉锚点",
	"documentary": "自然抓拍视角，动作真实连续，商品接触关系可信",
	"scale":       "以家具或日常物件建立真实比例，平视或微俯机位",
	"desk":        "俯拍或 45° 桌面构图，装备有序排布，商品为主体",
	"display":     "陈列式构图，道具克制、层次高低错落",
	"table":       "餐桌平视或俯拍，餐具与留白建立节奏",
	"gift":        "静物陈列，高低错落，不添加虚构赠品",
	"lab":         "精确几何背景与对称构图，冷暖光分区",
	"instruction": "分镜式步骤排列，每格一个动作",
}

var categoryPalette = map[string][]string{
	"maternal":  {"奶油白 #FFF8EE", "柔杏 #F6DCC2", "雾粉 #F2D4D7"},
	"tech":      {"石墨黑 #1F2329", "冷银灰 #C9CED6", "信号蓝 #2F6BFF"},
	"apparel":   {"暖灰 #E7E2DC", "炭黑 #2B2B2B", "砂岩 #CDBBA7"},
	"home":      {"燕麦 #E9DFCF", "原木 #B98B5E", "暖白 #FAF7F2"},
	"appliance": {"云白 #F5F6F7", "浅木 #D9C3A5", "雾蓝 #B9C8D6"},
	"beauty":    {"珍珠白 #FBF7F4", "裸粉 #EBC9C1", "香槟 #E3CFA8"},
	"food":      {"奶咖 #D8BFA3", "番茄红 #D94E3B", "米白 #FAF3E6"},
}

var categoryLighting = map[string]string{
	"maternal":  "大面积柔光与自然窗光，阴影柔和，色温偏暖",
	"tech":      "低调侧光加轮廓光，强调外壳边缘与材质",
	"apparel":   "柔光箱漫射表现面料纹理，补光保留褶皱层次",
	"home":      "模拟自然窗光，侧光描出材质与轮廓",
	"appliance": "明亮漫射环境光加侧向轮廓光，机身边缘清楚",
	"beauty":    "顶光加侧光表现包装光泽，避免过曝",
	"food":      "自然侧逆光表现食物质感，暖色调",
}

func (s *VisualStrategySkill) Execute(input VisualStrategyInput) (*VisualStrategyOutput, error) {
	output := &VisualStrategyOutput{DirectionName: input.DirectionName, Mode: input.Mode, ProductEmphasis: input.VisualEmphasis, KnowledgeMethods: []string{}}
	if output.ProductEmphasis == nil {
		output.ProductEmphasis = []string{}
	}
	output.ColorPalette = input.Palette
	if len(output.ColorPalette) == 0 {
		output.ColorPalette = categoryPalette[input.CategoryKey]
	}
	if len(output.ColorPalette) == 0 {
		output.ColorPalette = []string{"暖白 #FAF8F5", "中性灰 #D9D9D9", "墨黑 #222222"}
	}
	output.CompositionStyle = modeComposition[input.Mode]
	if output.CompositionStyle == "" {
		output.CompositionStyle = "三分法构图，主体清晰，留出文字安全区"
	}
	basis := []KnowledgeRef{}
	// Photography knowledge decides the light when the direction has none of
	// its own; scene/visual/layout knowledge contributes executable methods.
	output.LightingApproach = strings.TrimSpace(input.Lighting)
	for _, ref := range input.Knowledge {
		method := firstSentence(ref.Guidance, 90)
		if method == "" {
			continue
		}
		switch ref.Domain {
		case "KB06":
			if output.LightingApproach == "" {
				output.LightingApproach = method
			}
		case "KB04":
			if output.LayoutPrinciple == "" {
				output.LayoutPrinciple = method
			}
		}
		output.KnowledgeMethods = append(output.KnowledgeMethods, ref.Title+"："+method)
		basis = append(basis, ref)
	}
	if output.LightingApproach == "" {
		output.LightingApproach = categoryLighting[input.CategoryKey]
	}
	if output.LightingApproach == "" {
		output.LightingApproach = "均匀主光加轮廓光，真实还原商品颜色"
	}
	if strings.TrimSpace(input.Layout) != "" {
		output.LayoutPrinciple = input.Layout
	}
	if output.LayoutPrinciple == "" {
		output.LayoutPrinciple = "标题、商品、说明三级阅读顺序，手机端字号可读"
	}
	output.KnowledgeBasis = refIDs(basis)
	// Every image prompt repeats the lock verbatim, so it holds only what must
	// stay identical across the set: palette, light and product emphasis.
	// Composition and layout change per page with the run's design variation;
	// locking them made every page the same shot. CompositionStyle and
	// LayoutPrinciple stay in the output as guidance.
	lock := []string{"【选定方向视觉锁定·" + input.DirectionName + "】配色：" + strings.Join(output.ColorPalette, "、"), "光线：" + output.LightingApproach}
	if len(output.ProductEmphasis) > 0 {
		lock = append(lock, "商品重点："+strings.Join(output.ProductEmphasis, "、"))
	}
	output.PromptLock = strings.Join(lock, "；") + "。"
	return output, nil
}

func (s *VisualStrategySkill) Run(stage string, input VisualStrategyInput) (*VisualStrategyOutput, Invocation) {
	output, _ := s.Execute(input)
	logged := input
	logged.Knowledge = nil
	return output, newInvocation("visual_strategy", stage, output.KnowledgeBasis, logged, output)
}

func (o *VisualStrategyOutput) ToJSON() string {
	data, _ := json.MarshalIndent(o, "", "  ")
	return string(data)
}

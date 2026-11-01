package ecommerceskills

import (
	"encoding/json"
	"strings"
)

// ProductAnalysisSkill separates seller-confirmed facts from planning hints
// and reads category knowledge (KB01) for visual emphasis and fact boundaries.
type ProductAnalysisSkill struct{}

type ProductAnalysisInput struct {
	ProductName    string         `json:"productName"`
	CategoryKey    string         `json:"categoryKey"`
	Category       string         `json:"category"`
	Description    string         `json:"description"`
	Claims         string         `json:"claims"`
	Materials      string         `json:"materials"`
	Colors         string         `json:"colors"`
	Specifications string         `json:"specifications"`
	Knowledge      []KnowledgeRef `json:"knowledge"`
}

type ProductAnalysisOutput struct {
	CategoryKey     string   `json:"categoryKey"`
	ProductType     string   `json:"productType"`
	TargetAudience  string   `json:"targetAudience"`
	ConfirmedFacts  []string `json:"confirmedFacts"`
	MentionedTraits []string `json:"mentionedTraits"`
	UsageScenarios  []string `json:"usageScenarios"`
	VisualEmphasis  []string `json:"visualEmphasis"`
	FactBoundaries  []string `json:"factBoundaries"`
	KnowledgeBasis  []string `json:"knowledgeBasis"`
}

var productTypeLabels = map[string][2]string{
	"maternal":  {"母婴用品", "照护婴幼儿的家庭"},
	"tech":      {"数码 3C", "重视效率与设计的数码用户"},
	"apparel":   {"服饰鞋包", "关注版型与搭配的穿着者"},
	"home":      {"家居家具", "布置居住空间的家庭"},
	"appliance": {"智能家电", "希望减轻家务负担的家庭"},
	"beauty":    {"美妆护肤", "日常护理与妆容用户"},
	"food":      {"食品饮品", "日常饮食与分享场景的消费者"},
	"bathroom":  {"卫浴用品", "改善卫浴空间的家庭"},
	"sport":     {"运动健身", "规律训练的运动人群"},
	"pet":       {"宠物用品", "养宠家庭"},
}

// Trait words are only recorded as "用户描述提及"; they are never upgraded to
// confirmed facts or performance claims.
var mentionedTraitWords = []string{"防胀气", "宽口", "降噪", "头戴", "入耳", "续航", "真丝", "棉", "A字", "实木", "科技布", "三人位", "激光导航", "吸力", "静音", "App", "APP"}

func (s *ProductAnalysisSkill) Execute(input ProductAnalysisInput) (*ProductAnalysisOutput, error) {
	labels, ok := productTypeLabels[input.CategoryKey]
	if !ok {
		labels = [2]string{"通用商品", "该商品的目标消费者"}
	}
	output := &ProductAnalysisOutput{CategoryKey: input.CategoryKey, ProductType: labels[0], TargetAudience: labels[1], ConfirmedFacts: []string{}, MentionedTraits: []string{}, UsageScenarios: []string{}, VisualEmphasis: []string{}, FactBoundaries: []string{}}
	for _, field := range []struct{ label, value string }{{"商品", input.ProductName}, {"卖点", input.Claims}, {"材质", input.Materials}, {"颜色", input.Colors}, {"规格", input.Specifications}} {
		if value := strings.TrimSpace(field.value); value != "" {
			output.ConfirmedFacts = append(output.ConfirmedFacts, field.label+"："+value)
		}
	}
	text := input.ProductName + " " + input.Description
	for _, word := range mentionedTraitWords {
		if strings.Contains(text, word) {
			output.MentionedTraits = append(output.MentionedTraits, word)
		}
	}
	basis := []KnowledgeRef{}
	for _, ref := range refsInDomain(input.Knowledge, "KB01") {
		used := false
		if part := guidanceSegment(ref.Guidance, "常见使用场景："); part != "" {
			output.UsageScenarios, used = appendUnique(output.UsageScenarios, splitList(part)...), true
		}
		if part := guidanceSegment(ref.Guidance, "视觉策划重点："); part != "" {
			output.VisualEmphasis, used = appendUnique(output.VisualEmphasis, splitList(part)...), true
		}
		if part := guidanceSegment(ref.Guidance, "注意事项："); part != "" {
			output.FactBoundaries, used = appendUnique(output.FactBoundaries, part), true
		}
		if used {
			basis = append(basis, ref)
		}
	}
	output.FactBoundaries = appendUnique(output.FactBoundaries, "未由卖家确认的参数、功效、认证、价格和评价不得写成商品事实")
	output.KnowledgeBasis = refIDs(basis)
	return output, nil
}

// Run executes the skill and returns its auditable invocation record.
func (s *ProductAnalysisSkill) Run(stage string, input ProductAnalysisInput) (*ProductAnalysisOutput, Invocation) {
	output, _ := s.Execute(input)
	logged := input
	logged.Knowledge = nil
	return output, newInvocation("product_analysis", stage, output.KnowledgeBasis, logged, output)
}

func appendUnique(values []string, items ...string) []string {
	for _, item := range items {
		found := false
		for _, value := range values {
			found = found || value == item
		}
		if !found && item != "" {
			values = append(values, item)
		}
	}
	return values
}

func (o *ProductAnalysisOutput) ToJSON() string {
	data, _ := json.MarshalIndent(o, "", "  ")
	return string(data)
}

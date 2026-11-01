package ecommerceskills

import (
	"encoding/json"
	"strings"
)

// CopywritingSkill fixes the copy tone and evidence slots for one direction.
// It writes no claims: evidence slots are exactly the seller-confirmed facts,
// and headline angles are writing methods, not finished slogans.
type CopywritingSkill struct{}

type CopywritingInput struct {
	ProductName    string         `json:"productName"`
	DirectionName  string         `json:"directionName"`
	Mode           string         `json:"mode"`
	ImageType      string         `json:"imageType"`
	ConfirmedFacts []string       `json:"confirmedFacts"`
	NoText         bool           `json:"noText"`
	Knowledge      []KnowledgeRef `json:"knowledge"`
}

type CopywritingOutput struct {
	DirectionName  string   `json:"directionName"`
	Tone           string   `json:"tone"`
	HeadlineAngles []string `json:"headlineAngles"`
	EvidenceSlots  []string `json:"evidenceSlots"`
	Forbidden      []string `json:"forbidden"`
	KnowledgeRules []string `json:"knowledgeRules"`
	KnowledgeBasis []string `json:"knowledgeBasis"`
	NoText         bool     `json:"noText"`
}

var modeTone = map[string][2]string{
	"hero":        {"克制、确定，一句话点明商品身份", "以可见外观或材质开场的短标题"},
	"lifestyle":   {"温和具体，写真实的使用片刻", "以场景或动作开场的短句"},
	"creative":    {"短促有节奏，留出想象空间", "以感受或节拍开场的短句"},
	"feature":     {"精确清楚，只陈述已确认信息", "以可见细节或已确认规格开场"},
	"macro":       {"观察式，像在描述看到的细节", "以局部细节观察开场"},
	"editorial":   {"编辑式观察，句子简洁有留白", "以观察或态度开场的标题"},
	"documentary": {"纪实、平实，不渲染情绪", "以真实动作开场"},
	"scale":       {"从容，强调空间关系", "以摆放位置或空间关系开场"},
}

var defaultForbidden = []string{"未经卖家确认的数字参数（续航、吸力、噪音、容量等）", "认证、检测、获奖与安全承诺", "价格、折扣、销量、好评与排名", "最、第一、顶级等绝对化用语"}

func (s *CopywritingSkill) Execute(input CopywritingInput) (*CopywritingOutput, error) {
	tone, ok := modeTone[input.Mode]
	if !ok {
		tone = [2]string{"真诚自然，围绕真实使用价值", "以场景或可见差异开场"}
	}
	output := &CopywritingOutput{DirectionName: input.DirectionName, Tone: tone[0], HeadlineAngles: []string{tone[1]}, EvidenceSlots: []string{}, Forbidden: append([]string{}, defaultForbidden...), KnowledgeRules: []string{}, NoText: input.NoText}
	for _, fact := range input.ConfirmedFacts {
		if fact = strings.TrimSpace(fact); fact != "" {
			output.EvidenceSlots = append(output.EvidenceSlots, fact)
		}
	}
	if len(output.EvidenceSlots) == 0 {
		output.HeadlineAngles = append(output.HeadlineAngles, "卖家未提供卖点：只写可见外观与使用情境，不写功能结论")
	}
	basis := []KnowledgeRef{}
	for _, ref := range input.Knowledge {
		if ref.Domain != "KB05" && ref.Domain != "KB02" {
			continue
		}
		if rule := firstSentence(ref.Guidance, 80); rule != "" {
			output.KnowledgeRules = append(output.KnowledgeRules, ref.Title+"："+rule)
			basis = append(basis, ref)
		}
	}
	if input.NoText {
		output.HeadlineAngles = []string{}
	}
	output.KnowledgeBasis = refIDs(basis)
	return output, nil
}

func (s *CopywritingSkill) Run(stage string, input CopywritingInput) (*CopywritingOutput, Invocation) {
	output, _ := s.Execute(input)
	logged := input
	logged.Knowledge = nil
	return output, newInvocation("copywriting", stage, output.KnowledgeBasis, logged, output)
}

func (o *CopywritingOutput) ToJSON() string {
	data, _ := json.MarshalIndent(o, "", "  ")
	return string(data)
}

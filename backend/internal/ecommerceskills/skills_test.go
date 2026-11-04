package ecommerceskills

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

var bottleKB01 = KnowledgeRef{ID: "kb01-baby-bottle-knowledge", Domain: "KB01", Title: "奶瓶产品认知与购买决策", Guidance: "奶瓶的核心购买因素：材质安全。视觉策划重点：透明材质展示纯净感、刻度清晰可见。常见使用场景：夜间喂养、外出携带。注意事项：不虚构BPA-free认证,不承诺防胀气效果。"}

func TestProductAnalysisSeparatesConfirmedFactsAndReadsKnowledge(t *testing.T) {
	skill := ProductAnalysisSkill{}
	input := ProductAnalysisInput{ProductName: "婴儿奶瓶", CategoryKey: "maternal", Description: "防胀气设计", Materials: "PPSU", Knowledge: []KnowledgeRef{bottleKB01}}
	first, call := skill.Run("creative-directions", input)
	for i := 0; i < 20; i++ {
		again, _ := skill.Execute(input)
		if !reflect.DeepEqual(first, again) {
			t.Fatalf("product analysis is not deterministic: %+v vs %+v", first, again)
		}
	}
	if first.ProductType != "母婴用品" || !reflect.DeepEqual(first.ConfirmedFacts, []string{"商品：婴儿奶瓶", "材质：PPSU"}) {
		t.Fatalf("wrong facts: %+v", first)
	}
	// "防胀气" came only from the free-text description: it must stay a mention.
	if strings.Contains(strings.Join(first.ConfirmedFacts, " "), "防胀气") || !reflect.DeepEqual(first.MentionedTraits, []string{"防胀气"}) {
		t.Fatalf("description trait upgraded to fact: %+v", first)
	}
	if !reflect.DeepEqual(first.UsageScenarios, []string{"夜间喂养", "外出携带"}) || !reflect.DeepEqual(first.VisualEmphasis, []string{"透明材质展示纯净感", "刻度清晰可见"}) {
		t.Fatalf("knowledge not applied: %+v", first)
	}
	if !reflect.DeepEqual(call.KnowledgeBasis, []string{"kb01-baby-bottle-knowledge"}) || call.Skill != "product_analysis" || call.Stage != "creative-directions" {
		t.Fatalf("invocation not traceable: %+v", call)
	}
	without, _ := skill.Execute(ProductAnalysisInput{ProductName: "婴儿奶瓶", CategoryKey: "maternal"})
	if len(without.UsageScenarios) != 0 || len(without.KnowledgeBasis) != 0 {
		t.Fatalf("output must depend on knowledge: %+v", without)
	}
}

func TestVisualStrategyUsesDirectionAndKnowledge(t *testing.T) {
	skill := VisualStrategySkill{}
	photo := KnowledgeRef{ID: "kb06-x", Domain: "KB06", Title: "透明材质布光", Guidance: "透明材质用背光与黑卡勾边。其余略。"}
	base := VisualStrategyInput{CategoryKey: "maternal", DirectionName: "柔光安心风", Mode: "hero", Knowledge: []KnowledgeRef{photo}}
	out, call := skill.Run("creative-directions", base)
	if out.LightingApproach != "透明材质用背光与黑卡勾边" || !strings.Contains(out.PromptLock, "柔光安心风") || !strings.Contains(out.PromptLock, "背光与黑卡勾边") {
		t.Fatalf("photography knowledge not used: %+v", out)
	}
	if !reflect.DeepEqual(call.KnowledgeBasis, []string{"kb06-x"}) {
		t.Fatalf("basis = %v", call.KnowledgeBasis)
	}
	base.Knowledge = nil
	plain, _ := skill.Execute(base)
	if plain.PromptLock == out.PromptLock {
		t.Fatal("removing knowledge did not change the visual lock")
	}
	base.Palette, base.Lighting = []string{"雾蓝 #B9C8D6"}, "左后 45° 大柔光箱"
	explicit, _ := skill.Execute(base)
	if !strings.Contains(explicit.PromptLock, "雾蓝 #B9C8D6") || explicit.LightingApproach != "左后 45° 大柔光箱" {
		t.Fatalf("direction visual system not preserved: %+v", explicit)
	}
	for _, color := range plain.ColorPalette {
		if !strings.Contains(color, " #") {
			t.Fatalf("palette entry lacks a valid name and hex: %q", color)
		}
	}
}

func TestCopywritingNeverInventsClaims(t *testing.T) {
	skill := CopywritingSkill{}
	out, call := skill.Run("planning", CopywritingInput{ProductName: "北欧风沙发", DirectionName: "松弛客厅风", Mode: "lifestyle"})
	raw, _ := json.Marshal(out)
	for _, invented := range []string{"好评", "品质保证", "安心的选择", "立即选购", "✓"} {
		if strings.Contains(strings.Join(append(out.HeadlineAngles, out.EvidenceSlots...), " "), invented) {
			t.Fatalf("copy skill invented %q: %s", invented, raw)
		}
	}
	if len(out.EvidenceSlots) != 0 || out.Tone == "" || call.Skill != "copywriting" {
		t.Fatalf("unexpected copy output: %s", raw)
	}
	facts, _ := skill.Execute(CopywritingInput{Mode: "feature", ConfirmedFacts: []string{"材质：实木框架"}, Knowledge: []KnowledgeRef{{ID: "kb05-a", Domain: "KB05", Title: "标题法", Guidance: "标题写场景。"}}})
	if !reflect.DeepEqual(facts.EvidenceSlots, []string{"材质：实木框架"}) || !reflect.DeepEqual(facts.KnowledgeBasis, []string{"kb05-a"}) {
		t.Fatalf("evidence or basis wrong: %+v", facts)
	}
	noText, _ := skill.Execute(CopywritingInput{Mode: "hero", NoText: true})
	if len(noText.HeadlineAngles) != 0 || !noText.NoText {
		t.Fatalf("no-text rule ignored: %+v", noText)
	}
}

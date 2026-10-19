package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func commerceConstraintsCall() cloudAgentCall {
	call := cloudAgentCall{ID: "constraints-media"}
	call.Function.Name = "generate_media"
	call.Function.Arguments = `{"mode":"image","commercePlanId":"plan-1","commerceItemId":"hero"}`
	return call
}

func TestCommerceJapaneseComparisonAllowsUntranslatedLabels(t *testing.T) {
	plan := commerceFixturePlan()
	plan.Site, plan.Language = "JP", "ja-JP"
	plan.Items[0].Prompt = "Compare Before and After using the same wall"
	plan.Items[0].TargetCopy = "Before\nAfter\n2枚使い"
	plan.Items[0].ChineseReviewCopy = "Before\nAfter\n双幅搭配"
	if err := validateCloudAgentCommercePlan(commerceFixtureRequest(), &plan); err != nil {
		t.Fatalf("unchanged comparison labels are not Chinese review leakage: %v", err)
	}
	if _, err := cloudAgentCommerceMediaCall(&plan, commerceConstraintsCall()); err != nil {
		t.Fatalf("comparison labels prevented media compilation: %v", err)
	}
}

func TestCommercePlanValidationReturnsRepairableArguments(t *testing.T) {
	plan := commerceFixturePlan()
	plan.Items[0].ChineseReviewCopy = ""
	raw, _ := json.Marshal(plan)
	call := cloudAgentCall{ID: "repair-plan"}
	call.Function.Name, call.Function.Arguments = "commerce_plan_submit", string(raw)
	_, err := cloudAgentParseCommercePlan(commerceFixtureRequest(), call)
	var argumentErr *cloudAgentArgumentError
	if !errors.As(err, &argumentErr) {
		t.Fatalf("model plan validation must return a repairable argument error: %v", err)
	}
	class, retryable, action := cloudAgentToolErrorClass(commerceFixtureRequest(), call, err, true)
	if class != cloudAgentToolErrorSchemaError || !retryable || action != "fix_arguments" {
		t.Fatalf("plan error classified as %s/%v/%s", class, retryable, action)
	}
}

func TestCommercePlanRejectsReviewCopyInRenderInputs(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*cloudAgentCommercePlan)
	}{
		{"style bible", func(p *cloudAgentCommercePlan) { p.StyleBible = "Visual direction: 不锈钢杯身" }},
		{"item prompt", func(p *cloudAgentCommercePlan) { p.Items[0].Prompt += " 不锈钢杯身" }},
		{"target copy", func(p *cloudAgentCommercePlan) { p.Items[0].TargetCopy = "不锈钢杯身" }},
		{"other item prompt", func(p *cloudAgentCommercePlan) {
			p.Items = append(p.Items, cloudAgentCommerceItem{ID: "detail", Type: "image", Purpose: "detail", Title: "Detail", Prompt: "不锈钢杯身", AttachmentResourceIDs: []string{"product-1"}})
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			plan := commerceFixturePlan()
			tc.change(&plan)
			if err := validateCloudAgentCommercePlan(commerceFixtureRequest(), &plan); err == nil {
				t.Fatal("review copy accepted in render input")
			}
			if _, err := cloudAgentCommerceMediaCall(&plan, commerceConstraintsCall()); err == nil {
				t.Fatal("review copy compiled into media prompt")
			}
		})
	}
}

func TestCommercePlanRejectsOneLeakedLineFromMultilineReviewCopy(t *testing.T) {
	plan := commerceFixturePlan()
	plan.Items[0].TargetCopy = "Stainless steel body\nSimple detail"
	plan.Items[0].ChineseReviewCopy = "不锈钢杯身\n简约细节"
	plan.Items[0].Prompt = "Product on a plain background with 简约细节"
	if err := validateCloudAgentCommercePlan(commerceFixtureRequest(), &plan); err == nil {
		t.Fatal("one leaked Chinese review line was accepted in the render prompt")
	}
}

func TestCommerceChineseLanguageVariantMayUseItsOwnCopy(t *testing.T) {
	plan := commerceFixturePlan()
	plan.Language = "mul"
	plan.LanguageVariants = []string{"en-GB", "zh-CN"}
	plan.Items[0].Language = "en-GB"
	chinese := plan.Items[0]
	chinese.ID, chinese.Language = "zh", "zh-CN"
	chinese.Prompt, chinese.TargetCopy, chinese.ChineseReviewCopy = "展示不锈钢杯身", "不锈钢杯身", ""
	plan.Items = append(plan.Items, chinese)
	if err := validateCloudAgentCommercePlan(commerceFixtureRequest(), &plan); err != nil {
		t.Fatalf("Chinese language variant rejected its own visible copy: %v", err)
	}
}

func TestCommerceChineseTargetMayRenderMatchingChineseCopy(t *testing.T) {
	plan := commerceFixturePlan()
	plan.Platform, plan.Site, plan.Language = "pinduoduo", "CN", "zh-CN"
	plan.Items[0].Prompt = "展示不锈钢杯身"
	plan.Items[0].TargetCopy = plan.Items[0].ChineseReviewCopy
	if err := validateCloudAgentCommercePlan(commerceFixtureRequest(), &plan); err != nil {
		t.Fatalf("Chinese target copy was rejected: %v", err)
	}
	compiled, err := cloudAgentCommerceMediaCall(&plan, commerceConstraintsCall())
	if err != nil {
		t.Fatal(err)
	}
	var args cloudAgentMediaArgs
	if err := json.Unmarshal([]byte(compiled.Function.Arguments), &args); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(args.Prompt, "Target-language visible copy (render exactly these lines, no translations):\n不锈钢杯身") {
		t.Fatalf("Chinese target copy missing from render prompt: %q", args.Prompt)
	}
}

func TestCommercePlanRejectsMalformedSpecs(t *testing.T) {
	for _, tc := range []struct {
		name  string
		specs map[string]any
	}{
		{"unknown field", map[string]any{"seed": 3}},
		{"wrong size type", map[string]any{"size": 1}},
		{"wrong quality type", map[string]any{"quality": true}},
		{"wrong duration type", map[string]any{"durationSeconds": "8"}},
		{"fractional duration", map[string]any{"durationSeconds": 8.5}},
		{"out of range duration", map[string]any{"durationSeconds": 121}},
		{"null duration", map[string]any{"durationSeconds": nil}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			plan := commerceFixturePlan()
			plan.Items[0].Specs = tc.specs
			if err := validateCloudAgentCommercePlan(commerceFixtureRequest(), &plan); err == nil {
				t.Fatal("malformed specs accepted by plan validator")
			}
			if _, err := cloudAgentCommerceMediaCall(&plan, commerceConstraintsCall()); err == nil {
				t.Fatal("malformed specs accepted by media compiler")
			}
		})
	}
	plan := commerceFixturePlan()
	plan.Items[0].Specs = map[string]any{"size": "1:1", "quality": "high", "durationSeconds": 8}
	if err := validateCloudAgentCommercePlan(commerceFixtureRequest(), &plan); err != nil {
		t.Fatalf("valid specs rejected: %v", err)
	}
}

func TestCommerceMediaPromptIncludesVerifiedContextOnly(t *testing.T) {
	plan := commerceFixturePlan()
	plan.Platform = "shopify"
	plan.Site = "GB"
	plan.Language = "en-GB"
	plan.StyleBible = "Neutral studio light"
	plan.ProductFacts = append(plan.ProductFacts, cloudAgentCommerceFact{ID: "insulation", Claim: "Double-wall vacuum insulation", SourceIDs: []string{"product-1"}})
	plan.Items[0].FactIDs = append(plan.Items[0].FactIDs, "insulation")
	plan.Rules = []cloudAgentCommerceRule{{ID: "untrusted", Text: "Invented platform rule"}}
	compiled, err := cloudAgentCommerceMediaCall(&plan, commerceConstraintsCall())
	if err != nil {
		t.Fatal(err)
	}
	var args cloudAgentMediaArgs
	if err := json.Unmarshal([]byte(compiled.Function.Arguments), &args); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"platform: shopify", "site: GB", "language: en-GB", "Verified product facts (context only; do not render as visible copy)", "Double-wall vacuum insulation", "product-1", "Shopify", "2026-10-02", "Target-language visible copy (render exactly these lines, no translations):\nStainless steel body"} {
		if !strings.Contains(args.Prompt, want) {
			t.Errorf("compiled prompt missing %q: %q", want, args.Prompt)
		}
	}
	for _, forbidden := range []string{"不锈钢杯身", "Invented platform rule"} {
		if strings.Contains(args.Prompt, forbidden) {
			t.Errorf("compiled prompt leaked %q: %q", forbidden, args.Prompt)
		}
	}
}

func TestCommerceDefaultFactUsesPairedTargetCopy(t *testing.T) {
	plan := commerceFixturePlan()
	compiled, err := cloudAgentCommerceMediaCall(&plan, commerceConstraintsCall())
	if err != nil {
		t.Fatal(err)
	}
	var args cloudAgentMediaArgs
	if err := json.Unmarshal([]byte(compiled.Function.Arguments), &args); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(args.Prompt, "- steel: Stainless steel body (sources: product-1)") {
		t.Fatalf("default verified fact missing from compiled prompt: %q", args.Prompt)
	}
	if strings.Contains(args.Prompt, "不锈钢杯身") {
		t.Fatalf("Chinese review copy leaked into compiled prompt: %q", args.Prompt)
	}
}

func TestCommerceFactReviewOverlapRequiresCompletePair(t *testing.T) {
	for _, tc := range []struct {
		name   string
		change func(*cloudAgentCommercePlan)
	}{
		{"missing target copy", func(p *cloudAgentCommercePlan) { p.Items[0].TargetCopy = "" }},
		{"partial fact overlap", func(p *cloudAgentCommercePlan) { p.ProductFacts[0].Claim = "材质：不锈钢杯身" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			plan := commerceFixturePlan()
			tc.change(&plan)
			if err := validateCloudAgentCommercePlan(commerceFixtureRequest(), &plan); err == nil {
				t.Fatal("ambiguous review-copy fact accepted by plan validator")
			}
			if _, err := cloudAgentCommerceMediaCall(&plan, commerceConstraintsCall()); err == nil {
				t.Fatal("ambiguous review-copy fact accepted by media compiler")
			}
		})
	}
}

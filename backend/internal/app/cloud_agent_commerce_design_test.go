package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func commerceDesignPayload(t *testing.T, layouts []string) map[string]any {
	t.Helper()
	raw, _ := json.Marshal(commerceFixturePlan())
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	payload["site"], payload["language"] = "JP", "ja-JP"
	first := payload["items"].([]any)[0].(map[string]any)
	items := make([]any, 0, len(layouts))
	for i, layout := range layouts {
		item := make(map[string]any)
		for key, value := range first {
			item[key] = value
		}
		item["id"] = string(rune('a' + i))
		item["targetCopy"], item["zhReviewCopy"] = "美しい風景", "美丽风景"
		item["specs"] = map[string]any{"size": "2048x2048", "quality": "high"}
		item["design"] = map[string]any{"role": "secondary", "layout": layout, "focalPoint": "Framed artwork remains the hero", "composition": "Headline at top 18%, artwork at center 58%, three supported feature callouts at bottom 24%", "typography": "Readable Japanese headline with short supporting labels", "palette": "Warm ivory, charcoal and lake blue accents"}
		items = append(items, item)
	}
	payload["items"] = items
	return payload
}

func parseCommerceDesignPayload(t *testing.T, payload map[string]any) (*cloudAgentCommercePlan, error) {
	t.Helper()
	raw, _ := json.Marshal(payload)
	call := commerceConstraintsCall()
	call.Function.Arguments = string(raw)
	return cloudAgentParseCommercePlan(commerceFixtureRequest(), call)
}

func TestCommerceDesignCompilesEachApprovedLayoutWithoutChangingQuality(t *testing.T) {
	layouts := []string{"hero_lifestyle", "feature_infographic", "detail_callout", "multi_scene", "comparison", "lifestyle_finish"}
	plan, err := parseCommerceDesignPayload(t, commerceDesignPayload(t, layouts))
	if err != nil {
		t.Fatal(err)
	}
	for i, item := range plan.Items {
		call := commerceConstraintsCall()
		args, _ := json.Marshal(map[string]any{"mode": "image", "commercePlanId": plan.PlanID, "commerceItemId": item.ID})
		call.Function.Arguments = string(args)
		compiled, err := cloudAgentCommerceMediaCall(plan, call)
		if err != nil {
			t.Fatal(err)
		}
		var media cloudAgentMediaArgs
		if err := json.Unmarshal([]byte(compiled.Function.Arguments), &media); err != nil {
			t.Fatal(err)
		}
		for _, want := range []string{layouts[i], "Headline at top 18%", "lake blue", "secondary", "Japanese headline", "2048x2048", "not the product's physical aspect ratio"} {
			if !strings.Contains(media.Prompt, want) {
				t.Errorf("item %s lost approved design %q", item.ID, want)
			}
		}
		if media.Size != "2048x2048" || media.Quality != "high" {
			t.Errorf("design altered request: %+v", media)
		}
		if strings.Contains(media.Prompt, item.ChineseReviewCopy) {
			t.Fatal("Chinese review leaked into render prompt")
		}
	}
}

func TestCommerceDesignRejectsIncompleteRepetitiveOrUnreviewedLayouts(t *testing.T) {
	for _, tc := range []string{"incomplete", "repetitive", "unknown", "review-leak", "main-copy"} {
		t.Run(tc, func(t *testing.T) {
			payload := commerceDesignPayload(t, []string{"hero_lifestyle", "feature_infographic", "detail_callout", "multi_scene"})
			items := payload["items"].([]any)
			first := items[0].(map[string]any)
			design := first["design"].(map[string]any)
			switch tc {
			case "incomplete":
				delete(items[1].(map[string]any), "design")
			case "repetitive":
				for _, raw := range items {
					raw.(map[string]any)["design"].(map[string]any)["layout"] = "hero_lifestyle"
				}
			case "unknown":
				design["layout"] = "make_up_a_layout"
			case "review-leak":
				design["typography"] = "美丽风景"
			case "main-copy":
				design["role"], design["layout"] = "main", "product_only"
			}
			if _, err := parseCommerceDesignPayload(t, payload); err == nil {
				t.Fatal("invalid art direction admitted")
			}
		})
	}
}

func TestCommerceLegacyPlanRemainsReadableAndSquareIsRecommendation(t *testing.T) {
	plan := commerceFixturePlan()
	if err := validateCloudAgentCommercePlan(commerceFixtureRequest(), &plan); err != nil {
		t.Fatal(err)
	}
	payload := commerceDesignPayload(t, []string{"hero_lifestyle"})
	payload["items"].([]any)[0].(map[string]any)["specs"] = map[string]any{"size": "16:9", "quality": "high"}
	if _, err := parseCommerceDesignPayload(t, payload); err != nil {
		t.Fatalf("explicit wide delivery rejected as if square were an Amazon mandate: %v", err)
	}
}

func commerceStyleLockPayload() map[string]any {
	return map[string]any{"fontFamily": "Noto Sans JP", "typography": "Headings 700, labels 500, body 400; heading:body 3:1; one shared type hierarchy", "headingColor": "#182332", "bodyColor": "#465263", "accentColor": "#1976D2", "backgroundColor": "#F7F3ED", "iconStyle": "Outlined icons, consistent 2px strokes"}
}

func TestCommerceSharedStyleLockOverridesConflictingItemFontsAndColors(t *testing.T) {
	payload := commerceDesignPayload(t, []string{"hero_lifestyle", "feature_infographic", "detail_callout", "multi_scene", "comparison", "lifestyle_finish"})
	payload["styleLock"] = commerceStyleLockPayload()
	for _, raw := range payload["items"].([]any) {
		design := raw.(map[string]any)["design"].(map[string]any)
		design["typography"], design["palette"] = "Conflicting serif family", "Conflicting neon purple lettering"
	}
	plan, err := parseCommerceDesignPayload(t, payload)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range plan.Items {
		call := commerceConstraintsCall()
		args, _ := json.Marshal(map[string]any{"mode": "image", "commercePlanId": plan.PlanID, "commerceItemId": item.ID})
		call.Function.Arguments = string(args)
		compiled, err := cloudAgentCommerceMediaCall(plan, call)
		if err != nil {
			t.Fatal(err)
		}
		var media cloudAgentMediaArgs
		if err := json.Unmarshal([]byte(compiled.Function.Arguments), &media); err != nil {
			t.Fatal(err)
		}
		for _, want := range []string{"Noto Sans JP", "#182332", "#465263", "#1976D2", "#F7F3ED", "Headings 700", "Outlined icons", item.Design.Layout, item.TargetCopy} {
			if !strings.Contains(media.Prompt, want) {
				t.Errorf("item %s lost shared style or approved content: %s", item.ID, want)
			}
		}
		if strings.Contains(media.Prompt, "Conflicting") {
			t.Fatal("per-image fonts/colors overrode the set's shared style lock")
		}
	}
}

func TestCommerceSharedStyleLockRejectsIncompleteOrInvalidColors(t *testing.T) {
	for _, field := range []string{"fontFamily", "typography", "headingColor", "bodyColor", "accentColor", "backgroundColor", "iconStyle"} {
		t.Run(field, func(t *testing.T) {
			payload := commerceDesignPayload(t, []string{"hero_lifestyle"})
			lock := commerceStyleLockPayload()
			lock[field] = ""
			payload["styleLock"] = lock
			if _, err := parseCommerceDesignPayload(t, payload); err == nil {
				t.Fatal("incomplete shared style lock admitted")
			}
		})
	}
	payload := commerceDesignPayload(t, []string{"hero_lifestyle"})
	lock := commerceStyleLockPayload()
	lock["accentColor"] = "blue or red"
	payload["styleLock"] = lock
	if _, err := parseCommerceDesignPayload(t, payload); err == nil {
		t.Fatal("ambiguous color admitted into a shared style lock")
	}
}

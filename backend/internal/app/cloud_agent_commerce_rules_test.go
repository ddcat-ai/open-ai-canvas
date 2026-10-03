package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCommerceOfficialRuleCatalogIsSiteScoped(t *testing.T) {
	for _, tc := range []struct {
		platform, site, source, phrase string
	}{
		{"amazon", "JP", "sell.amazon.co.jp/en/learn/listing", "副图"},
		{"amazon", " jp ", "sell.amazon.co.jp/en/learn/listing", "纯白"},
		{"tiktok_shop", "US", "seller-us.tiktok.com/university", "首图"},
		{"shopify", "GB", "help.shopify.com/en/manual/products/product-media/product-media-types", "PNG"},
	} {
		rules := cloudAgentCommerceRules(tc.platform, tc.site)
		if len(rules) == 0 {
			t.Errorf("no official rule for %s/%s", tc.platform, tc.site)
			continue
		}
		matched := false
		for _, rule := range rules {
			if rule.ID == "" || rule.CheckedAt == "" || !strings.HasPrefix(rule.SourceURL, "https://") {
				t.Errorf("unverifiable rule: %+v", rule)
			}
			matched = matched || strings.Contains(rule.SourceURL, tc.source) && strings.Contains(rule.Text, tc.phrase)
		}
		if !matched {
			t.Errorf("missing source/text for %s/%s: %+v", tc.platform, tc.site, rules)
		}
	}
	for _, tc := range []struct{ platform, site string }{
		{"amazon", "UK"}, {"amazon", "UNKNOWN"}, {"tiktok_shop", "JP"},
		{"walmart", "US"}, {"pinduoduo", "CN"}, {"generic", "UNKNOWN"},
	} {
		if rules := cloudAgentCommerceRules(tc.platform, tc.site); len(rules) != 0 {
			t.Errorf("unknown %s/%s rules invented: %+v", tc.platform, tc.site, rules)
		}
	}
}

func TestCommerceJapanGalleryRuleAppearsInEachActualImagePrompt(t *testing.T) {
	plan := commerceFixturePlan()
	plan.Site, plan.Language, plan.Intent = "JP", "ja-JP", "日本站副图套图，不包含白底图"
	plan.Items[0].Purpose, plan.Items[0].Title = "副图：使用场景", "使用场景"
	plan.Items[0].Prompt, plan.Items[0].TargetCopy, plan.Items[0].ChineseReviewCopy = "Show product in use", "使いやすい", "使用方便"
	second := plan.Items[0]
	second.ID, second.Title, second.Purpose = "detail", "细节", "副图：细节"
	second.Prompt, second.TargetCopy, second.ChineseReviewCopy = "Show accessory details", "細部まで", "细节呈现"
	plan.Items = append(plan.Items, second)
	for _, item := range plan.Items {
		call := commerceConstraintsCall()
		call.Function.Arguments = `{"mode":"image","commercePlanId":"plan-1","commerceItemId":"` + item.ID + `"}`
		compiled, err := cloudAgentCommerceMediaCall(&plan, call)
		if err != nil {
			t.Fatal(err)
		}
		var args cloudAgentMediaArgs
		if err := json.Unmarshal([]byte(compiled.Function.Arguments), &args); err != nil {
			t.Fatal(err)
		}
		for _, text := range []string{"site: JP", "language: ja-JP", item.Prompt, item.TargetCopy, "Verified platform rules", "sell.amazon.co.jp/en/learn/listing", "副图"} {
			if !strings.Contains(args.Prompt, text) {
				t.Errorf("item %s prompt missing %q: %s", item.ID, text, args.Prompt)
			}
		}
		if strings.Contains(args.Prompt, item.ChineseReviewCopy) || strings.Contains(args.Prompt, "Invented platform rule") {
			t.Errorf("item %s leaked review or invented rule: %s", item.ID, args.Prompt)
		}
	}
}

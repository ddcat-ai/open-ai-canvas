package ecommerceagent

import (
	"math/rand/v2"
	"regexp"
	"slices"
	"strings"
	"testing"
	"unicode/utf8"
)

func designTestRand(seed uint64) *rand.Rand { return rand.New(rand.NewPCG(seed, seed^0x5eed)) }

var designComponentPattern = regexp.MustCompile(`^(卖点总览|标题导语|细节放大窗|场景注释|侧栏目录|规格卡|步骤编号|双栏对照|图标组|留白收束|无文字陈列)｜.{12,}`)

var designCloseupPattern = regexp.MustCompile(`微距|特写|局部`)

var designCategoryKeys = []string{"beauty", "maternal", "apparel", "bathroom", "appliance", "tech", "home", "food", "sport", "pet", "general"}

var webPlatformIDs = []string{"taobao", "tmall", "jd", "pdd", "douyin", "kuaishou", "1688", "xiaohongshu", "amazon", "temu", "shopee", "lazada", "tiktok", "shopify", "ebay", "aliexpress", "wechat-shop", "video-shop", "etsy", "walmart", "mercado-libre", "coupang", "rakuten", "ozon", "alibaba", "dhgate", "11street", "wayfair", "noon", "wildberries", "emag", "vipshop", "dewu", "aikucun", "railway"}

// designIndex maps every playbook entry id to its entry and fails on a
// duplicate id, since signatures and Avoid rely on unique ids.
func designIndex(t *testing.T) map[string]designOption {
	t.Helper()
	index := map[string]designOption{}
	add := func(pool []designOption) {
		for _, o := range pool {
			if _, ok := index[o.id]; ok {
				t.Fatalf("duplicate playbook id %s", o.id)
			}
			index[o.id] = o
		}
	}
	for _, pool := range [][]designOption{designMainLayouts, designListingMainLayouts, designSecondaryLayouts, designWhiteLayouts, designThreeViewLayouts, designBannerLayouts, designSkuLayouts, designSceneLayouts, designCustomLayouts, designMarketingLayouts, designSizeLayouts, designMaterialLayouts, designPackageLayouts, designDetailFirst, designDetailLast, designUIKits, designTypography, designCastingModifiers} {
		add(pool)
	}
	for _, roles := range [][]designRole{designSetRoles, designDetailRoles} {
		for _, role := range roles {
			add(role.variants)
		}
	}
	for _, pools := range []map[string][]designOption{designScenes, designPersonas} {
		for _, pool := range pools {
			add(pool)
		}
	}
	return index
}

func peopleLayouts(t *testing.T, v DesignVariation) int {
	t.Helper()
	index := designIndex(t)
	people := 0
	for _, id := range v.Picks[:len(v.Layouts)] {
		if index[id].has("people") {
			people++
		}
	}
	return people
}

func TestDesignPlaybookPoolsAreCompleteAndConsistent(t *testing.T) {
	designIndex(t)
	for name, size := range map[string][2]int{
		"main": {len(designMainLayouts), 14}, "secondary": {len(designSecondaryLayouts), 12}, "white": {len(designWhiteLayouts), 8},
		"banner": {len(designBannerLayouts), 6}, "sku": {len(designSkuLayouts), 6}, "scene": {len(designSceneLayouts), 6}, "custom": {len(designCustomLayouts), 6},
		"listing main": {len(designListingMainLayouts), 6}, "marketing": {len(designMarketingLayouts), 12}, "ui kits": {len(designUIKits), 10},
		"typography": {len(designTypography), 10}, "casting": {len(designCastingModifiers), 8}, "detail first": {len(designDetailFirst), 3},
		"detail last": {len(designDetailLast), 3}, "detail roles": {len(designDetailRoles), 8},
	} {
		if size[0] < size[1] {
			t.Errorf("%s pool has %d entries, want at least %d", name, size[0], size[1])
		}
	}
	for _, o := range slices.Concat(designWhiteLayouts, designListingMainLayouts, designThreeViewLayouts) {
		if !o.has("white") || !strings.Contains(o.text, "纯白") || !strings.Contains(o.text, "无文字") {
			t.Errorf("white entry %s is not pure white and text-free: %s", o.id, o.text)
		}
	}
	setNames := []string{"主图", "卖点总览", "细节特写", "使用场景", "多角度", "尺寸或规格", "场景二/人物", "收束"}
	for i, role := range designSetRoles {
		// Five single-product variants per role (four with people for the
		// people roles) keep slots 4–7 from flipping between two fixed sets.
		single := slices.DeleteFunc(slices.Clone(role.variants), func(o designOption) bool { return o.has("multi") })
		if role.name != setNames[i] || len(single) < 5 || len(taggedLayouts(role.variants, "people")) == len(role.variants) {
			t.Errorf("set role %d = %s with %d single-product variants", i, role.name, len(single))
		}
		if role.people && len(taggedLayouts(single, "people")) < 4 {
			t.Errorf("set people role %s has %d people variants, want at least 4", role.name, len(taggedLayouts(single, "people")))
		}
		for _, o := range role.variants {
			if !strings.HasPrefix(o.text, role.name+"｜") {
				t.Errorf("set variant %s does not name its role: %s", o.id, o.text)
			}
		}
	}
	checkDetail := func(o designOption, allowed ...string) {
		t.Helper()
		match := designComponentPattern.FindStringSubmatch(o.text)
		if match == nil || !strings.Contains(o.text, "（商品状态：") || !slices.Contains(allowed, match[1]) {
			t.Errorf("detail entry %s has an invalid component or no product state: %s", o.id, o.text)
		}
	}
	for _, o := range designDetailFirst {
		checkDetail(o, "卖点总览", "标题导语")
	}
	for _, o := range designDetailLast {
		checkDetail(o, "规格卡", "留白收束")
		if !strings.Contains(o.text, "4–6 项") {
			t.Errorf("closing page %s lacks the product information block", o.id)
		}
	}
	for _, role := range designDetailRoles {
		if len(role.variants) < 3 || len(taggedLayouts(role.variants, "people")) == len(role.variants) {
			t.Errorf("detail role %s needs 3 variants with one without people", role.name)
		}
		if role.people && len(taggedLayouts(role.variants, "people")) < 2 {
			t.Errorf("people role %s needs at least two people variants", role.name)
		}
		for _, o := range role.variants {
			// Closing components never appear mid-page, so the closer cannot
			// repeat the page before it.
			checkDetail(o, "标题导语", "细节放大窗", "场景注释", "侧栏目录", "步骤编号", "双栏对照", "图标组")
			if role.closeup && !designCloseupPattern.MatchString(o.text) {
				t.Errorf("close-up variant %s has no macro or close-up: %s", o.id, o.text)
			}
		}
	}
	for _, key := range designCategoryKeys {
		if len(designScenes[key]) < 8 || len(designPersonas[key]) < 6 {
			t.Errorf("category %s has %d scenes and %d personas", key, len(designScenes[key]), len(designPersonas[key]))
		}
	}
}

func TestPlatformGuideForMapsWebPlatforms(t *testing.T) {
	red := PlatformGuideFor("xiaohongshu")
	text := red.Tone + red.Layout + red.UIKit + red.Avoid
	for _, want := range []string{"3:4", "笔记", "手写", "便签", "贴纸", "胶片", "开箱", "清单", "不伪造评价"} {
		if !strings.Contains(text, want) {
			t.Errorf("xiaohongshu guide lacks %q: %s", want, text)
		}
	}
	if red.Key != "xiaohongshu" || !strings.Contains(red.Label, "小红书") {
		t.Fatalf("xiaohongshu guide = %+v", red)
	}
	for id, family := range map[string]string{"pdd": "pdd", "pinduoduo": "pdd", "拼多多": "pdd", "taobao": "shelf", "tmall": "shelf", "jd": "shelf", "amazon": "listing", "ebay": "listing", "walmart": "listing", "aliexpress": "listing", "douyin": "short-video", "kuaishou": "short-video", "1688": "wholesale", "shopify": "indie", "tiktok": "mobile-cross", "temu": "mobile-cross", "ozon": "mobile-cross", "wechat-shop": "wechat", "video-shop": "wechat", "Amazon": "listing", "unknown-market": "default"} {
		if got := PlatformGuideFor(id); got.Key != family {
			t.Errorf("%s maps to %s, want %s", id, got.Key, family)
		}
	}
	amazon := PlatformGuideFor("amazon")
	if !strings.Contains(amazon.Label, "Amazon") || !strings.Contains(amazon.Layout, "RGB 255") || !strings.Contains(amazon.Layout, "85%") || !strings.Contains(amazon.Layout, "无文字") {
		t.Fatalf("amazon guide lacks the listing main image rule: %+v", amazon)
	}
	if pdd := PlatformGuideFor("pdd"); !strings.Contains(pdd.Label, "拼多多") || !strings.Contains(pdd.Layout, "组合") {
		t.Fatalf("pdd guide = %+v", pdd)
	}
	if taobao := PlatformGuideFor("taobao"); !strings.Contains(taobao.Label, "淘宝") || !strings.Contains(taobao.Layout, "卖点总览") || !strings.Contains(taobao.UIKit, "规格卡") {
		t.Fatalf("taobao guide = %+v", taobao)
	}
	if unknown := PlatformGuideFor("unknown-market"); !strings.Contains(unknown.Label, "unknown-market") {
		t.Fatalf("unknown platform lost its name: %+v", unknown)
	}
	styles := map[string]bool{}
	for _, preset := range StyleLibrary {
		styles[preset.Label] = true
	}
	for _, id := range webPlatformIDs {
		guide := PlatformGuideFor(id)
		if guide.Key == "default" || len(guide.Routes) < 4 || len(guide.Routes) > 6 {
			t.Errorf("%s has no specific guide: %+v", id, guide)
		}
		for _, route := range guide.Routes {
			if !styles[route] {
				t.Errorf("%s route %q is not a style library preset", id, route)
			}
		}
	}
	guide := PlatformGuideFor("shopee")
	guide.Routes[0] = "changed"
	if PlatformGuideFor("shopee").Routes[0] == "changed" {
		t.Fatal("PlatformGuideFor returned a shared routes slice")
	}
}

func TestPickDesignVariationMainLayoutsDifferEveryRun(t *testing.T) {
	in := VariationInput{ImageType: "main", Platform: "taobao", Category: "maternal", Count: 5, PeopleAllowed: true}
	first := PickDesignVariation(designTestRand(1), in)
	if len(first.Layouts) != 5 || len(slices.Compact(slices.Sorted(slices.Values(first.Layouts)))) != 5 {
		t.Fatalf("main layouts are not five distinct layouts: %q", first.Layouts)
	}
	if first.UIKit == "" || first.Typography == "" || len(first.Scenes) == 0 || first.Signature == "" || first.Seed == "" {
		t.Fatalf("incomplete variation: %+v", first)
	}
	if again := PickDesignVariation(designTestRand(1), in); again.Signature != first.Signature {
		t.Fatal("the same seed drew a different variation")
	}
	second := PickDesignVariation(designTestRand(2), in)
	if second.Signature == first.Signature || slices.Equal(second.Layouts, first.Layouts) {
		t.Fatal("two seeds drew the same variation")
	}
	in.Avoid = []string{first.Signature}
	if avoided := PickDesignVariation(designTestRand(1), in); avoided.Signature == first.Signature {
		t.Fatal("an avoided signature was drawn again")
	}
	in.Avoid = append([]string{first.Signature}, first.Picks...)
	next := PickDesignVariation(designTestRand(1), in)
	for _, layout := range next.Layouts {
		if slices.Contains(first.Layouts, layout) {
			t.Fatalf("the next run reused layout %q", layout)
		}
	}
	if next.UIKit == first.UIKit || next.Typography == first.Typography || (first.Persona != "" && next.Persona == first.Persona) {
		t.Fatalf("the next run reused the UI kit, typography or persona:\n%+v\n%+v", first, next)
	}
}

func TestPickDesignVariationDetailFollowsPageRhythm(t *testing.T) {
	for _, count := range []int{9, 6, 12, 20, 30} {
		for seed := uint64(1); seed <= 60; seed++ {
			for _, people := range []bool{true, false} {
				v := PickDesignVariation(designTestRand(seed), VariationInput{ImageType: "detail", Platform: "taobao", Category: "maternal", Count: count, PeopleAllowed: people})
				if len(v.Layouts) != count {
					t.Fatalf("detail %d drew %d layouts", count, len(v.Layouts))
				}
				previous, closeups, components := "", 0, map[string]bool{}
				for i, layout := range v.Layouts {
					match := designComponentPattern.FindStringSubmatch(layout)
					if match == nil || !strings.Contains(layout, "商品状态：") {
						t.Fatalf("page %d has no allowed component or product state: %s", i+1, layout)
					}
					if match[1] == previous {
						t.Fatalf("seed %d count %d: pages %d and %d share %s:\n%s", seed, count, i, i+1, previous, strings.Join(v.Layouts, "\n"))
					}
					previous, components[match[1]] = match[1], true
					if designCloseupPattern.MatchString(layout) {
						closeups++
					}
				}
				if first := designComponentPattern.FindStringSubmatch(v.Layouts[0])[1]; first != "卖点总览" && first != "标题导语" {
					t.Fatalf("detail opens with %s", first)
				}
				if last := designComponentPattern.FindStringSubmatch(v.Layouts[count-1])[1]; last != "规格卡" && last != "留白收束" {
					t.Fatalf("detail closes with %s", last)
				}
				if closeups < 2 || len(components) < 4 {
					t.Fatalf("detail %d has %d close-ups and %d components", count, closeups, len(components))
				}
				if count <= 9 && len(slices.Compact(slices.Sorted(slices.Values(v.Layouts)))) != count {
					t.Fatalf("detail %d repeats a layout: %q", count, v.Layouts)
				}
				peoplePages := peopleLayouts(t, v)
				if people && (peoplePages < 3 || v.Persona == "") {
					t.Fatalf("detail with people has %d people pages, persona %q", peoplePages, v.Persona)
				}
				if !people && (peoplePages != 0 || v.Persona != "") {
					t.Fatalf("detail without people drew %d people pages, persona %q", peoplePages, v.Persona)
				}
			}
		}
	}
}

func TestPickDesignVariationFitsTypesAndPlatforms(t *testing.T) {
	white := PickDesignVariation(designTestRand(3), VariationInput{ImageType: "white", Platform: "taobao", Category: "beauty", Count: 4, PeopleAllowed: true})
	if white.Persona != "" || len(white.Scenes) != 0 || white.UIKit != "" || white.Typography != "" || len(white.Layouts) != 4 {
		t.Fatalf("white variation carries people, scenes or UI: %+v", white)
	}
	for _, layout := range white.Layouts {
		if !strings.Contains(layout, "纯白") || !strings.Contains(layout, "无道具、无文字") {
			t.Fatalf("white layout is not pure white: %s", layout)
		}
	}
	amazon := PickDesignVariation(designTestRand(4), VariationInput{ImageType: "main", Platform: "amazon", Category: "tech", Count: 5, PeopleAllowed: true})
	for _, layout := range amazon.Layouts {
		if !strings.Contains(layout, "RGB 255") || !strings.Contains(layout, "85%") {
			t.Fatalf("amazon main is not a compliant white image: %s", layout)
		}
	}
	if amazon.Persona != "" || amazon.UIKit != "" {
		t.Fatalf("amazon white main carries a persona or UI kit: %+v", amazon)
	}
	pair := VariationInput{ImageType: "set", Platform: "amazon", Category: "home", Count: 2, Distribution: "主图 1 张、副图 1 张", PeopleAllowed: true}
	for seed := uint64(1); seed <= 20; seed++ {
		v := PickDesignVariation(designTestRand(seed), pair)
		if len(v.Layouts) != 2 || !strings.Contains(v.Layouts[0], "RGB 255") || !strings.HasPrefix(v.Picks[1], "sec-") {
			t.Fatalf("amazon 主副图 = %q %q", v.Layouts, v.Picks)
		}
	}
	pair.Platform = "taobao"
	index := designIndex(t)
	fitsShelf := func(o designOption) bool {
		restricted := slices.ContainsFunc(o.tags, func(tag string) bool { return strings.HasPrefix(tag, "p:") })
		return !restricted || o.has("p:shelf")
	}
	for seed := uint64(1); seed <= 20; seed++ {
		v := PickDesignVariation(designTestRand(seed), pair)
		main := index[v.Picks[0]]
		if !slices.ContainsFunc(designMainLayouts, func(o designOption) bool { return o.id == main.id }) || !fitsShelf(main) || !strings.HasPrefix(v.Picks[1], "sec-") || !fitsShelf(index[v.Picks[1]]) {
			t.Fatalf("taobao 主副图 = %q %q", v.Layouts, v.Picks)
		}
	}
	set := PickDesignVariation(designTestRand(5), VariationInput{ImageType: "set", Platform: "taobao", Category: "food", Count: 8, PeopleAllowed: true})
	for i, name := range []string{"主图", "卖点总览", "细节特写", "使用场景", "多角度", "尺寸或规格", "场景二/人物", "收束"} {
		if !strings.HasPrefix(set.Layouts[i], name+"｜") {
			t.Fatalf("set image %d is not %s: %s", i+1, name, set.Layouts[i])
		}
	}
	if peopleLayouts(t, set) < 2 || set.Persona == "" {
		t.Fatalf("set with people allowed has no people pages: %+v", set)
	}
	short := PickDesignVariation(designTestRand(6), VariationInput{ImageType: "set", Platform: "amazon", Category: "food", Count: 5})
	if !strings.HasPrefix(short.Layouts[0], "主图｜合规") || !strings.HasPrefix(short.Layouts[4], "收束｜") || short.Persona != "" || peopleLayouts(t, short) != 0 {
		t.Fatalf("short amazon set without people = %q persona %q", short.Layouts, short.Persona)
	}
	sku := PickDesignVariation(designTestRand(7), VariationInput{ImageType: "sku", Platform: "jd", Category: "apparel", Count: 4})
	if len(sku.Layouts) != 4 || len(slices.Compact(slices.Clone(sku.Layouts))) != 1 {
		t.Fatalf("SKU images do not share one layout: %q", sku.Layouts)
	}
	quiet := PickDesignVariation(designTestRand(8), VariationInput{ImageType: "marketing", Platform: "xiaohongshu", Category: "beauty", Count: 3, NoText: true, PeopleAllowed: true})
	if quiet.Typography != "" || quiet.UIKit == "" || len(quiet.Layouts) != 3 {
		t.Fatalf("no-text marketing variation = %+v", quiet)
	}
	for _, layout := range quiet.Layouts {
		for _, o := range designMarketingLayouts {
			if o.text == layout && o.has("text") {
				t.Fatalf("no-text run drew a text layout: %s", layout)
			}
		}
	}
	for platform, cast := range map[string]string{"ozon": "东欧裔", "shopee": "东南亚裔", "amazon": "选角："} {
		v := PickDesignVariation(designTestRand(9), VariationInput{ImageType: "detail", Platform: platform, Category: "sport", Count: 9, PeopleAllowed: true})
		if !strings.Contains(v.Persona, cast) {
			t.Fatalf("%s persona lacks %s casting: %s", platform, cast, v.Persona)
		}
	}
	if domestic := PickDesignVariation(designTestRand(9), VariationInput{ImageType: "detail", Platform: "taobao", Category: "sport", Count: 9, PeopleAllowed: true}); strings.Contains(domestic.Persona, "选角：") {
		t.Fatalf("domestic persona got cross-border casting: %s", domestic.Persona)
	}
	for _, purpose := range []string{"商品主图", "商品副图", "Banner", "SKU 展示", "商品场景图", "自定义", ""} {
		v := PickDesignVariation(designTestRand(10), VariationInput{ImageType: "single", Platform: "tmall", Category: "home", Count: 1, Purpose: purpose, PeopleAllowed: true})
		if len(v.Layouts) != 1 || v.Layouts[0] == "" {
			t.Fatalf("single %q drew %q", purpose, v.Layouts)
		}
	}
}

func TestPickDesignVariationKeepsUIInsideTheSelectedStyle(t *testing.T) {
	index := designIndex(t)
	for style, group := range map[string]string{
		"安静治愈：晨光窗边的亚麻与原木托盘": "静谧治愈", "电音派对：暗场霓虹灯管与声波光效": "电音燃动", "潮流街头：涂鸦墙与撕纸拼贴": "潮流先锋",
		"都市通勤：高楼窗景前的通勤桌面": "都市质感", "活力萌趣：糖果色布景与手绘贴纸": "活力趣味",
	} {
		if got := designStyleGroup(style); got != group {
			t.Fatalf("%s matched style group %q, want %q", style, got, group)
		}
		for seed := uint64(1); seed <= 30; seed++ {
			v := PickDesignVariation(designTestRand(seed), VariationInput{ImageType: "detail", Platform: "taobao", Category: "general", Count: 9, PeopleAllowed: true, Style: style})
			for _, id := range v.Picks {
				if !strings.HasPrefix(id, "ui-") && !strings.HasPrefix(id, "ty-") {
					continue
				}
				entry := index[id]
				styled := slices.ContainsFunc(entry.tags, func(tag string) bool { return strings.HasPrefix(tag, "s:") })
				if styled && !entry.has("s:"+group) {
					t.Fatalf("%s drew %s outside the %s family", style, id, group)
				}
			}
		}
	}
	if designStyleGroup("") != "" || designStyleGroup("完全无关的描述") != "" {
		t.Fatal("an unknown style matched a style group")
	}
}

func TestFastDirectionsSystemForContentTypes(t *testing.T) {
	if FastDirectionsSystemFor("detail") != WorkbenchFastDirectionsSystem || !strings.Contains(FastDirectionsSystemFor("detail"), "推荐四套反差强烈的整套详情页视觉方向") {
		t.Fatal("detail directions prompt changed")
	}
	set := FastDirectionsSystemFor("set")
	if !strings.Contains(set, "推荐四套反差强烈的产品套图视觉方向") || strings.Contains(set, "整套详情页") || strings.Contains(set, "九屏节奏一句话") || !strings.Contains(set, `"narrative":"套图张与张的分工一句话"`) {
		t.Fatalf("set directions prompt still describes a detail page:\n%s", set)
	}
	for kind, want := range map[string]string{"main-secondary": "主副图组合", "single": "单张成品", "marketing": "营销物料", "white": "纯白背景（RGB 255）", "main": "商品主图", "three-view": "三视图"} {
		system := FastDirectionsSystemFor(kind)
		if !strings.Contains(system, want) || strings.Contains(system, "整套详情页") || !strings.Contains(system, `"recommendations"`) {
			t.Errorf("%s directions prompt lacks %q", kind, want)
		}
	}
	if white := FastDirectionsSystemFor("white"); strings.Index(white, "【白底图专属") > strings.Index(white, "只输出一个 JSON 对象") {
		t.Fatal("white rule is not placed before the output contract")
	}
}

func TestPlatformDirectionsBriefFitsPlatformAndType(t *testing.T) {
	for _, id := range append(slices.Clone(webPlatformIDs), "unknown-market", "") {
		for _, kind := range []string{"detail", "set", "main-secondary", "main", "white", "single", "marketing", "sku"} {
			brief := PlatformDirectionsBrief(id, kind)
			if n := utf8.RuneCountInString(brief); n > 500 || !strings.HasPrefix(brief, "【平台与类型适配】") || !strings.Contains(brief, "强反差") || !strings.Contains(brief, directionsRouteRule) {
				t.Fatalf("%s/%s brief has %d runes:\n%s", id, kind, n, brief)
			}
			// Every suitable route is listed under its family, so each family
			// starts from this platform's own routes.
			for _, route := range PlatformGuideFor(id).Routes {
				if !strings.Contains(brief, route) {
					t.Fatalf("%s/%s brief lacks route %s:\n%s", id, kind, route, brief)
				}
			}
		}
	}
	for _, want := range []string{"label 以该路线名开头", "母婴、食品、宠物不用电音赛博或赛博霓虹", "燃家族改用明亮克制的硬核实证或科技未来"} {
		if !strings.Contains(directionsRouteRule, want) {
			t.Fatalf("route rule lacks %q", want)
		}
	}
	if brief := PlatformDirectionsBrief("xiaohongshu", "detail"); !strings.Contains(brief, "静＝安静治愈、自然有机") || !strings.Contains(brief, "都市＝复古胶片、杂志编辑") || strings.Contains(brief, "燃＝") {
		t.Fatalf("xiaohongshu routes are not grouped by family:\n%s", brief)
	}
	if brief := PlatformDirectionsBrief("douyin", "detail"); !strings.Contains(brief, "燃＝电音赛博、运动机能") || !strings.Contains(brief, "潮＝痛点对比、多巴胺撞色、潮流街头、节日礼赠") {
		t.Fatalf("douyin routes are not grouped by family:\n%s", brief)
	}
	if strings.Contains(WorkbenchFastDirectionsSystem, "电音派对") || strings.Contains(WorkbenchFastDirectionsSystem, "都市通勤") || !strings.Contains(WorkbenchFastDirectionsSystem, "label 以所选路线名开头") {
		t.Fatal("the fast directions prompt still pins the same four example labels")
	}
	for _, family := range directionFamilies {
		for _, route := range family.routes {
			if !strings.Contains(WorkbenchFastDirectionsSystem, route) {
				t.Errorf("family %s route %s is missing from the fast directions prompt", family.name, route)
			}
		}
	}
	if brief := PlatformDirectionsBrief("amazon", "main"); !strings.Contains(brief, "RGB 255") || !strings.Contains(brief, "商品主图") {
		t.Fatalf("amazon main brief = %s", brief)
	}
	if brief := PlatformDirectionsBrief("xiaohongshu", "set"); !strings.Contains(brief, "笔记") || !strings.Contains(brief, "产品套图") || !strings.Contains(brief, "安静治愈") {
		t.Fatalf("xiaohongshu set brief = %s", brief)
	}
	if brief := PlatformDirectionsBrief("pdd", "main"); !strings.Contains(brief, "拼多多") || !strings.Contains(brief, "件数") {
		t.Fatalf("pdd brief = %s", brief)
	}
}

func TestDesignVariationPromptBlockListsTheDraw(t *testing.T) {
	v := PickDesignVariation(designTestRand(11), VariationInput{ImageType: "detail", Platform: "douyin", Category: "tech", Count: 9, PeopleAllowed: true})
	block := v.PromptBlock("detail")
	if !strings.HasPrefix(block, "【本轮版式方案·"+DesignPlaybookVersion+"】") || !strings.Contains(block, "随机抽取") || !strings.Contains(block, "优先于前文") || !strings.Contains(block, "informationComponent") {
		t.Fatalf("block header = %s", block)
	}
	for i, layout := range v.Layouts {
		if !strings.Contains(block, layout) {
			t.Fatalf("block lacks layout %d: %s", i+1, layout)
		}
	}
	for _, part := range append([]string{v.UIKit, v.Typography, v.Persona}, v.Scenes...) {
		if part == "" || !strings.Contains(block, part) {
			t.Fatalf("block lacks %q", part)
		}
	}
	outline := v.DetailOutline()
	if !slices.Equal(outline, v.Layouts) {
		t.Fatal("detail outline differs from the layouts")
	}
	outline[0] = "changed"
	if v.Layouts[0] == "changed" {
		t.Fatal("detail outline shares the layouts slice")
	}
	white := PickDesignVariation(designTestRand(12), VariationInput{ImageType: "white", Platform: "amazon", Count: 3})
	if block := white.PromptBlock("white"); !strings.Contains(block, "纯白合规") || strings.Contains(block, "UI 套件") || strings.Contains(block, "人物设定") {
		t.Fatalf("white block = %s", block)
	}
	sku := PickDesignVariation(designTestRand(13), VariationInput{ImageType: "sku", Platform: "jd", Category: "apparel", Count: 3})
	if block := sku.PromptBlock("sku"); !strings.Contains(block, "全部 3 张使用同一版式") || !strings.Contains(block, sku.Layouts[0]) {
		t.Fatalf("sku block = %s", block)
	}
}

// webListingPlatformIDs is the "listing" family of web/src/pages/ecommerce/
// platform-style.ts familyOf; ListingMainImage must agree with it exactly.
var webListingPlatformIDs = []string{"amazon", "walmart", "aliexpress", "emag", "coupang", "tiktok"}

func TestListingMainImageMirrorsTheWebRule(t *testing.T) {
	for _, id := range webPlatformIDs {
		listing := slices.Contains(webListingPlatformIDs, id)
		if got := ListingMainImage(id, "main", ""); got != listing {
			t.Errorf("%s main: listing main = %v, want %v", id, got, listing)
		}
		if got := ListingMainImage(id, "single", "商品主图"); got != listing {
			t.Errorf("%s single main: listing main = %v, want %v", id, got, listing)
		}
		// The visual family does not determine background policy.
		for _, other := range [][2]string{{"single", "Banner"}, {"secondary", ""}, {"set", ""}, {"detail", ""}, {"white", ""}} {
			if ListingMainImage(id, other[0], other[1]) {
				t.Errorf("%s %s/%s counted as a listing main image", id, other[0], other[1])
			}
		}
	}
}

// designMultiPattern names layouts that need several real colours, SKUs or
// pieces; every playbook entry that mentions one must carry the "multi" tag.
var designMultiPattern = regexp.MustCompile(`全家福|多色|多件|多款|SKU 阵列|款式目录|其他颜色|色系依次|只换款式`)

func TestDesignPlaybookTagsMultiVariantLayouts(t *testing.T) {
	multi := 0
	for id, o := range designIndex(t) {
		if designMultiPattern.MatchString(o.text) && !o.has("multi") {
			t.Errorf("%s implies several variants but is not tagged multi: %s", id, o.text)
		}
		if o.has("multi") {
			multi++
		}
	}
	if multi < 10 {
		t.Fatalf("only %d multi-variant entries are tagged", multi)
	}
	kinds := []string{"detail", "set", "main", "white", "sku", "single", "secondary", "marketing", "amazon-a-plus"}
	index := designIndex(t)
	drawn := map[bool]bool{}
	for _, variants := range []bool{false, true} {
		for _, platform := range []string{"taobao", "pdd", "1688", "amazon", "alibaba", "vipshop", "xiaohongshu"} {
			for _, kind := range kinds {
				for seed := uint64(1); seed <= 25; seed++ {
					in := VariationInput{ImageType: kind, Platform: platform, Category: "maternal", Count: 9, PeopleAllowed: true, MultiVariant: variants, Purpose: "Banner"}
					if kind == "sku" || kind == "white" {
						in.Count = 10
					}
					v := PickDesignVariation(designTestRand(seed), in)
					for _, id := range v.Picks[:len(v.Layouts)] {
						if index[id].has("multi") {
							if !variants {
								t.Fatalf("%s/%s single product drew multi-variant layout %s", platform, kind, id)
							}
							drawn[variants] = true
						}
					}
				}
			}
		}
	}
	if !drawn[true] {
		t.Fatal("a product with several variants never drew a multi-variant layout")
	}
}

func TestPickDesignVariationAvoidsRecentLayoutLists(t *testing.T) {
	in := VariationInput{ImageType: "set", Platform: "taobao", Category: "maternal", Count: 7, PeopleAllowed: true}
	var runs [][]string
	slots := make([]map[string]bool, 7)
	for i := range slots {
		slots[i] = map[string]bool{}
	}
	// Like the app's memory: entry ids of the last three runs, layout
	// signatures of every earlier run.
	seen := map[string]bool{}
	var layoutSignatures []string
	for run := 0; run < 8; run++ {
		in.Avoid = slices.Clone(layoutSignatures)
		for _, recent := range runs[max(0, len(runs)-3):] {
			in.Avoid = append(in.Avoid, recent...)
		}
		v := PickDesignVariation(designTestRand(uint64(100+run)), in)
		if !strings.HasPrefix(v.LayoutSignature, "layouts:") || seen[v.LayoutSignature] {
			t.Fatalf("run %d repeated a layout list or lacks its signature: %q", run, v.LayoutSignature)
		}
		seen[v.LayoutSignature] = true
		layoutSignatures = append(layoutSignatures, v.LayoutSignature)
		for i, layout := range v.Layouts {
			slots[i][layout] = true
		}
		runs = append(runs, append([]string{v.Signature}, v.Picks...))
	}
	// Slots 4–7 (使用场景, 多角度, 场景二/人物, 收束) rotate through at least
	// four layouts instead of flipping between two.
	for i := 3; i < 7; i++ {
		if len(slots[i]) < 4 {
			t.Fatalf("slot %d drew only %d layouts in eight runs", i+1, len(slots[i]))
		}
	}
	first := PickDesignVariation(designTestRand(7), in)
	in.Avoid = []string{first.LayoutSignature}
	for seed := uint64(7); seed < 12; seed++ {
		if again := PickDesignVariation(designTestRand(seed), in); again.LayoutSignature == first.LayoutSignature {
			t.Fatal("an avoided layout list was drawn again")
		}
	}
}

func TestDirectionsInspirationLineChangesPerRequest(t *testing.T) {
	first, second := DirectionsInspirationLine(designTestRand(1)), DirectionsInspirationLine(designTestRand(2))
	if first == second || !strings.HasPrefix(first, "【本轮灵感 #") || DirectionsInspirationLine(nil) == "" {
		t.Fatalf("inspiration lines = %q %q", first, second)
	}
}

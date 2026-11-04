package ecommerceagent

import (
	"strings"
	"testing"
)

func TestPlatformMatrixAndBlueprintCounts(t *testing.T) {
	if len(Platforms) != 9 {
		t.Fatalf("platform count=%d", len(Platforms))
	}
	amazon := Platforms["Amazon"]
	if amazon.MainSize != [2]int{2000, 2000} || amazon.ProductOccupancy != .85 || amazon.TitleMax != 200 || amazon.BulletMax != 5 || amazon.AplusSize != [2]int{970, 600} {
		t.Fatalf("Amazon platform rule drifted: %+v", amazon)
	}
	for _, tc := range []struct{ kind, requested, want int }{{100, 8, 1}, {101, 8, 1}, {102, 2, 5}, {103, 2, 5}, {103, 15, 9}, {200, 8, 8}, {400, 8, 4}} {
		pages := Plan(tc.requested, tc.kind, amazon, nil, Brief{Category: "行李箱"})
		if len(pages) != tc.want {
			t.Fatalf("type %d: got %d, want %d", tc.kind, len(pages), tc.want)
		}
		if pages[0].Role != "hero" || pages[0].NeedText {
			t.Fatalf("type %d hero rule: %+v", tc.kind, pages[0])
		}
		if pages[0].Shot == "" || len(pages[0].MustShow) == 0 {
			t.Fatalf("type %d lost blueprint: %+v", tc.kind, pages[0])
		}
	}
}

func TestSystemPromptsAreReadable(t *testing.T) {
	for _, prompt := range []string{SystemVision, SystemCopy, SystemRecommend, SystemPlanner, SystemHelpWrite} {
		if strings.ContainsRune(prompt, '\ufffd') || !strings.Contains(prompt, "电商") {
			t.Fatalf("damaged system prompt: %q", prompt[:min(len(prompt), 60)])
		}
	}
}

func TestMockPlanningKeepsProductFactsUnconfirmed(t *testing.T) {
	b := MockBrief("20寸行李箱，耐摔抗压")
	if b.Category != "行李箱" || len(b.Material) != 0 || len(b.Craft) != 0 || b.Confidence != 0 {
		t.Fatalf("mock invented image observations: %+v", b)
	}
	if !strings.Contains(strings.Join(b.VisualRisks, " "), "未查看图片") {
		t.Fatalf("missing mock disclosure: %+v", b)
	}
	p := Platforms["Amazon"]
	r := Recommend(b, p, 8)
	if len(r) < 4 || len(r) > 6 || r[0].NeedText || !strings.Contains(r[0].PreviewPrompt, "same product as reference image") {
		t.Fatalf("recommendations: %+v", r)
	}
	if got := Recommend(MockBrief("耳机"), p, 8); got[3].Label == r[3].Label {
		t.Fatalf("category did not change detail direction: %q", got[3].Label)
	}
}

func TestHeroCanvasNeverCarriesTextForRestrictedPlatform(t *testing.T) {
	p := Platforms["Amazon"]
	pages := Plan(5, 200, p, nil, MockBrief("耳机"))
	if len(pages) != 5 || pages[0].Role != "hero" || pages[0].NeedText {
		t.Fatalf("plan: %+v", pages)
	}
	for i := range pages {
		pages[i].URL = MockImage(pages[i], "耳机")
	}
	c := BuildCanvas(pages, p)
	images, texts := 0, 0
	for _, o := range c.Objects {
		if o.Type == "image" {
			images++
		}
		if o.Type == "i-text" {
			texts++
			if o.Top < 1224 {
				t.Fatalf("hero gained text: %+v", o)
			}
		}
	}
	if images != 5 || texts == 0 {
		t.Fatalf("canvas images=%d texts=%d", images, texts)
	}
}

func TestTextPreferenceHonorsLanguageAndExplicitNoText(t *testing.T) {
	platform := Platforms["Amazon"]
	pages := Plan(5, 200, platform, nil, Brief{Category: "扩香器"})
	ApplyTextPreference(pages, nil, "中文")
	if pages[0].NeedText || pages[1].Headline != "细节展示" || pages[1].Subline != "查看商品可见细节" {
		t.Fatalf("Chinese canvas copy: %+v", pages[:2])
	}
	noText := false
	ApplyTextPreference(pages, &noText, "中文")
	for i := range pages {
		pages[i].URL = MockImage(pages[i], "扩香器")
		if pages[i].NeedText || pages[i].Headline != "" || pages[i].Subline != "" {
			t.Fatalf("page %d kept text: %+v", i+1, pages[i])
		}
	}
	for _, object := range BuildCanvas(pages, platform).Objects {
		if object.Type == "i-text" {
			t.Fatalf("no-text canvas contains text layer: %+v", object)
		}
	}
}

func TestOnlySuccessfulPagesBecomeImageObjects(t *testing.T) {
	p := Platforms["Amazon"]
	pages := Plan(10, 200, p, nil, Brief{Category: "耳机"})
	for i := 0; i < 3; i++ {
		pages[i].URL = MockImage(pages[i], "耳机")
	}
	c := BuildCanvas(pages, p)
	images := 0
	for _, o := range c.Objects {
		if o.Type == "image" {
			images++
		}
	}
	if images != 3 || c.Meta["successPages"] != 3 {
		t.Fatalf("canvas count=%d meta=%v", images, c.Meta)
	}
}

func TestCanvasTextLayersHaveStableNamesAndScrim(t *testing.T) {
	p := Platforms["Amazon"]
	pages := []Page{
		{Index: 1, Role: "hero", AspectRatio: "1:1", NeedText: true, Headline: "Forbidden", URL: "hero.png"},
		{Index: 2, Role: "detail", AspectRatio: "1:1", NeedText: true, Headline: "Closer look", Subline: "Visible details", Bullets: []string{"Shape", "Color"}, URL: "detail.png"},
	}
	c := BuildCanvas(pages, p)
	names := make([]string, 0, len(c.Objects))
	for _, object := range c.Objects {
		names = append(names, object.Name)
		if object.Type == "i-text" && (!object.Editable || object.Selectable == nil || !*object.Selectable) {
			t.Fatalf("text layer is not editable: %+v", object)
		}
		if object.Name == "scrim_2" && (object.Opacity != .34 || object.Selectable == nil || *object.Selectable) {
			t.Fatalf("scrim contract: %+v", object)
		}
	}
	want := []string{"pageBg_1", "pageImage_1", "pageBg_2", "pageImage_2", "scrim_2", "headline_2", "subline_2", "bullet_2_1", "bullet_2_2"}
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("canvas layer order=%v, want %v", names, want)
	}
}

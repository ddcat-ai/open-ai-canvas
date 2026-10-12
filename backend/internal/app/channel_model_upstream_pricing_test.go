package app

import (
	"strings"
	"testing"
)

func TestUpstreamPricingURLUsesSiteRoot(t *testing.T) {
	cases := map[string]string{
		"https://suanliai.top/v1":     "https://suanliai.top/api/pricing",
		"https://suanliai.top/v1/":    "https://suanliai.top/api/pricing",
		"https://suanliai.top":        "https://suanliai.top/api/pricing",
		"https://img.yunfei.best/v1/": "https://img.yunfei.best/api/pricing",
		"http://127.0.0.1:8080/v1":    "http://127.0.0.1:8080/api/pricing",
	}
	for base, want := range cases {
		got, ok := upstreamPricingURL(base)
		if !ok || got != want {
			t.Fatalf("upstreamPricingURL(%q) = %q ok=%v, want %q", base, got, ok, want)
		}
	}
	for _, invalid := range []string{"", "suanliai.top/v1", "ftp://suanliai.top/v1", "://bad"} {
		if got, ok := upstreamPricingURL(invalid); ok {
			t.Fatalf("upstreamPricingURL(%q) 不应成功，得到 %q", invalid, got)
		}
	}
}

func TestParseUpstreamPricingAcceptsWrappedAndBare(t *testing.T) {
	wrapped := []byte(`{"success":true,"group_ratio":{"default":1},"data":[{"model_name":"a","model_price":1.5}]}`)
	items, ratio := parseUpstreamPricing(wrapped)
	if len(items) != 1 || items[0].ModelName != "a" || ratio["default"] != 1 {
		t.Fatalf("包装形态解析失败: %+v %+v", items, ratio)
	}
	bare := []byte(`[{"model_name":"b","model_ratio":2}]`)
	items, ratio = parseUpstreamPricing(bare)
	if len(items) != 1 || items[0].ModelName != "b" || ratio != nil {
		t.Fatalf("数组形态解析失败: %+v %+v", items, ratio)
	}
	if items, _ := parseUpstreamPricing([]byte(`{"msg":"not found"}`)); items != nil {
		t.Fatal("非价格目录不应被当成价格数据")
	}
}

func price(value float64) *float64 { return &value }

func TestFormatUpstreamPriceNoteCoversBillingModes(t *testing.T) {
	noRatio := map[string]float64{"default": 1}
	cases := []struct {
		name string
		item upstreamPricingItem
		want string
	}{
		{"按次", upstreamPricingItem{ModelPrice: price(1.5), BillingMode: "per_request"}, "¥1.5/次"},
		{"按秒", upstreamPricingItem{ModelPrice: price(0.65), BillingMode: "per_second"}, "¥0.65/秒"},
		{"视频多规格", upstreamPricingItem{ModelPrice: price(2), BillingMode: "video_multi"}, "¥2/秒"},
		{"视频每秒", upstreamPricingItem{VideoPricing: &upstreamVideoPricing{OutputPerSecond: price(0.68)}}, "¥0.68/秒"},
		{"按分辨率每秒", upstreamPricingItem{VideoPricing: &upstreamVideoPricing{ResolutionPerSecond: map[string]float64{"1080p": 1.2, "720p": 0.68}}}, "¥0.68/秒(720p)"},
		{"按 token 只有倍率", upstreamPricingItem{ModelRatio: price(2.5)}, "倍率 2.5x"},
		{"没有价格", upstreamPricingItem{}, ""},
		{"价格为零视为没有", upstreamPricingItem{ModelPrice: price(0)}, ""},
	}
	for _, tc := range cases {
		if got := formatUpstreamPriceNote(tc.item, noRatio); got != tc.want {
			t.Fatalf("%s: got %q want %q", tc.name, got, tc.want)
		}
	}
}

func TestFormatUpstreamPriceNoteAppliesGroupRatio(t *testing.T) {
	note := formatUpstreamPriceNote(upstreamPricingItem{ModelPrice: price(2)}, map[string]float64{"default": 1.9})
	if note != "¥3.8/次（分组倍率 ×1.9）" {
		t.Fatalf("分组倍率换算不正确: %q", note)
	}
	// 没有 default 分组时按 1 处理，不编造倍率。
	note = formatUpstreamPriceNote(upstreamPricingItem{ModelPrice: price(2)}, map[string]float64{"auto": 3})
	if note != "¥2/次" {
		t.Fatalf("缺少 default 分组时不应换算: %q", note)
	}
}

func TestUpstreamPriceNotesByCatalogKeyNormalizesNames(t *testing.T) {
	keyed := upstreamPriceNotesByCatalogKey(map[string]string{"MiniMax-H3": "¥1/次", "SD2.5": "¥2/次"})
	if len(keyed) != 2 {
		t.Fatalf("键数量不对: %+v", keyed)
	}
	if keyed[channelModelCatalogKey("minimax-h3")] != "¥1/次" {
		t.Fatalf("大小写/空白归一后应命中: %+v", keyed)
	}
	if upstreamPriceNotesByCatalogKey(nil) != nil {
		t.Fatal("空输入应返回 nil")
	}
}

func TestFormatPriceAmountTrimsTrailingZeros(t *testing.T) {
	cases := map[float64]string{1.5000: "1.5", 2: "2", 0.6500: "0.65", 1.85555: "1.8556"}
	for input, want := range cases {
		if got := formatPriceAmount(input); got != want {
			t.Fatalf("formatPriceAmount(%v) = %q want %q", input, got, want)
		}
	}
	if got := formatPriceAmount(0); got != "0" || strings.TrimSpace(got) == "" {
		t.Fatalf("零值应输出 0，得到 %q", got)
	}
}

// 用真实上游（suanliai.top/api/pricing）返回的条目做回归：字段名和取值形态都以线上为准，
// 免得以后靠猜改解析。
const realUpstreamPricingFixture = `{
  "success": true,
  "group_ratio": {"default": 1},
  "data": [
    {"model_name":"claude-sonnet-5-特价渠道3","model_ratio":0,"model_price":1.5,"billing_mode":"per_request","enable_groups":["default"]},
    {"model_name":"claude-opus-4-6-特价渠道4","model_ratio":0.275,"model_price":0,"completion_ratio":5,"enable_groups":["default"]},
    {"model_name":"003系列/sd2.5(官转不卡脸30-10-10/720P)","model_ratio":0,"model_price":0.65,"billing_mode":"per_second","enable_groups":["default"]},
    {"model_name":"官方直连sd2.0(满血全参不排队720P)","model_ratio":0,"model_price":0.68,"billing_mode":"video_multi","video_pricing":{"output_per_second":0.68,"resolution_per_second":{"720p":0.68},"ref_video_per_second":0.68}},
    {"model_name":"官方直连sd2.5(满血全参不排队1080P)","model_ratio":0,"model_price":2.29,"billing_mode":"video_multi","video_pricing":{"output_per_second":2.29,"resolution_per_second":{"1080p":2.4},"ref_video_per_second":2.29}}
  ]
}`

func TestRealUpstreamPricingFixtureProducesNotes(t *testing.T) {
	items, ratio := parseUpstreamPricing([]byte(realUpstreamPricingFixture))
	if len(items) != 5 {
		t.Fatalf("真实样例应解析出 5 条，得到 %d", len(items))
	}
	want := map[string]string{
		"claude-sonnet-5-特价渠道3":           "¥1.5/次",
		"claude-opus-4-6-特价渠道4":           "倍率 0.275x",
		"003系列/sd2.5(官转不卡脸30-10-10/720P)": "¥0.65/秒",
		"官方直连sd2.0(满血全参不排队720P)":          "¥0.68/秒",
		"官方直连sd2.5(满血全参不排队1080P)":         "¥2.29/秒",
	}
	for _, item := range items {
		got := formatUpstreamPriceNote(item, ratio)
		if got != want[item.ModelName] {
			t.Fatalf("%s: got %q want %q", item.ModelName, got, want[item.ModelName])
		}
	}
}

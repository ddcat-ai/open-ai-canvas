package emailtpl

import (
	"strings"
	"testing"
)

func TestRenderCodeEscapesAndKeepsCopyableCode(t *testing.T) {
	rendered, err := RenderCode(CodeEmail{Brand: "<b>影策</b>", Heading: "注册", Intro: "你正在注册", Code: "042517", Recipient: "a@example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(rendered.Subject, "042517 是你的") {
		t.Fatalf("subject = %q", rendered.Subject)
	}
	if strings.Contains(rendered.HTML, "<b>影策</b>") || !strings.Contains(rendered.HTML, "&lt;b&gt;") {
		t.Fatal("brand must be HTML-escaped")
	}
	if !strings.Contains(rendered.HTML, "user-select:all") || !strings.Contains(rendered.Text, "\n验证码：042517\n") {
		t.Fatal("code must be selectable in HTML and on its own line in text")
	}
}

func TestFormatCredits(t *testing.T) {
	for micro, want := range map[int64]string{0: "0", 1_000_000: "1", 1_234_567_890: "1,234.57", 500_000: "0.5", -2_050_000: "-2.05"} {
		if got := FormatCredits(micro); got != want {
			t.Fatalf("FormatCredits(%d) = %q, want %q", micro, got, want)
		}
	}
}

func TestRenderConsumptionReport(t *testing.T) {
	report := ConsumptionReport{Brand: "影策", UserName: "小王", Date: "2026-11-06", WeekdayName: "星期五",
		TotalMicro: 120_000_000, ConsumeMicro: 130_000_000, RefundMicro: 10_000_000, OrderCount: 12, AvailableMicro: 900_000_000, PreviousDayMicro: 60_000_000,
		Capabilities: []Slice{{Label: "视频生成", Micro: 100_000_000, Count: 4}, {Label: "图片生成", Micro: 30_000_000, Count: 8}},
		Models:       []Slice{{Label: "Seedance", Micro: 100_000_000, Count: 4}},
		TopOrders:    []OrderLine{{Time: "14:02", Model: "Seedance", Kind: "视频生成", Micro: 40_000_000}},
		WalletURL:    "https://canvas.example.com/wallet",
	}
	for i := 0; i < 7; i++ {
		report.Last7 = append(report.Last7, DayAmount{Label: "11-0" + string(rune('0'+i)), Micro: int64(i) * 20_000_000})
	}
	report.Hourly[14] = 130_000_000
	rendered, err := RenderConsumptionReport(report)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"120", "较昨日 ↑ 100%", "视频生成", "76.9%", "Seedance", "https://canvas.example.com/wallet", "今天"} {
		if !strings.Contains(rendered.HTML, want) {
			t.Fatalf("report HTML missing %q", want)
		}
	}
	if !strings.Contains(rendered.Subject, "11 月 6 日") || !strings.Contains(rendered.Text, "今日净消费：120 积分") {
		t.Fatalf("subject/text = %q / %q", rendered.Subject, rendered.Text)
	}
	if strings.Contains(rendered.HTML, "<script") || strings.Contains(rendered.HTML, "<svg") {
		t.Fatal("email HTML must not depend on script or SVG")
	}
}

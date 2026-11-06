package app

import (
	"strings"
	"testing"
	"unicode/utf8"
)

// 宿主组报文按模型声明的 promptMaxChars 收敛 prompt：image 与 video 能力各自
// 声明上限，0 或能力缺失表示未声明，不做收敛。
func TestDeclaredPromptMaxChars(t *testing.T) {
	cfg := &ModelCapabilityConfig{
		Image: &ImageCapabilityConfig{References: ImageReferenceConfig{PromptMaxChars: 6000}},
		Video: &VideoCapabilityConfig{References: VideoReferenceConfig{PromptMaxChars: 5000}},
	}
	for _, tt := range []struct {
		mode string
		cfg  *ModelCapabilityConfig
		want int
	}{
		{"image", cfg, 6000},
		{"video", cfg, 5000},
		{"text", cfg, 0},
		{"image", nil, 0},
		{"image", &ModelCapabilityConfig{}, 0},
	} {
		if got := declaredPromptMaxChars(tt.mode, tt.cfg); got != tt.want {
			t.Errorf("declaredPromptMaxChars(%q) = %d, want %d", tt.mode, got, tt.want)
		}
	}
}

// 超上限时保头尾截断：保住头部主体描述与尾部规则块，中段叙事让位。
func TestClipPromptToLimit(t *testing.T) {
	head := "商品主体描述"
	tail := "【排版安全规则】文字位于 8%–92% 安全区"
	long := head + "，" + strings.Repeat("场景叙事铺陈", 500) + tail
	got := clipPromptToLimit(long, 6000)
	if n := utf8.RuneCountInString(got); n > 6000 {
		t.Fatalf("clipped prompt %d runes, want <= 6000", n)
	}
	if !strings.Contains(got, head) {
		t.Fatalf("leading subject description lost")
	}
	if !strings.Contains(got, "【排版安全规则") {
		t.Fatalf("trailing rule block lost")
	}
	if short := clipPromptToLimit("short", 6000); short != "short" {
		t.Fatalf("under-limit prompt must be untouched: %q", short)
	}
}

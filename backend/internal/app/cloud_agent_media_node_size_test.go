package app

import (
	"math"
	"testing"
)

// 复现线上事故（run ag58de3169 之后的生成中节点）：size 传像素值 1536x2752 时，
// 旧的「a.Size == "9:16"」字面量特判不命中，草稿节点落到默认 720x405 横版框，
// 用户看到「标题写 9比16、框却是 16:9」。修复后比例与像素两种写法都按宽高比定框。
func TestCloudAgentMediaNodeDimensionsFollowRequestedAspect(t *testing.T) {
	cases := []struct {
		size         string
		wantWidth    float64
		wantHeight   float64
		wantPortrait bool
	}{
		{size: "9:16", wantWidth: 360, wantHeight: 640, wantPortrait: true},
		{size: "1536x2752", wantWidth: 640.0 * 1536.0 / 2752.0, wantHeight: 640, wantPortrait: true},
		{size: "16:9", wantWidth: 720, wantHeight: 405},
		{size: "3840x2160", wantWidth: 720, wantHeight: 405},
		{size: "3:4", wantWidth: 480, wantHeight: 640, wantPortrait: true},
		{size: "1:1", wantWidth: 540, wantHeight: 540},
	}
	for _, c := range cases {
		width, height, ok := cloudAgentMediaNodeDimensions(c.size)
		if !ok {
			t.Fatalf("%s: expected explicit dimensions", c.size)
		}
		if math.Abs(width-c.wantWidth) > 0.01 || math.Abs(height-c.wantHeight) > 0.01 {
			t.Fatalf("%s: frame = %v x %v, want %v x %v", c.size, width, height, c.wantWidth, c.wantHeight)
		}
		if (height > width) != c.wantPortrait {
			t.Fatalf("%s: portrait = %v", c.size, height > width)
		}
	}
}

// auto、空与无法解析的 size 保留节点类型默认框，不能把非法值放大成异常尺寸。
func TestCloudAgentMediaNodeDimensionsKeepsDefaultForUnresolvedSize(t *testing.T) {
	for _, size := range []string{"", "auto", "AUTO", "portraiti", "9:", "x2752", "0x0", "-16x9", "99999x1"} {
		if _, _, ok := cloudAgentMediaNodeDimensions(size); ok {
			t.Fatalf("%q should fall back to the default frame", size)
		}
	}
}

package app

import (
	"strings"
	"testing"
	"yingce/backend/internal/model"
)

func TestGenerationMediaAssetTitles(t *testing.T) {
	for _, tc := range []struct {
		name, prompt, input, want string
		index, count              int
	}{
		{"node", "提示词正文", `{"metadata":{"nodeId":"n","assetTitle":"雨夜重逢 · 主镜头"}}`, "雨夜重逢 · 主镜头", 0, 1},
		{"prompt", "  雨夜\n主角穿过街道  ", `{}`, "雨夜 主角穿过街道", 0, 1},
		{"multiple", "雨夜", `{}`, "雨夜 · 2", 1, 3},
		{"unicode", strings.Repeat("🌙", 49), `{}`, strings.Repeat("🌙", 48) + "…", 0, 1},
		{"empty", "", `{}`, "生成视频 · task-123", 0, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := generationMediaAssetTitle(model.Task{ID: "task-123456", Prompt: tc.prompt, InputJSON: tc.input}, "video", tc.index, tc.count)
			if got != tc.want {
				t.Fatalf("title=%q want=%q", got, tc.want)
			}
		})
	}
	context := taskClientContext(`{"metadata":{"assetTitle":"我的素材","apiKey":"not-public"}}`)
	if context == nil || context.AssetTitle != "我的素材" {
		t.Fatalf("missing asset title: %+v", context)
	}
}

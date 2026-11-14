package app

import "testing"

// 生成张数（2026-11-12）：画布「生成张数」必须真的传出去。
// 三条链路各有一个断点，这里逐个锁住：
//   1) providerConfig.Count → GenerationRequest.ImageCount（声明式插件用 request.imageCount）
//   2) providerConfig.Count → 上游请求体 n（OpenAI 兼容路径）
//   3) 非法/缺省值一律回落 1
func TestRequestedImageCount(t *testing.T) {
	cases := []struct {
		raw  string
		want int
	}{
		{"", 1}, {"0", 1}, {"-2", 1}, {"abc", 1}, {"1", 1}, {"3", 3}, {"5", 5}, {" 4 ", 4},
	}
	for _, tc := range cases {
		if got := requestedImageCount(tc.raw); got != tc.want {
			t.Fatalf("requestedImageCount(%q) = %d, want %d", tc.raw, got, tc.want)
		}
	}
}

func TestProtocolRequestCarriesImageCount(t *testing.T) {
	request := protocolRequestFromInput(canvasGenerationInput{
		Mode:   "image",
		Prompt: "一只橘猫",
		Config: providerConfig{Model: "doubao_image_1.0", InterfaceType: "doubao-web-image", Count: "4"},
	})
	if request.ImageCount != 4 {
		t.Fatalf("ImageCount = %d, want 4", request.ImageCount)
	}
	if request.Extra["count"] != "4" {
		t.Fatalf("Extra[count] = %#v, want 4", request.Extra["count"])
	}
}

func TestProtocolRequestCarriesCanvasNodeMetadata(t *testing.T) {
	request := protocolRequestFromInput(canvasGenerationInput{Mode: "image", Metadata: map[string]any{"nodeId": "node-a"}})
	if request.Metadata["nodeId"] != "node-a" {
		t.Fatalf("metadata = %#v", request.Metadata)
	}
}

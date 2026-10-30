package protocol

import (
	"context"
	"testing"
)

// 短剧续接段同时带首帧（上一段尾帧）和角色/场景参考图；adaptive 会被横版参考图带偏，必须按请求比例出片。
func TestMiniMaxVideoRatioWithFirstFrameAndReferences(t *testing.T) {
	adapter := officialPackageAdapter(t, "minimax-hailuo-video-v2.yingce-plugin", "minimax-video")
	firstFrame := MediaReference{Kind: "image", Role: "first_frame", URL: "https://cdn.example/first.png"}
	reference := MediaReference{Kind: "image", Role: "reference_image", URL: "https://cdn.example/cast.png", Order: 1}
	for _, tc := range []struct {
		name   string
		images []MediaReference
		ratio  string
		want   string
	}{
		{"first frame with references keeps requested ratio", []MediaReference{firstFrame, reference}, "9:16", "9:16"},
		{"first frame with references and no ratio", []MediaReference{firstFrame, reference}, "", "adaptive"},
		{"first frame only follows the frame", []MediaReference{firstFrame}, "9:16", "adaptive"},
		{"references only", []MediaReference{reference}, "9:16", "9:16"},
		{"text only defaults to landscape", nil, "", "16:9"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "MiniMax-H3", Prompt: "test", Images: tc.images, AspectRatio: tc.ratio, Duration: 15, Resolution: "768P"}})
			if err != nil {
				t.Fatal(err)
			}
			if got := manifestTestBody(t, spec)["ratio"]; got != tc.want {
				t.Fatalf("ratio = %v, want %s", got, tc.want)
			}
		})
	}
}

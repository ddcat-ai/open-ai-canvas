package app

import (
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func textTaskWithVideos(channelID, modelKey string, count int) map[string]any {
	videos := make([]any, 0, count)
	for index := 0; index < count; index++ {
		videos = append(videos, map[string]any{"storageKey": "resource:video-" + string(rune('a'+index)), "mimeType": "video/mp4", "bytes": 1024})
	}
	return map[string]any{
		"mode": "text", "prompt": "总结这段视频",
		"referenceVideos": videos,
		"config":          map[string]any{"channelId": channelID, "model": modelKey},
	}
}

func assertTextVideoRejected(t *testing.T, err error, issue, message string) {
	t.Helper()
	var argumentErr *modelCapabilityArgumentError
	if !errors.As(err, &argumentErr) || argumentErr.Field != "referenceNodeIds" || argumentErr.Issue != issue {
		t.Fatalf("text task with videos must be rejected with %s: %#v", issue, err)
	}
	if !strings.Contains(err.Error(), message) {
		t.Fatalf("message = %q, want %q", err.Error(), message)
	}
}

// 视频识别默认关闭：未勾选「支持视频识别」的文本模型在扣费前就拒绝参考视频。
func TestValidateTaskCapabilityRejectsVideosUntilTextVideoUnderstandingEnabled(t *testing.T) {
	svc, channel, channelModel := textVisionFixture(t, 4)
	assertTextVideoRejected(t, svc.ValidateTaskCapability(textTaskWithVideos(channel.ID, channelModel.ModelKey, 1)), "unsupported_value", "当前文字模型未开启视频识别")

	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "qwen-video")
	profile.Text.References.MaxImages = 9
	profile.Text.References.MaxVideos = 2
	videoSvc, _, videoChannel, videoModel := createSystemChannelSelectionFixture(t, "text", model.ChannelInterfaceChatCompletion, profile, []model.ChannelModelPriceTier{
		newSelectionPriceTier("text-video-tier", `{}`, "provider-text", "fixed_request"),
	})
	if err := videoSvc.ValidateTaskCapability(textTaskWithVideos(videoChannel.ID, videoModel.ModelKey, 2)); err != nil {
		t.Fatalf("video-capable text model must accept up to its limit: %v", err)
	}
	assertTextVideoRejected(t, videoSvc.ValidateTaskCapability(textTaskWithVideos(videoChannel.ID, videoModel.ModelKey, 3)), "item_count", "最多识别 2 个参考视频")
}

func TestValidateTaskCapabilityChecksDeclaredCustomTextVideoCapability(t *testing.T) {
	declared := func(maxVideos int) map[string]any {
		return map[string]any{
			"mode": "text", "prompt": "总结这段视频",
			"referenceVideos": []any{map[string]any{"dataUrl": "https://example.test/a.mp4", "mimeType": "video/mp4"}},
			"config": map[string]any{"interfaceType": string(model.ChannelInterfaceChatCompletion), "model": "custom-text",
				"capabilityConfig": map[string]any{"version": 1, "text": map[string]any{"references": map[string]any{"maxVideos": maxVideos, "promptMaxChars": 32000}}}},
		}
	}
	assertTextVideoRejected(t, (&Service{}).ValidateTaskCapability(declared(0)), "unsupported_value", "当前文字模型未开启视频识别")
	if err := (&Service{}).ValidateTaskCapability(declared(1)); err != nil {
		t.Fatalf("declared video understanding must pass: %v", err)
	}
}

func TestClaudeTextContentRejectsVideosInsteadOfDroppingThem(t *testing.T) {
	_, err := claudeTextContent(canvasGenerationInput{Prompt: "看视频", ReferenceVideos: []providerMedia{{DataURL: "data:video/mp4;base64,AAAA"}}})
	if err == nil || !strings.Contains(err.Error(), "不支持参考视频") {
		t.Fatalf("Claude text content must refuse videos, got %v", err)
	}
}

// 管理端「测试模型」：按能力构造最小测试请求并真实调用一次上游。

package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

func (s *Service) TestAdminChannelModel(ctx context.Context, actor *model.User, channelID string, req ChannelModelRequest) (*AdminChannelModelTestResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.adminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	modelKey, providerModelKey, capability, protocol, err := s.normalizeChannelModelContract(channel, req)
	if err != nil {
		return nil, err
	}
	if capability == "text" || capability == "image" || capability == "video" {
		if _, err := NormalizeModelCapabilityConfigForModel(capability, string(protocol), providerModelKey, req.CapabilityConfig); err != nil {
			return nil, err
		}
	}
	if strings.TrimSpace(channel.BaseURL) == "" || strings.TrimSpace(channel.APIKey) == "" {
		return nil, BadAuthRequest("请先在渠道中配置 Base URL 和 API Key")
	}
	if _, err := ValidateOutboundURL(channel.BaseURL); err != nil {
		return nil, err
	}
	headers, err := ParseOutboundHeadersJSON(channel.HeadersJSON)
	if err != nil {
		return nil, err
	}

	prompt := map[string]string{
		"text":  "Reply with OK.",
		"image": "A simple gray circle on a white background.",
		"video": "A static gray circle on a white background.",
		"audio": "Model test.",
	}[capability]
	videoSeconds := "6"
	videoSecondsValue := 6
	if protocol == model.ChannelInterfaceVolcengineJiMengVideo {
		videoSeconds = "5"
		videoSecondsValue = 5
	}
	imageSize, imageQuality := "", ""
	var imageProfile *ImageCapabilityConfig
	videoRatio, videoResolution := videoTestDefaults(nil)
	var videoProfile *VideoCapabilityConfig
	switch capability {
	case "image":
		profile, normalizeErr := NormalizeModelCapabilityConfigForModel(capability, string(protocol), providerModelKey, req.CapabilityConfig)
		if normalizeErr != nil {
			return nil, normalizeErr
		}
		imageProfile = profile.Image
		imageSize, imageQuality = imageTestDefaults(imageProfile)
	case "video":
		// 视频测试必须带上模型能力画像：声明式协议只按画像里的枚举回填分辨率名（如 480 -> 480p），
		// 没有画像时会把裸数字发给上游，火山方舟等供应商会直接拒绝。
		profile, normalizeErr := NormalizeModelCapabilityConfigForModel(capability, string(protocol), providerModelKey, req.CapabilityConfig)
		if normalizeErr != nil {
			return nil, normalizeErr
		}
		videoProfile = profile.Video
		videoRatio, videoResolution = videoTestDefaults(videoProfile)
	}
	input := canvasGenerationInput{
		Mode:   capability,
		Prompt: prompt,
		Config: providerConfig{
			ChannelID:          channel.ID,
			APIFormat:          channel.APIFormat,
			InterfaceType:      string(protocol),
			BaseURL:            channel.BaseURL,
			APIKey:             channel.APIKey,
			SecretKey:          channel.SecretKey,
			Headers:            headers,
			Model:              providerModelKey,
			ChannelModelKey:    modelKey,
			Size:               map[string]string{"image": imageSize, "video": videoRatio}[capability],
			Quality:            imageQuality,
			Count:              "1",
			VideoSeconds:       videoSeconds,
			VQuality:           videoResolution,
			VideoGenerateAudio: "false",
			VideoWatermark:     "false",
			AudioVoice:         "alloy",
			AudioFormat:        "mp3",
			AudioSpeed:         "1",
		},
		Metadata: map[string]interface{}{},
	}
	if capability == "image" {
		input.ImageCapability = imageProfile
	}
	if capability == "video" {
		input.VideoCapability = videoProfile
	}

	// 测试复用真实生成协议、运行时并发和熔断策略，但不创建用户任务或计费订单。
	testCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	testCtx = context.WithValue(testCtx, providerAnalyticsKey{}, providerAnalyticsContext{
		Service: s, Billing: s.taskBilling(), UserID: actor.ID, ChannelID: channel.ID, Capability: capability,
		Operation: "admin_model_test", Model: modelKey, VideoSeconds: videoSecondsValue,
	})
	testCtx = withProtocolRegistry(testCtx, s.protocolRegistry())
	startedAt := time.Now()
	switch capability {
	case "text":
		_, err = runTextTask(testCtx, input)
	case "image":
		_, err = runImageTask(testCtx, input)
	case "video":
		_, err = runVideoTask(testCtx, input)
	case "audio":
		_, err = runAudioTask(testCtx, input)
	}
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, context.DeadlineExceeded) {
			status = http.StatusGatewayTimeout
		}
		return nil, WrapAppError(status, "模型测试失败："+providerUserFacingErrorMessage(err), err)
	}
	return &AdminChannelModelTestResult{DurationMs: time.Since(startedAt).Milliseconds()}, nil
}

// 模型测试必须使用当前模型声明的默认参数，避免固定分辨率 SKU 被通用 1K 测试值误伤。
// videoTestDefaults 从模型能力画像取测试用的比例和分辨率；画像缺失时回退到最通用的 16:9 / 720。
func videoTestDefaults(profile *VideoCapabilityConfig) (string, string) {
	if profile == nil {
		return "16:9", "720"
	}
	ratio := strings.TrimSpace(profile.DefaultRatio)
	if ratio == "" && len(profile.Ratios) > 0 {
		ratio = strings.TrimSpace(profile.Ratios[0])
	}
	if ratio == "" {
		ratio = "16:9"
	}
	resolution := strings.TrimSpace(profile.DefaultResolution)
	if resolution == "" && len(profile.Resolutions) > 0 {
		resolution = strings.TrimSpace(profile.Resolutions[0])
	}
	if resolution == "" {
		resolution = "720"
	}
	return ratio, resolution
}

func imageTestDefaults(profile *ImageCapabilityConfig) (string, string) {
	if profile == nil {
		return "1024x1024", "auto"
	}
	size := ""
	if profile.Size.Parameter != "none" {
		size = strings.TrimSpace(profile.Size.Default)
	}
	quality := ""
	if profile.Quality.Supported {
		quality = strings.TrimSpace(profile.Quality.Default)
	}
	return size, quality
}

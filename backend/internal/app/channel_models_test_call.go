// 管理端「测试模型」：按能力构造最小测试请求并真实调用一次上游。

package app

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

func (s *Service) TestAdminChannelModel(ctx context.Context, actor *model.User, channelID string, req ChannelModelRequest) (*AdminChannelModelTestResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	channel, err := s.adminSystemChannel(channelID)
	if err != nil {
		return nil, err
	}
	release, err := selectModelRelease(s.protocolRegistry(), req.Protocol, req.ProtocolRelease, true)
	if err != nil {
		return nil, err
	}
	modelKey, providerModelKey, capability, protocol, err := normalizeChannelModelContractWithRegistry(release.Registry, channel, req)
	if err != nil {
		return nil, err
	}
	profile, err := NormalizeModelCapabilityConfigForModel(capability, string(protocol), providerModelKey, req.CapabilityConfig, release.Registry)
	if err != nil {
		return nil, err
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
			CapabilityConfig:   profile,
			Count:              "1",
			VideoGenerateAudio: "false",
			VideoWatermark:     "false",
			AudioVoice:         "alloy",
			AudioFormat:        "mp3",
			AudioSpeed:         "1",
		},
		Metadata: map[string]interface{}{},
	}
	var videoSeconds int
	switch capability {
	case "image":
		imageProfile := profile.Image
		input.ImageCapability = imageProfile
		input.Config.Size, input.Config.Quality = imageTestDefaults(imageProfile)
		if imageProfile.Parameters != nil {
			input.Config.ImageParameters = imageParameterDefaults(imageProfile.Parameters)
		}
		if imageProfile.Resolution.Supported {
			input.Config.ImageResolution = imageProfile.Resolution.Default
		}
		if err := applyImageParameterValues(&input.Config, imageProfile); err != nil {
			return nil, err
		}
	case "video":
		input.VideoCapability = profile.Video
		input.Config.Size, input.Config.VQuality = profile.Video.DefaultRatio, profile.Video.DefaultResolution
		videoSeconds = profile.Video.Duration.Default
		input.Config.VideoSeconds = strconv.Itoa(videoSeconds)
	}

	// 测试复用真实生成协议、运行时并发和熔断策略，但不创建用户任务或计费订单。
	testCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	testCtx = context.WithValue(testCtx, providerAnalyticsKey{}, providerAnalyticsContext{
		Service: s, Billing: s.taskBilling(), UserID: actor.ID, ChannelID: channel.ID, Capability: capability,
		Operation: "admin_model_test", Model: modelKey, VideoSeconds: videoSeconds, ProxyURL: channel.ProxyURL,
	})
	testCtx = withProtocolRegistry(testCtx, release.Registry)
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

func imageTestDefaults(profile *ImageCapabilityConfig) (string, string) {
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

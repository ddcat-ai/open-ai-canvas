// 按模型能力配置校验生成任务：尺寸、质量、时长、比例、参考数量与提示词长度。
//
// 校验在任务创建前完成，不合规的请求直接拒绝，不会产生计费订单。

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

func validateTextCapabilityConfig(value *TextCapabilityConfig) error {
	if value.ContextWindowTokens < 4096 || value.ContextWindowTokens > 10000000 {
		return BadAuthRequest("文本模型上下文窗口必须在 4096-10000000 Token 之间")
	}
	if value.MaxOutputTokens < 256 || value.MaxOutputTokens > 1000000 || value.MaxOutputTokens >= value.ContextWindowTokens {
		return BadAuthRequest("文本模型最大输出 Token 必须小于上下文窗口且在 256-1000000 之间")
	}
	if value.References.PromptMaxChars < 1 || value.References.PromptMaxChars > 1000000 {
		return BadAuthRequest("提示词最大字符数必须在 1-1000000 之间")
	}
	for name, number := range map[string]int{"最大图片引用数": value.References.MaxImages, "最大视频引用数": value.References.MaxVideos} {
		if number < 0 || number > 100 {
			return BadAuthRequest(name + "必须在 0-100 之间")
		}
	}
	if value.References.MaxImageBytes < 0 || value.References.MaxVideoBytes < 0 {
		return BadAuthRequest("引用素材大小限制不能小于 0")
	}
	return nil
}

func validateImageCapabilityConfig(value *ImageCapabilityConfig) error {
	if value.References.PromptMaxChars < 1 || value.References.PromptMaxChars > 1000000 {
		return BadAuthRequest("提示词最大字符数必须在 1-1000000 之间")
	}
	if value.References.MaxImages < 0 || value.References.MaxImages > 100 || value.References.MaxImageBytes < 0 {
		return BadAuthRequest("图片引用限制无效")
	}
	if value.MaxOutputs < 1 || value.MaxOutputs > 100 {
		return BadAuthRequest("单次图片数量必须在 1-100 之间")
	}
	switch value.Size.Parameter {
	case "none":
		value.Size.Values = []string{}
		value.Size.Presets = nil
		value.Size.Default = "auto"
		value.Size.AllowCustom = false
	case "size", "aspect_ratio":
		if strings.TrimSpace(value.Size.Default) == "" {
			return BadAuthRequest("请配置默认图片尺寸或比例")
		}
		if !value.Size.AllowCustom && !containsCapabilityString(value.Size.Values, value.Size.Default) {
			return BadAuthRequest("默认图片尺寸必须属于支持值")
		}
	default:
		return BadAuthRequest("尺寸参数仅支持不发送、size 或 aspect_ratio")
	}
	seenPresets := make(map[string]bool)
	for _, preset := range value.Size.Presets {
		if preset.Tier != "1k" && preset.Tier != "2k" && preset.Tier != "4k" {
			return BadAuthRequest("图片分辨率档位仅支持 1K、2K、4K")
		}
		parts := strings.Split(preset.Ratio, ":")
		if len(parts) != 2 {
			return BadAuthRequest("图片预设比例格式无效")
		}
		w, ew := strconv.Atoi(parts[0])
		h, eh := strconv.Atoi(parts[1])
		if ew != nil || eh != nil || w <= 0 || h <= 0 || w > 100000 || h > 100000 || max(w, h) > min(w, h)*3 {
			return BadAuthRequest("图片预设比例无效")
		}
		if preset.Width <= 0 || preset.Height <= 0 || max(preset.Width, preset.Height) > 3840 || max(preset.Width, preset.Height) > min(preset.Width, preset.Height)*3 || preset.Width*preset.Height < 655360 || preset.Width*preset.Height > 8294400 || preset.Size != fmt.Sprintf("%dx%d", preset.Width, preset.Height) {
			return BadAuthRequest("图片预设像素尺寸无效")
		}
		// 容许像素取整误差，但不能将横屏尺寸标记成竖屏或其他比例。
		difference := preset.Width*h - preset.Height*w
		if difference < 0 {
			difference = -difference
		}
		if difference*1000 > preset.Height*w*25 {
			return BadAuthRequest("图片预设像素尺寸与宽高比不一致")
		}
		a, b := w, h
		for b != 0 {
			a, b = b, a%b
		}
		key := fmt.Sprintf("%s:%d:%d", preset.Tier, w/a, h/a)
		if seenPresets[key] {
			return BadAuthRequest("图片尺寸预设重复")
		}
		seenPresets[key] = true
		requestValue := preset.Size
		if value.Size.Parameter == "aspect_ratio" {
			requestValue = preset.Ratio
		}
		if !containsCapabilityString(value.Size.Values, requestValue) {
			return BadAuthRequest("图片预设必须包含在尺寸支持值中")
		}
	}
	if value.Quality.Supported {
		if len(value.Quality.Values) == 0 || strings.TrimSpace(value.Quality.Default) == "" || !containsCapabilityString(value.Quality.Values, value.Quality.Default) {
			return BadAuthRequest("请配置图片质量支持值和默认值")
		}
	} else {
		value.Quality.Values = []string{}
		value.Quality.Default = "auto"
	}
	if err := validateImagePresetSelection(value, value.Quality.Default, value.Size.Default); err != nil {
		return BadAuthRequest("默认图片分辨率与宽高比不在已配置的组合中")
	}
	if !value.TransparentBackground.Supported {
		value.TransparentBackground.Default = false
	}
	return nil
}

func validateVideoCapabilityConfig(value *VideoCapabilityConfig) error {
	if value.References.PromptMaxChars < 1 || value.References.PromptMaxChars > 1000000 {
		return BadAuthRequest("提示词最大字符数必须在 1-1000000 之间")
	}
	for name, number := range map[string]int{"最少图片引用数": value.References.MinImages, "最大图片引用数": value.References.MaxImages, "最大视频引用数": value.References.MaxVideos, "最大音频引用数": value.References.MaxAudios} {
		if number < 0 || number > 100 {
			return BadAuthRequest(name + "必须在 0-100 之间")
		}
	}
	if value.References.MinImages > value.References.MaxImages {
		return BadAuthRequest("最少图片引用数不能超过最大图片引用数")
	}
	if value.References.MaxImageBytes < 0 || value.References.MaxVideoBytes < 0 || value.References.MaxAudioBytes < 0 || value.References.MaxVideoDuration < 0 || value.References.MaxAudioDuration < 0 {
		return BadAuthRequest("引用素材限制不能小于 0")
	}
	if err := validateVideoDuration(value.Duration); err != nil {
		return err
	}
	if len(value.Ratios) == 0 {
		if strings.TrimSpace(value.DefaultRatio) != "" {
			return BadAuthRequest("未配置画面比例时不能设置默认比例")
		}
	} else if strings.TrimSpace(value.DefaultRatio) == "" || !containsCapabilityString(value.Ratios, value.DefaultRatio) {
		return BadAuthRequest("默认画面比例必须属于支持值")
	}
	if len(value.Resolutions) == 0 {
		if strings.TrimSpace(value.DefaultResolution) != "" {
			return BadAuthRequest("未配置输出分辨率时不能设置默认分辨率")
		}
	} else if strings.TrimSpace(value.DefaultResolution) == "" || !containsCapabilityString(value.Resolutions, value.DefaultResolution) {
		return BadAuthRequest("默认输出分辨率必须属于支持值")
	}
	if len(value.Operations) == 0 || strings.TrimSpace(value.DefaultOperation) == "" || !containsCapabilityString(value.Operations, value.DefaultOperation) {
		return BadAuthRequest("请至少配置一个生成模式，并选择默认模式")
	}
	return nil
}

func validateVideoDuration(value VideoDurationConfig) error {
	switch value.Selection {
	case "range":
		if value.Min < 1 || value.Max < value.Min || value.Max > 3600 || value.Step < 1 || value.Default < value.Min || value.Default > value.Max || (value.Default-value.Min)%value.Step != 0 {
			return BadAuthRequest("视频时长范围或默认值无效")
		}
	case "enum":
		if len(value.Values) == 0 || len(value.Values) > 100 {
			return BadAuthRequest("视频固定时长至少需要一个选项")
		}
		values := append([]int(nil), value.Values...)
		sort.Ints(values)
		for index, item := range values {
			if item < 1 || item > 3600 || (index > 0 && values[index-1] == item) {
				return BadAuthRequest("视频固定时长选项无效或重复")
			}
		}
		if !containsInt(values, value.Default) {
			return BadAuthRequest("视频默认时长必须属于固定时长选项")
		}
	default:
		return BadAuthRequest("视频时长选择方式仅支持范围或固定值")
	}
	return nil
}

func (s *Service) ValidateTaskCapability(input map[string]any) error {
	encoded, err := json.Marshal(input)
	if err != nil {
		return BadAuthRequest("任务输入格式无效")
	}
	var taskInput canvasGenerationInput
	if err := json.Unmarshal(encoded, &taskInput); err != nil || (taskInput.Mode != "image" && taskInput.Mode != "video" && taskInput.Mode != "audio") {
		return nil
	}
	if isWorkflowProviderInterface(taskInput.Config.InterfaceType) {
		if err := validateWorkflowProviderPromptLength(taskInput); err != nil {
			return err
		}
		return validateWorkflowProviderConfig(taskInput.Mode, taskInput.Config)
	}
	// 普通音频模型沿用主线的能力校验路径；当前专用能力表只覆盖图片和视频。
	if taskInput.Mode == "audio" {
		return nil
	}
	channelID := strings.TrimSpace(taskInput.Config.ChannelID)
	if channelID == "" {
		channelID = systemChannelIDFromBaseURL(taskInput.Config.BaseURL)
	}
	if channelID == "" {
		if taskInput.Mode == "image" {
			profile := DefaultImageCapabilityConfig(taskInput.Config.InterfaceType, taskInput.Config.Model)
			if taskInput.Config.CapabilityConfig != nil && taskInput.Config.CapabilityConfig.Image != nil {
				profile = taskInput.Config.CapabilityConfig.Image
			}
			return validateImageTask(profile, taskInput)
		}
		profile := taskInput.Config.CapabilityConfig
		if profile == nil || profile.Video == nil {
			if taskInput.Config.InterfaceType != string(model.ChannelInterfaceAgnesVideo) {
				return nil
			}
			profile = DefaultModelCapabilityConfigForModel(taskInput.Config.InterfaceType, taskInput.Config.Model)
		}
		normalized, normalizeErr := NormalizeModelCapabilityConfigForModel("video", taskInput.Config.InterfaceType, taskInput.Config.Model, profile)
		if normalizeErr != nil || normalized == nil || normalized.Video == nil {
			return BadAuthRequest("当前视频模型能力参数无效")
		}
		applyAutoDLVideoScreenSpec(&taskInput, normalized.Video)
		if config, ok := input["config"].(map[string]any); ok {
			config["size"], config["vquality"] = taskInput.Config.Size, taskInput.Config.VQuality
		}
		return validateVideoTask(normalized.Video, taskInput)
	}
	item, err := s.repo.ChannelModelByKey(channelID, providerChannelModelKey(taskInput.Config))
	if err != nil {
		return BadAuthRequest("当前系统渠道模型未配置或已停用")
	}
	profile, err := DecodeModelCapabilityConfig(item.CapabilityConfigJSON)
	if taskInput.Mode == "image" {
		if err != nil {
			return BadAuthRequest("当前图片模型能力参数无效")
		}
		imageProfile := DefaultImageCapabilityConfig(string(item.Protocol), firstNonEmpty(item.ProviderModelKey, item.ModelKey))
		if profile != nil && profile.Image != nil {
			imageProfile = profile.Image
		}
		return validateImageTask(applyModelSpecificImageCapability(imageProfile, string(item.Protocol), firstNonEmpty(item.ProviderModelKey, item.ModelKey), taskInput.Config.APIFormat), taskInput)
	}
	if err != nil || profile == nil || profile.Video == nil {
		return BadAuthRequest("当前视频模型尚未配置能力参数")
	}
	normalized, normalizeErr := NormalizeModelCapabilityConfigForModel("video", string(item.Protocol), firstNonEmpty(item.ProviderModelKey, item.ModelKey), profile)
	if normalizeErr != nil || normalized == nil || normalized.Video == nil {
		return BadAuthRequest("当前视频模型能力参数无效")
	}
	applyAutoDLVideoScreenSpec(&taskInput, normalized.Video)
	applyFixedVideoResolution(&taskInput, normalized.Video)
	if config, ok := input["config"].(map[string]any); ok {
		config["size"] = taskInput.Config.Size
		config["vquality"] = taskInput.Config.VQuality
	}
	return validateVideoTask(normalized.Video, taskInput)
}

// applyModelSpecificImageCapability is retained as a narrow normalization hook
// for provider-specific image validation. The stored capability profile is
// already normalized when the channel model is saved, so no second override is
// needed here.
func applyModelSpecificImageCapability(profile *ImageCapabilityConfig, _ string, _ string, _ string) *ImageCapabilityConfig {
	return profile
}

// applyFixedVideoResolution 让单档位 SKU 的预扣、恢复和上游请求保持同一分辨率。
func applyFixedVideoResolution(input *canvasGenerationInput, profile *VideoCapabilityConfig) {
	if input == nil || profile == nil || len(profile.Resolutions) != 1 {
		return
	}
	if resolution := videoResolutionNameRequest(profile, profile.Resolutions[0]); resolution != "" {
		input.Config.VQuality = resolution
	}
}

func validateVideoTask(profile *VideoCapabilityConfig, input canvasGenerationInput) error {
	if profile == nil {
		return BadAuthRequest("当前视频模型能力参数无效")
	}
	if err := validateModelPromptLength("视频", input.Prompt, profile.References.PromptMaxChars); err != nil {
		return err
	}
	if len(input.ReferenceImages) > profile.References.MaxImages || len(input.ReferenceVideos) > profile.References.MaxVideos || len(input.ReferenceAudios) > profile.References.MaxAudios {
		return BadAuthRequest("参考素材数量超过当前模型限制")
	}
	if model.IsVolcengineArkVideoProtocol(model.ChannelInterfaceType(input.Config.InterfaceType)) && len(input.ReferenceAudios) > 0 && len(input.ReferenceImages) == 0 && len(input.ReferenceVideos) == 0 {
		return BadAuthRequest("火山方舟全模态参考不支持纯音频或文本+音频，请同时添加参考图片或参考视频")
	}
	if len(input.ReferenceImages) < profile.References.MinImages {
		return BadAuthRequest(fmt.Sprintf("当前视频模型至少需要 %d 张参考图", profile.References.MinImages))
	}
	for _, media := range input.ReferenceImages {
		if profile.References.MaxImageBytes > 0 && media.Bytes > profile.References.MaxImageBytes {
			return BadAuthRequest("参考图片文件超过当前模型大小限制")
		}
	}
	for _, media := range input.ReferenceVideos {
		if profile.References.MaxVideoBytes > 0 && media.Bytes > profile.References.MaxVideoBytes {
			return BadAuthRequest("参考视频文件超过当前模型大小限制")
		}
		if profile.References.MaxVideoDuration > 0 && media.DurationMs > int64(profile.References.MaxVideoDuration)*1000 {
			return BadAuthRequest("参考视频时长超过当前模型限制")
		}
	}
	for _, media := range input.ReferenceAudios {
		if profile.References.MaxAudioBytes > 0 && media.Bytes > profile.References.MaxAudioBytes {
			return BadAuthRequest("参考音频文件超过当前模型大小限制")
		}
		if profile.References.MaxAudioDuration > 0 && media.DurationMs > int64(profile.References.MaxAudioDuration)*1000 {
			return BadAuthRequest("参考音频时长超过当前模型限制")
		}
	}
	seconds, err := strconv.Atoi(strings.TrimSpace(input.Config.VideoSeconds))
	if err != nil || !videoDurationAllowed(profile.Duration, seconds) {
		return BadAuthRequest("视频时长不在当前模型支持范围内")
	}
	if input.Config.Size != "" && !videoRatioAllowed(profile.Ratios, input.Config.Size) {
		return BadAuthRequest("画面比例不在当前模型支持范围内")
	}
	if len(profile.Resolutions) > 0 && !isAutomaticVideoResolution(input.Config.VQuality) && videoResolutionNameRequest(profile, input.Config.VQuality) == "" {
		return BadAuthRequest("输出分辨率不在当前模型支持范围内")
	}
	operation := metadataString(input.Metadata, "videoEditOperation")
	if operation == "" {
		if len(input.ReferenceImages) > 0 {
			operation = "image_to_video"
		} else {
			operation = profile.DefaultOperation
		}
	}
	if !containsCapabilityString(profile.Operations, operation) {
		return BadAuthRequest("当前视频模型不支持该生成模式")
	}
	return nil
}

func validateImageTask(profile *ImageCapabilityConfig, input canvasGenerationInput) error {
	if profile == nil {
		return nil
	}
	modelName := strings.TrimPrefix(strings.ToLower(strings.TrimSpace(input.Config.Model)), "models/")
	if input.Config.InterfaceType == string(model.ChannelInterfaceGrokImage) && modelName == "grok-imagine-image-quality" {
		const maxPromptBytes = 8000
		promptBytes := len(withSystemPrompt(input.Config, input.Prompt))
		if promptBytes > maxPromptBytes {
			return BadAuthRequest(fmt.Sprintf("Grok 图片完整提示词为 %d UTF-8 字节，超过上游 %d 字节限制。系统不会自动删改；请精简当前输入、连线文本、角色卡、画风或模板内容后重试", promptBytes, maxPromptBytes))
		}
	}
	if len(input.ReferenceImages) > profile.References.MaxImages {
		return BadAuthRequest(fmt.Sprintf("当前图片模型最多支持 %d 张参考图", profile.References.MaxImages))
	}
	for _, media := range input.ReferenceImages {
		if profile.References.MaxImageBytes > 0 && media.Bytes > profile.References.MaxImageBytes {
			return BadAuthRequest("参考图片文件超过当前模型大小限制")
		}
	}
	if input.Mask != nil && !profile.References.MaskSupported {
		return BadAuthRequest("当前图片模型不支持蒙版编辑")
	}
	if profile.Size.Parameter != "none" && !profile.Size.AllowCustom && strings.TrimSpace(input.Config.Size) != "" && !containsCapabilityString(profile.Size.Values, input.Config.Size) {
		return BadAuthRequest("图片尺寸不在当前模型支持范围内")
	}
	if profile.Size.Parameter == "size" && profile.Size.AllowCustom && strings.HasPrefix(modelName, "gpt-image-2") && !containsCapabilityString(profile.Size.Values, input.Config.Size) {
		if err := validateGPTImage2CustomSize(input.Config.Size); err != nil {
			return BadAuthRequest(err.Error())
		}
	}
	quality := strings.TrimSpace(input.Config.Quality)
	if profile.Quality.Supported && quality != "" && !strings.EqualFold(quality, "auto") && !strings.EqualFold(quality, "any") && !containsCapabilityString(profile.Quality.Values, quality) {
		return BadAuthRequest("图片质量不在当前模型支持范围内")
	}
	if err := validateImagePresetSelection(profile, qualityForImageValidation(quality, profile.Quality.Default), firstNonEmpty(input.Config.Size, profile.Size.Default)); err != nil {
		return err
	}
	count, err := strconv.Atoi(strings.TrimSpace(input.Config.Count))
	if err == nil && count > profile.MaxOutputs {
		return BadAuthRequest(fmt.Sprintf("当前图片模型单次最多生成 %d 张", profile.MaxOutputs))
	}
	return nil
}

func qualityForImageValidation(quality string, fallback string) string {
	if strings.EqualFold(quality, "auto") || strings.EqualFold(quality, "any") {
		return fallback
	}
	return firstNonEmpty(quality, fallback)
}

func validateImagePresetSelection(profile *ImageCapabilityConfig, quality, ratio string) error {
	if profile.Size.Parameter != "aspect_ratio" || profile.Size.AllowCustom || len(profile.Size.Presets) == 0 || ratio == "auto" {
		return nil
	}
	tier := imageResolutionTier(quality)
	if tier == "" {
		return nil
	}
	for _, preset := range profile.Size.Presets {
		if preset.Tier == tier && preset.Ratio == ratio {
			return nil
		}
	}
	return BadAuthRequest("当前分辨率不支持所选图片宽高比")
}

func imageResolutionTier(quality string) string {
	switch strings.ToLower(strings.TrimSpace(quality)) {
	case "1k", "low":
		return "1k"
	case "2k", "medium":
		return "2k"
	case "4k", "high":
		return "4k"
	default:
		return ""
	}
}

func validateWorkflowProviderPromptLength(input canvasGenerationInput) error {
	profile := input.Config.CapabilityConfig
	if input.Mode != "video" || profile == nil || profile.Video == nil {
		return nil
	}
	return validateModelPromptLength("视频", input.Prompt, profile.Video.References.PromptMaxChars)
}

func validateModelPromptLength(label string, prompt string, maxChars int) error {
	if maxChars <= 0 {
		return nil
	}
	actualChars := utf8.RuneCountInString(prompt)
	if actualChars <= maxChars {
		return nil
	}
	return BadAuthRequest(fmt.Sprintf("当前%s模型提示词最多 %d 个字符，完整提示词为 %d 个字符。系统不会自动截断，请精简当前输入、连线内容或技能上下文后重试", label, maxChars, actualChars))
}

func validateGPTImage2CustomSize(value string) error {
	value = strings.ToLower(strings.TrimSpace(strings.ReplaceAll(value, "×", "x")))
	if value == "" || value == "auto" {
		return nil
	}
	parts := strings.Split(value, "x")
	if len(parts) != 2 {
		return errors.New("自定义图片尺寸请使用宽x高，例如 3840x1920")
	}
	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return errors.New("图片尺寸必须是正整数")
	}
	if width%16 != 0 || height%16 != 0 {
		return errors.New("图片尺寸宽高必须是 16 的倍数")
	}
	if max(width, height) > 3840 {
		return errors.New("图片尺寸最长边不能超过 3840px")
	}
	if max(width, height) > min(width, height)*3 {
		return errors.New("图片宽高比不能超过 3:1")
	}
	pixels := int64(width) * int64(height)
	if pixels < 655360 || pixels > 8294400 {
		return errors.New("图片总像素需在 655360 到 8294400 之间")
	}
	return nil
}

func videoDurationAllowed(value VideoDurationConfig, seconds int) bool {
	if value.Selection == "enum" {
		return containsInt(value.Values, seconds)
	}
	return seconds >= value.Min && seconds <= value.Max && value.Step > 0 && (seconds-value.Min)%value.Step == 0
}

func videoRatioAllowed(options []string, value string) bool {
	value = strings.TrimSpace(strings.ToLower(strings.ReplaceAll(value, "×", "x")))
	if containsCapabilityString(options, value) {
		return true
	}
	parts := strings.Split(value, "x")
	if len(parts) != 2 {
		return false
	}
	width, widthErr := strconv.ParseFloat(parts[0], 64)
	height, heightErr := strconv.ParseFloat(parts[1], 64)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return false
	}
	actual := width / height
	for _, option := range options {
		candidate := ratioValue(option)
		if candidate > 0 && absFloat(candidate-actual)/candidate < 0.01 {
			return true
		}
	}
	return false
}

func ratioValue(value string) float64 {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return 0
	}
	width, widthErr := strconv.ParseFloat(parts[0], 64)
	height, heightErr := strconv.ParseFloat(parts[1], 64)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return 0
	}
	return width / height
}

func normalizeResolution(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimSuffix(value, "p")
	if value == "2k" {
		return "1440p"
	}
	if value == "4k" {
		return "2160p"
	}
	return value + "p"
}

func containsCapabilityString(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(strings.TrimSpace(value), strings.TrimSpace(target)) {
			return true
		}
	}
	return false
}

func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func absFloat(value float64) float64 {
	if value < 0 {
		return -value
	}
	return value
}

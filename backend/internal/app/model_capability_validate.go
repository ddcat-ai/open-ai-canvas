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
		if value.Parameters == nil && strings.TrimSpace(value.Size.Default) == "" {
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
		if value.Parameters == nil && preset.Tier != "1k" && preset.Tier != "1.5k" && preset.Tier != "2k" && preset.Tier != "4k" {
			return BadAuthRequest("图片分辨率档位仅支持 1K、1.5K、2K、4K")
		}
		if value.Parameters != nil && value.Resolution.Supported && !containsCapabilityString(value.Resolution.Values, preset.Tier) {
			return BadAuthRequest("像素映射使用了未启用的分辨率")
		}
		parts := strings.Split(preset.Ratio, ":")
		if len(parts) != 2 {
			return BadAuthRequest("图片预设比例格式无效")
		}
		w, ew := strconv.Atoi(parts[0])
		h, eh := strconv.Atoi(parts[1])
		if ew != nil || eh != nil || w <= 0 || h <= 0 || w > 100000 || h > 100000 || value.Parameters == nil && max(w, h) > min(w, h)*3 {
			return BadAuthRequest("图片预设比例无效")
		}
		if preset.Width <= 0 || preset.Height <= 0 || max(preset.Width, preset.Height) > 100000 || preset.Size != fmt.Sprintf("%dx%d", preset.Width, preset.Height) {
			return BadAuthRequest("图片预设像素尺寸无效")
		}
		if value.Parameters == nil && (max(preset.Width, preset.Height) > 3840 || max(preset.Width, preset.Height) > min(preset.Width, preset.Height)*3 || preset.Width*preset.Height < 655360 || preset.Width*preset.Height > 8294400) {
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
		if value.Parameters == nil && (len(value.Quality.Values) == 0 || strings.TrimSpace(value.Quality.Default) == "" || !containsCapabilityString(value.Quality.Values, value.Quality.Default)) {
			return BadAuthRequest("请配置图片质量支持值和默认值")
		}
	} else {
		value.Quality.Values = []string{}
		value.Quality.Default = "auto"
	}
	if value.Resolution.Supported {
		if value.Parameters == nil && (len(value.Resolution.Values) == 0 || strings.TrimSpace(value.Resolution.Default) == "" || !containsCapabilityString(value.Resolution.Values, value.Resolution.Default)) {
			return BadAuthRequest("请配置图片分辨率支持值和默认值")
		}
	} else {
		value.Resolution.Values = []string{}
		value.Resolution.Default = "auto"
	}
	defaultTier := value.Quality.Default
	if value.Resolution.Supported {
		defaultTier = value.Resolution.Default
	}
	if err := validateImagePresetSelection(value, defaultTier, value.Size.Default); err != nil {
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
			normalized, err := NormalizeModelCapabilityConfigForModel("image", taskInput.Config.InterfaceType, taskInput.Config.Model, &ModelCapabilityConfig{Version: 1, Image: profile}, s.protocolRegistry())
			if err != nil {
				return err
			}
			profile = normalized.Image
			if profile.Parameters == nil {
				fillMissingImageSizePresets(profile, taskInput.Config.InterfaceType)
			}
			if presetErr := imageSizePresetReadyError(profile, taskInput.Config.InterfaceType); presetErr != nil {
				return presetErr
			}
			return validateImageTaskWithResolvedSize(input, &taskInput, profile)
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
		profile, err = normalizedChannelModelCapability(item, s.protocolRegistry())
		if err != nil {
			return BadAuthRequest("当前图片模型能力参数无效")
		}
		imageProfile := DefaultImageCapabilityConfig(string(item.Protocol), firstNonEmpty(item.ProviderModelKey, item.ModelKey))
		if profile != nil && profile.Image != nil {
			imageProfile = profile.Image
		}
		imageProfile = applyModelSpecificImageCapability(imageProfile, string(item.Protocol), firstNonEmpty(item.ProviderModelKey, item.ModelKey), taskInput.Config.APIFormat)
		// 旧线路没有换算表时按声明的档位补齐；补不齐就失败关闭，不能静默按 1K 出图。
		if imageProfile.Parameters == nil {
			fillMissingImageSizePresets(imageProfile, string(item.Protocol))
		}
		if presetErr := imageSizePresetReadyError(imageProfile, string(item.Protocol)); presetErr != nil {
			return presetErr
		}
		return validateImageTaskWithResolvedSize(input, &taskInput, imageProfile)
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
		return newModelCapabilityArgumentError("referenceNodeIds", "item_count", BadAuthRequest("参考素材数量超过当前模型限制"))
	}
	if model.IsVolcengineArkVideoProtocol(model.ChannelInterfaceType(input.Config.InterfaceType)) && len(input.ReferenceAudios) > 0 && len(input.ReferenceImages) == 0 && len(input.ReferenceVideos) == 0 {
		return newModelCapabilityArgumentError("referenceNodeIds", "invalid_combination", BadAuthRequest("火山方舟全模态参考不支持纯音频或文本+音频，请同时添加参考图片或参考视频"))
	}
	if len(input.ReferenceImages) < profile.References.MinImages {
		return newModelCapabilityArgumentError("referenceNodeIds", "item_count", BadAuthRequest(fmt.Sprintf("当前视频模型至少需要 %d 张参考图", profile.References.MinImages)))
	}
	for _, media := range input.ReferenceImages {
		if profile.References.MaxImageBytes > 0 && media.Bytes > profile.References.MaxImageBytes {
			return newModelCapabilityArgumentError("referenceNodeIds", "unsupported_value", BadAuthRequest("参考图片文件超过当前模型大小限制"))
		}
	}
	for _, media := range input.ReferenceVideos {
		if profile.References.MaxVideoBytes > 0 && media.Bytes > profile.References.MaxVideoBytes {
			return newModelCapabilityArgumentError("referenceNodeIds", "unsupported_value", BadAuthRequest("参考视频文件超过当前模型大小限制"))
		}
		if profile.References.MaxVideoDuration > 0 && media.DurationMs > int64(profile.References.MaxVideoDuration)*1000 {
			return newModelCapabilityArgumentError("referenceNodeIds", "unsupported_value", BadAuthRequest("参考视频时长超过当前模型限制"))
		}
	}
	for _, media := range input.ReferenceAudios {
		if profile.References.MaxAudioBytes > 0 && media.Bytes > profile.References.MaxAudioBytes {
			return newModelCapabilityArgumentError("referenceNodeIds", "unsupported_value", BadAuthRequest("参考音频文件超过当前模型大小限制"))
		}
		if profile.References.MaxAudioDuration > 0 && media.DurationMs > int64(profile.References.MaxAudioDuration)*1000 {
			return newModelCapabilityArgumentError("referenceNodeIds", "unsupported_value", BadAuthRequest("参考音频时长超过当前模型限制"))
		}
	}
	seconds, err := strconv.Atoi(strings.TrimSpace(input.Config.VideoSeconds))
	if err != nil || !videoDurationAllowed(profile.Duration, seconds) {
		return newModelCapabilityArgumentError("durationSeconds", "unsupported_value", BadAuthRequest("视频时长不在当前模型支持范围内"))
	}
	if input.Config.Size != "" && !videoRatioAllowed(profile.Ratios, input.Config.Size) {
		return newModelCapabilityArgumentError("size", "unsupported_value", BadAuthRequest("画面比例不在当前模型支持范围内"))
	}
	if len(profile.Resolutions) > 0 && !isAutomaticVideoResolution(input.Config.VQuality) && videoResolutionNameRequest(profile, input.Config.VQuality) == "" {
		return newModelCapabilityArgumentError("quality", "unsupported_value", BadAuthRequest("输出分辨率不在当前模型支持范围内"))
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
		return newModelCapabilityArgumentError("logicalModelId", "unsupported_value", BadAuthRequest("当前视频模型不支持该生成模式"))
	}
	return nil
}

func validateImageTask(profile *ImageCapabilityConfig, input canvasGenerationInput) error {
	if profile == nil {
		return nil
	}
	if profile.Parameters != nil {
		if _, err := resolveImageParameterValues(profile.Parameters, input.Config.ImageParameters); err != nil {
			return err
		}
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
		return newModelCapabilityArgumentError("referenceNodeIds", "item_count", BadAuthRequest(fmt.Sprintf("当前图片模型最多支持 %d 张参考图", profile.References.MaxImages)))
	}
	for _, media := range input.ReferenceImages {
		if profile.References.MaxImageBytes > 0 && media.Bytes > profile.References.MaxImageBytes {
			return newModelCapabilityArgumentError("referenceNodeIds", "unsupported_value", BadAuthRequest("参考图片文件超过当前模型大小限制"))
		}
	}
	if input.Mask != nil && !profile.References.MaskSupported {
		return newModelCapabilityArgumentError("logicalModelId", "unsupported_value", BadAuthRequest("当前图片模型不支持蒙版编辑"))
	}
	quality := strings.TrimSpace(input.Config.Quality)
	resolution := strings.TrimSpace(input.Config.ImageResolution)
	if profile.Resolution.Supported && resolution != "" && !strings.EqualFold(resolution, "auto") && !strings.EqualFold(resolution, "any") && !containsCapabilityString(profile.Resolution.Values, resolution) {
		return newModelCapabilityArgumentError("imageResolution", "unsupported_value", BadAuthRequest("图片分辨率不在当前模型支持范围内"))
	}
	selectionTier := quality
	if profile.Resolution.Supported {
		selectionTier = resolution
	}
	// 比例型线路会在任务输入边界把画布比例换算成 preset 像素值（OpenAI Images 只收
	// WIDTHxHEIGHT）。换算结果必须继续通过同一套尺寸与分辨率校验。
	resolvedRatio := imageSizeRatioForDeclaredPreset(profile, input.Config.Size, qualityForImageValidation(selectionTier, profile.Resolution.Default))
	if profile.Size.Parameter != "none" && !profile.Size.AllowCustom && strings.TrimSpace(input.Config.Size) != "" &&
		!containsCapabilityString(profile.Size.Values, input.Config.Size) && resolvedRatio == "" {
		return newModelCapabilityArgumentError("size", "unsupported_value", BadAuthRequest("图片尺寸不在当前模型支持范围内"))
	}
	if profile.Parameters == nil && profile.Size.Parameter == "size" && profile.Size.AllowCustom && strings.HasPrefix(modelName, "gpt-image-2") && !containsCapabilityString(profile.Size.Values, input.Config.Size) {
		if err := validateGPTImage2CustomSize(input.Config.Size); err != nil {
			return newModelCapabilityArgumentError("size", "unsupported_value", err)
		}
	}
	if profile.Quality.Supported && quality != "" && !strings.EqualFold(quality, "auto") && !strings.EqualFold(quality, "any") && !containsCapabilityString(profile.Quality.Values, quality) {
		return newModelCapabilityArgumentError("quality", "unsupported_value", BadAuthRequest("图片质量不在当前模型支持范围内"))
	}
	if err := validateImagePresetSelection(profile, qualityForImageValidation(selectionTier, firstNonEmpty(profile.Resolution.Default, profile.Quality.Default)), firstNonEmpty(resolvedRatio, input.Config.Size, profile.Size.Default)); err != nil {
		return err
	}
	count, err := strconv.Atoi(strings.TrimSpace(input.Config.Count))
	if err == nil && count > profile.MaxOutputs {
		return newModelCapabilityArgumentError("count", "unsupported_value", BadAuthRequest(fmt.Sprintf("当前图片模型单次最多生成 %d 张", profile.MaxOutputs)))
	}
	return nil
}

func validateImageTaskWithResolvedSize(input map[string]any, taskInput *canvasGenerationInput, profile *ImageCapabilityConfig) error {
	if profile.Parameters != nil {
		if err := applyImageParameterValues(&taskInput.Config, profile); err != nil {
			return err
		}
		if config, ok := input["config"].(map[string]any); ok {
			config["imageParameters"] = taskInput.Config.ImageParameters
			config["size"], config["quality"], config["imageResolution"] = taskInput.Config.Size, taskInput.Config.Quality, taskInput.Config.ImageResolution
			config["count"], config["transparentBackground"] = taskInput.Config.Count, taskInput.Config.TransparentBackground
		}
		return validateImageTask(profile, *taskInput)
	}
	if imageSizeResolutionAfterValidation(profile, taskInput.Config.InterfaceType) {
		if err := validateImageTask(profile, *taskInput); err != nil {
			return err
		}
		applyImageSizeResolution(input, taskInput, profile)
		return nil
	}
	applyImageSizeResolution(input, taskInput, profile)
	return validateImageTask(profile, *taskInput)
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
	tier := imagePresetSelectionTier(profile, quality)
	if tier == "" {
		return nil
	}
	for _, preset := range profile.Size.Presets {
		if preset.Tier == tier && preset.Ratio == ratio {
			return nil
		}
	}
	return newModelCapabilityArgumentError("size", "unsupported_value", BadAuthRequest("当前分辨率不支持所选图片宽高比"))
}

func imageSizeValueForDeclaredPreset(profile *ImageCapabilityConfig, size string, quality string) string {
	if profile == nil {
		return ""
	}
	preset, ok := declaredImageSizePreset(profile.Size.Presets, size, quality, imagePresetDefaultTier(profile))
	if !ok {
		return ""
	}
	if profile.Size.Parameter == "size" {
		return strings.TrimSpace(preset.Size)
	}
	return normalizeDeclaredImageRatio(preset.Ratio)
}

// imageSizeRatioForDeclaredPreset 把已声明的 preset 像素值还原成它对应的比例。比例型线路
// 会把画布比例换算成 preset 像素值（OpenAI Images 只收 WIDTHxHEIGHT），换算结果必须继续
// 通过同一套尺寸与分辨率校验。只认当前档位的 preset，避免用低档价格取到高档像素。
func imageSizeRatioForDeclaredPreset(profile *ImageCapabilityConfig, size string, quality string) string {
	if profile == nil {
		return ""
	}
	value := strings.TrimSpace(size)
	if value == "" || !strings.ContainsAny(value, "xX") {
		return ""
	}
	if preset, ok := declaredImageSizePreset(profile.Size.Presets, value, imagePresetSelectionTier(profile, quality), imagePresetDefaultTier(profile)); ok {
		return normalizeDeclaredImageRatio(preset.Ratio)
	}
	return ""
}

func declaredImageSizePreset(presets []ImageSizePreset, value string, quality string, fallbackQuality string) (ImageSizePreset, bool) {
	value = strings.TrimSpace(value)
	if value == "" || strings.EqualFold(value, "auto") {
		return ImageSizePreset{}, false
	}
	tier := strings.TrimSpace(quality)
	if tier == "" {
		tier = strings.TrimSpace(fallbackQuality)
	}
	ratio := ""
	if strings.Contains(value, ":") {
		ratio = normalizeDeclaredImageRatio(value)
	}
	for _, preset := range presets {
		if tier != "" && !strings.EqualFold(strings.TrimSpace(preset.Tier), tier) {
			continue
		}
		if (ratio != "" && normalizeDeclaredImageRatio(preset.Ratio) == ratio) || strings.EqualFold(strings.TrimSpace(preset.Size), value) {
			return preset, true
		}
	}
	return ImageSizePreset{}, false
}

func normalizeDeclaredImageRatio(value string) string {
	ratio := normalizeImageAspectRatio(value)
	left, right, found := strings.Cut(ratio, ":")
	if !found {
		return ratio
	}
	width, widthErr := strconv.Atoi(left)
	height, heightErr := strconv.Atoi(right)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return ratio
	}
	divisor := imageDimensionGCD(width, height)
	return strconv.Itoa(width/divisor) + ":" + strconv.Itoa(height/divisor)
}

func imageResolutionTier(quality string) string {
	switch strings.ToLower(strings.TrimSpace(quality)) {
	case "1k", "low":
		return "1k"
	case "1.5k":
		return "1.5k"
	case "2k", "medium":
		return "2k"
	case "4k", "high":
		return "4k"
	default:
		return ""
	}
}

func declaredImageResolutionTier(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "1k", "1.5k", "2k", "4k":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return ""
	}
}

// Legacy aliases are meaningful only when the model explicitly declares resolution tiers.
// Ordinary image quality never selects a pixel preset.
func imagePresetSelectionTier(profile *ImageCapabilityConfig, value string) string {
	if profile.Parameters != nil {
		if profile.Resolution.Supported && containsCapabilityString(profile.Resolution.Values, value) {
			return value
		}
		if !profile.Resolution.Supported {
			if tier, ok := singleImageSizeTier(profile); ok {
				return tier
			}
		}
		return ""
	}
	if tier := declaredImageResolutionTier(value); tier != "" {
		return tier
	}
	if profile.Resolution.Supported || (profile.Quality.Supported && profile.ResolutionUsesQuality) {
		return imageResolutionTier(value)
	}
	for _, quality := range profile.Quality.Values {
		if declaredImageResolutionTier(quality) != "" {
			return imageResolutionTier(value)
		}
	}
	return ""
}

func imagePresetDefaultTier(profile *ImageCapabilityConfig) string {
	if profile.Resolution.Supported {
		return imagePresetSelectionTier(profile, profile.Resolution.Default)
	}
	return imagePresetSelectionTier(profile, profile.Quality.Default)
}

// resolveImageTaskSize 把画布按比例保存的 size（如 16:9）换算成图片模型
// 声明的 preset 像素尺寸。声明式 OpenAI Images 协议把统一请求的 aspectRatio
// 原样映射到上游 size 字段，只认 WIDTHxHEIGHT 的上游会拒绝比例字符串，所以
// 换算必须在任务输入边界完成。未命中 preset 的组合不做猜测，交给能力校验给
// 出明确错误。
func resolveImageTaskSize(profile *ImageCapabilityConfig, interfaceType string, size string, quality string) string {
	if profile == nil {
		return size
	}
	value := strings.TrimSpace(size)
	if value == "" || strings.EqualFold(value, "auto") {
		return size
	}
	preset, ok := declaredImageSizePreset(activeImageSizePresets(profile), value, imagePresetSelectionTier(profile, quality), imagePresetDefaultTier(profile))
	if !ok {
		return size
	}
	if imageSizePixelOutbound(profile, interfaceType) {
		return preset.Size
	}
	if profile.Size.Parameter == "aspect_ratio" {
		return normalizeDeclaredImageRatio(preset.Ratio)
	}
	return size
}

// imageSizePixelOutbound 表示该线路出网需要像素尺寸，决定“比例 → 像素”换算是否发生。
// parameter=size 由字段本身要求像素；aspect_ratio 只在声明式 OpenAI Images 上被翻成像素。
func imageSizePixelOutbound(profile *ImageCapabilityConfig, protocol string) bool {
	if profile == nil {
		return false
	}
	if profile.Parameters != nil {
		for _, p := range profile.Parameters {
			if p.Name == "size" && p.IsEnabled() {
				return p.Encoding == "pixels"
			}
		}
		return false
	}
	if profile.Size.Parameter == "size" {
		return true
	}
	return profile.Size.Parameter == "aspect_ratio" && strings.TrimSpace(protocol) == string(model.ChannelInterfaceOpenAIImage)
}

// imageSizeClientSubmitsRatio 表示画布会按比例提交尺寸。size 字段里出现比例值属于历史
// 遗留形态：字段名说“发送像素”，值却是比例，同样需要换算表。
func imageSizeClientSubmitsRatio(profile *ImageCapabilityConfig) bool {
	if profile.Size.Parameter == "aspect_ratio" || profile.Size.AllowCustom {
		return true
	}
	if strings.Contains(profile.Size.Default, ":") {
		return true
	}
	for _, value := range profile.Size.Values {
		if strings.Contains(value, ":") {
			return true
		}
	}
	return false
}

// imageSizePresetMissingExact 是规则本体：出网需要像素、客户端按比例提交、没有换算表、
// 且确实有档位要被编码进尺寸。与 imageSizeResolutionEnabled 共用 imageSizePixelOutbound，
// 保证“需要换算”只有一个判断来源。size + 像素值 + 无预设表 的线路不需要换算，不能误伤。
func imageSizePresetMissingExact(profile *ImageCapabilityConfig, protocol string) bool {
	return imageSizePixelOutbound(profile, protocol) && len(profile.Size.Presets) == 0 && imageSizeClientSubmitsRatio(profile)
}

// imageSizePresetMissing 在规则本体上再要求“有可解析的档位”：没有档位声明的线路（如 ark、
// 即梦图片）档位不参与请求，用不着换算表，不能因为缺表就判为配置不完整。
func imageSizePresetMissing(profile *ImageCapabilityConfig, protocol string) bool {
	if !imageSizePresetMissingExact(profile, protocol) {
		return false
	}
	if profile.Parameters != nil {
		return true
	}
	return len(imageSizeDeclaredTiers(profile)) > 0
}

// imageSizeDeclaredTiers 取出该线路声明里可解析的分辨率档位。只有"档位要被编码进尺寸"的
// 线路才需要换算表：没有质量档位声明（例如 ark / 即梦图片）时，档位不参与请求，用不着表。
func imageSizeDeclaredTiers(profile *ImageCapabilityConfig) []string {
	tiers := make([]string, 0, 3)
	seen := make(map[string]bool, 3)
	add := func(value string) {
		tier := imageResolutionTier(value)
		if tier == "" || seen[tier] {
			return
		}
		seen[tier] = true
		tiers = append(tiers, tier)
	}
	if profile.Quality.Supported {
		for _, value := range profile.Quality.Values {
			add(value)
		}
	}
	add(profile.Quality.Default)
	return tiers
}

// imageSizeDeclaredRatios 取出该线路声明里按比例形式的支持值与默认值，归一化后去重。
func imageSizeDeclaredRatios(profile *ImageCapabilityConfig) []string {
	ratios := make([]string, 0, len(profile.Size.Values))
	seen := make(map[string]bool, len(profile.Size.Values)+1)
	add := func(value string) {
		if !strings.Contains(value, ":") {
			return
		}
		ratio := normalizeImageAspectRatio(value)
		if ratio == "" || seen[ratio] {
			return
		}
		seen[ratio] = true
		ratios = append(ratios, ratio)
	}
	add(profile.Size.Default)
	for _, value := range profile.Size.Values {
		add(value)
	}
	return ratios
}

// openAIImageDefaultPixelSize 从默认换算表取「比例 + 档位」对应的像素尺寸。
func openAIImageDefaultPixelSize(ratio string, tier string) (ImageSizePreset, bool) {
	index := -1
	switch tier {
	case "1k":
		index = 0
	case "2k":
		index = 1
	case "4k":
		index = 2
	}
	if index < 0 {
		return ImageSizePreset{}, false
	}
	for _, entry := range openAIImageDefaultSizeTable {
		if entry.ratio != ratio {
			continue
		}
		size := entry.tierSizes[index]
		widthText, heightText, found := strings.Cut(size, "x")
		width, widthErr := strconv.Atoi(widthText)
		height, heightErr := strconv.Atoi(heightText)
		if !found || widthErr != nil || heightErr != nil {
			return ImageSizePreset{}, false
		}
		return ImageSizePreset{Tier: tier, Ratio: ratio, Size: size, Width: width, Height: height}, true
	}
	return ImageSizePreset{}, false
}

// fillMissingImageSizePresets 为「出网需要像素、按比例提交、却没有换算表」的旧线路补齐
// 换算表：按线路自己声明的档位与比例，从 openAIImageDefaultSizeTable 取值。这与
// legacyImageSizeValues 修复旧通配符尺寸是同一套做法 —— 旧数据在读取边界补成当前形态，
// 而不是要求人工逐条重配。补不齐（声明了表里没有的比例）时保持原样，交给调用方拒绝。
// 返回是否发生了补齐。
func fillMissingImageSizePresets(profile *ImageCapabilityConfig, protocol string) bool {
	if !imageSizePresetMissingExact(profile, protocol) {
		return false
	}
	tiers := imageSizeDeclaredTiers(profile)
	ratios := imageSizeDeclaredRatios(profile)
	if len(tiers) == 0 || len(ratios) == 0 {
		return false
	}
	presets := make([]ImageSizePreset, 0, len(tiers)*len(ratios))
	for _, tier := range tiers {
		for _, ratio := range ratios {
			if preset, ok := openAIImageDefaultPixelSize(ratio, tier); ok {
				presets = append(presets, preset)
			}
		}
	}
	if len(presets) == 0 {
		return false
	}
	profile.Size.Presets = presets
	if profile.Size.Parameter == "size" {
		// parameter=size 的线路要求预设像素值同时出现在支持值里（validateImageCapabilityConfig），
		// 与前端 imageSizeConfigWithPresets 的做法一致。
		for _, preset := range presets {
			if !containsCapabilityString(profile.Size.Values, preset.Size) {
				profile.Size.Values = append(profile.Size.Values, preset.Size)
			}
		}
	}
	return true
}

// imageSizePresetReadyError 是运行时的失败关闭点：需要把档位换算成像素、又确实没有可用的
// 换算表（含补不齐的情况）时，宁可报错，也不要静默按 1K 出图。
func imageSizePresetReadyError(profile *ImageCapabilityConfig, protocol string) error {
	if !imageSizePresetMissing(profile, protocol) {
		return nil
	}
	return BadAuthRequest("当前线路缺少像素尺寸换算表，无法把所选比例与档位换算成上游要求的像素尺寸；请在管理端为该线路的每个档位配置像素预设")
}

// validateImageSizePresetRequirement 是写路径（保存渠道模型）使用的完整性校验：
// 出网需要像素、客户端又按比例提交时必须有换算表。读路径不做这个拦截。
func validateImageSizePresetRequirement(capability string, protocol string, profile *ModelCapabilityConfig) error {
	if normalizeCapability(capability) != "image" || profile == nil {
		return nil
	}
	if image := profile.Image; image != nil && image.Parameters != nil && imageSizePixelOutbound(image, protocol) {
		if !image.Resolution.Supported && len(image.Size.Presets) > 0 {
			if _, ok := singleImageSizeTier(image); !ok || len(activeImageSizePresets(image)) == 0 {
				return BadAuthRequest("关闭分辨率前请设置默认尺寸档位")
			}
		}
		hasRatios := false
		for _, ratio := range image.Size.Values {
			if !strings.Contains(ratio, ":") {
				continue
			}
			hasRatios = true
			if _, ok := declaredImageSizePreset(image.Size.Presets, ratio, "", ""); !ok {
				return BadAuthRequest(fmt.Sprintf("请配置比例 %s 对应的像素尺寸", ratio))
			}
		}
		// Each tier owns its available ratios; the cartesian product is not required.
		if hasRatios && image.Resolution.Supported {
			for _, tier := range image.Resolution.Values {
				found := false
				for _, preset := range image.Size.Presets {
					if preset.Tier == tier {
						found = true
						break
					}
				}
				if !found {
					return BadAuthRequest(fmt.Sprintf("请为分辨率 %s 至少配置一个比例", tier))
				}
			}
		}
	}
	if !imageSizePresetMissing(profile.Image, protocol) {
		return nil
	}
	return BadAuthRequest("该线路按像素尺寸出网但未配置像素预设：请为每个分辨率档位填写对应的像素尺寸，否则实际出图尺寸会与所选档位不一致")
}

func imageSizeResolutionEnabled(profile *ImageCapabilityConfig, interfaceType string) bool {
	return imageSizePixelOutbound(profile, interfaceType) && len(profile.Size.Presets) > 0
}

func imageSizeResolutionAfterValidation(profile *ImageCapabilityConfig, interfaceType string) bool {
	return profile != nil && profile.Size.Parameter != "size" && imageSizeResolutionEnabled(profile, interfaceType)
}

// applyImageSizeResolution 把换算结果写回任务输入，与视频的 applyVideoResolution
// 写回 config.vquality 同一机制，保证持久化的任务输入已是可执行值。
func applyImageSizeResolution(input map[string]any, taskInput *canvasGenerationInput, profile *ImageCapabilityConfig) {
	tier := taskInput.Config.Quality
	if profile.Resolution.Supported {
		tier = taskInput.Config.ImageResolution
	}
	resolved := resolveImageTaskSize(profile, taskInput.Config.InterfaceType, taskInput.Config.Size, tier)
	if resolved == taskInput.Config.Size {
		return
	}
	taskInput.Config.Size = resolved
	if config, ok := input["config"].(map[string]any); ok {
		config["size"] = resolved
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

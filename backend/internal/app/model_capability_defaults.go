// 各类模型的默认能力配置与按模型的特例修正（例如固定分辨率、特定时长档位）。

package app

import (
	"strconv"
	"strings"

	"yingce/backend/internal/model"
)

func DefaultModelCapabilityConfig(protocol string) *ModelCapabilityConfig {
	return DefaultModelCapabilityConfigForModel(protocol, "")
}

func videoDurationSupported(value *VideoCapabilityConfig) bool {
	return value == nil || value.DurationSupported == nil || *value.DurationSupported
}

func DefaultImageCapabilityConfig(protocol string, modelName string) *ImageCapabilityConfig {
	image := &ImageCapabilityConfig{
		References:            ImageReferenceConfig{PromptMaxChars: 32000, MaxImages: 16, MaxImageBytes: 30 * 1024 * 1024, MaskSupported: true},
		Size:                  ImageSizeConfig{Parameter: "size", Values: defaultImageSizeValues(), Default: "1:1", AllowCustom: true},
		Quality:               ImageQualityConfig{Supported: true, Values: []string{"auto", "low", "medium", "high"}, Default: "auto"},
		TransparentBackground: VideoBooleanConfig{Supported: true, Default: false},
		ResponseFormat:        ParameterSupport{Supported: true, Default: "auto"},
		OutputFormat:          ParameterSupport{Supported: true},
		MaxOutputs:            15,
	}
	switch model.ChannelInterfaceType(protocol) {
	case model.ChannelInterfaceOpenAIImage:
		// OpenAI Images 只收 WIDTHxHEIGHT：默认配置声明了 1K/2K/4K，就必须自带档位换算表，
		// 否则运行时换算会被静默跳过（见 imageSizePresetMissing），实际出图档位与所选档位不一致。
		image.Size.Presets = openAIImageDefaultSizePresets()
	case "km-kemei-seedream":
		image.References.MaxImages = 10
		image.References.MaskSupported = false
		presets := kemeiSeedreamImagePresets()
		values := make([]string, 0, len(presets))
		for _, preset := range presets {
			values = append(values, preset.Size)
		}
		image.Size = ImageSizeConfig{Parameter: "size", Values: values, Default: "2048x2048", AllowCustom: true, Presets: presets}
		// Seedream 5.0 官方档位为 1K / 1.5K / 2K，不含 4K；1.5K 用于独立计价。
		image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"1k", "1.5k", "2k"}, Default: "2k"}
		image.Quality = ImageQualityConfig{Supported: false, Values: []string{}, Default: "auto"}
		// 透明背景需要带 alpha 的单张参考图，通过插件命名空间显式配置。
		image.TransparentBackground = VideoBooleanConfig{Supported: false, Default: false}
		image.MaxOutputs = 1
	case model.ChannelInterfaceGrokImage:
		image.References.MaxImages = 1
		image.References.MaskSupported = false
		// grok2api / xAI Imagine：size→aspect_ratio，quality→resolution(1k/2k)。
		image.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"}, Default: "1:1", AllowCustom: false}
		image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"1k", "2k"}, Default: "2k"}
		image.Quality = ImageQualityConfig{Supported: false, Default: "auto"}
		image.TransparentBackground = VideoBooleanConfig{Supported: false, Default: false}
		image.ResponseFormat = ParameterSupport{Supported: true, Default: "auto"}
		image.OutputFormat = ParameterSupport{Supported: false}
		image.MaxOutputs = 1
	case model.ChannelInterfaceVolcengineArkImage, model.ChannelInterfaceVolcengineArkAgentPlanImage:
		image.References.MaskSupported = false
		image.Quality.Supported = false
		image.TransparentBackground.Supported = false
		image.ResponseFormat.Supported = false
		image.OutputFormat.Supported = false
	case model.ChannelInterfaceVolcengineJiMengImage:
		image.References.MaxImages = 14
		image.References.MaskSupported = false
		image.Quality.Supported = false
		image.TransparentBackground.Supported = false
		image.ResponseFormat.Supported = false
		image.OutputFormat.Supported = false
	case model.ChannelInterfaceGeminiImage:
		image.References.MaskSupported = false
		// Gemini Images uses imageConfig.aspectRatio, not the OpenAI-style pixel size field.
		image.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"auto", "1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"}, Default: "1:1", AllowCustom: false}
		image.TransparentBackground.Supported = false
		image.ResponseFormat.Supported = false
		image.OutputFormat.Supported = false
		image.MaxOutputs = 4
		image.ResolutionUsesQuality = true
	}
	if model.ChannelInterfaceType(protocol) != model.ChannelInterfaceGrokImage && strings.HasPrefix(strings.ToLower(strings.TrimSpace(modelName)), "grok-imagine-image") {
		image.References.MaxImages = 0
		image.References.MaskSupported = false
		image.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2"}, Default: "1:1", AllowCustom: false}
		image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"1k", "2k"}, Default: "2k"}
		image.Quality = ImageQualityConfig{Supported: false, Default: "auto"}
		image.TransparentBackground = VideoBooleanConfig{Supported: false, Default: false}
		image.ResponseFormat = ParameterSupport{Supported: true, Default: "auto"}
		image.OutputFormat = ParameterSupport{Supported: false}
		image.MaxOutputs = 1
	}
	return image
}

func defaultImageSizeValues() []string {
	return []string{
		"auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "21:9", "9:16",
		"1024x1024", "1360x1024", "1024x1360", "1536x1024", "1024x1536", "1024x1280", "1280x1024", "2048x878", "1824x1024", "1024x1824",
		"2048x2048", "2304x1728", "1728x2304", "2496x1664", "1664x2496", "1792x2240", "2240x1792", "3136x1344", "2752x1536", "1536x2752",
		"2880x2880", "3264x2448", "2448x3264", "3504x2336", "2336x3504", "2560x3200", "3200x2560", "3808x1632", "3840x2160", "2160x3840",
	}
}

// openAIImageDefaultSizeTable 是 openai-image 默认能力配置的档位换算表（比例 × 1K/2K/4K）。
// 像素值与库内 openai-image 线路实际使用的预设逐项一致（gpt-image-2 / 2.5 / 4k 的 1K/2K/4K 全部命中），
// 且都在 defaultImageSizeValues() 里，不引入未声明的尺寸。
var openAIImageDefaultSizeTable = []struct {
	ratio     string
	tierSizes [3]string
}{
	{"1:1", [3]string{"1024x1024", "2048x2048", "2880x2880"}},
	{"16:9", [3]string{"1824x1024", "2752x1536", "3840x2160"}},
	{"9:16", [3]string{"1024x1824", "1536x2752", "2160x3840"}},
	{"4:3", [3]string{"1360x1024", "2304x1728", "3264x2448"}},
	{"3:4", [3]string{"1024x1360", "1728x2304", "2448x3264"}},
	{"3:2", [3]string{"1536x1024", "2496x1664", "3504x2336"}},
	{"2:3", [3]string{"1024x1536", "1664x2496", "2336x3504"}},
	{"4:5", [3]string{"1024x1280", "1792x2240", "2560x3200"}},
	{"5:4", [3]string{"1280x1024", "2240x1792", "3200x2560"}},
	{"21:9", [3]string{"2048x878", "3136x1344", "3808x1632"}},
}

// openAIImageDefaultSizePresets 把上面的表展开成 3 个档位 × 10 个比例的预设。
// 像素值都来自 defaultImageSizeValues()，validateImageCapabilityConfig 会校验与支持值一致。
func openAIImageDefaultSizePresets() []ImageSizePreset {
	tiers := []string{"1k", "2k", "4k"}
	presets := make([]ImageSizePreset, 0, len(openAIImageDefaultSizeTable)*len(tiers))
	for _, entry := range openAIImageDefaultSizeTable {
		for index, tier := range tiers {
			size := entry.tierSizes[index]
			widthText, heightText, found := strings.Cut(size, "x")
			width, widthErr := strconv.Atoi(widthText)
			height, heightErr := strconv.Atoi(heightText)
			if !found || widthErr != nil || heightErr != nil {
				continue
			}
			presets = append(presets, ImageSizePreset{Tier: tier, Ratio: entry.ratio, Size: size, Width: width, Height: height})
		}
	}
	return presets
}

// legacyImageSizeValues 用于修复旧数据中仅保存了 "*" 的图片尺寸能力。
// 这组值是前后台共同展示的基础预设，不能让历史通配符配置继续污染用户生成参数。
func legacyImageSizeValues() []string {
	return []string{
		"1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "21:9", "9:16",
		"1024x1024", "1536x1024", "1024x1536",
	}
}

func DefaultModelCapabilityConfigForModel(protocol string, modelName string) *ModelCapabilityConfig {
	// 文本模型是否支持视觉输入不能从协议或模型名可靠推断，默认关闭，由管理员按真实上游能力开启。
	streaming := true
	text := &TextCapabilityConfig{Streaming: &streaming, ContextWindowTokens: 128000, MaxOutputTokens: 16384, References: TextReferenceConfig{PromptMaxChars: 32000}}
	video := &VideoCapabilityConfig{
		References:        VideoReferenceConfig{PromptMaxChars: DefaultVideoPromptMaxChars, MinImages: 0, MaxImages: 9, MaxImageBytes: 30 * 1024 * 1024, MaxVideos: 0, MaxVideoBytes: 0, MaxVideoDuration: 0, MaxAudios: 0, MaxAudioBytes: 0, MaxAudioDuration: 0},
		Duration:          VideoDurationConfig{Selection: "range", Min: 1, Max: 15, Step: 1, Default: 6},
		Ratios:            []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"},
		DefaultRatio:      "16:9",
		Resolutions:       []string{"480p", "720p", "1080p", "1440p", "2160p"},
		DefaultResolution: "720p",
		GenerateAudio:     VideoBooleanConfig{Supported: false, Default: false},
		Watermark:         VideoBooleanConfig{Supported: false, Default: false},
		Operations:        []string{"text_to_video", "image_to_video"},
		DefaultOperation:  "text_to_video",
	}
	switch model.ChannelInterfaceType(protocol) {
	case model.ChannelInterfaceVolcengineJiMengVideo:
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{5, 10}, Default: 5}
		video.Resolutions = []string{"720p"}
	case model.ChannelInterfaceGeminiVeo:
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{4, 6, 8}, Default: 6}
		video.Resolutions = []string{"720p", "1080p"}
	case model.ChannelInterfaceVolcengineArkVideo, model.ChannelInterfaceVolcengineArkAgentPlanVideo:
		video.Operations = append(video.Operations, "reference_to_video", "audio_to_video")
		video.References.MaxVideos, video.References.MaxAudios = 3, 3
		video.References.MaxVideoBytes, video.References.MaxAudioBytes = 200*1024*1024, 15*1024*1024
		video.References.MaxVideoDuration, video.References.MaxAudioDuration = 15, 15
		video.GenerateAudio = VideoBooleanConfig{Supported: true, Default: true}
		video.Watermark = VideoBooleanConfig{Supported: true, Default: false}
		video.Resolutions = []string{"480p", "720p", "1080p"}
	case model.ChannelInterfaceNewAPIChannel1, model.ChannelInterfaceNewAPIChannel2:
		video.References.MaxVideos, video.References.MaxAudios = 3, 3
		video.References.MaxVideoBytes, video.References.MaxAudioBytes = 200*1024*1024, 15*1024*1024
		video.References.MaxVideoDuration, video.References.MaxAudioDuration = 15, 15
		video.GenerateAudio = VideoBooleanConfig{Supported: true, Default: true}
		if model.ChannelInterfaceType(protocol) == model.ChannelInterfaceNewAPIChannel1 {
			video.Resolutions = []string{"480p", "720p", "1080p"}
		}
	case model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceXAIVideo:
		video.GenerateAudio = VideoBooleanConfig{Supported: false, Default: false}
	case model.ChannelInterfaceNovitaVideo:
		video.References.MaxImages, video.References.MaxImageBytes = 1, 10*1024*1024
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{5, 10}, Default: 5}
		video.Ratios = []string{"16:9", "9:16", "1:1"}
		video.Resolutions = []string{"1080p"}
		video.DefaultResolution = "1080p"
	case model.ChannelInterfaceMiniMaxVideo, model.ChannelInterfaceType("metaso-h3"):
		video.Operations = append(video.Operations, "reference_to_video")
		video.References.MaxImages = 9
		video.References.MaxImageBytes = 30 * 1024 * 1024
		video.References.MaxVideos = 3
		video.References.MaxVideoBytes = 50 * 1024 * 1024
		video.References.MaxVideoDuration = 15
		video.References.MaxAudios = 3
		video.References.MaxAudioBytes = 15 * 1024 * 1024
		video.References.MaxAudioDuration = 15
		video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30}, Default: 5}
		video.Ratios = []string{"adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
		video.DefaultRatio = "16:9"
		video.Resolutions = []string{"768P", "2K"}
		video.DefaultResolution = "768P"
		video.Watermark = VideoBooleanConfig{Supported: true, Default: false}
	case model.ChannelInterfaceAgnesVideo:
		video = applyModelSpecificVideoCapability(video, protocol, modelName)
	}
	return &ModelCapabilityConfig{Version: 1, Text: text, Image: DefaultImageCapabilityConfig(protocol, modelName), Video: video}
}

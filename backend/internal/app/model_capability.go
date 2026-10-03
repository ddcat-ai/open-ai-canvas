package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
)

// ModelCapabilityConfig 是模型能力声明，不包含供应商字段名；协议适配器负责把统一参数映射到上游请求。
type ModelCapabilityConfig struct {
	Version int                    `json:"version"`
	Text    *TextCapabilityConfig  `json:"text,omitempty"`
	Image   *ImageCapabilityConfig `json:"image,omitempty"`
	Video   *VideoCapabilityConfig `json:"video,omitempty"`
}

type TextCapabilityConfig struct {
	// Streaming controls whether this model accepts upstream SSE text responses.
	// A nil value is treated as true for backwards compatibility with older configs.
	Streaming *bool `json:"streaming,omitempty"`
	// ContextWindowTokens is the provider's total input plus output context window.
	// It is a model contract, not an application transport ceiling.
	ContextWindowTokens int `json:"contextWindowTokens"`
	// MaxOutputTokens is the provider's maximum completion/reasoning budget.
	MaxOutputTokens int                 `json:"maxOutputTokens"`
	References      TextReferenceConfig `json:"references"`
}

type TextReferenceConfig struct {
	PromptMaxChars int   `json:"promptMaxChars"`
	MaxImages      int   `json:"maxImages"`
	MaxImageBytes  int64 `json:"maxImageBytes"`
	MaxVideos      int   `json:"maxVideos"`
	MaxVideoBytes  int64 `json:"maxVideoBytes"`
}

type ImageCapabilityConfig struct {
	References            ImageReferenceConfig `json:"references"`
	Size                  ImageSizeConfig      `json:"size"`
	Quality               ImageQualityConfig   `json:"quality"`
	TransparentBackground VideoBooleanConfig   `json:"transparentBackground"`
	ResponseFormat        ParameterSupport     `json:"responseFormat"`
	OutputFormat          ParameterSupport     `json:"outputFormat"`
	MaxOutputs            int                  `json:"maxOutputs"`
}

type ImageReferenceConfig struct {
	PromptMaxChars int   `json:"promptMaxChars"`
	MaxImages      int   `json:"maxImages"`
	MaxImageBytes  int64 `json:"maxImageBytes"`
	MaskSupported  bool  `json:"maskSupported"`
}

type ImageSizeConfig struct {
	Parameter   string            `json:"parameter"`
	Values      []string          `json:"values"`
	Default     string            `json:"default"`
	AllowCustom bool              `json:"allowCustom"`
	Presets     []ImageSizePreset `json:"presets,omitempty"`
}

type ImageSizePreset struct {
	Tier   string `json:"tier"`
	Ratio  string `json:"ratio"`
	Size   string `json:"size"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type ImageQualityConfig struct {
	Supported bool     `json:"supported"`
	Values    []string `json:"values"`
	Default   string   `json:"default"`
}

type ParameterSupport struct {
	Supported bool `json:"supported"`
}

type VideoCapabilityConfig struct {
	References           VideoReferenceConfig           `json:"references"`
	Duration             VideoDurationConfig            `json:"duration"`
	DurationByResolution map[string]VideoDurationConfig `json:"durationByResolution,omitempty"`
	DurationSupported    *bool                          `json:"durationSupported,omitempty"`
	Ratios               []string                       `json:"ratios"`
	DefaultRatio         string                         `json:"defaultRatio"`
	Resolutions          []string                       `json:"resolutions"`
	DefaultResolution    string                         `json:"defaultResolution"`
	GenerateAudio        VideoBooleanConfig             `json:"generateAudio"`
	Watermark            VideoBooleanConfig             `json:"watermark"`
	Operations           []string                       `json:"operations"`
	DefaultOperation     string                         `json:"defaultOperation"`
}

type VideoReferenceConfig struct {
	PromptMaxChars   int   `json:"promptMaxChars"`
	MinImages        int   `json:"minImages"`
	MaxImages        int   `json:"maxImages"`
	MaxImageBytes    int64 `json:"maxImageBytes"`
	MaxVideos        int   `json:"maxVideos"`
	MaxVideoBytes    int64 `json:"maxVideoBytes"`
	MaxVideoDuration int   `json:"maxVideoDurationSeconds"`
	MaxAudios        int   `json:"maxAudios"`
	MaxAudioBytes    int64 `json:"maxAudioBytes"`
	MaxAudioDuration int   `json:"maxAudioDurationSeconds"`
}

// DefaultVideoPromptMaxChars 是普通视频模型提示词字符数的默认上限。
// 视频提示词由输入框文本、连线内容和技能上下文合成，远长于用户手输内容；
// 默认值过小会把画布工作流正常可用的提示词拦在本地。管理员仍可按模型覆盖。
const DefaultVideoPromptMaxChars = 8000

type VideoDurationConfig struct {
	Selection string `json:"selection"`
	Min       int    `json:"min,omitempty"`
	Max       int    `json:"max,omitempty"`
	Step      int    `json:"step,omitempty"`
	Values    []int  `json:"values,omitempty"`
	Default   int    `json:"default"`
}

type VideoBooleanConfig struct {
	Supported bool `json:"supported"`
	Default   bool `json:"default"`
}

func DecodeModelCapabilityConfig(raw string) (*ModelCapabilityConfig, error) {
	if strings.TrimSpace(raw) == "" {
		return nil, nil
	}
	var value ModelCapabilityConfig
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, err
	}
	return &value, nil
}

// normalizedChannelModelCapability 从持久化记录恢复渠道模型的权威能力合同。
// 目录读取可以选择隔离损坏记录；任务创建等写路径必须把错误向上返回并失败关闭。
func normalizedChannelModelCapability(channelModel *model.ChannelModel) (*ModelCapabilityConfig, error) {
	if channelModel == nil {
		return nil, errors.New("渠道模型为空")
	}
	capability := normalizeCapability(channelModel.Capability)
	if capability == "audio" {
		return nil, nil
	}
	if capability != "text" && capability != "image" && capability != "video" {
		return nil, fmt.Errorf("不支持的渠道模型能力：%s", channelModel.Capability)
	}
	config, err := DecodeModelCapabilityConfig(channelModel.CapabilityConfigJSON)
	if err != nil {
		return nil, fmt.Errorf("解析渠道模型能力配置失败：%w", err)
	}
	normalized, err := NormalizeModelCapabilityConfigForModel(capability, string(channelModel.Protocol), firstNonEmpty(channelModel.ProviderModelKey, channelModel.ModelKey), config)
	if err != nil {
		return nil, err
	}
	return normalized, nil
}

func NormalizeModelCapabilityConfig(capability string, protocol string, input *ModelCapabilityConfig) (*ModelCapabilityConfig, error) {
	return NormalizeModelCapabilityConfigForModel(capability, protocol, "", input)
}

func NormalizeModelCapabilityConfigForModel(capability string, protocol string, modelName string, input *ModelCapabilityConfig) (*ModelCapabilityConfig, error) {
	if capability != "text" && capability != "image" && capability != "video" {
		return nil, nil
	}
	if capability == "text" {
		if input == nil || input.Text == nil {
			return nil, BadAuthRequest("请配置文本模型能力参数")
		}
		text := *input.Text
		if text.Streaming == nil {
			streaming := true
			text.Streaming = &streaming
		}
		if text.ContextWindowTokens == 0 {
			text.ContextWindowTokens = 128000
		}
		if text.MaxOutputTokens == 0 {
			text.MaxOutputTokens = 16384
		}
		value := &ModelCapabilityConfig{Version: 1, Text: &text}
		if err := validateTextCapabilityConfig(value.Text); err != nil {
			return nil, err
		}
		return value, nil
	}
	if capability == "image" {
		if input == nil || input.Image == nil {
			return nil, BadAuthRequest("请配置图片模型能力参数")
		}
		value := &ModelCapabilityConfig{Version: 1, Image: input.Image}
		if err := validateImageCapabilityConfig(value.Image); err != nil {
			return nil, err
		}
		return value, nil
	}
	if input == nil || input.Video == nil {
		return nil, BadAuthRequest("请配置视频模型能力参数")
	}
	value := &ModelCapabilityConfig{Version: 1, Video: applyModelSpecificVideoCapability(input.Video, protocol, modelName)}
	if err := validateVideoCapabilityConfig(value.Video); err != nil {
		return nil, err
	}
	return value, nil
}

func applyModelSpecificVideoCapability(profile *VideoCapabilityConfig, protocol string, modelName string) *VideoCapabilityConfig {
	if profile == nil || model.ChannelInterfaceType(strings.TrimSpace(protocol)) != model.ChannelInterfaceAgnesVideo {
		return profile
	}
	normalizedModel := strings.ToLower(strings.TrimSpace(modelName))
	if normalizedModel != "agnes-video-2.5" && normalizedModel != "agnes-video-2.5-flash" {
		return profile
	}
	value := *profile
	value.References = profile.References
	flash := normalizedModel == "agnes-video-2.5-flash"
	value.References.MaxImages = 9
	value.References.MaxVideos = 3
	value.References.MaxAudios = 3
	value.References.MaxVideoBytes = 200 * 1024 * 1024
	value.References.MaxVideoDuration = 15
	value.References.MaxAudioBytes = 15 * 1024 * 1024
	value.References.MaxAudioDuration = 15
	if flash {
		value.References.MaxImages = 5
		value.References.MaxVideos = 0
		value.References.MaxVideoBytes = 0
		value.References.MaxVideoDuration = 0
	}
	value.Duration = VideoDurationConfig{Selection: "range", Min: 4, Max: 12, Step: 1, Default: 5}
	value.Ratios = []string{"21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
	value.DefaultRatio = "16:9"
	value.Resolutions = []string{"720P", "960P", "2K"}
	if flash {
		value.Resolutions = []string{"720P"}
	}
	value.DefaultResolution = "720P"
	value.GenerateAudio = VideoBooleanConfig{Supported: false, Default: false}
	value.Watermark = VideoBooleanConfig{Supported: false, Default: false}
	value.Operations = []string{"text_to_video", "image_to_video", "reference_to_video", "audio_to_video"}
	value.DefaultOperation = "text_to_video"
	return &value
}

// CapabilitySpecFromModelCapabilityConfig 将渠道模型的真实供应能力投影为路由能力规格。
// 渠道模型能力参数是唯一事实来源，前台模型供应线路直接引用该规格。
func CapabilitySpecFromModelCapabilityConfig(config *ModelCapabilityConfig, capability string) (CapabilitySpec, error) {
	spec := CapabilitySpec{Version: 1, Capability: capability, Inputs: map[string]InputConstraint{}, Options: map[string]OptionConstraint{}}
	// 音频模型当前没有可编辑的渠道能力 JSON，使用空能力规格表示“无额外路由约束”。
	if capability == "audio" {
		return spec, nil
	}
	if config == nil {
		switch capability {
		case "text":
			return spec, BadAuthRequest("渠道文本模型尚未配置能力参数")
		case "image":
			return spec, BadAuthRequest("渠道图片模型尚未配置能力参数")
		case "video":
			return spec, BadAuthRequest("渠道视频模型尚未配置能力参数")
		default:
			return spec, BadAuthRequest("渠道模型尚未配置能力参数")
		}
	}
	switch capability {
	case "text":
		if config.Text == nil {
			return spec, BadAuthRequest("渠道文本模型尚未配置能力参数")
		}
		addInputConstraint(spec.Inputs, "image", 0, config.Text.References.MaxImages)
		addInputConstraint(spec.Inputs, "video", 0, config.Text.References.MaxVideos)
	case "image":
		if config.Image == nil {
			return spec, BadAuthRequest("渠道图片模型尚未配置能力参数")
		}
		image := config.Image
		addInputConstraint(spec.Inputs, "image", 0, image.References.MaxImages)
		if image.References.MaskSupported {
			addInputConstraint(spec.Inputs, "mask", 0, 1)
		}
		if image.Size.Parameter != "none" {
			spec.Options["size"] = imageSizeOptionConstraint(image.Size)
			spec.ImageSize = capabilityImageSizeFromConfig(image.Size)
		}
		if image.Quality.Supported {
			spec.Options["quality"] = anyValues(image.Quality.Values)
		}
		if image.TransparentBackground.Supported {
			spec.Options["transparentBackground"] = boolValues(true)
		} else {
			spec.Options["transparentBackground"] = boolValues(false)
		}
		spec.Options["count"] = numericRange(1, float64(image.MaxOutputs), 1)
	case "video":
		if config.Video == nil {
			return spec, BadAuthRequest("渠道视频模型尚未配置能力参数")
		}
		video := config.Video
		spec.Operations = append([]string(nil), video.Operations...)
		addInputConstraint(spec.Inputs, "image", video.References.MinImages, video.References.MaxImages)
		addInputConstraint(spec.Inputs, "video", 0, video.References.MaxVideos)
		addInputConstraint(spec.Inputs, "audio", 0, video.References.MaxAudios)
		if video.Duration.Selection == "enum" {
			values := make([]any, 0, len(video.Duration.Values))
			for _, value := range video.Duration.Values {
				values = append(values, value)
			}
			spec.Options["videoSeconds"] = OptionConstraint{Values: values}
		} else {
			spec.Options["videoSeconds"] = numericRange(float64(video.Duration.Min), float64(video.Duration.Max), float64(video.Duration.Step))
		}
		for resolution, duration := range video.DurationByResolution {
			key := canonicalVideoResolutionKey(resolution) + "p"
			if key == "p" {
				continue
			}
			if duration.Selection == "enum" {
				values := make([]any, 0, len(duration.Values))
				for _, value := range duration.Values {
					values = append(values, value)
				}
				spec.VideoDurationByResolution = ensureVideoDurationMap(spec.VideoDurationByResolution)
				spec.VideoDurationByResolution[key] = OptionConstraint{Values: values}
			} else {
				spec.VideoDurationByResolution = ensureVideoDurationMap(spec.VideoDurationByResolution)
				spec.VideoDurationByResolution[key] = numericRange(float64(duration.Min), float64(duration.Max), float64(duration.Step))
			}
		}
		spec.Options["size"] = anyValues(video.Ratios)
		if len(video.Resolutions) > 0 {
			spec.Options["vquality"] = anyValues(video.Resolutions)
		}
		if video.GenerateAudio.Supported {
			spec.Options["videoGenerateAudio"] = boolValues(true)
		} else {
			spec.Options["videoGenerateAudio"] = boolValues(false)
		}
		if video.Watermark.Supported {
			spec.Options["videoWatermark"] = boolValues(true)
		} else {
			spec.Options["videoWatermark"] = boolValues(false)
		}
	default:
		return spec, BadAuthRequest("未知模型能力类型")
	}
	return spec, nil
}

// imageSizeOptionConstraint 保留可见的标准尺寸/比例，同时用 * 表示允许自定义。
// * 不能替代标准值，否则管理端只能看到一个没有业务含义的通配符。
func imageSizeOptionConstraint(size ImageSizeConfig) OptionConstraint {
	values := make([]string, 0, len(size.Values)+1)
	seen := make(map[string]struct{}, len(size.Values)+1)
	for _, value := range size.Values {
		value = strings.TrimSpace(value)
		if value == "" || value == "*" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		values = append(values, value)
	}
	if size.AllowCustom {
		if len(values) == 0 {
			for _, value := range legacyImageSizeValues() {
				seen[value] = struct{}{}
				values = append(values, value)
			}
		}
		values = append(values, "*")
	}
	return anyValues(values)
}

func capabilityImageSizeFromConfig(size ImageSizeConfig) *CapabilityImageSize {
	if size.Parameter == "" || size.Parameter == "none" {
		return nil
	}
	result := &CapabilityImageSize{Parameter: size.Parameter, AllowCustom: size.AllowCustom}
	for _, preset := range size.Presets {
		tier := strings.ToLower(strings.TrimSpace(preset.Tier))
		ratio := strings.TrimSpace(preset.Ratio)
		value := strings.TrimSpace(preset.Size)
		if tier == "" || ratio == "" || value == "" {
			continue
		}
		result.Presets = append(result.Presets, CapabilityImageSizePreset{
			Size: value, Tier: tier, Ratio: ratio, Width: preset.Width, Height: preset.Height,
		})
	}
	return result
}

func addInputConstraint(inputs map[string]InputConstraint, name string, min int, max int) {
	if min <= 0 && max <= 0 {
		return
	}
	inputs[name] = InputConstraint{Min: min, Max: max}
}

func ensureVideoDurationMap(value map[string]OptionConstraint) map[string]OptionConstraint {
	if value == nil {
		return make(map[string]OptionConstraint)
	}
	return value
}

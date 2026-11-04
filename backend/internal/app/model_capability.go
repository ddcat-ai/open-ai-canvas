package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"yingce/backend/internal/model"
	protocolcontract "yingce/backend/internal/protocol"
)

// ModelCapabilityConfig 是模型能力声明，不包含供应商字段名；协议适配器负责把统一参数映射到上游请求。
type ModelCapabilityConfig struct {
	Version int                    `json:"version"`
	Text    *TextCapabilityConfig  `json:"text,omitempty"`
	Image   *ImageCapabilityConfig `json:"image,omitempty"`
	Video   *VideoCapabilityConfig `json:"video,omitempty"`
	// 补上音频能力段，字段名与 JSON 名跟 web/src/lib/model-capabilities.ts 的 audio 完全一致；
	// 未声明时保持 nil，序列化结果里不出现 audio。
	Audio *AudioCapabilityConfig `json:"audio,omitempty"`
	// PromptFamily 声明该模型使用的提示词写法家族（如 seedance / veo / kling / gpt-image）。
	// 提示词优化按模型声明选模板，不再靠模型名子串命中。空值表示未声明。
	PromptFamily string `json:"promptFamily,omitempty"`
}

// AudioCapabilityConfig 是音频模型的能力声明，与前端 audio 段同名同形。
// 后端此前没有该字段，渠道模型保存时 audio 会被 JSON 解码丢掉。
type AudioCapabilityConfig struct {
	References    AudioReferenceConfig    `json:"references"`
	Voices        []AudioCapabilityOption `json:"voices,omitempty"`
	Formats       []AudioCapabilityOption `json:"formats,omitempty"`
	VoiceInput    string                  `json:"voiceInput,omitempty"`
	ProviderNotes bool                    `json:"providerNotes,omitempty"`
}

// AudioReferenceConfig 是音频模型可连接的参考素材上限。
type AudioReferenceConfig struct {
	MaxAudios int `json:"maxAudios"`
	MaxImages int `json:"maxImages"`
}

// AudioCapabilityOption 是音色 / 输出格式的值域项。
type AudioCapabilityOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
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
	Parameters []protocolcontract.ImageParameter `json:"parameters"`
	References ImageReferenceConfig              `json:"references"`
	Size       ImageSizeConfig                   `json:"size"`
	Resolution ImageResolutionConfig             `json:"resolution"`
	Quality    ImageQualityConfig                `json:"quality"`
	// ResolutionUsesQuality is reserved for protocols whose documented quality
	// values are actually resolution tiers (for example Gemini imageSize).
	ResolutionUsesQuality bool               `json:"resolutionUsesQuality,omitempty"`
	TransparentBackground VideoBooleanConfig `json:"transparentBackground"`
	ResponseFormat        ParameterSupport   `json:"responseFormat"`
	OutputFormat          ParameterSupport   `json:"outputFormat"`
	MaxOutputs            int                `json:"maxOutputs"`
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
	DefaultTier string            `json:"defaultTier,omitempty"`
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

type ImageResolutionConfig struct {
	Supported bool     `json:"supported"`
	Values    []string `json:"values"`
	Default   string   `json:"default"`
}

type ParameterSupport struct {
	Supported bool   `json:"supported"`
	Default   string `json:"default,omitempty"`
}

type VideoCapabilityConfig struct {
	References        VideoReferenceConfig   `json:"references"`
	Duration          VideoDurationConfig    `json:"duration"`
	DurationSupported *bool                  `json:"durationSupported,omitempty"`
	Ratios            []string               `json:"ratios"`
	DefaultRatio      string                 `json:"defaultRatio"`
	Resolutions       []string               `json:"resolutions"`
	DefaultResolution string                 `json:"defaultResolution"`
	FixedScreenSpec   *VideoScreenSpecConfig `json:"fixedScreenSpec,omitempty"`
	GenerateAudio     VideoBooleanConfig     `json:"generateAudio"`
	Watermark         VideoBooleanConfig     `json:"watermark"`
	Operations        []string               `json:"operations"`
	DefaultOperation  string                 `json:"defaultOperation"`
	// Processing 只用于 kind=processing 的视频处理 provider（如画质增强），
	// 生成类模型保持 nil。
	Processing *VideoProcessingConfig `json:"processing,omitempty"`
}

const (
	VideoProcessingFPSKeepSource = "keep_source"
	VideoProcessingFPSUserSelect = "user_select"
	// 轮询上限固定 1 小时，按大模型画质增强 RTF≈20 估算，源视频默认不超过 180 秒。
	DefaultVideoProcessingMaxSourceSeconds = 180
	// VideoProcessingOperationEnhance 是画质增强任务的 operation，前后端与价格档共用。
	VideoProcessingOperationEnhance = "enhance"
	// VolcengineMediaKitEnhanceVideoProtocol 是官方插件 volcengine-mediakit 的画质增强 provider。
	VolcengineMediaKitEnhanceVideoProtocol = "volcengine-mediakit-enhance-video"
)

// VideoProcessingConfig 是视频处理工具的后台配置：帧率策略决定用户是否选择帧率，
// 价格档通过 vquality + fpsBand 选择，按秒计费时按源时长预扣、按实际输出时长结算。
type VideoProcessingConfig struct {
	FPSPolicy        string `json:"fpsPolicy"`
	FPSOptions       []int  `json:"fpsOptions,omitempty"`
	MaxSourceSeconds int    `json:"maxSourceSeconds,omitempty"`
}

type VideoScreenSpecConfig struct {
	Ratios            []string `json:"ratios"`
	DefaultRatio      string   `json:"defaultRatio"`
	Resolutions       []string `json:"resolutions"`
	DefaultResolution string   `json:"defaultResolution"`
}

type VideoReferenceConfig struct {
	PromptMaxChars   int   `json:"promptMaxChars"`
	MinImages        int   `json:"minImages"`
	MaxImages        int   `json:"maxImages"`
	MaxImageBytes    int64 `json:"maxImageBytes"`
	MaxVideos        int   `json:"maxVideos"`
	MaxVideoBytes    int64 `json:"maxVideoBytes"`
	MaxVideoDuration int   `json:"maxVideoDurationSeconds"`
	// 参考片段的最短时长改由模型能力声明（0 表示不限）。
	MinVideoDuration int   `json:"minVideoDurationSeconds"`
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

// normalizeAudioCapabilityConfig 只做最小清理：去首尾空格、丢弃空值项、负数归零。
// 不加任何默认值；未声明 audio 时返回 nil，序列化结果里就不会出现 audio。
// 音频能力按声明原样保存，不做猜测。
func normalizeAudioCapabilityConfig(input *AudioCapabilityConfig) *AudioCapabilityConfig {
	if input == nil {
		return nil
	}
	return &AudioCapabilityConfig{
		References: AudioReferenceConfig{
			MaxAudios: max(input.References.MaxAudios, 0),
			MaxImages: max(input.References.MaxImages, 0),
		},
		Voices:        normalizeAudioCapabilityOptions(input.Voices),
		Formats:       normalizeAudioCapabilityOptions(input.Formats),
		VoiceInput:    strings.TrimSpace(input.VoiceInput),
		ProviderNotes: input.ProviderNotes,
	}
}

func normalizeAudioCapabilityOptions(items []AudioCapabilityOption) []AudioCapabilityOption {
	if len(items) == 0 {
		return nil
	}
	result := make([]AudioCapabilityOption, 0, len(items))
	for _, item := range items {
		value := strings.TrimSpace(item.Value)
		if value == "" {
			continue
		}
		result = append(result, AudioCapabilityOption{Value: value, Label: strings.TrimSpace(item.Label)})
	}
	if len(result) == 0 {
		return nil
	}
	return result
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
func normalizedChannelModelCapability(channelModel *model.ChannelModel, registries ...*protocolcontract.Registry) (*ModelCapabilityConfig, error) {
	if channelModel == nil {
		return nil, errors.New("渠道模型为空")
	}
	capability := normalizeCapability(channelModel.Capability)
	// 音频模型现在可以声明 capabilityConfig.audio，读路径按同一套归一化恢复；
	// 未声明时归一化仍返回 nil，与原来的“音频无能力合同”行为一致。
	if capability != "text" && capability != "image" && capability != "video" && capability != "audio" {
		return nil, fmt.Errorf("不支持的渠道模型能力：%s", channelModel.Capability)
	}
	config, err := DecodeModelCapabilityConfig(channelModel.CapabilityConfigJSON)
	if err != nil {
		return nil, fmt.Errorf("解析渠道模型能力配置失败：%w", err)
	}
	normalized, err := NormalizeModelCapabilityConfigForModel(capability, string(channelModel.Protocol), firstNonEmpty(channelModel.ProviderModelKey, channelModel.ModelKey), config, registries...)
	if err != nil {
		return nil, err
	}
	return normalized, nil
}

func NormalizeModelCapabilityConfig(capability string, protocol string, input *ModelCapabilityConfig) (*ModelCapabilityConfig, error) {
	return NormalizeModelCapabilityConfigForModel(capability, protocol, "", input)
}

func NormalizeModelCapabilityConfigForModel(capability string, protocol string, modelName string, input *ModelCapabilityConfig, registries ...*protocolcontract.Registry) (*ModelCapabilityConfig, error) {
	// promptFamily 与 audio 是模型级声明，任何能力的归一化都要原样带出，不能被丢掉。
	var promptFamily string
	var audio *AudioCapabilityConfig
	if input != nil {
		promptFamily = strings.TrimSpace(input.PromptFamily)
		audio = normalizeAudioCapabilityConfig(input.Audio)
	}
	if capability == "audio" {
		// 音频模型此前直接返回 nil，保存时能力配置会被清空。
		// 没有任何声明时仍返回 nil，保持原来的“音频无能力合同”行为。
		if audio == nil && promptFamily == "" {
			return nil, nil
		}
		return &ModelCapabilityConfig{Version: 1, Audio: audio, PromptFamily: promptFamily}, nil
	}
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
		value := &ModelCapabilityConfig{Version: 1, Text: &text, Audio: audio, PromptFamily: promptFamily}
		if err := validateTextCapabilityConfig(value.Text); err != nil {
			return nil, err
		}
		return value, nil
	}
	if capability == "image" {
		if input == nil || input.Image == nil {
			return nil, BadAuthRequest("请配置图片模型能力参数")
		}
		if len(registries) > 0 && registries[0] != nil {
			if adapter, ok := registries[0].Resolve(protocol); ok && adapter.Metadata().ImageParameters != nil {
				if err := resolveImageCapabilityParameters(input.Image, adapter.Metadata().ImageParameters, modelName); err != nil {
					return nil, err
				}
			} else if input.Image.Parameters != nil {
				return nil, BadAuthRequest("当前插件未声明图片参数合同，请先更新插件")
			}
		}
		if input.Image.Parameters != nil {
			if err := projectImageParameters(input.Image); err != nil {
				return nil, err
			}
		} else {
			normalizeLegacyImageResolutionConfig(protocol, input.Image, registries...)
			// 分辨率是否复用 quality 字段先看插件声明的分辨率档，而非只认协议名。
			input.Image.ResolutionUsesQuality = imageResolutionRidesQualityField(protocol, input.Image, registries...)
		}
		// 旧配置缺换算表时按声明的档位与比例补齐后再校验，保存即把旧线路归一化成当前形态。
		if input.Image.Parameters == nil {
			fillMissingImageSizePresets(input.Image, protocol)
		}
		value := &ModelCapabilityConfig{Version: 1, Image: input.Image, Audio: audio, PromptFamily: promptFamily}
		if err := validateImageCapabilityConfig(value.Image); err != nil {
			return nil, err
		}
		return value, nil
	}
	if input == nil || input.Video == nil {
		return nil, BadAuthRequest("请配置视频模型能力参数")
	}
	video := applyModelSpecificVideoCapability(input.Video, protocol, modelName)
	if strings.TrimSpace(protocol) == "autodl-comfyui" {
		var err error
		video, err = normalizeAutoDLVideoScreenSpec(video, modelName)
		if err != nil {
			return nil, err
		}
	}
	value := &ModelCapabilityConfig{Version: 1, Video: video, Audio: audio, PromptFamily: promptFamily}
	if err := validateVideoCapabilityConfig(value.Video); err != nil {
		return nil, err
	}
	return value, nil
}

// normalizeLegacyImageResolutionConfig projects legacy values only for protocols whose
// shipped contracts prove that these exact quality values represented resolution tiers.
// The projection is in-memory; persisted capabilities and historical task inputs are untouched.
func normalizeLegacyImageResolutionConfig(protocol string, image *ImageCapabilityConfig, registries ...*protocolcontract.Registry) {
	if image == nil || image.Resolution.Supported || !image.Quality.Supported {
		return
	}
	allowed := legacyImageResolutionTiers(protocol, registries...)
	if len(allowed) == 0 {
		return
	}
	values := make([]string, 0, len(image.Quality.Values))
	for _, value := range image.Quality.Values {
		value = strings.ToLower(strings.TrimSpace(value))
		if !allowed[value] {
			return
		}
		values = append(values, value)
	}
	defaultValue := strings.ToLower(strings.TrimSpace(image.Quality.Default))
	if len(values) == 0 || !allowed[defaultValue] || !containsCapabilityString(values, defaultValue) {
		return
	}
	image.Resolution = ImageResolutionConfig{Supported: true, Values: values, Default: defaultValue}
	image.Quality = ImageQualityConfig{Supported: false, Values: []string{}, Default: "auto"}
}

func legacyImageResolutionProtocol(protocol string, registries ...*protocolcontract.Registry) bool {
	return len(legacyImageResolutionTiers(protocol, registries...)) > 0
}

// imageResolutionRidesQualityField 判定该线路的 quality 字段实际承载分辨率档。
// 先读插件声明的分辨率档（quality 取值全在档位声明内），
// 插件未声明时保留 Gemini 图片内置判断。
func imageResolutionRidesQualityField(protocol string, image *ImageCapabilityConfig, registries ...*protocolcontract.Registry) bool {
	if strings.TrimSpace(protocol) == string(model.ChannelInterfaceGeminiImage) {
		return true
	}
	tiers := pluginDeclaredImageResolutionTiers(protocol, registries...)
	if len(tiers) == 0 || image == nil || !image.Quality.Supported || len(image.Quality.Values) == 0 {
		return false
	}
	for _, value := range image.Quality.Values {
		if !tiers[strings.ToLower(strings.TrimSpace(value))] {
			return false
		}
	}
	return true
}

func legacyImageResolutionTiers(protocol string, registries ...*protocolcontract.Registry) map[string]bool {
	// 旧线路的 quality→分辨率投影改为先读插件声明的分辨率参数档；
	// 未安装声明式插件时保留按协议名写死的内置名单。
	if tiers := pluginDeclaredImageResolutionTiers(protocol, registries...); len(tiers) > 0 {
		return tiers
	}
	switch strings.TrimSpace(protocol) {
	case string(model.ChannelInterfaceGrokImage):
		return map[string]bool{"1k": true, "2k": true}
	case "agnes-image":
		return map[string]bool{"1k": true, "2k": true, "4k": true}
	case "km-kemei-seedream":
		return map[string]bool{"1k": true, "1.5k": true, "2k": true}
	default:
		return nil
	}
}

// pluginDeclaredImageResolutionTiers 读出插件 imageParameters 里 binding=resolution 的取值档位。
// 没有任何声明时返回 nil，调用方据此回到原有的内置行为。
func pluginDeclaredImageResolutionTiers(protocol string, registries ...*protocolcontract.Registry) map[string]bool {
	id := strings.TrimSpace(protocol)
	if id == "" {
		return nil
	}
	var registry *protocolcontract.Registry
	if len(registries) > 0 {
		registry = registries[0]
	}
	if registry == nil {
		registry = loadOfficialFallbackRegistry()
	}
	if registry == nil {
		return nil
	}
	adapter, ok := registry.Resolve(id)
	if !ok {
		return nil
	}
	tiers := map[string]bool{}
	for _, parameter := range adapter.Metadata().ImageParameters {
		if parameter.Binding != "resolution" || !parameter.IsEnabled() {
			continue
		}
		for _, value := range parameter.Values {
			text, ok := value.(string)
			if !ok {
				continue
			}
			if text = strings.ToLower(strings.TrimSpace(text)); text != "" {
				tiers[text] = true
			}
		}
	}
	if len(tiers) == 0 {
		return nil
	}
	return tiers
}

// normalizeLegacyImageResolutionRequest adapts only old request fields for the same
// proven protocols. Other plugins retain their own quality semantics.
func normalizeLegacyImageResolutionRequest(protocol string, capability *ModelCapabilityConfig, config map[string]any) string {
	if capability == nil || capability.Image == nil || !capability.Image.Resolution.Supported || capability.Image.Quality.Supported {
		return ""
	}
	// 参数合同已声明分辨率参数时不走旧字段改写，保持一致的能力驱动。
	if capability.Image.Parameters != nil && len(capability.Image.Parameters) > 0 {
		return ""
	}
	imageResolutionProtocol := legacyImageResolutionProtocol(protocol)
	if !imageResolutionProtocol {
		return ""
	}
	legacy := strings.TrimSpace(metadataString(config, "quality"))
	if !containsCapabilityString(capability.Image.Resolution.Values, legacy) {
		return ""
	}
	if strings.TrimSpace(metadataString(config, "imageResolution")) != "" {
		delete(config, "quality")
		return ""
	}
	config["imageResolution"] = legacy
	delete(config, "quality")
	return legacy
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
			if image.Parameters != nil && !image.Resolution.Supported {
				size := image.Size
				size.Presets = activeImageSizePresets(image)
				spec.ImageSize = capabilityImageSizeFromConfig(size)
			}
		}
		if image.Resolution.Supported {
			spec.Options["imageResolution"] = anyValues(image.Resolution.Values)
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
		if image.Parameters != nil {
			spec.Options = imageParameterConstraints(image.Parameters)
			spec.ImageParameters = publicImageParameters(image.Parameters)
		}
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
		if len(video.Ratios) > 0 {
			spec.Options["size"] = anyValues(video.Ratios)
		}
		if len(video.Resolutions) > 0 {
			spec.Options["vquality"] = anyValues(video.Resolutions)
		}
		if video.Processing != nil {
			// 处理类模型的 videoSeconds 是服务端测得的源时长，fpsBand 只用于价格档选择。
			spec.Options["videoSeconds"] = numericRange(1, float64(videoProcessingMaxSourceSeconds(video.Processing)), 1)
			spec.Options["fpsBand"] = anyValues(videoProcessingFPSBands)
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
		if ratio == "" || value == "" {
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

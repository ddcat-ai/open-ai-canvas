package service

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
)

// ModelCapabilityConfig 是模型能力声明，不包含供应商字段名；协议适配器负责把统一参数映射到上游请求。
type ModelCapabilityConfig struct {
	Version int                    `json:"version"`
	Video   *VideoCapabilityConfig `json:"video,omitempty"`
}

type VideoCapabilityConfig struct {
	References        VideoReferenceConfig `json:"references"`
	Duration          VideoDurationConfig  `json:"duration"`
	Ratios            []string             `json:"ratios"`
	DefaultRatio      string               `json:"defaultRatio"`
	Resolutions       []string             `json:"resolutions"`
	DefaultResolution string               `json:"defaultResolution"`
	GenerateAudio     VideoBooleanConfig   `json:"generateAudio"`
	Watermark         VideoBooleanConfig   `json:"watermark"`
	Operations        []string             `json:"operations"`
	DefaultOperation  string               `json:"defaultOperation"`
}

type VideoReferenceConfig struct {
	PromptMaxChars   int   `json:"promptMaxChars"`
	MaxImages        int   `json:"maxImages"`
	MaxImageBytes    int64 `json:"maxImageBytes"`
	MaxVideos        int   `json:"maxVideos"`
	MaxVideoBytes    int64 `json:"maxVideoBytes"`
	MaxVideoDuration int   `json:"maxVideoDurationSeconds"`
	MaxAudios        int   `json:"maxAudios"`
	MaxAudioBytes    int64 `json:"maxAudioBytes"`
	MaxAudioDuration int   `json:"maxAudioDurationSeconds"`
}

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

func DefaultModelCapabilityConfig(protocol string) *ModelCapabilityConfig {
	video := &VideoCapabilityConfig{
		References:        VideoReferenceConfig{PromptMaxChars: 1000, MaxImages: 9, MaxImageBytes: 30 * 1024 * 1024, MaxVideos: 0, MaxVideoBytes: 0, MaxVideoDuration: 0, MaxAudios: 0, MaxAudioBytes: 0, MaxAudioDuration: 0},
		Duration:          VideoDurationConfig{Selection: "range", Min: 1, Max: 15, Step: 1, Default: 6},
		Ratios:            []string{"16:9", "9:16", "1:1", "4:3", "3:4", "21:9"},
		DefaultRatio:      "16:9",
		Resolutions:       []string{"480p", "720p", "1080p", "2160p"},
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
	case model.ChannelInterfaceVolcengineArkVideo:
		video.References.MaxVideos, video.References.MaxAudios = 3, 3
		video.References.MaxVideoBytes, video.References.MaxAudioBytes = 200*1024*1024, 15*1024*1024
		video.References.MaxVideoDuration, video.References.MaxAudioDuration = 15, 15
		video.GenerateAudio = VideoBooleanConfig{Supported: true, Default: true}
		video.Watermark = VideoBooleanConfig{Supported: true, Default: false}
	case model.ChannelInterfaceNewAPIChannel1, model.ChannelInterfaceNewAPIChannel2:
		video.References.MaxVideos, video.References.MaxAudios = 3, 3
		video.References.MaxVideoBytes, video.References.MaxAudioBytes = 200*1024*1024, 15*1024*1024
		video.References.MaxVideoDuration, video.References.MaxAudioDuration = 15, 15
		video.GenerateAudio = VideoBooleanConfig{Supported: true, Default: true}
	case model.ChannelInterfaceNewAPIVideo, model.ChannelInterfaceXAIVideo:
		video.GenerateAudio = VideoBooleanConfig{Supported: false, Default: false}
	}
	return &ModelCapabilityConfig{Version: 1, Video: video}
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

func NormalizeModelCapabilityConfig(capability string, protocol string, input *ModelCapabilityConfig) (*ModelCapabilityConfig, error) {
	if capability != "video" {
		return nil, nil
	}
	if input == nil || input.Video == nil {
		return nil, BadAuthRequest("请配置视频模型能力参数")
	}
	value := &ModelCapabilityConfig{Version: 1, Video: input.Video}
	if err := validateVideoCapabilityConfig(value.Video); err != nil {
		return nil, err
	}
	return value, nil
}

func validateVideoCapabilityConfig(value *VideoCapabilityConfig) error {
	if value.References.PromptMaxChars < 1 || value.References.PromptMaxChars > 1000000 {
		return BadAuthRequest("提示词最大字符数必须在 1-1000000 之间")
	}
	for name, number := range map[string]int{"最大图片引用数": value.References.MaxImages, "最大视频引用数": value.References.MaxVideos, "最大音频引用数": value.References.MaxAudios} {
		if number < 0 || number > 100 {
			return BadAuthRequest(name + "必须在 0-100 之间")
		}
	}
	if value.References.MaxImageBytes < 0 || value.References.MaxVideoBytes < 0 || value.References.MaxAudioBytes < 0 || value.References.MaxVideoDuration < 0 || value.References.MaxAudioDuration < 0 {
		return BadAuthRequest("引用素材限制不能小于 0")
	}
	if err := validateVideoDuration(value.Duration); err != nil {
		return err
	}
	if len(value.Ratios) == 0 || strings.TrimSpace(value.DefaultRatio) == "" || !containsCapabilityString(value.Ratios, value.DefaultRatio) {
		return BadAuthRequest("请至少配置一个画面比例，并选择默认比例")
	}
	if len(value.Resolutions) == 0 || strings.TrimSpace(value.DefaultResolution) == "" || !containsCapabilityString(value.Resolutions, value.DefaultResolution) {
		return BadAuthRequest("请至少配置一个输出分辨率，并选择默认分辨率")
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
	if err := json.Unmarshal(encoded, &taskInput); err != nil || taskInput.Mode != "video" {
		return nil
	}
	channelID := strings.TrimSpace(taskInput.Config.ChannelID)
	if channelID == "" {
		channelID = systemChannelIDFromBaseURL(taskInput.Config.BaseURL)
	}
	if channelID == "" {
		if taskInput.Config.CapabilityConfig == nil || taskInput.Config.CapabilityConfig.Video == nil {
			return nil
		}
		return validateVideoTask(taskInput.Config.CapabilityConfig.Video, taskInput)
	}
	item, err := s.repo.ChannelModelByKey(channelID, strings.TrimPrefix(strings.TrimSpace(taskInput.Config.Model), "models/"))
	if err != nil {
		return BadAuthRequest("当前系统渠道模型未配置或已停用")
	}
	profile, err := DecodeModelCapabilityConfig(item.CapabilityConfigJSON)
	if err != nil || profile == nil || profile.Video == nil {
		return BadAuthRequest("当前视频模型尚未配置能力参数")
	}
	return validateVideoTask(profile.Video, taskInput)
}

func validateVideoTask(profile *VideoCapabilityConfig, input canvasGenerationInput) error {
	if utf8.RuneCountInString(input.Prompt) > profile.References.PromptMaxChars {
		return BadAuthRequest(fmt.Sprintf("提示词超过当前模型限制（最多 %d 字）", profile.References.PromptMaxChars))
	}
	if len(input.ReferenceImages) > profile.References.MaxImages || len(input.ReferenceVideos) > profile.References.MaxVideos || len(input.ReferenceAudios) > profile.References.MaxAudios {
		return BadAuthRequest("参考素材数量超过当前模型限制")
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
	if input.Config.VQuality != "" && !containsCapabilityString(profile.Resolutions, normalizeResolution(input.Config.VQuality)) {
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

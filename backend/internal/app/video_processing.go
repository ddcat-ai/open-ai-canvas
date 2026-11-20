package app

// 视频处理任务（manifest provider kind=processing，例如火山 MediaKit 画质增强）的服务端规则：
//   - 以源视频为主体，不要求 prompt；
//   - 源时长、帧率档和处理参数一律由服务端从资源记录与后台配置重算，不信任客户端；
//   - 按秒计费时按源时长预扣，结算时改用实际输出时长（与音频一致）。

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"

	"yingce/backend/internal/model"
)

// videoProcessingMetadataKey 由服务端在 admission 时写入任务 metadata，客户端传入的同名字段会被清除。
const videoProcessingMetadataKey = "videoProcessing"

var videoProcessingFPSBands = []string{"le30", "le60", "le120"}

type videoProcessingAdmission struct {
	Prompt string
}

// prepareVideoProcessingTask 识别系统渠道的视频处理模型并重写任务输入。
// 非处理模型返回 (nil, nil)，任务按普通生成链路继续。
func (s *Service) prepareVideoProcessingTask(userID string, input map[string]any) (*videoProcessingAdmission, error) {
	metadata, _ := input["metadata"].(map[string]any)
	if metadata != nil {
		delete(metadata, videoProcessingMetadataKey)
	}
	config, _ := input["config"].(map[string]any)
	if stringValue(input["mode"]) != "video" || config == nil {
		return nil, nil
	}
	channelID := strings.TrimSpace(stringValue(config["channelId"]))
	modelKey := strings.TrimPrefix(strings.TrimSpace(stringValue(config["model"])), "models/")
	if channelID == "" || modelKey == "" {
		return nil, nil
	}
	channelModel, err := s.repo.ChannelModelByKey(channelID, modelKey)
	if err != nil {
		// 模型不存在等错误由后续系统渠道 admission 统一报告。
		return nil, nil
	}
	protocolID := string(channelModel.Protocol)
	metadataInfo, ok := s.protocolMetadata(protocolID)
	if !ok || !metadataInfo.Kind.IsProcessing() {
		return nil, nil
	}
	capabilityConfig, err := normalizedChannelModelCapability(channelModel, s.protocolRegistry())
	if err != nil || capabilityConfig == nil || capabilityConfig.Video == nil || capabilityConfig.Video.Processing == nil {
		return nil, BadAuthRequest("视频处理模型尚未配置处理参数，请联系管理员")
	}
	profile := capabilityConfig.Video
	processing := profile.Processing

	videos, _ := input["referenceVideos"].([]any)
	if len(videos) != 1 {
		return nil, BadAuthRequest("视频处理需要且只能提交一个源视频")
	}
	if images, _ := input["referenceImages"].([]any); len(images) > 0 {
		return nil, BadAuthRequest("视频处理不接受参考图片")
	}
	if audios, _ := input["referenceAudios"].([]any); len(audios) > 0 {
		return nil, BadAuthRequest("视频处理不接受参考音频")
	}
	source, _ := videos[0].(map[string]any)
	if source == nil {
		return nil, BadAuthRequest("源视频引用格式无效")
	}
	storageKey := strings.TrimSpace(stringValue(source["storageKey"]))
	if !strings.HasPrefix(storageKey, "resource:") {
		return nil, BadAuthRequest("源视频需先保存到资源库后再处理")
	}
	resource, err := s.repo.ResourceForUser(userID, strings.TrimPrefix(storageKey, "resource:"))
	if err != nil {
		return nil, BadAuthRequest("源视频资源不存在或无权访问")
	}
	if resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("源视频尚未上传完成")
	}
	if mime := strings.ToLower(strings.TrimSpace(resource.MimeType)); mime != "" && !strings.HasPrefix(mime, "video/") {
		return nil, BadAuthRequest("源资源不是视频")
	}
	durationMs := resource.DurationMs
	if durationMs <= 0 {
		return nil, BadAuthRequest("无法读取源视频时长，请重新上传后再试")
	}
	maxSeconds := videoProcessingMaxSourceSeconds(profile)
	if durationMs > int64(maxSeconds)*1000 {
		return nil, BadAuthRequest(fmt.Sprintf("源视频时长超过 %d 秒上限，请先截取片段后再处理", maxSeconds))
	}
	isDepth := profile.DefaultOperation == VideoProcessingOperationDepth
	// 深度接口只公布了 2K 上限，未定义像素边界；交由上游校验，不能套用增强的 1080p 限制。
	if !isDepth {
		if err := validateVideoProcessingSourceSize(resource.Width, resource.Height); err != nil {
			return nil, err
		}
	}
	seconds := int((durationMs + 999) / 1000)

	if metadata == nil {
		metadata = map[string]any{}
		input["metadata"] = metadata
	}
	allOptions, _ := metadata["providerOptions"].(map[string]any)
	if allOptions == nil {
		allOptions = map[string]any{}
	}
	options, _ := allOptions[protocolID].(map[string]any)
	if options == nil {
		options = map[string]any{}
	}
	band := ""
	if isDepth {
		// 深度接口只有固定 standard 档，不接收增强参数或客户端指定的回调/存储位置。
		options = map[string]any{}
	} else {
		band, err = normalizeVideoProcessingOptions(processing, options)
		if err != nil {
			return nil, err
		}
	}
	// 只保留本 provider 命名空间，避免其它插件字段漂入上游请求。
	metadata["providerOptions"] = map[string]any{protocolID: options}
	metadata[videoProcessingMetadataKey] = true
	metadata["videoEditOperation"] = profile.DefaultOperation

	config["videoSeconds"] = strconv.Itoa(seconds)
	config["fpsBand"] = band
	if isDepth {
		delete(config, "vquality")
		delete(config, "fpsBand")
	}
	for _, key := range []string{"size", "videoGenerateAudio", "videoWatermark"} {
		delete(config, key)
	}
	if capabilityOptions, ok := input["capabilityOptions"].(map[string]any); ok {
		for _, key := range []string{"size", "videoGenerateAudio", "videoWatermark"} {
			delete(capabilityOptions, key)
		}
		capabilityOptions["videoSeconds"] = seconds
		capabilityOptions["fpsBand"] = band
		if isDepth {
			delete(capabilityOptions, "vquality")
			delete(capabilityOptions, "fpsBand")
		}
	}
	source["durationMs"] = durationMs
	source["width"], source["height"] = resource.Width, resource.Height

	prompt := strings.TrimSpace(metadataInfo.Name)
	if prompt == "" {
		prompt = "视频处理"
	}
	if resolution := strings.TrimSpace(stringValue(config["vquality"])); resolution != "" {
		prompt += "（" + resolution + "）"
	}
	return &videoProcessingAdmission{Prompt: prompt}, nil
}

// validateVideoProcessingSourceSize 校验火山画质增强的输入规格：短边 [360,1080]，长边 [360,1920]。
// 资源没有记录尺寸时交给上游校验。
func validateVideoProcessingSourceSize(width, height int) error {
	if width <= 0 || height <= 0 {
		return nil
	}
	short, long := min(width, height), max(width, height)
	if short < 360 || short > 1080 || long > 1920 {
		return BadAuthRequest(fmt.Sprintf("源视频分辨率 %dx%d 不受支持：短边需在 360-1080、长边不超过 1920", width, height))
	}
	return nil
}

// normalizeVideoProcessingOptions 按后台帧率策略收敛 fps，并校验码率参数；返回价格档使用的 fpsBand。
func normalizeVideoProcessingOptions(processing *VideoProcessingConfig, options map[string]any) (string, error) {
	band := "le30"
	switch processing.FPSPolicy {
	case VideoProcessingFPSKeepSource:
		// 保持原帧率：不向上游发送 fps，按 ≤30fps 档预扣。
		delete(options, "fps")
	case VideoProcessingFPSUserSelect:
		fps, ok := numericScalar(options["fps"])
		if !ok || fps != math.Trunc(fps) || !containsInt(processing.FPSOptions, int(fps)) {
			return "", BadAuthRequest("请选择后台允许的输出帧率")
		}
		options["fps"] = int(fps)
		band = videoFPSBand(fps)
	default:
		return "", BadAuthRequest("视频处理帧率策略无效，请联系管理员")
	}
	if raw, exists := options["bitrate_level"]; exists && raw != nil && strings.TrimSpace(fmt.Sprint(raw)) != "" {
		level := strings.ToLower(strings.TrimSpace(fmt.Sprint(raw)))
		if level != "low" && level != "medium" && level != "high" {
			return "", BadAuthRequest("码率档位仅支持 low、medium、high")
		}
		options["bitrate_level"] = level
	} else {
		delete(options, "bitrate_level")
	}
	if raw, exists := options["bitrate"]; exists && raw != nil && strings.TrimSpace(fmt.Sprint(raw)) != "" {
		bitrate, ok := numericScalar(raw)
		if !ok || bitrate != math.Trunc(bitrate) || bitrate < 10 || bitrate > 150000 {
			return "", BadAuthRequest("精确码率需为 10-150000 之间的整数（kbps）")
		}
		options["bitrate"] = int(bitrate)
	} else {
		delete(options, "bitrate")
	}
	for key := range options {
		switch key {
		case "fps", "bitrate_level", "bitrate":
		default:
			delete(options, key)
		}
	}
	return band, nil
}

// taskIsVideoProcessing 读取 admission 写入的服务端标记。
func (s *Service) taskIsVideoProcessing(task model.Task) bool {
	if capabilityFromTaskType(task.Type) != "video" || strings.TrimSpace(task.InputJSON) == "" {
		return false
	}
	raw, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return false
	}
	var input struct {
		Metadata map[string]any `json:"metadata"`
	}
	if json.Unmarshal([]byte(raw), &input) != nil {
		return false
	}
	flag, _ := input.Metadata[videoProcessingMetadataKey].(bool)
	return flag
}

// VideoProcessingOutputDurationMs 返回处理任务的实际输出时长：优先使用持久化资源的探测时长，
// 其次使用上游 usage.outputDurationSeconds。handled=false 表示不是处理任务；
// handled=true 且返回错误时，调用方必须进入待核对，不能按预扣金额结算。
func (s *Service) VideoProcessingOutputDurationMs(task model.Task) (int64, bool, error) {
	if !s.taskIsVideoProcessing(task) {
		return 0, false, nil
	}
	if resourceID, _ := taskOutputResource(task.ResultJSON, task.Type); resourceID != "" {
		if resource, err := s.repo.ResourceForUser(task.UserID, resourceID); err == nil && resource.DurationMs > 0 {
			return resource.DurationMs, true, nil
		}
	}
	var result struct {
		Usage map[string]any `json:"usage"`
	}
	if json.Unmarshal([]byte(task.ResultJSON), &result) == nil {
		if seconds, ok := numericScalar(result.Usage["outputDurationSeconds"]); ok && seconds > 0 {
			return int64(math.Ceil(seconds * 1000)), true, nil
		}
	}
	return 0, true, errors.New("视频处理结果缺少有效输出时长")
}

// settleVideoProcessingBilling 处理按秒计费的视频处理订单；非处理任务或非按秒订单返回 handled=false。
func (s *Service) settleVideoProcessingBilling(task model.Task, providerRequestID string) (bool, error) {
	if task.BillingOrderID == "" {
		return false, nil
	}
	billing := s.taskBilling()
	order, err := billing.BillingOrder(task.BillingOrderID)
	if err != nil || order == nil || order.Capability != "video" || order.BillingMode != "per_second" {
		return false, err
	}
	durationMs, handled, err := s.VideoProcessingOutputDurationMs(task)
	if !handled {
		return false, nil
	}
	if err != nil {
		return true, err
	}
	return true, billing.SettleBillingWithAudioDuration(task.BillingOrderID, providerRequestID, durationMs)
}

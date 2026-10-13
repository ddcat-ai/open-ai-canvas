// 模型能力规格（CapabilitySpec）的解码、规范化与匹配。
//
// 一次生成请求先被归一成 ModelRequestIntent（模式、尺寸、时长、参考图数量等），
// 再逐个路由比对能力规格：输入约束（参考图/视频/音频数量）与选项约束（尺寸、比例、质量）
// 都满足才算可用。这里是纯函数，不读数据库。

package app

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

type CapabilityImageSizePreset = ImageSizePreset

type CapabilityImageSize struct {
	Parameter   string                      `json:"parameter,omitempty"`
	AllowCustom bool                        `json:"allowCustom,omitempty"`
	Presets     []CapabilityImageSizePreset `json:"presets,omitempty"`
}

type CapabilitySpec struct {
	ImageParameters []protocol.ImageParameter   `json:"imageParameters"`
	Version         int                         `json:"version"`
	Capability      string                      `json:"capability"`
	Operations      []string                    `json:"operations,omitempty"`
	Inputs          map[string]InputConstraint  `json:"inputs,omitempty"`
	Options         map[string]OptionConstraint `json:"options,omitempty"`
	ImageSize       *CapabilityImageSize        `json:"imageSize,omitempty"`
}

type InputConstraint struct {
	Min int `json:"min"`
	Max int `json:"max"`
}

type OptionConstraint struct {
	Values []any    `json:"values,omitempty"`
	Min    *float64 `json:"min,omitempty"`
	Max    *float64 `json:"max,omitempty"`
	Step   *float64 `json:"step,omitempty"`
}

type ModelRequestIntent struct {
	Capability string         `json:"capability"`
	Operation  string         `json:"operation,omitempty"`
	Inputs     map[string]int `json:"inputs,omitempty"`
	Options    map[string]any `json:"options,omitempty"`
}

// ModelRequestIntentFromTaskInput 从统一任务输入推导路由意图；它只统计实际输入和显式参数，不假设任何固定图片数或视频时长。
func ModelRequestIntentFromTaskInput(input map[string]any, taskType string, operation string) ModelRequestIntent {
	capability := normalizeCapability(fmt.Sprint(input["mode"]))
	if capability == "" {
		capability = capabilityFromTaskType(taskType)
	}
	intent := ModelRequestIntent{Capability: capability, Operation: strings.TrimSpace(operation), Inputs: map[string]int{}, Options: map[string]any{}}
	for inputType, key := range map[string]string{"image": "referenceImages", "video": "referenceVideos", "audio": "referenceAudios"} {
		if values, ok := input[key].([]any); ok {
			intent.Inputs[inputType] = len(values)
		}
	}
	if mask, exists := input["mask"]; exists && mask != nil {
		intent.Inputs["mask"] = 1
	}
	explicitOptions := false
	if options, ok := input["capabilityOptions"].(map[string]any); ok {
		explicitOptions = true
		for key, value := range options {
			name := canonicalModelOptionName(capability, key)
			// auto/any 表示调用方不指定质量或图片分辨率；不能把它当作模型必须声明的
			// 枚举值，否则未列出 auto 的模型会被错误判定为参数不支持。
			if name == "quality" || name == "imageResolution" {
				if normalized, ok := value.(string); ok && (strings.EqualFold(strings.TrimSpace(normalized), "auto") || strings.EqualFold(strings.TrimSpace(normalized), "any")) {
					continue
				}
			}
			if capability == "image" {
				intent.Options[name] = value
			} else {
				intent.Options[name] = normalizeModelRequestOption(name, value)
			}
		}
	}
	if config, ok := input["config"].(map[string]any); ok && !explicitOptions {
		if capability == "image" {
			if parameters, ok := config["imageParameters"].(map[string]any); ok {
				for name, value := range parameters {
					intent.Options[name] = value
				}
				return intent
			}
		}
		for key, value := range config {
			switch key {
			case "channelId", "apiFormat", "interfaceType", "baseUrl", "apiKey", "secretKey", "headers", "model", "capabilityConfig":
				continue
			default:
				canonical := canonicalCapabilityOptionName(key)
				if isCapabilityOptionFor(capability, canonical) && value != nil && strings.TrimSpace(fmt.Sprint(value)) != "" {
					intent.Options[canonical] = normalizeModelRequestOption(canonical, value)
				}
			}
		}
	}
	return intent
}

func normalizeModelRequestOption(name string, value any) any {
	canonicalName := canonicalCapabilityOptionName(name)
	if canonicalName == "quality" || canonicalName == "size" || canonicalName == "imageResolution" {
		if text, ok := value.(string); ok {
			return strings.ToLower(strings.TrimSpace(text))
		}
		return value
	}
	if canonicalName != "vquality" {
		return value
	}
	resolution, ok := value.(string)
	if !ok {
		return value
	}
	switch strings.ToLower(strings.TrimSpace(resolution)) {
	case "low", "480", "480p":
		return "480p"
	case "720", "720p":
		return "720p"
	case "1080", "1080p":
		return "1080p"
	case "2k", "1440", "1440p":
		return "1440p"
	case "4k", "2160", "2160p":
		return "2160p"
	default:
		// Providers expose additional resolutions such as 768P and 960P.
		// Canonicalize numeric P values generically so billing selectors match
		// regardless of whether the client sends "960" or "960P".
		pixels := strings.TrimSuffix(strings.ToLower(strings.TrimSpace(resolution)), "p")
		if numeric, err := strconv.Atoi(pixels); err == nil && numeric > 0 {
			return strconv.Itoa(numeric) + "p"
		}
		return value
	}
}

type CapabilityMatch struct {
	Matched bool     `json:"matched"`
	Reasons []string `json:"reasons,omitempty"`
}

type cachedLogicalModel struct {
	Model       model.LogicalModel
	Revision    model.LogicalModelRevision
	ProductSpec CapabilitySpec
	Defaults    map[string]any
	Routes      []cachedLogicalRoute
}

type cachedLogicalRoute struct {
	Route          model.LogicalModelRoute
	CapabilitySpec CapabilitySpec
	ChannelModel   model.ChannelModel
}

type routeCatalogSnapshot struct {
	LoadedAt       time.Time
	CatalogVersion int64
	Models         map[string]cachedLogicalModel
	Ordered        []string
}

type RoutedModel struct {
	LogicalModel   model.LogicalModel
	Revision       model.LogicalModelRevision
	Route          model.LogicalModelRoute
	ChannelModel   model.ChannelModel
	CapabilitySpec CapabilitySpec
	PriceTier      *model.ChannelModelPriceTier
	Defaults       map[string]any
	// Intent 是已归一的公开生成意图（比例口径），与线路执行编码分离。
	Intent ModelRequestIntent
}

func DecodeCapabilitySpec(raw string) (CapabilitySpec, error) {
	var spec CapabilitySpec
	if err := json.Unmarshal([]byte(raw), &spec); err != nil {
		return spec, BadAuthRequest("能力配置不是有效 JSON")
	}
	normalized, err := NormalizeCapabilitySpec(spec)
	if err != nil {
		return spec, err
	}
	return normalized, nil
}

func ValidateCapabilitySpec(spec CapabilitySpec) error {
	_, err := NormalizeCapabilitySpec(spec)
	return err
}

func NormalizeCapabilitySpec(spec CapabilitySpec) (CapabilitySpec, error) {
	spec.Capability = normalizeCapability(spec.Capability)
	if spec.Version != 1 {
		return spec, BadAuthRequest("能力配置 version 必须为 1")
	}
	if spec.Capability == "" {
		return spec, BadAuthRequest("能力配置必须声明 capability")
	}
	operations := make([]string, 0, len(spec.Operations))
	seenOperations := make(map[string]bool, len(spec.Operations))
	for _, operation := range spec.Operations {
		normalized := normalizeCapabilityValue(operation)
		if normalized != "" && !seenOperations[normalized] {
			seenOperations[normalized] = true
			operations = append(operations, normalized)
		}
	}
	spec.Operations = operations
	normalizedInputs := make(map[string]InputConstraint, len(spec.Inputs))
	for rawName, constraint := range spec.Inputs {
		name := normalizeCapabilityValue(rawName)
		if name == "" || constraint.Min < 0 || constraint.Max < constraint.Min {
			return spec, BadAuthRequest("输入能力范围无效")
		}
		if _, exists := normalizedInputs[name]; exists {
			return spec, BadAuthRequest("输入能力存在重复名称：" + name)
		}
		normalizedInputs[name] = constraint
	}
	spec.Inputs = normalizedInputs
	normalizedOptions := make(map[string]OptionConstraint, len(spec.Options))
	for rawName, constraint := range spec.Options {
		name := canonicalModelOptionName(spec.Capability, rawName)
		if strings.TrimSpace(name) == "" {
			return spec, BadAuthRequest("能力参数名称不能为空")
		}
		if _, exists := normalizedOptions[name]; exists {
			return spec, BadAuthRequest("能力参数存在重复别名：" + name)
		}
		hasValues := len(constraint.Values) > 0
		hasRange := constraint.Min != nil || constraint.Max != nil || constraint.Step != nil
		if !hasValues && !hasRange {
			return spec, BadAuthRequest("能力参数必须声明 values 或数值范围")
		}
		if hasValues && hasRange {
			return spec, BadAuthRequest("能力参数不能同时声明 values 和数值范围")
		}
		if hasRange && (constraint.Min == nil || constraint.Max == nil) {
			return spec, BadAuthRequest("数值范围必须同时声明 min 和 max")
		}
		if constraint.Min != nil && constraint.Max != nil && *constraint.Max < *constraint.Min {
			return spec, BadAuthRequest("能力参数数值范围无效")
		}
		if constraint.Step != nil && *constraint.Step <= 0 {
			return spec, BadAuthRequest("能力参数 step 必须大于 0")
		}
		normalizedOptions[name] = constraint
	}
	spec.Options = normalizedOptions
	if spec.Capability == "image" && spec.ImageParameters != nil {
		if err := protocol.ValidateImageParameters(spec.ImageParameters); err != nil {
			return spec, BadAuthRequest(err.Error())
		}
	}
	return spec, nil
}

func decodeLogicalDefaults(raw string, spec CapabilitySpec) (map[string]any, error) {
	defaults := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &defaults); err != nil {
		return nil, err
	}
	if spec.Capability == "image" && spec.ImageParameters != nil {
		current := imageParameterDefaults(spec.ImageParameters)
		for _, p := range spec.ImageParameters {
			if value, ok := defaults[p.Name]; ok && p.IsEnabled() && p.Accepts(imageParameterValue(p, value)) {
				current[p.Name] = imageParameterValue(p, value)
			}
		}
		defaults = current
	}
	return normalizeLogicalDefaults(spec, defaults)
}

func MatchCapability(spec CapabilitySpec, intent ModelRequestIntent) CapabilityMatch {
	reasons := make([]string, 0)
	if spec.Capability == "image" && spec.ImageParameters != nil {
		values := make(map[string]any, len(intent.Options))
		for name, value := range intent.Options {
			values[name] = value
		}
		// Size may already be encoded as a pixel preset by an older client.
		parameters := append([]protocol.ImageParameter(nil), spec.ImageParameters...)
		for index := range parameters {
			parameters[index].Required = false
		}
		if value, ok := values["size"]; ok && capabilityImageSizePresetMatches(spec, value, values) {
			delete(values, "size")
			parameters = make([]protocol.ImageParameter, 0, len(spec.ImageParameters))
			for _, p := range spec.ImageParameters {
				if p.Name != "size" {
					p.Required = false
					parameters = append(parameters, p)
				}
			}
		}
		if _, err := resolveImageParameterValues(parameters, values); err != nil {
			reasons = append(reasons, err.Error())
		}
	}
	if normalizeCapability(intent.Capability) != normalizeCapability(spec.Capability) {
		reasons = append(reasons, "能力类型不匹配")
	}
	if operation := normalizeCapabilityValue(intent.Operation); operation != "" && len(spec.Operations) > 0 && !containsNormalized(spec.Operations, operation) {
		reasons = append(reasons, "不支持操作 "+intent.Operation)
	}
	for inputType, count := range intent.Inputs {
		if count < 0 {
			reasons = append(reasons, "输入数量不能小于 0")
			continue
		}
		constraint, declared := spec.Inputs[inputType]
		if !declared {
			if count > 0 {
				reasons = append(reasons, "不支持 "+capabilityInputLabel(inputType)+"输入")
			}
			continue
		}
		if count < constraint.Min || count > constraint.Max {
			reasons = append(reasons, fmt.Sprintf("%s数量需在 %d-%d 之间", capabilityInputLabel(inputType), constraint.Min, constraint.Max))
		}
	}
	for inputType, constraint := range spec.Inputs {
		if intent.Inputs[inputType] < constraint.Min {
			reasons = append(reasons, fmt.Sprintf("至少需要 %d 个%s", constraint.Min, capabilityInputLabel(inputType)))
		}
	}
	for name, value := range intent.Options {
		canonicalName := canonicalModelOptionName(spec.Capability, name)
		if inactiveCapabilityOptionValue(canonicalName, value) {
			continue
		}
		constraint, declared := spec.Options[canonicalName]
		if !declared {
			reasons = append(reasons, "不支持参数 "+capabilityOptionLabel(name))
			continue
		}
		if !matchOptionConstraint(name, constraint, value) {
			reasons = append(reasons, "参数 "+capabilityOptionLabel(name)+"超出支持范围")
		}
	}
	return CapabilityMatch{Matched: len(reasons) == 0, Reasons: reasons}
}

// Image size intent and provider encoding share explicit preset mappings.
// 公开意图按比例口径表达，线路执行编码可能是像素。两者只依据当前规格的显式 presets
// 互为别名，不做宽高数值猜测。

// resolveModelRequestIntent 产出匹配、计价与线路选择共用的唯一公开生成意图。
func resolveModelRequestIntent(spec CapabilitySpec, intent ModelRequestIntent, defaults map[string]any) ModelRequestIntent {
	intent.Options = mergeIntentDefaults(intent.Options, defaults)
	return normalizeImageSizeIntent(spec, intent)
}

func normalizeImageSizeIntent(spec CapabilitySpec, intent ModelRequestIntent) ModelRequestIntent {
	if normalizeCapability(intent.Capability) != "image" || spec.ImageSize == nil || intent.Options == nil {
		return intent
	}
	value, ok := intent.Options["size"].(string)
	if !ok || strings.TrimSpace(value) == "" {
		return intent
	}
	tier := stringValue(intent.Options["imageResolution"])
	if _, hasIndependentResolution := spec.Options["imageResolution"]; hasIndependentResolution {
		if strings.EqualFold(tier, "auto") || strings.EqualFold(tier, "any") {
			tier = ""
		}
		if tier == "" {
			return intent
		}
	} else if spec.ImageParameters == nil {
		tier = stringValue(intent.Options["quality"])
	}
	preset, ok := declaredImageSizePreset(spec.ImageSize.Presets, value, tier, "")
	if !ok {
		return intent
	}
	options := make(map[string]any, len(intent.Options))
	for key, option := range intent.Options {
		options[key] = option
	}
	if spec.ImageSize.Parameter == "size" {
		options["size"] = strings.TrimSpace(preset.Size)
	} else {
		options["size"] = normalizeDeclaredImageRatio(preset.Ratio)
	}
	intent.Options = options
	return intent
}

// capabilityImageSizePresetMatches lets routing compare the public image-size
// intent with either route encoding. Only an explicit tier + preset mapping is
// an alias; numeric similarity is never inferred.
func capabilityImageSizePresetMatches(spec CapabilitySpec, value any, options map[string]any) bool {
	size := spec.ImageSize
	if size == nil || len(size.Presets) == 0 {
		return false
	}
	text, ok := value.(string)
	if !ok {
		return false
	}
	var tier any
	if spec.ImageParameters == nil {
		tier = options["quality"]
	}
	if _, independent := spec.Options["imageResolution"]; independent {
		resolution := stringValue(options["imageResolution"])
		if resolution == "" || strings.EqualFold(resolution, "auto") || strings.EqualFold(resolution, "any") {
			return false
		}
		tier = resolution
	}
	_, matched := declaredImageSizePreset(size.Presets, text, stringValue(tier), "")
	return matched
}

// inactiveCapabilityOptionValue 判断取值是否表示“未请求该参数”。
// 空值和图片质量/分辨率的 auto/any 不构成请求；其他非空字符串、true、非零数字仍视为真实要求。
func inactiveCapabilityOptionValue(name string, value any) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case bool:
		return !typed
	case string:
		normalized := strings.TrimSpace(typed)
		if normalized == "" {
			return true
		}
		return (name == "quality" || name == "imageResolution") && (strings.EqualFold(normalized, "auto") || strings.EqualFold(normalized, "any"))
	case float64:
		return typed == 0
	case float32:
		return typed == 0
	case int:
		return typed == 0
	case int64:
		return typed == 0
	}
	return false
}

func capabilityInputLabel(name string) string {
	switch normalizeCapabilityValue(name) {
	case "image":
		return "参考图片"
	case "video":
		return "参考视频"
	case "audio":
		return "参考音频"
	case "mask":
		return "蒙版"
	default:
		return name
	}
}

func capabilityOptionLabel(name string) string {
	switch canonicalCapabilityOptionName(name) {
	case "size":
		return "画面尺寸"
	case "quality":
		return "生成质量"
	case "imageResolution":
		return "图片分辨率"
	case "transparentBackground":
		return "透明背景"
	case "count":
		return "输出数量"
	case "videoSeconds":
		return "视频时长"
	case "vquality":
		return "输出分辨率"
	case "videoGenerateAudio":
		return "同步音频"
	case "videoWatermark":
		return "水印设置"
	case "audioVoice":
		return "音色"
	case "audioFormat":
		return "音频格式"
	case "audioSpeed":
		return "语速"
	case "audioInstructions":
		return "朗读指令"
	default:
		return name
	}
}

func matchOptionConstraint(name string, constraint OptionConstraint, value any) bool {
	if len(constraint.Values) > 0 {
		for _, candidate := range constraint.Values {
			if normalizedScalar(candidate) == "*" {
				return true
			}
			if capabilityOptionValuesEqual(name, candidate, value) {
				return true
			}
		}
		return false
	}
	number, ok := numericScalar(value)
	if !ok {
		return false
	}
	if constraint.Min != nil && number < *constraint.Min {
		return false
	}
	if constraint.Max != nil && number > *constraint.Max {
		return false
	}
	if constraint.Step != nil && constraint.Min != nil {
		steps := (number - *constraint.Min) / *constraint.Step
		return math.Abs(steps-math.Round(steps)) < 1e-9
	}
	return true
}

func capabilityOptionValuesEqual(name string, candidate any, value any) bool {
	left := normalizedScalar(candidate)
	right := normalizedScalar(value)
	if canonicalCapabilityOptionName(name) == "vquality" {
		// Compare using the same aliases as request intents and price tiers.
		left = strings.TrimSuffix(normalizedScalar(normalizeModelRequestOption(name, left)), "p")
		right = strings.TrimSuffix(normalizedScalar(normalizeModelRequestOption(name, right)), "p")
	}
	return left == right
}

func normalizedScalar(value any) string {
	switch typed := value.(type) {
	case string:
		return normalizeCapabilityValue(typed)
	case bool:
		return strconv.FormatBool(typed)
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 64)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	default:
		encoded, _ := json.Marshal(value)
		return string(encoded)
	}
}

func numericScalar(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case float32:
		return float64(typed), true
	case int:
		return float64(typed), true
	case int64:
		return float64(typed), true
	case json.Number:
		parsed, err := typed.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(typed), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func containsNormalized(values []string, expected string) bool {
	for _, value := range values {
		if normalizeCapabilityValue(value) == expected {
			return true
		}
	}
	return false
}

func normalizeCapabilityValue(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func canonicalCapabilityOptionName(value string) string {
	name := strings.TrimSpace(value)
	switch name {
	case "duration":
		return "videoSeconds"
	case "aspectRatio":
		return "size"
	case "resolution":
		return "vquality"
	default:
		return name
	}
}

func canonicalModelOptionName(capability, value string) string {
	if capability == "image" {
		return strings.TrimSpace(value)
	}
	return canonicalCapabilityOptionName(value)
}

func isCapabilityOptionFor(capability string, name string) bool {
	switch normalizeCapability(capability) {
	case "image":
		return name == "size" || name == "quality" || name == "imageResolution" || name == "transparentBackground" || name == "count"
	case "video":
		return name == "size" || name == "videoSeconds" || name == "vquality" || name == "videoGenerateAudio" || name == "videoWatermark"
	case "audio":
		return name == "audioVoice" || name == "audioFormat" || name == "audioSpeed" || name == "audioInstructions"
	case "text":
		// systemPrompt 是请求内容，不是供应线路能力维度，不能参与路由匹配。
		return false
	default:
		return false
	}
}

func isProviderCapabilityOption(name string) bool {
	return isCapabilityOptionFor("image", name) || isCapabilityOptionFor("video", name) || isCapabilityOptionFor("audio", name) || isCapabilityOptionFor("text", name)
}

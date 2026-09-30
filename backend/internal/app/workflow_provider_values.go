// 工作流字段取值：把用户在画布上的选择（尺寸、比例、时长、分辨率、提示词、种子）
// 解析成 RunningHub 节点可接受的具体值。
//
// 规则：显式值优先；其次按字段声明的选项/范围就近取值；都没有才用配置默认值。
// 尺寸类字段会按上游要求的步长取整，避免上游拒绝非法分辨率。

package app

import (
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"sort"
	"strconv"
	"strings"
)

func workflowFieldsFromManagement(workflow map[string]interface{}, mode string) ([]WorkflowField, error) {
	rawFields := collectManagementWorkflowFields(workflow, mode)
	encoded, err := json.Marshal(rawFields)
	if err != nil {
		return nil, fmt.Errorf("工作流字段映射编码失败：%w", err)
	}
	var fields []WorkflowField
	if err := json.Unmarshal(encoded, &fields); err != nil {
		return nil, fmt.Errorf("工作流字段映射解析失败：%w", err)
	}
	return fields, nil
}

func workflowFieldsForMode(fields []WorkflowField, mode string) []WorkflowField {
	if len(fields) == 0 {
		return fields
	}
	normalized := make([]WorkflowField, len(fields))
	copy(normalized, fields)
	for index := range normalized {
		field := &normalized[index]
		if canonical := workflowNamedDynamicSource(field.Source, mode); canonical != "" {
			field.Source = canonical
		}
		inferred := workflowDynamicSourceForMode(field.FieldName, field.FieldType, mode)
		if strings.TrimSpace(field.Source) == "" && !field.sourceConfigured && !field.BindPrompt {
			field.Source = inferred
			if inferred != "" {
				field.SourceAutomatic = ptr(true)
			}
			continue
		}
		if shouldRepairLegacyWorkflowSource(field.FieldName, field.Source, inferred, mode) {
			field.Source = inferred
		}
	}
	return normalized
}

func shouldRepairLegacyWorkflowSource(fieldName string, source string, inferred string, mode string) bool {
	sourceKey := normalizeManagementFieldName(source)
	inferredKey := normalizeManagementFieldName(inferred)
	if sourceKey == "" || inferredKey == "" || sourceKey == inferredKey {
		return false
	}
	fieldKey := normalizeManagementFieldName(fieldName)
	wasMistakenForMedia := sourceKey == "referenceimage" || sourceKey == "referencevideo" || sourceKey == "referenceaudio"
	if wasMistakenForMedia && (workflowDimensionNameSource(fieldKey) != "" || inferredKey == "aspectratio" || inferredKey == "vquality") {
		return true
	}
	mode = strings.ToLower(strings.TrimSpace(mode))
	return (fieldKey == "resolution" && (mode == "video" && sourceKey == "size" || mode == "image" && sourceKey == "vquality")) || (fieldKey == "quality" && sourceKey == "vquality")
}

func validateWorkflowMediaInputs(fields []WorkflowField, input canvasGenerationInput) error {
	capacities := map[string]int{"referenceimage": 0, "referencevideo": 0, "referenceaudio": 0}
	hasMaskMapping := false
	for _, field := range fields {
		if field.Enabled != nil && !*field.Enabled {
			continue
		}
		source := strings.ReplaceAll(strings.ReplaceAll(normalizeWorkflowFieldSource(field), "_", ""), "-", "")
		if source == "mask" {
			hasMaskMapping = true
			continue
		}
		key := ""
		switch source {
		case "referenceimage", "image", "referenceimages":
			key = "referenceimage"
		case "referencevideo", "video", "referencevideos":
			key = "referencevideo"
		case "referenceaudio", "audio", "referenceaudios":
			key = "referenceaudio"
		}
		if key == "" {
			continue
		}
		index := field.SourceIndex
		if field.ImageOrder > 0 {
			index = field.ImageOrder - 1
		}
		if index < 0 {
			index = 0
		}
		if index+1 > capacities[key] {
			capacities[key] = index + 1
		}
	}
	checks := []struct {
		label    string
		count    int
		capacity int
	}{
		{label: "参考图片", count: len(input.ReferenceImages), capacity: capacities["referenceimage"]},
		{label: "参考视频", count: len(input.ReferenceVideos), capacity: capacities["referencevideo"]},
		{label: "参考音频", count: len(input.ReferenceAudios), capacity: capacities["referenceaudio"]},
	}
	for _, check := range checks {
		if check.count > check.capacity {
			return fmt.Errorf("工作流只配置了 %d 个%s槽位，但画布传入了 %d 个；请在工作流字段映射中补齐槽位", check.capacity, check.label, check.count)
		}
	}
	if input.Mask != nil && !hasMaskMapping {
		return errors.New("画布传入了蒙版，但工作流没有配置蒙版字段映射")
	}
	return nil
}

func runningHubNodeInfo(fields []WorkflowField, files map[string]string, input canvasGenerationInput) ([]map[string]any, error) {
	return runningHubNodeInfoWithWorkflow(fields, files, input, nil)
}

func runningHubNodeInfoWithWorkflow(fields []WorkflowField, files map[string]string, input canvasGenerationInput, workflow map[string]interface{}) ([]map[string]any, error) {
	items := make([]map[string]any, 0, len(fields)+3)
	for _, field := range fields {
		if field.Enabled != nil && !*field.Enabled || strings.TrimSpace(field.NodeID) == "" || strings.TrimSpace(field.FieldName) == "" {
			continue
		}
		// RunningHub 的 nodeInfoList 只接受字符串 fieldValue。部分内部节点不会把
		// 字符串恢复为数值，因此安全边界必须由服务端强制执行，不能依赖前端隐藏。
		if isRunningHubUnsafeInternalField(workflow, field) {
			continue
		}
		value, present, err := resolveWorkflowFieldValue(field, files, input)
		if err != nil {
			return nil, err
		}
		if !present {
			if field.Required {
				return nil, fmt.Errorf("工作流字段 %s 缺少值", firstNonEmptyString(field.ID, field.FieldName))
			}
			continue
		}
		if err := validateRunningHubWorkflowFieldValue(field, value); err != nil {
			return nil, err
		}
		encoded := workflowScalarString(value)
		if !shouldSendRunningHubWorkflowField(workflow, field, encoded) {
			continue
		}
		items = append(items, map[string]any{"nodeId": field.NodeID, "fieldName": field.FieldName, "fieldValue": encoded})
	}
	return items, nil
}

func shouldSendRunningHubWorkflowField(workflow map[string]interface{}, field WorkflowField, encoded string) bool {
	if len(workflow) == 0 {
		// AI App 只有公开参数列表，没有可用于比较的工作流 JSON。
		return true
	}
	node, ok := workflow[strings.TrimSpace(field.NodeID)].(map[string]interface{})
	if !ok {
		return true
	}
	inputs, ok := node["inputs"].(map[string]interface{})
	if !ok {
		return true
	}
	original, exists := inputs[strings.TrimSpace(field.FieldName)]
	if exists && isWorkflowLinkValue(original) {
		// 已连接输入属于工作流拓扑，不能被旧字段映射拆成字符串覆盖。
		return false
	}
	if normalizeWorkflowFieldSource(field) != "" || field.RandomEnabled {
		return !isRunningHubAutomaticInternalBinding(node, field)
	}
	if !exists {
		return true
	}
	// 拉取参数时会保存所有 widget 的默认值；未修改项无需重复覆盖工作流。
	return encoded != workflowScalarString(original)
}

func isRunningHubAutomaticInternalBinding(node map[string]interface{}, field WorkflowField) bool {
	if field.SourceAutomatic != nil && !*field.SourceAutomatic {
		return false
	}
	classType := strings.ToLower(strings.TrimSpace(stringValue(node["class_type"])))
	if classType != "imageresize+" {
		return false
	}
	// 旧配置没有 sourceAutomatic，但 ImageResize+ 的宽高来源是按同名字段自动误判的。
	// 保留节点自身尺寸链；用户仍可将来源设为默认并明确修改静态值。
	source := strings.ReplaceAll(strings.ReplaceAll(normalizeWorkflowFieldSource(field), "_", ""), "-", "")
	return source == "size" || source == "imagesize" || source == "sizewidth" || source == "width" || source == "imagewidth" || source == "videowidth" || source == "sizeheight" || source == "height" || source == "imageheight" || source == "videoheight"
}

func isRunningHubUnsafeInternalField(workflow map[string]interface{}, field WorkflowField) bool {
	if field.SafeToOverride != nil && !*field.SafeToOverride {
		return true
	}
	classType := strings.ToLower(strings.TrimSpace(field.ClassType))
	if node, ok := workflow[strings.TrimSpace(field.NodeID)].(map[string]interface{}); ok {
		classType = strings.ToLower(strings.TrimSpace(stringValue(node["class_type"])))
	}
	fieldName := strings.ToLower(strings.TrimSpace(field.FieldName))
	if classType == "int" && fieldName == "value" {
		return true
	}
	return classType == "imageresize+" && (fieldName == "width" || fieldName == "height" || fieldName == "multiple_of")
}

func validateRunningHubWorkflowFieldValue(field WorkflowField, value interface{}) error {
	fieldID := firstNonEmptyString(strings.TrimSpace(field.ID), strings.TrimSpace(field.NodeID)+"."+strings.TrimSpace(field.FieldName))
	fieldType := strings.ToUpper(strings.TrimSpace(field.FieldType))
	if fieldType == "NUMBER" || fieldType == "FLOAT" || fieldType == "INTEGER" || fieldType == "INT" || fieldType == "SLIDER" {
		numeric, ok := workflowNumericBound(value)
		if !ok {
			return fmt.Errorf("工作流字段 %s 不是有效数字", fieldID)
		}
		minValue, hasMin := workflowNumericBound(field.Min)
		maxValue, hasMax := workflowNumericBound(field.Max)
		stepValue, hasStep := workflowNumericBound(field.Step)
		if hasMin && hasMax && minValue > maxValue {
			return fmt.Errorf("工作流字段 %s 的最小值不能大于最大值", fieldID)
		}
		if hasStep && stepValue <= 0 {
			return fmt.Errorf("工作流字段 %s 的步长必须大于 0", fieldID)
		}
		if (hasMin && numeric < minValue) || (hasMax && numeric > maxValue) {
			return fmt.Errorf("工作流字段 %s 的值超出允许范围", fieldID)
		}
		if hasStep {
			start := float64(0)
			if hasMin {
				start = minValue
			}
			steps := (numeric - start) / stepValue
			if math.Abs(steps-math.Round(steps)) > 1e-7 {
				return fmt.Errorf("工作流字段 %s 的值不符合步长", fieldID)
			}
		}
	}
	if fieldType == "BOOLEAN" || fieldType == "BOOL" {
		switch item := value.(type) {
		case bool:
		case string:
			normalized := strings.ToLower(strings.TrimSpace(item))
			if normalized != "true" && normalized != "false" {
				return fmt.Errorf("工作流字段 %s 不是有效开关值", fieldID)
			}
		default:
			return fmt.Errorf("工作流字段 %s 不是有效开关值", fieldID)
		}
	}
	if options := workflowFieldAllowedOptions(field); len(options) > 0 {
		encoded := strings.TrimSpace(workflowScalarString(value))
		matched := false
		hasScalarOption := false
		for _, option := range options {
			if workflowOptionIsRange(option) {
				continue
			}
			candidate := strings.TrimSpace(workflowOptionString(option))
			if candidate == "" || candidate == "<nil>" {
				continue
			}
			hasScalarOption = true
			if candidate == encoded {
				matched = true
				break
			}
		}
		if hasScalarOption && !matched {
			return fmt.Errorf("工作流字段 %s 的值不在允许选项中", fieldID)
		}
	}
	return nil
}

func workflowOptionIsRange(value interface{}) bool {
	object, ok := value.(map[string]interface{})
	if !ok {
		return false
	}
	for _, key := range []string{"min", "max", "step", "minValue", "maxValue", "stepValue"} {
		if _, exists := object[key]; exists {
			return true
		}
	}
	if nested, ok := object["range"].(map[string]interface{}); ok {
		return workflowOptionIsRange(nested)
	}
	return false
}

func resolveWorkflowFieldValue(field WorkflowField, files map[string]string, input canvasGenerationInput) (interface{}, bool, error) {
	source := normalizeWorkflowFieldSource(field)
	// 画布参数按 nodeId + fieldName 独立保存时 source 可能为空；枚举字段仍必须
	// 使用工作流原始 options 的完整值，不能把用户界面上的比例简称直接发给 ComfyUI。
	if source == "" && strings.EqualFold(strings.TrimSpace(field.FieldName), "aspect_ratio") {
		// 旧版前端只把比例写入 Config.Size，没有同步改写字段映射。此时不能
		// 直接使用工作流保存的默认值，否则用户选择 9:16 会在提交前静默回到 1:1。
		// 仅对非 1:1 的显式比例做回填，避免没有动态参数时覆盖工作流自己的 1:1 默认值。
		requested := strings.TrimSpace(input.Config.Size)
		if requested != "" && !strings.EqualFold(workflowAspectRatio(requested), "1:1") {
			value := workflowAspectRatioValue(field, requested)
			if strings.TrimSpace(fmt.Sprint(value)) != "" {
				return value, true, nil
			}
		}
		raw := strings.TrimSpace(workflowOptionString(firstNonNilWorkflowValue(field.FieldValue, field.Value)))
		if raw != "" {
			value := workflowAspectRatioValue(field, raw)
			return value, true, nil
		}
	}
	if source != "" {
		switch strings.ReplaceAll(strings.ReplaceAll(source, "_", ""), "-", "") {
		case "prompt", "text", "positiveprompt", "positive":
			return input.Prompt, strings.TrimSpace(input.Prompt) != "", nil
		case "size", "imagesize":
			return input.Config.Size, strings.TrimSpace(input.Config.Size) != "", nil
		case "resolution":
			if strings.EqualFold(strings.TrimSpace(input.Mode), "video") {
				value := workflowVideoResolutionValue(field, input.Config.VQuality)
				return value, strings.TrimSpace(fmt.Sprint(value)) != "", nil
			}
			return input.Config.Size, strings.TrimSpace(input.Config.Size) != "", nil
		case "aspectratio", "ratio", "imageaspectratio", "imageratio", "videoaspectratio", "videoratio":
			value := workflowAspectRatioValue(field, input.Config.Size)
			return value, value != "", nil
		case "sizewidth", "width", "imagewidth", "videowidth":
			value := workflowDimensionPart(input.Mode, input.Config.Size, input.Config.VQuality, 0)
			return value, value != "", nil
		case "sizeheight", "height", "imageheight", "videoheight":
			value := workflowDimensionPart(input.Mode, input.Config.Size, input.Config.VQuality, 1)
			return value, value != "", nil
		case "quality":
			return input.Config.Quality, strings.TrimSpace(input.Config.Quality) != "", nil
		case "count", "batch", "batchsize":
			return input.Config.Count, strings.TrimSpace(input.Config.Count) != "", nil
		case "videoseconds", "video_seconds", "duration":
			value := workflowVideoDurationValue(field, input.Config.VideoSeconds)
			return value, strings.TrimSpace(fmt.Sprint(value)) != "", nil
		case "vquality", "videoquality", "video_quality":
			value := workflowVideoResolutionValue(field, input.Config.VQuality)
			return value, strings.TrimSpace(fmt.Sprint(value)) != "", nil
		case "videogenerateaudio", "video_generate_audio", "generateaudio":
			return input.Config.VideoGenerateAudio, strings.TrimSpace(input.Config.VideoGenerateAudio) != "", nil
		case "videowatermark", "video_watermark", "watermark":
			return input.Config.VideoWatermark, strings.TrimSpace(input.Config.VideoWatermark) != "", nil
		case "audioformat", "audio_format":
			return input.Config.AudioFormat, strings.TrimSpace(input.Config.AudioFormat) != "", nil
		case "systemprompt", "system_prompt":
			return input.Config.SystemPrompt, strings.TrimSpace(input.Config.SystemPrompt) != "", nil
		case "transparentbackground", "transparent_background":
			return input.Config.TransparentBackground, strings.TrimSpace(input.Config.TransparentBackground) != "", nil
		case "audiovoice", "audio_voice", "voice":
			return input.Config.AudioVoice, strings.TrimSpace(input.Config.AudioVoice) != "", nil
		case "audiospeed", "audio_speed":
			return input.Config.AudioSpeed, strings.TrimSpace(input.Config.AudioSpeed) != "", nil
		case "audioinstructions", "audio_instructions":
			return input.Config.AudioInstructions, strings.TrimSpace(input.Config.AudioInstructions) != "", nil
		}
		index := field.SourceIndex
		if field.ImageOrder > 0 {
			index = field.ImageOrder - 1
		}
		var media providerMedia
		switch strings.ReplaceAll(strings.ReplaceAll(source, "_", ""), "-", "") {
		case "referenceimage", "image", "referenceimages":
			if index < 0 || index >= len(input.ReferenceImages) {
				return nil, false, nil
			}
			media = input.ReferenceImages[index]
		case "referencevideo", "video", "referencevideos":
			if index < 0 || index >= len(input.ReferenceVideos) {
				return nil, false, nil
			}
			media = input.ReferenceVideos[index]
		case "referenceaudio", "audio", "referenceaudios":
			if index < 0 || index >= len(input.ReferenceAudios) {
				return nil, false, nil
			}
			media = input.ReferenceAudios[index]
		case "mask":
			if input.Mask == nil {
				return nil, false, nil
			}
			media = *input.Mask
		default:
			return nil, false, fmt.Errorf("不支持的工作流字段来源：%s", field.Source)
		}
		name := files[media.ID]
		if name == "" {
			return nil, false, errors.New("工作流参考素材尚未上传")
		}
		return name, true, nil
	}
	if field.RandomEnabled {
		randomMax := field.Max
		if isRunningHubInterface(input.Config.InterfaceType) && isWorkflowSeedField(field.FieldName) {
			// RunningHub 的随机 Seed 按 uint32 传输，不能沿用 JavaScript 安全整数上限。
			const runningHubSeedMax int64 = 1<<32 - 1
			maxValue, err := workflowIntegerBound(field.Max, runningHubSeedMax)
			if err != nil {
				return nil, false, err
			}
			if maxValue > runningHubSeedMax {
				maxValue = runningHubSeedMax
			}
			randomMax = maxValue
		}
		value, err := randomWorkflowInteger(field.Min, randomMax)
		return value, err == nil, err
	}
	if field.FieldValue != nil {
		return field.FieldValue, true, nil
	}
	if field.Value != nil {
		return field.Value, true, nil
	}
	return nil, false, nil
}

func firstNonNilWorkflowValue(values ...interface{}) interface{} {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func normalizeWorkflowFieldSource(field WorkflowField) string {
	source := strings.ToLower(strings.TrimSpace(field.Source))
	if source == "" && field.BindPrompt {
		return "prompt"
	}
	if source != "" {
		return source
	}
	if !field.SourceFromUpstream {
		return ""
	}
	fieldName := strings.ToLower(strings.TrimSpace(field.FieldName))
	if fieldName == "prompt" || fieldName == "text" || fieldName == "positive_prompt" || fieldName == "positiveprompt" {
		return "prompt"
	}
	switch strings.ToLower(strings.TrimSpace(field.FieldType)) {
	case "image", "img", "photo", "picture":
		return "referenceimage"
	case "video", "movie":
		return "referencevideo"
	case "audio", "sound", "music", "voice":
		return "referenceaudio"
	default:
		return ""
	}
}

func workflowDimensionPart(mode string, size string, videoQuality string, index int) string {
	if index < 0 || index > 1 {
		return ""
	}
	if dimensions, ok := workflowPixelDimensions(size); ok {
		return strconv.Itoa(dimensions[index])
	}
	if strings.EqualFold(strings.TrimSpace(mode), "video") {
		dimensions, ok := workflowVideoDimensions(size, videoQuality)
		if !ok {
			return ""
		}
		return strconv.Itoa(dimensions[index])
	}
	dimensions, ok := workflowImageDimensions(size)
	if !ok {
		return ""
	}
	return strconv.Itoa(dimensions[index])
}

func workflowPixelDimensions(value string) ([2]int, bool) {
	var result [2]int
	normalized := strings.ToLower(strings.TrimSpace(value))
	if !strings.Contains(normalized, "x") {
		return result, false
	}
	parts := strings.FieldsFunc(normalized, func(r rune) bool { return r == 'x' || r == ' ' || r == ',' })
	if len(parts) != 2 {
		return result, false
	}
	for index, part := range parts {
		parsed, err := strconv.Atoi(strings.TrimSpace(part))
		if err != nil || parsed <= 0 {
			return result, false
		}
		result[index] = parsed
	}
	return result, true
}

func workflowAspectRatio(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	// RunningHub 的 ResolutionSelector 选项带有展示文案（例如
	// "9:16 (Portrait Widescreen)"），协议比较只需要比例前缀。
	if cut := strings.IndexAny(normalized, " ("); cut >= 0 {
		normalized = strings.TrimSpace(normalized[:cut])
	}
	for _, suffix := range []string{"-1k", "-2k", "-4k"} {
		if strings.HasSuffix(normalized, suffix) {
			normalized = strings.TrimSuffix(normalized, suffix)
			break
		}
	}
	if width, height, ok := workflowRatioParts(normalized); ok {
		divisor := workflowGreatestCommonDivisor(width, height)
		return fmt.Sprintf("%d:%d", width/divisor, height/divisor)
	}
	dimensions, ok := workflowPixelDimensions(normalized)
	if !ok {
		return ""
	}
	ratio := float64(dimensions[0]) / float64(dimensions[1])
	known := [][2]int{{1, 1}, {3, 2}, {2, 3}, {4, 3}, {3, 4}, {4, 5}, {5, 4}, {16, 9}, {9, 16}, {2, 1}, {1, 2}, {21, 9}}
	bestDifference := math.MaxFloat64
	best := [2]int{}
	for _, candidate := range known {
		expected := float64(candidate[0]) / float64(candidate[1])
		difference := math.Abs(ratio-expected) / expected
		if difference < bestDifference {
			bestDifference = difference
			best = candidate
		}
	}
	if bestDifference <= 0.03 {
		return fmt.Sprintf("%d:%d", best[0], best[1])
	}
	divisor := workflowGreatestCommonDivisor(dimensions[0], dimensions[1])
	return fmt.Sprintf("%d:%d", dimensions[0]/divisor, dimensions[1]/divisor)
}

func workflowAspectRatioValue(field WorkflowField, value string) string {
	raw := strings.TrimSpace(value)
	if options := workflowFieldAllowedOptions(field); len(options) > 0 {
		requested := workflowAspectRatio(raw)
		for _, option := range options {
			candidate := strings.TrimSpace(workflowOptionString(option))
			if candidate != "" && strings.EqualFold(workflowAspectRatio(candidate), requested) {
				return candidate
			}
		}
		if fallback := workflowFieldConfiguredDefault(field); fallback != "" {
			return fallback
		}
		return raw
	}
	// “auto/adaptive” 是工作流的真实模式，不应被画布当前像素尺寸反推成
	// 一个并不存在的比例；宽高字段仍按工作流自身的默认值或显式尺寸处理。
	if fallback := strings.TrimSpace(workflowFieldConfiguredDefault(field)); strings.EqualFold(fallback, "auto") || strings.EqualFold(fallback, "adaptive") {
		return fallback
	}
	return workflowAspectRatio(raw)
}

func workflowFieldAllowedOptions(field WorkflowField) []interface{} {
	classType := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(field.ClassType), "_", ""), "-", ""))
	fieldName := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(field.FieldName), "_", ""), "-", ""))
	if classType == "resolutionselector" && fieldName == "aspectratio" {
		// RunningHub 的工作流 API 不返回 object_info；ResolutionSelector 的完整枚举
		// 是节点协议的一部分，通用比例预设（9:16 等）不能直接提交给该节点。
		return []interface{}{
			"1:1 (Square)",
			"2:3 (Portrait Photo)",
			"3:2 (Photo)",
			"3:4 (Portrait Standard)",
			"4:3 (Standard)",
			"9:16 (Portrait Widescreen)",
			"16:9 (Widescreen)",
			"21:9 (Ultrawide)",
		}
	}
	return field.Options
}

func workflowRatioParts(value string) (int, int, bool) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 {
		return 0, 0, false
	}
	width, widthErr := strconv.Atoi(strings.TrimSpace(parts[0]))
	height, heightErr := strconv.Atoi(strings.TrimSpace(parts[1]))
	return width, height, widthErr == nil && heightErr == nil && width > 0 && height > 0
}

func workflowGreatestCommonDivisor(left int, right int) int {
	for right != 0 {
		left, right = right, left%right
	}
	if left <= 0 {
		return 1
	}
	return left
}

func workflowImageDimensions(value string) ([2]int, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	preset := map[string][2]int{
		"1:1": {1024, 1024}, "3:2": {1536, 1024}, "2:3": {1024, 1536},
		"4:3": {1360, 1024}, "3:4": {1024, 1360}, "4:5": {1024, 1280}, "5:4": {1280, 1024},
		"16:9": {1824, 1024}, "9:16": {1024, 1824}, "2:1": {2048, 1024}, "1:2": {1024, 2048},
		"21:9": {2352, 1008}, "1:1-2k": {2048, 2048}, "16:9-2k": {2048, 1152},
		"9:16-2k": {1152, 2048}, "16:9-4k": {3840, 2160}, "9:16-4k": {2160, 3840},
	}
	if dimensions, ok := preset[normalized]; ok {
		return dimensions, true
	}
	ratio := workflowAspectRatio(normalized)
	widthRatio, heightRatio, ok := workflowRatioParts(ratio)
	if !ok {
		return [2]int{}, false
	}
	tier := "1k"
	if strings.HasSuffix(normalized, "-2k") {
		tier = "2k"
	} else if strings.HasSuffix(normalized, "-4k") {
		tier = "4k"
	}
	if tier == "1k" {
		if widthRatio >= heightRatio {
			return [2]int{workflowRoundToStep(1024*float64(widthRatio)/float64(heightRatio), 16), 1024}, true
		}
		return [2]int{1024, workflowRoundToStep(1024*float64(heightRatio)/float64(widthRatio), 16)}, true
	}
	longEdge := 2048
	if tier == "4k" {
		longEdge = 3840
	}
	if widthRatio >= heightRatio {
		return [2]int{longEdge, workflowRoundToStep(float64(longEdge)*float64(heightRatio)/float64(widthRatio), 16)}, true
	}
	return [2]int{workflowRoundToStep(float64(longEdge)*float64(widthRatio)/float64(heightRatio), 16), longEdge}, true
}

func workflowVideoDimensions(size string, quality string) ([2]int, bool) {
	ratio := workflowAspectRatio(size)
	widthRatio, heightRatio, ok := workflowRatioParts(ratio)
	shortEdge := workflowVideoResolutionPixels(quality)
	if !ok || shortEdge <= 0 {
		return [2]int{}, false
	}
	if widthRatio >= heightRatio {
		return [2]int{workflowRoundToStep(float64(shortEdge)*float64(widthRatio)/float64(heightRatio), 2), shortEdge}, true
	}
	return [2]int{shortEdge, workflowRoundToStep(float64(shortEdge)*float64(heightRatio)/float64(widthRatio), 2)}, true
}

func workflowRoundToStep(value float64, step int) int {
	if step <= 1 {
		return int(math.Round(value))
	}
	return int(math.Round(value/float64(step))) * step
}

func workflowVideoResolutionPixels(value string) int {
	normalized := strings.ToLower(strings.TrimSpace(value))
	switch normalized {
	case "low":
		return 480
	case "auto", "default", "medium", "high":
		return 720
	case "2k":
		return 1440
	case "4k":
		return 2160
	}
	parsed, err := strconv.Atoi(strings.TrimSuffix(normalized, "p"))
	if err != nil || parsed <= 0 {
		return 0
	}
	return parsed
}

func workflowVideoResolutionValue(field WorkflowField, value string) interface{} {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return ""
	}
	if len(field.Options) > 0 {
		requested := normalizeWorkflowResolutionToken(raw)
		for _, option := range field.Options {
			candidate := strings.TrimSpace(workflowOptionString(option))
			if candidate != "" && normalizeWorkflowResolutionToken(candidate) == requested {
				// nodeInfoList 的 fieldValue 是字符串；对象选项只取其 value/id 等标量。
				return candidate
			}
		}
		// 工作流明确声明了可选项但画布值不在其中时，保留工作流默认值，
		// 不再把 2K/4K/720 等普通模型别名硬塞给工作流。
		if fallback := workflowFieldConfiguredDefault(field); fallback != "" {
			for _, option := range field.Options {
				candidate := strings.TrimSpace(workflowOptionString(option))
				if candidate != "" && normalizeWorkflowResolutionToken(candidate) == normalizeWorkflowResolutionToken(fallback) {
					return candidate
				}
			}
			return fallback
		}
		return raw
	}
	if numeric := workflowNumericResolutionValue(field, raw); numeric != nil {
		return numeric
	}
	if fallback := workflowFieldConfiguredDefault(field); fallback != "" && !workflowResolutionShapeCompatible(fallback, raw) {
		return fallback
	}
	return raw
}

func workflowVideoDurationValue(field WorkflowField, value string) interface{} {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return ""
	}
	if len(field.Options) > 0 {
		requested := normalizeWorkflowDurationToken(raw)
		for _, option := range field.Options {
			candidate := strings.TrimSpace(workflowOptionString(option))
			if candidate != "" && normalizeWorkflowDurationToken(candidate) == requested {
				return candidate
			}
		}
		if fallback := workflowFieldConfiguredDefault(field); fallback != "" {
			for _, option := range field.Options {
				candidate := strings.TrimSpace(workflowOptionString(option))
				if candidate != "" && normalizeWorkflowDurationToken(candidate) == normalizeWorkflowDurationToken(fallback) {
					return candidate
				}
			}
			return fallback
		}
		return raw
	}
	if numeric := workflowNumericResolutionValue(field, raw); numeric != nil {
		return numeric
	}
	if fallback := workflowFieldConfiguredDefault(field); fallback != "" && !workflowResolutionShapeCompatible(fallback, raw) {
		return fallback
	}
	return raw
}

func normalizeWorkflowDurationToken(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(value, "s"), "秒")))
}

func workflowFieldConfiguredDefault(field WorkflowField) string {
	value := field.FieldValue
	if value == nil {
		value = field.Value
	}
	if value == nil {
		return ""
	}
	return strings.TrimSpace(workflowOptionString(value))
}

func normalizeWorkflowResolutionToken(value string) string {
	return strings.ToLower(strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(value, "p"), "P")))
}

func workflowNumericValue(value string) *float64 {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(strings.TrimSuffix(value, "p"), "P")), 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return nil
	}
	return &parsed
}

func workflowResolutionShapeCompatible(defaultValue string, requested string) bool {
	defaultNumeric := workflowNumericValue(defaultValue)
	requestedNumeric := workflowNumericValue(requested)
	if defaultNumeric != nil && requestedNumeric != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(defaultValue), strings.TrimSpace(requested))
}

func workflowNumericResolutionValue(field WorkflowField, raw string) interface{} {
	parsed := workflowNumericValue(raw)
	if parsed == nil {
		return nil
	}
	min, minOK := workflowNumericBound(field.Min)
	max, maxOK := workflowNumericBound(field.Max)
	step, stepOK := workflowNumericBound(field.Step)
	if !minOK && !maxOK && !stepOK && !strings.EqualFold(strings.TrimSpace(field.FieldType), "NUMBER") {
		return nil
	}
	value := *parsed
	if minOK && value < min {
		value = min
	}
	if maxOK && value > max {
		value = max
	}
	if stepOK && step > 0 {
		anchor := min
		if !minOK {
			anchor = 0
		}
		value = anchor + math.Round((value-anchor)/step)*step
	}
	if strings.EqualFold(strings.TrimSpace(field.FieldType), "NUMBER") && math.Trunc(value) == value {
		return int64(value)
	}
	return value
}

func workflowNumericBound(value interface{}) (float64, bool) {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(fmt.Sprint(value)), 64)
	return parsed, err == nil && !math.IsNaN(parsed) && !math.IsInf(parsed, 0)
}

func workflowOptionString(value interface{}) string {
	if object, ok := value.(map[string]interface{}); ok {
		for _, key := range []string{"value", "id", "key", "label", "name"} {
			if candidate := strings.TrimSpace(fmt.Sprint(object[key])); candidate != "" && candidate != "<nil>" {
				return candidate
			}
		}
	}
	return fmt.Sprint(value)
}

func runningHubPromptFallback(workflow map[string]interface{}, prompt string) []map[string]any {
	if strings.TrimSpace(prompt) == "" || len(workflow) == 0 {
		return nil
	}
	bestNodeID := ""
	bestFieldName := ""
	bestScore := -1000
	nodeIDs := make([]string, 0, len(workflow))
	for nodeID := range workflow {
		nodeIDs = append(nodeIDs, nodeID)
	}
	sort.Slice(nodeIDs, func(i, j int) bool { return managementNodeIDLess(nodeIDs[i], nodeIDs[j]) })
	for _, nodeID := range nodeIDs {
		node, ok := workflow[nodeID].(map[string]interface{})
		if !ok {
			continue
		}
		inputs, ok := node["inputs"].(map[string]interface{})
		if !ok {
			continue
		}
		fieldNames := make([]string, 0, len(inputs))
		for fieldName := range inputs {
			fieldNames = append(fieldNames, fieldName)
		}
		sort.Strings(fieldNames)
		classType := strings.ToLower(strings.TrimSpace(fmt.Sprint(node["class_type"])))
		metaTitle := strings.ToLower(strings.TrimSpace(fmt.Sprint(workflowNodeMetaTitle(node))))
		for _, fieldName := range fieldNames {
			if !isWorkflowPromptCandidate(fieldName, classType, metaTitle) {
				continue
			}
			if isWorkflowLinkValue(inputs[fieldName]) {
				continue
			}
			score := workflowPromptCandidateScore(fieldName, classType, metaTitle)
			if bestNodeID == "" || score > bestScore {
				bestNodeID = nodeID
				bestFieldName = fieldName
				bestScore = score
			}
		}
	}
	if bestNodeID != "" {
		return []map[string]any{{"nodeId": bestNodeID, "fieldName": bestFieldName, "fieldValue": prompt}}
	}
	return nil
}

func isWorkflowMediaSource(source string) bool {
	normalized := strings.ReplaceAll(strings.ReplaceAll(strings.ToLower(strings.TrimSpace(source)), "_", ""), "-", "")
	switch normalized {
	case "referenceimage", "referenceimages", "image", "referencevideo", "referencevideos", "video", "referenceaudio", "referenceaudios", "audio", "mask":
		return true
	default:
		return false
	}
}

func workflowPromptCandidateScore(fieldName string, classType string, metaTitle string) int {
	descriptor := strings.ToLower(strings.TrimSpace(fieldName + " " + metaTitle))
	score := 0
	for _, marker := range []string{"negative", "neg prompt", "负面", "反向", "负向"} {
		if strings.Contains(descriptor, marker) {
			score -= 100
			break
		}
	}
	for _, marker := range []string{"positive", "正面", "正向"} {
		if strings.Contains(descriptor, marker) {
			score += 20
			break
		}
	}
	if strings.Contains(classType, "cliptextencode") {
		score += 5
	}
	if isWorkflowPromptFieldName(fieldName) {
		score += 2
	}
	return score
}

func randomWorkflowInteger(rawMin interface{}, rawMax interface{}) (int64, error) {
	const defaultMax int64 = 9007199254740991
	minValue, err := workflowIntegerBound(rawMin, 0)
	if err != nil {
		return 0, err
	}
	maxValue, err := workflowIntegerBound(rawMax, defaultMax)
	if err != nil {
		return 0, err
	}
	if maxValue < minValue {
		return 0, errors.New("工作流随机值最大值不能小于最小值")
	}
	rangeSize := new(big.Int).Sub(big.NewInt(maxValue), big.NewInt(minValue))
	rangeSize.Add(rangeSize, big.NewInt(1))
	offset, err := cryptorand.Int(cryptorand.Reader, rangeSize)
	if err != nil {
		return 0, fmt.Errorf("生成工作流随机值失败：%w", err)
	}
	return new(big.Int).Add(offset, big.NewInt(minValue)).Int64(), nil
}

func workflowIntegerBound(value interface{}, fallback int64) (int64, error) {
	if value == nil || strings.TrimSpace(fmt.Sprint(value)) == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("工作流随机值范围不是有效整数：%v", value)
	}
	return parsed, nil
}

func workflowFieldsBindPrompt(fields []WorkflowField) bool {
	for _, field := range fields {
		if field.Enabled != nil && !*field.Enabled || strings.TrimSpace(field.NodeID) == "" || strings.TrimSpace(field.FieldName) == "" {
			continue
		}
		source := strings.ReplaceAll(strings.ReplaceAll(normalizeWorkflowFieldSource(field), "_", ""), "-", "")
		switch source {
		case "prompt", "text", "positiveprompt", "positive":
			return true
		}
	}
	return false
}

func upsertRunningHubNodeInfo(items []map[string]any, overrides []map[string]any) []map[string]any {
	for _, override := range overrides {
		nodeID := strings.TrimSpace(stringValue(override["nodeId"]))
		fieldName := strings.TrimSpace(stringValue(override["fieldName"]))
		replaced := false
		for index, item := range items {
			if strings.TrimSpace(stringValue(item["nodeId"])) == nodeID && strings.TrimSpace(stringValue(item["fieldName"])) == fieldName {
				items[index] = override
				replaced = true
				break
			}
		}
		if !replaced {
			items = append(items, override)
		}
	}
	return items
}

func isWorkflowLinkValue(value interface{}) bool {
	items, ok := value.([]interface{})
	return ok && len(items) == 2 && fmt.Sprint(items[0]) != "" && isIntegerLike(items[1])
}

func isIntegerLike(value interface{}) bool {
	switch item := value.(type) {
	case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		return true
	case float64:
		return item == float64(int(item))
	case json.Number:
		_, err := strconv.Atoi(string(item))
		return err == nil
	default:
		return false
	}
}

func isWorkflowPromptFieldName(value string) bool {
	normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "", " ", "").Replace(strings.TrimSpace(value)))
	switch normalized {
	case "text", "prompt", "positiveprompt", "positive", "caption", "description":
		return true
	default:
		return false
	}
}

func isWorkflowPromptCandidate(fieldName string, classType string, metaTitle string) bool {
	if isWorkflowPromptFieldName(fieldName) {
		return true
	}
	normalizedField := strings.ToLower(strings.TrimSpace(fieldName))
	if normalizedField != "value" {
		return false
	}
	return strings.Contains(classType, "text") || strings.Contains(classType, "string") || strings.Contains(classType, "prompt") || strings.Contains(metaTitle, "text") || strings.Contains(metaTitle, "prompt") || strings.Contains(metaTitle, "提示词") || strings.Contains(metaTitle, "文本")
}

func workflowNodeMetaTitle(node map[string]interface{}) string {
	meta, _ := node["_meta"].(map[string]interface{})
	return fmt.Sprint(meta["title"])
}

func workflowScalarString(value interface{}) string {
	switch item := value.(type) {
	case string:
		return item
	case nil:
		return ""
	default:
		encoded, err := json.Marshal(item)
		if err == nil {
			return string(encoded)
		}
		return fmt.Sprint(item)
	}
}

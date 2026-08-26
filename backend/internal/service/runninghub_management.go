package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// RunningHubWorkflowFetchRequest 只用于独立工作流设置页，不进入 ModelChannel。
type RunningHubWorkflowFetchRequest struct {
	BaseURL      string `json:"baseUrl"`
	APIKey       string `json:"apiKey"`
	WalletAPIKey string `json:"walletApiKey"`
	UseWallet    bool   `json:"useWallet"`
	WorkflowID   string `json:"workflowId"`
	WebappID     string `json:"webappId,omitempty"`
	Title        string `json:"title,omitempty"`
	Capability   string `json:"capability,omitempty"`
}

func (s *Service) FetchRunningHubWorkflowInfo(ctx context.Context, req RunningHubWorkflowFetchRequest) (map[string]any, error) {
	workflowID := strings.TrimSpace(req.WorkflowID)
	if workflowID == "" {
		return nil, BadAuthRequest("workflowId 不能为空")
	}
	config, err := runningHubManagementConfig(req)
	if err != nil {
		return nil, err
	}
	root := runningHubRootURL(config.BaseURL)
	var response map[string]any
	if err := s.runningHubJSON(ctx, config, root+"/api/openapi/getJsonApiFormat", map[string]any{"apiKey": runningHubAPIKey(config), "workflowId": workflowID}, &response); err != nil {
		return nil, fmt.Errorf("拉取 RunningHub 工作流参数失败：%w", err)
	}
	data, _ := response["data"].(map[string]any)
	if data == nil {
		return nil, errors.New("RunningHub 工作流参数响应缺少 data")
	}
	workflow := map[string]any{}
	if prompt, ok := data["prompt"].(string); ok && strings.TrimSpace(prompt) != "" {
		if err := json.Unmarshal([]byte(prompt), &workflow); err != nil {
			return nil, fmt.Errorf("RunningHub 工作流 JSON 解析失败：%w", err)
		}
	} else if prompt, ok := data["prompt"].(map[string]any); ok {
		workflow = prompt
	}
	return map[string]any{"workflowId": workflowID, "kind": "workflow", "title": firstNonEmptyString(req.Title, workflowID), "fields": collectManagementWorkflowFields(workflow, req.Capability), "workflowJson": workflow, "raw": response}, nil
}

func (s *Service) FetchRunningHubAppInfo(ctx context.Context, req RunningHubWorkflowFetchRequest) (map[string]any, error) {
	webappID := strings.TrimSpace(req.WebappID)
	if webappID == "" {
		return nil, BadAuthRequest("webappId 不能为空")
	}
	config, err := runningHubManagementConfig(req)
	if err != nil {
		return nil, err
	}
	root := runningHubRootURL(config.BaseURL)
	var response map[string]any
	if err := s.runningHubJSON(ctx, config, root+"/api/webapp/apiCallDemo", map[string]any{
		"apiKey":   runningHubAPIKey(config),
		"webappId": webappID,
	}, &response); err != nil {
		return nil, fmt.Errorf("拉取 RunningHub App 参数失败：%w", err)
	}
	if code, valid := runningHubPayloadCode(response); valid && code != 0 {
		return nil, fmt.Errorf("拉取 RunningHub App 参数失败：%s", runningHubFailureMessage(response))
	}
	rawData, _ := response["data"].(map[string]any)
	result := map[string]any{"kind": "app", "webappId": webappID, "workflowId": webappID, "title": firstNonEmptyString(req.Title, webappID), "fields": []map[string]any{}, "raw": response}
	if rawData != nil {
		result["fields"] = normalizeManagementAppFields(rawData["nodeInfoList"], req.Capability)
	}
	return result, nil
}

func normalizeManagementAppFields(raw any, capability string) []map[string]any {
	items, _ := raw.([]any)
	fields := make([]map[string]any, 0, len(items))
	for _, item := range items {
		original, ok := item.(map[string]any)
		if !ok {
			continue
		}
		field := make(map[string]any, len(original)+3)
		for key, value := range original {
			field[key] = value
		}
		nodeID := strings.TrimSpace(stringValue(field["nodeId"]))
		fieldName := strings.TrimSpace(stringValue(field["fieldName"]))
		if nodeID == "" || fieldName == "" {
			continue
		}
		if stringValue(field["id"]) == "" {
			field["id"] = nodeID + "::" + fieldName
		}
		if _, exists := field["enabled"]; !exists {
			field["enabled"] = true
		}
		fieldType := strings.ToUpper(strings.TrimSpace(stringValue(field["fieldType"])))
		if fieldType == "" {
			fieldType = managementWorkflowFieldType(fieldName, field["fieldValue"], "")
			field["fieldType"] = fieldType
		}
		if strings.TrimSpace(stringValue(field["source"])) == "" {
			if isWorkflowPromptFieldName(fieldName) {
				field["source"] = "prompt"
				field["sourceAutomatic"] = true
			} else if source := managementAutomaticInputSource(fieldName, fieldType); source != "" {
				field["source"] = source
				field["sourceAutomatic"] = true
			} else {
				field["source"] = ""
				field["sourceAutomatic"] = false
			}
		}
		field["role"] = managementWorkflowFieldRole("", fieldName, fieldType, stringValue(field["source"]))
		field["safeToOverride"] = true
		fields = append(fields, field)
	}
	return applyManagementFieldDefaults(fields, capability)
}

func runningHubManagementConfig(req RunningHubWorkflowFetchRequest) (providerConfig, error) {
	config := providerConfig{BaseURL: strings.TrimSpace(req.BaseURL), APIKey: strings.TrimSpace(req.APIKey), RunningHubWalletKey: strings.TrimSpace(req.WalletAPIKey), RunningHubUseWallet: req.UseWallet}
	if config.BaseURL == "" {
		config.BaseURL = "https://www.runninghub.cn"
	}
	if _, err := ValidateOutboundURL(runningHubRootURL(config.BaseURL)); err != nil {
		return config, err
	}
	if runningHubAPIKey(config) == "" {
		return config, BadAuthRequest("请先填写 RunningHub 积分 API Key")
	}
	return config, nil
}

func collectManagementWorkflowFields(workflow map[string]any, capability string) []map[string]any {
	fields := make([]map[string]any, 0)
	promptNodeID := ""
	promptFieldName := ""
	if promptFields := runningHubPromptFallback(workflow, "prompt"); len(promptFields) > 0 {
		promptNodeID = strings.TrimSpace(stringValue(promptFields[0]["nodeId"]))
		promptFieldName = strings.TrimSpace(stringValue(promptFields[0]["fieldName"]))
	}
	nodeIDs := make([]string, 0, len(workflow))
	for nodeID := range workflow {
		nodeIDs = append(nodeIDs, nodeID)
	}
	sort.Slice(nodeIDs, func(i, j int) bool { return managementNodeIDLess(nodeIDs[i], nodeIDs[j]) })
	for _, nodeID := range nodeIDs {
		rawNode := workflow[nodeID]
		node, ok := rawNode.(map[string]any)
		if !ok {
			continue
		}
		inputs, ok := node["inputs"].(map[string]any)
		if !ok {
			continue
		}
		classType := strings.TrimSpace(stringValue(node["class_type"]))
		fieldNames := make([]string, 0, len(inputs))
		for fieldName := range inputs {
			fieldNames = append(fieldNames, fieldName)
		}
		sort.Strings(fieldNames)
		for _, fieldName := range fieldNames {
			value := inputs[fieldName]
			if isWorkflowLinkValue(value) {
				continue
			}
			// 所有静态输入都保留在设置页，但内部参数默认关闭；危险数值字段
			// 额外标记为不可覆盖，并由提交端再次强制拦截。
			fieldType := managementWorkflowFieldType(fieldName, value, classType)
			label := fieldName
			if title := strings.TrimSpace(workflowNodeMetaTitle(node)); title != "" {
				label = title + " · " + fieldName
			}
			safeToOverride := managementWorkflowFieldSafeToOverride(classType, fieldName)
			role := managementWorkflowFieldRole(classType, fieldName, fieldType, "")
			field := map[string]any{"id": nodeID + "::" + fieldName, "nodeId": nodeID, "classType": classType, "fieldName": fieldName, "fieldValue": value, "fieldType": fieldType, "label": label, "role": role, "safeToOverride": safeToOverride, "enabled": safeToOverride && role != "internal", "source": "", "sourceAutomatic": false}
			if nodeID == promptNodeID && fieldName == promptFieldName {
				field["source"] = "prompt"
				field["sourceAutomatic"] = true
				field["required"] = true
				field["role"] = "prompt"
				field["enabled"] = true
			} else if source := managementAutomaticInputSource(fieldName, fieldType); source != "" {
				field["source"] = source
				field["sourceAutomatic"] = true
				field["role"] = "media"
				field["enabled"] = true
			}
			if isManagementSeedField(fieldName) {
				field["randomEnabled"] = true
			}
			fields = append(fields, field)
		}
	}
	return applyManagementFieldDefaults(fields, capability)
}

func managementWorkflowFieldSafeToOverride(classType string, fieldName string) bool {
	classKey := normalizeManagementFieldName(classType)
	fieldKey := normalizeManagementFieldName(fieldName)
	if classKey == "int" && fieldKey == "value" {
		return false
	}
	return classKey != "imageresize+" || (fieldKey != "width" && fieldKey != "height" && fieldKey != "multipleof")
}

func managementWorkflowFieldRole(classType string, fieldName string, fieldType string, source string) string {
	normalizedSource := normalizeManagementFieldName(source)
	if normalizedSource == "prompt" || normalizedSource == "text" || normalizedSource == "positiveprompt" || normalizedSource == "positive" {
		return "prompt"
	}
	if normalizedSource == "referenceimage" || normalizedSource == "image" || normalizedSource == "referencevideo" || normalizedSource == "video" || normalizedSource == "referenceaudio" || normalizedSource == "audio" || normalizedSource == "mask" {
		return "media"
	}
	if fieldType == "IMAGE" || fieldType == "VIDEO" || fieldType == "AUDIO" {
		return "media"
	}
	if !managementWorkflowFieldSafeToOverride(classType, fieldName) {
		return "internal"
	}
	key := normalizeManagementFieldName(fieldName)
	for _, candidate := range []string{"aspectratio", "ratio", "duration", "durationseconds", "seconds", "videoseconds", "quality", "resolution", "seed", "noiseseed", "steps", "step", "sigmapoints", "cfg", "cfgscale", "guidance", "guidancescale", "sampler", "samplername", "scheduler", "fps", "count", "batch", "batchsize", "generateaudio", "watermark", "negativeprompt", "systemprompt"} {
		if key == candidate {
			return "business"
		}
	}
	if strings.TrimSpace(classType) == "" {
		// AI App 返回的是公开参数列表，没有内部节点类型。
		return "business"
	}
	return "internal"
}

func applyManagementFieldDefaults(fields []map[string]any, capability string) []map[string]any {
	sort.SliceStable(fields, func(i, j int) bool {
		leftNode := strings.TrimSpace(stringValue(fields[i]["nodeId"]))
		rightNode := strings.TrimSpace(stringValue(fields[j]["nodeId"]))
		if leftNode != rightNode {
			return managementNodeIDLess(leftNode, rightNode)
		}
		return strings.TrimSpace(stringValue(fields[i]["fieldName"])) < strings.TrimSpace(stringValue(fields[j]["fieldName"]))
	})
	imageOrder := 0
	videoOrder := 0
	audioOrder := 0
	for _, field := range fields {
		fieldName := strings.TrimSpace(stringValue(field["fieldName"]))
		fieldType := strings.ToUpper(strings.TrimSpace(stringValue(field["fieldType"])))
		source := strings.TrimSpace(stringValue(field["source"]))
		sourceAutomatic, sourceAutomaticConfigured := field["sourceAutomatic"].(bool)
		if source == "" && (!sourceAutomaticConfigured || sourceAutomatic) {
			source = workflowDynamicSourceForMode(fieldName, fieldType, capability)
			if source != "" {
				field["source"] = source
				field["sourceAutomatic"] = true
			}
		}
		switch normalizeManagementFieldName(source) {
		case "prompt", "text", "positiveprompt", "positive":
			if _, exists := field["required"]; !exists {
				field["required"] = true
			}
		case "referenceimage", "image":
			configuredOrder := managementIntValue(field["imageOrder"], 0)
			if configuredOrder <= 0 {
				imageOrder++
				configuredOrder = imageOrder
				field["imageOrder"] = configuredOrder
			} else if configuredOrder > imageOrder {
				imageOrder = configuredOrder
			}
			if _, exists := field["sourceIndex"]; !exists {
				field["sourceIndex"] = configuredOrder - 1
			}
			if _, exists := field["required"]; !exists {
				field["required"] = configuredOrder == 1
			}
		case "referencevideo", "video":
			configuredIndex, exists := field["sourceIndex"]
			index := managementIntValue(configuredIndex, videoOrder)
			if !exists {
				field["sourceIndex"] = index
			}
			if index >= videoOrder {
				videoOrder = index + 1
			}
			if _, exists := field["required"]; !exists {
				field["required"] = index == 0
			}
		case "referenceaudio", "audio":
			configuredIndex, exists := field["sourceIndex"]
			index := managementIntValue(configuredIndex, audioOrder)
			if !exists {
				field["sourceIndex"] = index
			}
			if index >= audioOrder {
				audioOrder = index + 1
			}
			if _, exists := field["required"]; !exists {
				field["required"] = index == 0
			}
		case "mask":
			if _, exists := field["required"]; !exists {
				field["required"] = false
			}
		}
		if isManagementSeedField(fieldName) {
			field["randomEnabled"] = true
		}
	}
	return fields
}

func managementAutomaticInputSource(fieldName string, fieldType string) string {
	if strings.Contains(normalizeManagementFieldName(fieldName), "mask") {
		return "mask"
	}
	switch strings.ToUpper(strings.TrimSpace(fieldType)) {
	case "IMAGE":
		return "referenceImage"
	case "VIDEO":
		return "referenceVideo"
	case "AUDIO":
		return "referenceAudio"
	default:
		return ""
	}
}

func managementNodeIDLess(left string, right string) bool {
	leftNumber, leftErr := strconv.ParseInt(strings.TrimSpace(left), 10, 64)
	rightNumber, rightErr := strconv.ParseInt(strings.TrimSpace(right), 10, 64)
	if leftErr == nil && rightErr == nil {
		return leftNumber < rightNumber
	}
	return left < right
}

func managementIntValue(value any, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(fmt.Sprint(value)))
	if err != nil {
		return fallback
	}
	return parsed
}

func workflowDynamicSource(name string, fieldType string) string {
	return workflowDynamicSourceForMode(name, fieldType, "")
}

func workflowDynamicSourceForMode(name string, fieldType string, mode string) string {
	if source := workflowNamedDynamicSource(name, mode); source != "" {
		return source
	}
	normalizedFieldType := strings.ToUpper(strings.TrimSpace(fieldType))
	switch normalizedFieldType {
	case "IMAGE":
		return "referenceImage"
	case "VIDEO":
		return "referenceVideo"
	case "AUDIO":
		return "referenceAudio"
	default:
		return ""
	}
}

func workflowNamedDynamicSource(name string, mode string) string {
	key := normalizeManagementFieldName(name)
	switch {
	case strings.Contains(key, "mask"):
		return "mask"
	case workflowDimensionNameSource(key) != "":
		return workflowDimensionNameSource(key)
	case key == "ratio" || key == "aspectratio" || key == "imageaspectratio" || key == "imageratio" || key == "videoaspectratio" || key == "videoratio":
		return "aspectRatio"
	case key == "videoresolution" || key == "videoquality" || key == "vquality":
		return "vquality"
	case key == "size" || key == "imagesize" || key == "imageresolution":
		return "size"
	case key == "resolution" && strings.EqualFold(strings.TrimSpace(mode), "video"):
		return "vquality"
	case key == "resolution" && strings.EqualFold(strings.TrimSpace(mode), "image"):
		return "size"
	case key == "batch" || key == "batchsize" || key == "count" || key == "numimages" || key == "numberofimages" || key == "imagecount" || key == "imagescount":
		return "count"
	case key == "quality":
		return "quality"
	case key == "duration" || key == "seconds" || key == "durationseconds" || key == "videoseconds" || key == "videoduration" || key == "videodurationseconds" || key == "videolength" || key == "clipduration":
		return "videoSeconds"
	case key == "generateaudio" || key == "videogenerateaudio":
		return "videoGenerateAudio"
	case key == "watermark" || key == "videowatermark":
		return "videoWatermark"
	case key == "audioformat":
		return "audioFormat"
	case key == "voice" || key == "audiovoice":
		return "audioVoice"
	case key == "audiospeed":
		return "audioSpeed"
	case key == "audioinstructions":
		return "audioInstructions"
	case key == "transparentbackground" || key == "transparent":
		return "transparentBackground"
	default:
		return ""
	}
}

func workflowDimensionNameSource(key string) string {
	prefixes := []string{"", "image", "video", "size", "output", "target", "latent", "frame", "canvas", "source", "resolution", "final"}
	for _, prefix := range prefixes {
		if key == prefix+"width" {
			return "width"
		}
		if key == prefix+"height" {
			return "height"
		}
	}
	if key == "pixelwidth" || key == "widthpixels" {
		return "width"
	}
	if key == "pixelheight" || key == "heightpixels" {
		return "height"
	}
	return ""
}

func normalizeManagementFieldName(value string) string {
	return strings.ToLower(strings.NewReplacer("_", "", "-", "", " ", "").Replace(strings.TrimSpace(value)))
}

func isManagementSeedField(value string) bool {
	key := normalizeManagementFieldName(value)
	return key == "seed" || strings.HasSuffix(key, "seed") || strings.Contains(key, "noiseseed")
}

func managementFieldType(name string, value any) string {
	return managementWorkflowFieldType(name, value, "")
}

func managementWorkflowFieldType(name string, value any, classType string) string {
	key := normalizeManagementFieldName(name)
	classKey := normalizeManagementFieldName(classType)
	if strings.Contains(key, "mask") {
		return "IMAGE"
	}
	if strings.Contains(classKey, "loadimage") && (key == "file" || key == "path") {
		return "IMAGE"
	}
	if strings.Contains(classKey, "loadvideo") && (key == "file" || key == "path") {
		return "VIDEO"
	}
	if strings.Contains(classKey, "loadaudio") && (key == "file" || key == "path") {
		return "AUDIO"
	}
	if source := workflowNamedDynamicSource(name, ""); source != "" && source != "mask" {
		return managementScalarFieldType(value)
	}
	switch value.(type) {
	case bool:
		return "BOOLEAN"
	case float64, int, int64:
		return "NUMBER"
	}
	if managementMediaFieldName(key, "image") {
		return "IMAGE"
	}
	if managementMediaFieldName(key, "video") {
		return "VIDEO"
	}
	if managementMediaFieldName(key, "audio") {
		return "AUDIO"
	}
	// RunningHub 的部分自定义节点不会把素材字段命名为 image/video/audio，
	// 但默认值仍是带扩展名的输入文件；与参考项目一致，使用文件类型补充识别。
	if mediaType := managementMediaValueType(value); mediaType != "" {
		return mediaType
	}
	return "TEXT"
}

func managementMediaValueType(value any) string {
	switch items := value.(type) {
	case []any:
		if len(items) == 0 {
			return ""
		}
		value = items[0]
	case []string:
		if len(items) == 0 {
			return ""
		}
		value = items[0]
	}
	text := strings.ToLower(strings.TrimSpace(stringValue(value)))
	if text == "" {
		return ""
	}
	if index := strings.IndexAny(text, "?#"); index >= 0 {
		text = text[:index]
	}
	for _, suffix := range []string{".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"} {
		if strings.HasSuffix(text, suffix) {
			return "IMAGE"
		}
	}
	for _, suffix := range []string{".mp4", ".webm", ".mov", ".m4v", ".mkv"} {
		if strings.HasSuffix(text, suffix) {
			return "VIDEO"
		}
	}
	for _, suffix := range []string{".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"} {
		if strings.HasSuffix(text, suffix) {
			return "AUDIO"
		}
	}
	return ""
}

func managementScalarFieldType(value any) string {
	switch value.(type) {
	case bool:
		return "BOOLEAN"
	case float32, float64, int, int32, int64:
		return "NUMBER"
	default:
		return "TEXT"
	}
}

func managementMediaFieldName(key string, mediaType string) bool {
	if key == mediaType {
		return true
	}
	prefixes := []string{"input", "reference", "ref", "source", "init", "start", "end", "first", "last", "control", "controlnet", "style", "subject"}
	for _, prefix := range prefixes {
		if key == prefix+mediaType {
			return true
		}
	}
	for _, suffix := range []string{"file", "path", "filename", "upload"} {
		if key == mediaType+suffix {
			return true
		}
	}
	if mediaType == "image" {
		return key == "firstframe" || key == "lastframe" || key == "startframe" || key == "endframe"
	}
	return false
}

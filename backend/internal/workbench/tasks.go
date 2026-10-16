package workbench

import (
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

type TaskInput struct {
	Kind           string          `json:"kind"`
	ToolID         string          `json:"toolId"`
	PresetID       string          `json:"presetId,omitempty"`
	Workbench      *TaskWorkbench  `json:"workbench,omitempty"`
	Prompt         string          `json:"prompt"`
	Model          string          `json:"model,omitempty"`
	LogicalModelID string          `json:"logicalModelId,omitempty"`
	ChannelID      string          `json:"channelId,omitempty"`
	ModelChoice    *ModelChoice    `json:"modelChoice,omitempty"`
	Parameters     map[string]any  `json:"parameters,omitempty"`
	References     []TaskReference `json:"references,omitempty"`
}

type TaskWorkbench struct {
	Kind     string `json:"kind"`
	ToolID   string `json:"toolId"`
	PresetID string `json:"presetId,omitempty"`
}

type ModelChoice struct {
	LogicalModelID string `json:"logicalModelId,omitempty"`
	UserChannelID  string `json:"userChannelId,omitempty"`
	ModelName      string `json:"modelName,omitempty"`
}

type TaskReference struct {
	ResourceID string `json:"resourceId"`
	Kind       string `json:"kind"`
	Role       string `json:"role,omitempty"`
	SlotKey    string `json:"slotKey,omitempty"`
}

type TaskResolution struct {
	TaskType       string
	Operation      string
	Input          map[string]any
	Parameters     map[string]any
	Prompt         string
	Model          string
	LogicalModelID string
	ChannelID      string
	Tool           *model.WorkbenchTool
	Preset         *model.WorkbenchPreset
}

func (s *Service) ResolveTask(userID string, req TaskInput) (*TaskResolution, error) {
	toolID := strings.TrimSpace(req.ToolID)
	presetID := strings.TrimSpace(req.PresetID)
	if req.Workbench != nil && (req.Workbench.Kind != req.Kind || strings.TrimSpace(req.Workbench.ToolID) != toolID || (strings.TrimSpace(req.Workbench.PresetID) != "" && strings.TrimSpace(req.Workbench.PresetID) != presetID)) {
		return nil, kernel.BadAuthRequest("工作台任务范围字段不一致")
	}
	if !validKind(req.Kind) {
		return nil, kernel.BadAuthRequest("工作台类型无效")
	}
	if toolID == "" && presetID != "" {
		return nil, kernel.BadAuthRequest("使用提示词预设前必须选择创作工具")
	}
	var tool *model.WorkbenchTool
	var preset *model.WorkbenchPreset
	if toolID != "" {
		var err error
		tool, preset, err = s.repo.WorkbenchToolAndPreset(toolID, presetID, true)
		if err != nil {
			return nil, kernel.BadAuthRequest("工具或预设未开放")
		}
		if tool.Kind != req.Kind {
			return nil, kernel.BadAuthRequest("所选工具与工作台类型不匹配")
		}
	}
	if strings.TrimSpace(req.Prompt) == "" && (tool == nil || toolRequiresPrompt(tool)) {
		return nil, kernel.BadAuthRequest("当前工具需要填写提示词")
	}
	modelName, logicalModelID, channelID, providerConfig, err := resolveModelInput(req)
	if err != nil {
		return nil, err
	}
	if len(providerConfig) == 0 {
		return nil, kernel.BadAuthRequest("必须提供可执行模型配置")
	}
	if containsSensitiveURL(providerConfig) {
		return nil, kernel.BadAuthRequest("浏览器不能直接提交模型配置、URL 或凭据")
	}
	if len(req.References) > 20 {
		return nil, kernel.BadAuthRequest("参考素材数量超出限制")
	}
	parameters, err := normalizeTaskParameters(req.Kind, req.Parameters)
	if err != nil {
		return nil, err
	}
	refs := make([]TaskReference, 0, len(req.References))
	frameRoles := map[string]bool{}
	for _, ref := range req.References {
		if strings.TrimSpace(ref.ResourceID) == "" || !validReferenceKind(ref.Kind) {
			return nil, kernel.BadAuthRequest("参考素材无效")
		}
		role := strings.TrimSpace(ref.Role)
		if !validReferenceRole(req.Kind, ref.Kind, role) {
			return nil, kernel.BadAuthRequest("参考素材角色无效")
		}
		if role == "first_frame" || role == "last_frame" {
			if frameRoles[role] {
				return nil, kernel.BadAuthRequest("首帧和尾帧各只能指定一个素材")
			}
			frameRoles[role] = true
		}
		resource, err := s.repo.ResourceForUser(userID, strings.TrimSpace(ref.ResourceID))
		if err != nil || resource.Status != model.ResourceStatusReady || resource.Kind != ref.Kind {
			return nil, kernel.BadAuthRequest("参考素材不存在、未就绪或类型不匹配")
		}
		refs = append(refs, TaskReference{ResourceID: resource.ID, Kind: resource.Kind, Role: role, SlotKey: strings.TrimSpace(ref.SlotKey)})
	}
	if tool != nil {
		capability := map[string]any{}
		if err := json.Unmarshal([]byte(tool.CapabilityJSON), &capability); err != nil {
			return nil, errors.New("工具能力配置无效")
		}
		if err := validateTaskCapabilities(tool.Kind, capability, refs); err != nil {
			return nil, err
		}
	}
	metadata := map[string]any{"source": "workbench", "workbenchKind": req.Kind}
	operation := "image"
	if req.Kind == KindVideo {
		operation = videoOperation(refs)
		// Provider adapters read the same operation and frame identities as admission.
		metadata["videoEditOperation"] = operation
		for _, ref := range refs {
			if ref.Role == "first_frame" {
				metadata["videoStartFrameNodeId"] = ref.ResourceID
			} else if ref.Role == "last_frame" {
				metadata["videoEndFrameNodeId"] = ref.ResourceID
			}
		}
	}
	workbenchSnapshot := map[string]any{"kind": req.Kind, "parameters": parameters}
	snapshotReferences := make([]map[string]any, 0, len(refs))
	for _, ref := range refs {
		reference := map[string]any{"resourceId": ref.ResourceID, "kind": ref.Kind}
		if ref.Role != "" {
			reference["role"] = ref.Role
		}
		if ref.SlotKey != "" {
			reference["slotKey"] = ref.SlotKey
		}
		snapshotReferences = append(snapshotReferences, reference)
	}
	workbenchSnapshot["references"] = snapshotReferences
	if tool != nil {
		metadata["workbenchToolId"], metadata["workbenchToolName"], metadata["workbenchToolVersion"] = tool.ID, tool.Name, tool.Version
		workbenchSnapshot["toolId"], workbenchSnapshot["toolName"], workbenchSnapshot["toolVersion"] = tool.ID, tool.Name, tool.Version
	}
	metadata["workbench"] = workbenchSnapshot
	input := map[string]any{"mode": req.Kind, "prompt": strings.TrimSpace(req.Prompt), "config": providerConfig, "metadata": metadata}
	if len(refs) > 0 {
		imageRefs, videoRefs, audioRefs := []map[string]any{}, []map[string]any{}, []map[string]any{}
		for _, ref := range refs {
			value := map[string]any{"id": ref.ResourceID, "resourceId": ref.ResourceID, "storageKey": "resource:" + ref.ResourceID}
			if ref.Role != "" {
				value["role"] = ref.Role
			}
			if ref.SlotKey != "" {
				value["slotKey"] = ref.SlotKey
			}
			switch ref.Kind {
			case "image":
				imageRefs = append(imageRefs, value)
			case "video":
				videoRefs = append(videoRefs, value)
			case "audio":
				audioRefs = append(audioRefs, value)
			}
		}
		if len(imageRefs) > 0 {
			input["referenceImages"] = imageRefs
		}
		if len(videoRefs) > 0 {
			input["referenceVideos"] = videoRefs
		}
		if len(audioRefs) > 0 {
			input["referenceAudios"] = audioRefs
		}
	}
	if preset != nil {
		meta := input["metadata"].(map[string]any)
		meta["workbenchPresetId"], meta["workbenchPresetVersion"], meta["workbenchPresetName"] = preset.ID, preset.Version, preset.Name
		meta["workbenchPresetPrompt"] = preset.PromptTemplate
		workbenchSnapshot := meta["workbench"].(map[string]any)
		workbenchSnapshot["presetId"], workbenchSnapshot["presetName"], workbenchSnapshot["presetVersion"] = preset.ID, preset.Name, preset.Version
		workbenchSnapshot["presetPrompt"] = preset.PromptTemplate
	}
	return &TaskResolution{TaskType: map[string]string{KindImage: "canvas_image", KindVideo: "canvas_video"}[req.Kind], Operation: operation, Input: input, Parameters: parameters, Prompt: strings.TrimSpace(req.Prompt), Model: modelName, LogicalModelID: logicalModelID, ChannelID: channelID, Tool: tool, Preset: preset}, nil
}

func videoOperation(refs []TaskReference) string {
	hasFrame, hasAudio := false, false
	for _, ref := range refs {
		switch ref.Kind {
		case "video":
			return "reference_to_video"
		case "image":
			if ref.Role != "first_frame" && ref.Role != "last_frame" {
				return "reference_to_video"
			}
			hasFrame = true
		case "audio":
			hasAudio = true
		}
	}
	if hasFrame {
		return "image_to_video"
	}
	if hasAudio {
		return "audio_to_video"
	}
	return "text_to_video"
}

func normalizeTaskParameters(kind string, params map[string]any) (map[string]any, error) {
	allowed := map[string]map[string]bool{
		KindImage: {"size": true, "quality": true, "imageResolution": true, "count": true},
		KindVideo: {"seconds": true, "ratio": true, "resolution": true, "generateAudio": true, "watermark": true},
	}[kind]
	if allowed == nil {
		return nil, kernel.BadAuthRequest("工作台类型无效")
	}
	normalized := make(map[string]any, len(params))
	for key, value := range params {
		if !allowed[key] {
			return nil, kernel.BadAuthRequest("生成参数包含不支持字段: " + key)
		}
		switch key {
		case "size", "quality", "imageResolution", "ratio", "resolution":
			text, ok := value.(string)
			text = strings.TrimSpace(text)
			if !ok || len(text) > 64 || strings.Contains(text, "://") || strings.HasPrefix(strings.ToLower(text), "data:") {
				return nil, kernel.BadAuthRequest("生成参数格式无效: " + key)
			}
			if text != "" {
				normalized[key] = text
			}
		case "count", "seconds":
			number, ok := taskParameterInteger(value)
			max := 20
			if key == "seconds" {
				max = 3600
			}
			if !ok || number < 1 || number > max {
				return nil, kernel.BadAuthRequest("生成参数数值无效: " + key)
			}
			normalized[key] = number
		case "generateAudio", "watermark":
			flag, ok := value.(bool)
			if !ok {
				return nil, kernel.BadAuthRequest("生成参数格式无效: " + key)
			}
			normalized[key] = flag
		}
	}
	return normalized, nil
}

func taskParameterInteger(value any) (int, bool) {
	switch number := value.(type) {
	case int:
		return number, true
	case int64:
		return int(number), int64(int(number)) == number
	case float64:
		if math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number {
			return 0, false
		}
		return int(number), float64(int(number)) == number
	case json.Number:
		parsed, err := strconv.Atoi(number.String())
		return parsed, err == nil
	default:
		return 0, false
	}
}

func validReferenceRole(kind, referenceKind, role string) bool {
	if role == "" || role == "reference" {
		return kind == KindVideo || referenceKind == "image"
	}
	return kind == KindVideo && referenceKind == "image" && (role == "first_frame" || role == "last_frame")
}

func resolveModelInput(req TaskInput) (string, string, string, map[string]any, error) {
	modelName := strings.TrimSpace(req.Model)
	logicalModelID := strings.TrimSpace(req.LogicalModelID)
	channelID := strings.TrimSpace(req.ChannelID)
	if req.ModelChoice != nil {
		choice := req.ModelChoice
		if choice.UserChannelID != "" {
			return "", "", "", nil, kernel.BadAuthRequest("工作台暂不接受浏览器自定义渠道选择")
		}
		if value := strings.TrimSpace(choice.LogicalModelID); value != "" {
			if logicalModelID != "" && logicalModelID != value {
				return "", "", "", nil, kernel.BadAuthRequest("模型选择字段不一致")
			}
			logicalModelID = value
		}
		if value := strings.TrimSpace(choice.ModelName); value != "" {
			if modelName != "" && modelName != value {
				return "", "", "", nil, kernel.BadAuthRequest("模型名称字段不一致")
			}
			modelName = value
		}
	}
	if modelName == "" {
		return "", "", "", nil, kernel.BadAuthRequest("必须选择一个模型")
	}
	// 创作页的系统目录模型多数只有渠道 ID + 模型名，没有 logicalModelId。
	// 两者都空才拒绝；渠道是否为系统渠道由后续 admission 再校验。
	if logicalModelID == "" && channelID == "" {
		return "", "", "", nil, kernel.BadAuthRequest("工作台任务必须选择系统模型目录中的模型")
	}
	config := map[string]any{"mode": req.Kind, "model": modelName}
	if channelID != "" {
		config["channelId"] = channelID
	}
	return modelName, logicalModelID, channelID, config, nil
}

func validReferenceKind(kind string) bool {
	return kind == "image" || kind == "video" || kind == "audio"
}

func containsSensitiveURL(value any) bool {
	switch item := value.(type) {
	case map[string]any:
		for key, child := range item {
			lower := strings.ToLower(key)
			if lower == "api_key" || lower == "apikey" || lower == "authorization" || lower == "headers" || lower == "baseurl" || lower == "base_url" || lower == "url" {
				return true
			}
			if containsSensitiveURL(child) {
				return true
			}
		}
	case []any:
		for _, child := range item {
			if containsSensitiveURL(child) {
				return true
			}
		}
	}
	return false
}

func validateTaskCapabilities(kind string, capability map[string]any, refs []TaskReference) error {
	allowedRefs, _ := capability["referenceKinds"].([]any)
	allowedSet := map[string]bool{}
	for _, value := range allowedRefs {
		if text, ok := value.(string); ok {
			allowedSet[text] = true
		}
	}
	var contract InputContract
	if raw, ok := capability["inputContract"]; ok {
		encoded, _ := json.Marshal(raw)
		_ = json.Unmarshal(encoded, &contract)
	}
	slots := map[string]ReferenceSlot{}
	for _, slot := range contract.Slots {
		slots[slot.Key] = slot
	}
	counts := map[string]int{}
	for _, ref := range refs {
		if len(allowedSet) > 0 && !allowedSet[ref.Kind] {
			return kernel.BadAuthRequest("当前工具不支持该类型参考素材")
		}
		if kind == KindImage && ref.Kind != "image" {
			return kernel.BadAuthRequest("生图任务只允许使用图片参考素材")
		}
		if kind == KindVideo && ref.Kind != "image" && ref.Kind != "video" && ref.Kind != "audio" {
			return kernel.BadAuthRequest("视频任务参考素材类型无效")
		}
		if len(contract.Slots) == 0 {
			continue
		}
		slotKey := strings.TrimSpace(ref.SlotKey)
		slot, ok := slots[slotKey]
		if !ok {
			return kernel.BadAuthRequest("参考素材未指定有效的输入槽位")
		}
		mediaAllowed := false
		for _, mediaType := range slot.MediaTypes {
			if mediaType == ref.Kind {
				mediaAllowed = true
				break
			}
		}
		if !mediaAllowed {
			return kernel.BadAuthRequest("参考素材类型与输入槽位不匹配")
		}
		counts[slotKey]++
		if counts[slotKey] > slot.MaxCount {
			return kernel.BadAuthRequest("输入槽位的参考素材数量超出上限")
		}
	}
	for _, slot := range contract.Slots {
		if counts[slot.Key] < slot.MinCount || (slot.Required && counts[slot.Key] == 0) {
			return kernel.BadAuthRequest("请补齐必需的输入素材：" + slot.Name)
		}
	}
	return nil
}

func toolRequiresPrompt(tool *model.WorkbenchTool) bool {
	if tool == nil {
		return true
	}
	config, err := parseCatalogConfig(tool.CapabilityJSON, tool.GuideJSON)
	return err != nil || config.InputContract.PromptRequired || config.InputContract.MinTextReferences > 0
}

package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// CreateTask 收敛任务进入系统前的 admission 流程：输入标准化、逻辑模型路由、
// 能力/额度校验和持久化。执行阶段由 worker 与 provider 相关模块负责。
func (s *Service) CreateTask(userID string, req CreateTaskRequest) (*model.Task, error) {
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, errors.New("prompt is required")
	}
	taskType := strings.TrimSpace(req.Type)
	if err := validateTaskType(taskType); err != nil {
		return nil, err
	}
	normalizedInput, err := normalizeTaskInput(req.Input)
	if err != nil {
		return nil, err
	}

	// 根据 frontendModelsEnabled 开关强制分流模型选择
	frontendEnabled, err := s.FeatureEnabled(FeatureFrontendModels)
	if err != nil {
		return nil, err
	}

	var routed *RoutedModel
	logicalModelID := strings.TrimSpace(req.LogicalModelID)

	if frontendEnabled {
		// 前台模型模式：必须有 logicalModelId
		if logicalModelID == "" {
			return nil, InvalidModelSelection("前台模型模式下必须指定 logicalModelId")
		}
		intent := ModelRequestIntentFromTaskInput(normalizedInput, taskType, req.Operation)
		routed, err = s.ResolveLogicalModel(logicalModelID, intent)
		if err != nil {
			return nil, err
		}
		normalizedInput = applyRoutedProviderSelection(normalizedInput, routed)
	} else {
		// 系统渠道模型模式：禁止 logicalModelId
		if logicalModelID != "" {
			return nil, ModelCatalogMismatch("模型目录已更新，请重新选择")
		}
		// 自定义渠道没有系统 channelId；它会在后续由自定义渠道功能开关、
		// 能力校验和 provider 配置校验共同处理，不能误报为“缺少系统渠道”。
		if !taskInputUsesCustomChannel(normalizedInput) {
			// 非自定义任务必须校验 channelId + model 属于启用的系统渠道模型。
			if err := s.validateSystemChannelModelSelection(normalizedInput); err != nil {
				return nil, err
			}
		}
	}

	if strings.HasPrefix(taskType, "video_") && !hasExecutableProviderVideoConfig(normalizedInput) {
		if mode, _ := normalizedInput["mode"].(string); mode != "video" {
			return nil, errors.New("视频任务必须使用 video 模式")
		}
		return nil, errors.New("视频任务缺少可执行的模型配置")
	}
	// 前端自管的文本持久化任务：直连模型生成、增量上报 text-deltas，不排入 worker 队列生成。
	if isTextReplayTaskRequest(normalizedInput) {
		return s.createTextReplayTask(userID, req, normalizedInput)
	}
	if err := s.requireCustomChannelsForTaskInput(normalizedInput); err != nil {
		return nil, err
	}
	if err := s.ValidateTaskCapability(normalizedInput); err != nil {
		return nil, err
	}
	if containsInlineMediaDataURL(normalizedInput) {
		return nil, BadAuthRequest("任务输入不能包含内嵌媒体，请先上传到资源存储")
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	activeTasks, err := s.repo.ActiveTaskCountForUser(userID)
	if err != nil {
		return nil, err
	}
	if activeTasks >= int64(policy.Task.ActiveTaskLimit) {
		return nil, BadAuthRequest(fmt.Sprintf("同时排队或运行的任务最多 %d 个，请等待已有任务完成", policy.Task.ActiveTaskLimit))
	}
	task := model.Task{ID: newID(), UserID: userID, TraceID: req.TraceID, RequestID: req.RequestID, SessionID: req.SessionID, ProjectID: req.ProjectID, Type: taskType, Status: model.TaskStatusQueued, Stage: "等待队列调度", Progress: 5, Prompt: prompt, Operation: req.Operation, Provider: req.Provider, Model: req.Model}
	if routed != nil {
		task.LogicalModelID = routed.LogicalModel.ID
		task.LogicalModelRevisionID = routed.Revision.ID
		task.RouteID = routed.Route.ID
		task.ChannelModelID = routed.ChannelModel.ID
		task.RouteRun = 1
		task.Model = routed.LogicalModel.Code
		task.Provider = "managed"
	}
	if err := s.ensureTaskProjectActive(userID, req.ProjectID); err != nil {
		return nil, err
	}
	billingOrder, err := s.taskBillingOrder(userID, &task, normalizedInput)
	if err != nil {
		return nil, err
	}
	if err := s.protectTaskSecrets(normalizedInput); err != nil {
		return nil, err
	}
	inputJSON, err := json.Marshal(normalizedInput)
	if err != nil {
		return nil, fmt.Errorf("序列化任务输入失败：%w", err)
	}
	task.InputJSON = string(inputJSON)
	if billingOrder != nil {
		task.BillingOrderID = billingOrder.ID
	}
	err = s.createTaskWithinStorageQuota(&task, billingOrder, policy)
	if errors.Is(err, repository.ErrActiveTaskLimit) {
		return nil, BadAuthRequest(fmt.Sprintf("同时排队或运行的任务最多 %d 个，请等待已有任务完成", policy.Task.ActiveTaskLimit))
	}
	if errors.Is(err, repository.ErrInsufficientCredits) {
		return nil, BadAuthRequest("积分不足，请先使用兑换码充值")
	}
	if errors.Is(err, repository.ErrLogicalModelUnavailable) {
		return nil, BadAuthRequest("所选模型已停用、归档或配置已更新，请重新选择")
	}
	if err != nil {
		return nil, err
	}
	s.recordActivity(userID, "task", 1)
	_ = s.log(userID, task.ID, "info", "任务已进入队列", "")
	return taskForOutput(task), nil
}

func applyRoutedProviderSelection(input map[string]any, routed *RoutedModel) map[string]any {
	config, _ := input["config"].(map[string]any)
	nextConfig := make(map[string]any, len(config)+2)
	for key, value := range config {
		switch key {
		case "channelId", "channelModelKey", "priceTierId", "providerModelKey", "apiFormat", "interfaceType", "baseUrl", "allowLocalChannel", "apiKey", "secretKey", "headers", "model", "capabilityConfig":
			continue
		default:
			nextConfig[key] = value
		}
	}
	for key, value := range routed.Defaults {
		canonical := canonicalCapabilityOptionName(key)
		if existing, exists := nextConfig[canonical]; !exists || existing == nil || strings.TrimSpace(fmt.Sprint(existing)) == "" {
			nextConfig[canonical] = providerConfigOptionValue(value)
		}
	}
	// 路由匹配和真实请求必须使用同一组参数；逻辑能力参数覆盖空的页面配置，但不携带供应链字段。
	if options, ok := input["capabilityOptions"].(map[string]any); ok {
		for key, value := range options {
			canonical := canonicalCapabilityOptionName(key)
			if isProviderCapabilityOption(canonical) {
				nextConfig[canonical] = providerConfigOptionValue(value)
			}
		}
	}
	nextConfig["channelId"] = routed.ChannelModel.ChannelID
	nextConfig["model"] = routed.ChannelModel.ModelKey
	nextConfig["channelModelKey"] = routed.ChannelModel.ModelKey
	if routed.PriceTier != nil {
		nextConfig["priceTierId"] = routed.PriceTier.ID
		nextConfig["providerModelKey"] = routed.PriceTier.ProviderModelKey
	}
	input["config"] = nextConfig
	return input
}

func providerConfigOptionValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	default:
		return fmt.Sprint(value)
	}
}

// 所有任务输入先收敛为 JSON 对象，确保计费与密钥保护不会因 Go 结构体类型不同而被绕过。
func normalizeTaskInput(input map[string]any) (map[string]any, error) {
	if input == nil {
		return map[string]any{}, nil
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return nil, BadAuthRequest("任务输入格式无效")
	}
	var normalized map[string]any
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		return nil, BadAuthRequest("任务输入格式无效")
	}
	if snapshot, ok := normalized["canvasSnapshot"]; ok {
		normalized["canvasSnapshot"] = compactPersistedValue(snapshot)
	}
	return normalized, nil
}

// createTextReplayTask 创建前端自管的文本持久化任务：状态为 text_replay，
// 不排队执行、不计 active 队列、不产生计费，仅作为正文增量（text-deltas）的存储容器。
func (s *Service) createTextReplayTask(userID string, req CreateTaskRequest, normalizedInput map[string]any) (*model.Task, error) {
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		prompt = strings.TrimSpace(fmt.Sprint(normalizedInput["prompt"]))
	}
	if prompt == "" {
		return nil, errors.New("prompt is required")
	}
	taskType := strings.TrimSpace(req.Type)
	if err := validateTaskType(taskType); err != nil {
		return nil, err
	}
	task := model.Task{
		ID: newID(), UserID: userID, TraceID: req.TraceID, RequestID: req.RequestID, SessionID: req.SessionID, ProjectID: req.ProjectID,
		Type: taskType, Status: model.TaskStatusTextReplay, Stage: "文本持久化（前端自管）", Progress: 5,
		Prompt: prompt, Operation: req.Operation, Provider: req.Provider, Model: strings.TrimSpace(req.Model),
	}
	if err := s.protectTaskSecrets(normalizedInput); err != nil {
		return nil, err
	}
	inputJSON, _ := json.Marshal(normalizedInput)
	task.InputJSON = string(inputJSON)
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	if err := s.createTaskWithinStorageQuota(&task, nil, policy); err != nil {
		return nil, err
	}
	_ = s.log(userID, task.ID, "info", "文本持久化任务已创建（前端自管）", "")
	return taskForOutput(task), nil
}

// validateTaskType 是任务进入队列前的边界校验。视频任务允许携带具体操作后缀，
// 其他任务类型必须是已实现的执行分支，避免未知类型落入假成功工作流。
func validateTaskType(taskType string) error {
	switch taskType {
	case "text", "agent_storyboard", "agent_storyboard_rows", "canvas_text", "canvas_image", "canvas_video", "canvas_audio":
		return nil
	}
	if strings.HasPrefix(taskType, "video_") && strings.TrimPrefix(taskType, "video_") != "" {
		return nil
	}
	if taskType == "" {
		return errors.New("task type is required")
	}
	return fmt.Errorf("不支持的任务类型：%s", taskType)
}

func (s *Service) requireCustomChannelsForTaskInput(input map[string]any) error {
	if !taskInputUsesCustomChannel(input) {
		return nil
	}
	return s.RequireFeature(FeatureCustomChannels)
}

// validateSystemChannelModelSelection 校验系统渠道模型选择的有效性
func (s *Service) validateSystemChannelModelSelection(input map[string]any) error {
	config, ok := input["config"].(map[string]any)
	if !ok {
		return InvalidModelSelection("缺少模型配置")
	}

	channelID, _ := config["channelId"].(string)
	modelKey, _ := config["model"].(string)

	channelID = strings.TrimSpace(channelID)
	modelKey = strings.TrimSpace(modelKey)

	if channelID == "" || modelKey == "" {
		return InvalidModelSelection("必须指定系统渠道和模型")
	}

	// 验证渠道存在且启用
	channel, err := s.repo.SystemChannel(channelID)
	if err != nil {
		return InvalidModelSelection("指定的渠道不存在")
	}
	if !channel.Enabled || channel.Scope != model.ChannelScopeSystem {
		return InvalidModelSelection("指定的渠道不可用")
	}

	// 验证渠道模型存在且启用
	channelModel, err := s.repo.ChannelModelByKey(channelID, modelKey)
	if err != nil {
		return InvalidModelSelection("指定的模型不存在")
	}
	if !channelModel.Enabled {
		return InvalidModelSelection("指定的模型已停用")
	}

	// 验证价格配置
	if !HasValidPrice(channelModel) {
		return ModelPriceNotConfigured("指定的模型未配置有效价格")
	}

	return nil
}

func taskInputUsesCustomChannel(input map[string]any) bool {
	config, ok := input["config"].(map[string]any)
	if !ok {
		return false
	}
	channelID, _ := config["channelId"].(string)
	baseURL, _ := config["baseUrl"].(string)
	apiKey, _ := config["apiKey"].(string)
	if strings.TrimSpace(channelID) != "" || systemChannelIDFromBaseURL(baseURL) != "" {
		return false
	}
	return strings.TrimSpace(baseURL) != "" && strings.TrimSpace(apiKey) != ""
}

func compactPersistedValue(value interface{}) interface{} {
	switch item := value.(type) {
	case map[string]interface{}:
		result := make(map[string]interface{}, len(item))
		for key, child := range item {
			if text, ok := child.(string); ok && strings.HasPrefix(text, "data:") {
				result[key] = ""
				continue
			}
			result[key] = compactPersistedValue(child)
		}
		return result
	case []interface{}:
		result := make([]interface{}, len(item))
		for index, child := range item {
			result[index] = compactPersistedValue(child)
		}
		return result
	default:
		return value
	}
}

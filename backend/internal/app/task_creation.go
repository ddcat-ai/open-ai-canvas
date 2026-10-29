package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Internal admission constraints are not JSON fields. Callers cannot select a
// task ID or bypass the quoted-charge ceiling through the public tasks API.
type taskAdmission struct {
	ID           string
	MaxCharge    int64
	AgentRunID   string
	GenerationID string
	ApprovalID   string
	NonBillable  bool
}

// CreateTask 收敛任务进入系统前的 admission 流程：输入标准化、逻辑模型路由、
// 能力/额度校验和持久化。执行阶段由 worker 与 provider 相关模块负责。
// CreateTask 校验并创建一条生成任务。
// 这是常规模型生成任务的写入口：客户端只提交创作意图，模型、渠道、协议和计价信息必须由服务端目录重新解析，
// 以保证“可展示的模型”与“实际执行及扣费的模型”来自同一份有效配置。
func (s *Service) CreateTask(userID string, req CreateTaskRequest) (*model.Task, error) {
	if req.admission == nil && (strings.HasPrefix(req.Operation, "cloud_agent") || req.Input["cloudAgent"] != nil) {
		return nil, BadAuthRequest("Agent 任务必须通过 Agent 接口创建")
	}
	if s.IsDraining() {
		return nil, &AppError{Status: 503, Code: 503, Message: "服务正在维护，暂不接受新的生成任务", Retryable: true}
	}
	prompt := strings.TrimSpace(req.Prompt)
	taskType := strings.TrimSpace(req.Type)
	if err := validateTaskType(taskType); err != nil {
		return nil, err
	}
	normalizedInput, err := normalizeTaskInput(req.Input)
	if err != nil {
		return nil, err
	}
	// 视频处理（kind=processing）以源视频为主体，不要求 prompt；提示词由服务端生成，
	// 源时长、帧率档和处理参数在这里按资源记录与后台配置重算。
	processing, err := s.prepareVideoProcessingTask(userID, normalizedInput)
	if err != nil {
		return nil, err
	}
	if processing != nil {
		prompt = processing.Prompt
		normalizedInput["prompt"] = prompt
	}
	if prompt == "" {
		return nil, errors.New("prompt is required")
	}
	// Fail admission before queueing or charging; the worker validates again in
	// case a tool is deleted or its visibility changes while queued.
	toolMode, _ := normalizedInput["mode"].(string)
	if toolMode == "" {
		if strings.HasPrefix(taskType, "video_") || taskType == "canvas_video" {
			toolMode = "video"
		} else if taskType == "canvas_image" {
			toolMode = "image"
		}
	}
	if _, err := s.ResolveToolMentionTokens(userID, toolMode, prompt); err != nil {
		return nil, err
	}
	if inputPrompt, ok := normalizedInput["prompt"].(string); ok && inputPrompt != prompt {
		if _, err := s.ResolveToolMentionTokens(userID, toolMode, inputPrompt); err != nil {
			return nil, err
		}
	}

	var routed *RoutedModel
	logicalModelID := strings.TrimSpace(req.LogicalModelID)
	workflowProviderTask := taskInputUsesWorkflowProvider(normalizedInput)
	frontendEnabled := false
	if workflowProviderTask {
		config, _ := normalizedInput["config"].(map[string]any)
		if err := s.RequireWorkflowPluginForUser(userID, strings.TrimSpace(fmt.Sprint(config["interfaceType"]))); err != nil {
			return nil, err
		}
	} else {
		// 工作流是独立执行器；普通模型仍严格使用主线的目录和路由校验。
		frontendEnabled, err = s.FeatureEnabled(FeatureFrontendModels)
		if err != nil {
			return nil, err
		}
	}

	if !workflowProviderTask {
		routed, normalizedInput, err = s.resolveTaskModelSelection(userID, normalizedInput, logicalModelID, taskType, req.Operation, frontendEnabled)
		if err != nil {
			return nil, err
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
	// 媒体任务在扣费和调用上游前确认账号文件容量，避免容量已满仍然计费却无法回存产物。
	// 调用方已持锁时走不加锁的版本；这里不能再抢同一把 storageMu。
	var capacityErr error
	if req.callerHoldsStorageMu {
		capacityErr = s.requireStoredFileCapacityWhileLocked(userID, taskType, policy)
	} else {
		capacityErr = s.requireStoredFileCapacityForTask(userID, taskType, policy)
	}
	if capacityErr != nil {
		return nil, capacityErr
	}
	workbenchKind := req.workbenchKind
	if workbenchKind == "" {
		workbenchKind = workbenchKindFromTaskInput(normalizedInput, taskType)
	}
	task := model.Task{ID: newID(), UserID: userID, TraceID: req.TraceID, RequestID: req.RequestID, ProjectID: req.ProjectID, Type: taskType, WorkbenchKind: workbenchKind, Status: model.TaskStatusQueued, Stage: "等待队列调度", Progress: 5, Prompt: prompt, Operation: req.Operation, Provider: req.Provider, Model: req.Model}
	if req.admission != nil {
		task.ID = req.admission.ID
		task.AgentRunID = req.admission.AgentRunID
		task.GenerationID = req.admission.GenerationID
		task.ApprovalID = req.admission.ApprovalID
	}
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
	// Agent roots are durable control-plane carriers, not model calls. They
	// must not reserve credits or enter the worker queue; Pi creates the
	// billable cloud_agent_step task for each actual model request instead.
	if req.admission != nil && req.admission.NonBillable && !s.legacyCloudAgentRootTask {
		if err := s.protectTaskSecrets(normalizedInput); err != nil {
			return nil, err
		}
		inputJSON, err := json.Marshal(normalizedInput)
		if err != nil {
			return nil, fmt.Errorf("序列化任务输入失败：%w", err)
		}
		task.Status = model.TaskStatusTextReplay
		task.Stage = "Agent 控制面载体"
		task.Progress = 0
		task.InputJSON = string(inputJSON)
		if err := s.createTaskWithinStorageQuota(&task, nil, policy); err != nil {
			return nil, err
		}
		return taskForOutput(task), nil
	}
	billingOrder, err := s.taskBillingOrder(userID, &task, normalizedInput)
	if err != nil {
		return nil, err
	}
	if req.admission != nil && billingOrder != nil {
		if billingOrder.AmountMicrocredits > req.admission.MaxCharge {
			return nil, BadAuthRequest("模型调用报价超过本轮 Agent 积分上限，尚未创建任务或扣费")
		}
		switch billingOrder.BillingMode {
		case "fixed_request", "per_second", "token":
			billingOrder.ChargeLimitSet = true
			billingOrder.ChargeLimitMicrocredits = billingOrder.AmountMicrocredits
			task.AuthorizedChargeMicrocredits = billingOrder.AmountMicrocredits
		default:
			return nil, BadAuthRequest("Agent 暂不支持当前模型计费方式")
		}
	}
	if req.creationPrepare != nil {
		encoded, encodeErr := json.Marshal(normalizedInput)
		if encodeErr != nil {
			return nil, encodeErr
		}
		task.InputJSON = string(encoded)
		req.creationPrepare.Order = billingOrder
		return &task, nil
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
	if req.admission == nil {
		// 用户直接在节点上生成时，关闭 Agent 对同一节点仍在等待的生成审批。
		s.supersedeCloudAgentApprovalsForNodeTask(userID, &task, normalizedInput)
	}
	return taskForOutput(task), nil
}

// resolveTaskModelSelection 根据请求实际携带的模型选择决定路由方式。
// 显式系统渠道和用户自定义渠道请求不能被全局前台模型开关误判；
// 它们仍分别进入系统目录校验或自定义渠道的功能、能力与安全校验。
func (s *Service) resolveTaskModelSelection(userID string, input map[string]any, logicalModelID string, taskType string, operation string, frontendEnabled bool) (*RoutedModel, map[string]any, error) {
	customChannelTask := taskInputUsesCustomChannel(input)
	if frontendEnabled && !taskInputUsesSystemChannel(input) && !customChannelTask {
		if logicalModelID == "" {
			return nil, input, InvalidModelSelection("前台模型模式下必须指定 logicalModelId")
		}
		// 系统渠道和前台模型都按用户分组过滤可用渠道；自定义渠道不受分组约束。
		access, err := s.userGroupAccess(userID)
		if err != nil {
			return nil, input, err
		}
		intent := ModelRequestIntentFromTaskInput(input, taskType, operation)
		routed, err := s.ResolveLogicalModel(access, logicalModelID, intent)
		if err != nil {
			return nil, input, err
		}
		if normalizeCapability(routed.Intent.Capability) == "image" && routed.Intent.Options != nil {
			input["capabilityOptions"] = maps.Clone(routed.Intent.Options)
		}
		return routed, applyRoutedProviderSelection(input, routed), nil
	}

	if logicalModelID != "" {
		return nil, input, ModelCatalogMismatch("模型目录已更新，请重新选择")
	}
	// 自定义渠道没有系统 channelId；它会在后续由自定义渠道功能开关、
	// 能力校验和 provider 配置校验共同处理，不能误报为“缺少系统渠道”。
	if !customChannelTask {
		access, err := s.userGroupAccess(userID)
		if err != nil {
			return nil, input, err
		}
		resolvedInput, err := s.resolveSystemChannelModelSelection(access, input, taskType, operation)
		if err != nil {
			return nil, input, err
		}
		return nil, resolvedInput, nil
	}
	return nil, input, nil
}

func applyRoutedProviderSelection(input map[string]any, routed *RoutedModel) map[string]any {
	config, _ := input["config"].(map[string]any)
	nextConfig := make(map[string]any, len(config)+2)
	for key, value := range config {
		switch key {
		case "channelId", "channelModelKey", "priceTierId", "providerModelKey", "apiFormat", "interfaceType", "baseUrl", "apiKey", "secretKey", "headers", "model", "capabilityConfig":
			continue
		default:
			nextConfig[key] = value
		}
	}
	for key, value := range routed.Defaults {
		canonical := canonicalModelOptionName(routed.Intent.Capability, key)
		if !isProviderCapabilityOption(canonical) {
			continue
		}
		if existing, exists := nextConfig[canonical]; !exists || existing == nil || strings.TrimSpace(fmt.Sprint(existing)) == "" {
			nextConfig[canonical] = providerConfigOptionValue(value)
		}
	}
	// 路由匹配和真实请求必须使用同一组参数；逻辑能力参数覆盖空的页面配置，但不携带供应链字段。
	if options, ok := input["capabilityOptions"].(map[string]any); ok {
		for key, value := range options {
			canonical := canonicalModelOptionName(routed.Intent.Capability, key)
			if isProviderCapabilityOption(canonical) {
				nextConfig[canonical] = providerConfigOptionValue(value)
			}
		}
	}
	nextConfig["channelId"] = routed.ChannelModel.ChannelID
	nextConfig["model"] = routed.ChannelModel.ModelKey
	nextConfig["channelModelKey"] = routed.ChannelModel.ModelKey
	// 协议必须以服务端记录为唯一权威：受管逻辑模型流程的客户端只表达创作参数，不携带
	// interfaceType；缺失会让依赖协议的尺寸换算（比例 → 像素）静默跳过，把 16:9 这类比例
	// 原样发给只认 WIDTHxHEIGHT 的上游（OpenAI Images 直接拒绝）。
	nextConfig["interfaceType"] = string(routed.ChannelModel.Protocol)
	providerModelKey := routed.ChannelModel.ProviderModelKey
	if routed.PriceTier != nil {
		nextConfig["priceTierId"] = routed.PriceTier.ID
		providerModelKey = firstNonEmpty(routed.PriceTier.ProviderModelKey, providerModelKey)
	}
	nextConfig["providerModelKey"] = firstNonEmpty(providerModelKey, routed.ChannelModel.ModelKey)
	if routed.Intent.Capability == "image" && routed.CapabilitySpec.ImageParameters != nil {
		nextConfig["imageParameters"] = maps.Clone(routed.Intent.Options)
		for _, key := range []string{"size", "quality", "imageResolution", "transparentBackground", "count"} {
			delete(nextConfig, key)
			if value, exists := routed.Intent.Options[key]; exists {
				nextConfig[key] = providerConfigOptionValue(value)
			}
		}
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
	if config, ok := normalized["config"].(map[string]any); ok {
		if encoded, ok := config["imageParameters"].(string); ok {
			var parameters map[string]any
			if err := json.Unmarshal([]byte(encoded), &parameters); err != nil || parameters == nil {
				return nil, BadAuthRequest("图片扩展参数必须为有效对象")
			}
			config["imageParameters"] = parameters
		}
	}
	if snapshot, ok := normalized["canvasSnapshot"]; ok {
		normalized["canvasSnapshot"] = compactPersistedValue(snapshot)
	}
	return normalized, nil
}

func workbenchKindFromTaskInput(input map[string]any, taskType string) string {
	metadata, ok := input["metadata"].(map[string]any)
	if !ok || metadata["source"] != "workbench" {
		return ""
	}
	kind := stringValue(metadata["workbenchKind"])
	if stringValue(input["mode"]) != kind {
		return ""
	}
	switch kind {
	case model.WorkbenchKindImage:
		if taskType == "canvas_image" {
			return kind
		}
	case model.WorkbenchKindVideo:
		if taskType == "canvas_video" || strings.HasPrefix(taskType, "video_") {
			return kind
		}
	}
	return ""
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
		ID: newID(), UserID: userID, TraceID: req.TraceID, RequestID: req.RequestID, ProjectID: req.ProjectID,
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
	case "text", "canvas_text", "canvas_image", "canvas_video", "canvas_audio":
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

// resolveSystemChannelModelSelection 是系统渠道任务的 admission 边界。
// 客户端只负责表达创作参数；模型协议、能力合同、价格档和上游模型标识必须从服务端记录重建，
// 避免出现“按一个规格校验/计费，却按另一个规格执行”的跨阶段漂移。
func (s *Service) resolveSystemChannelModelSelection(access *userGroupAccess, input map[string]any, taskType string, operation string) (map[string]any, error) {
	config, ok := input["config"].(map[string]any)
	if !ok {
		return input, InvalidModelSelection("缺少模型配置")
	}

	channelID := strings.TrimSpace(stringValue(config["channelId"]))
	modelKey := strings.TrimPrefix(strings.TrimSpace(stringValue(config["model"])), "models/")

	if channelID == "" || modelKey == "" {
		return input, InvalidModelSelection("必须指定系统渠道和模型")
	}

	channel, err := s.repo.SystemChannel(channelID)
	if err != nil {
		return input, InvalidModelSelection("指定的渠道不存在")
	}
	if !channel.Enabled || channel.Scope != model.ChannelScopeSystem {
		return input, InvalidModelSelection("指定的渠道不可用")
	}
	if err := access.requireChannel(channelID); err != nil {
		return input, err
	}

	channelModel, err := s.repo.ChannelModelByKey(channelID, modelKey)
	if err != nil {
		return input, InvalidModelSelection("指定的模型不存在")
	}
	if !channelModel.Enabled {
		return input, InvalidModelSelection("指定的模型已停用")
	}
	if channelModel.Protocol == "" {
		return input, InvalidModelSelection("指定的模型未配置请求协议")
	}

	nextConfig := make(map[string]any, len(config)+6)
	for key, value := range config {
		switch key {
		case "channelId", "channelModelKey", "priceTierId", "providerModelKey", "apiFormat", "interfaceType", "baseUrl", "apiKey", "secretKey", "headers", "model", "capabilityConfig":
			continue
		default:
			nextConfig[key] = value
		}
	}
	// capabilityOptions 是路由、校验和计价共同使用的请求规格；存在时必须覆盖 config 中的同名字段，
	// 不能让两份客户端数据分别驱动计费与真实上游请求。
	if options, ok := input["capabilityOptions"].(map[string]any); ok {
		for key, value := range options {
			canonical := canonicalModelOptionName(channelModel.Capability, key)
			if isCapabilityOptionFor(channelModel.Capability, canonical) {
				nextConfig[canonical] = value
			}
		}
	}

	capabilityConfig, err := normalizedChannelModelCapability(channelModel, s.protocolRegistry())
	if err != nil {
		return input, InvalidModelSelection("指定的模型能力配置无效，请联系管理员")
	}
	if legacyImageResolutionProtocol(string(channelModel.Protocol)) && capabilityConfig != nil && capabilityConfig.Image != nil && capabilityConfig.Image.Resolution.Supported {
		legacyQuality := strings.ToLower(strings.TrimSpace(metadataString(nextConfig, "quality")))
		if legacyQuality != "" && legacyQuality != "<nil>" && legacyQuality != "auto" && legacyQuality != "any" && !containsCapabilityString(capabilityConfig.Image.Resolution.Values, legacyQuality) {
			return input, ModelCapabilityNotSupported("所选模型不支持当前图片分辨率：" + legacyQuality)
		}
	}
	legacyImageResolutionTier := normalizeLegacyImageResolutionRequest(string(channelModel.Protocol), capabilityConfig, nextConfig)
	if capabilityConfig != nil && capabilityConfig.Video != nil && capabilityConfig.Video.FixedScreenSpec != nil {
		videoInput := canvasGenerationInput{Config: providerConfig{
			Size: metadataString(nextConfig, "size"), VQuality: metadataString(nextConfig, "vquality"),
		}}
		applyAutoDLVideoScreenSpec(&videoInput, capabilityConfig.Video)
		nextConfig["size"], nextConfig["vquality"] = videoInput.Config.Size, videoInput.Config.VQuality
	}
	// 只有真实能力配置声明过的参数才能进入路由意图。客户端 config 可能保留
	// 旧模型的质量/分辨率值；若直接重新汇总，会把已关闭的参数误报为“不支持”。
	var capabilitySpec *CapabilitySpec
	if normalizeCapability(channelModel.Capability) != "audio" {
		spec, specErr := CapabilitySpecFromModelCapabilityConfig(capabilityConfig, channelModel.Capability)
		if specErr != nil {
			return input, InvalidModelSelection("指定的模型能力配置无效，请联系管理员")
		}
		capabilitySpec = &spec
	}
	applyChannelCapabilityDefaults(nextConfig, channelModel.Capability, capabilityConfig)
	if capabilityConfig != nil && capabilityConfig.Image != nil && capabilityConfig.Image.Parameters != nil {
		parameters := capabilityConfig.Image.Parameters
		values := declaredImageParameterValues(nextConfig, parameters)
		if explicit, ok := input["capabilityOptions"].(map[string]any); ok {
			values = explicit
		}
		if value, ok := values["size"]; ok && capabilitySpec != nil && capabilityImageSizePresetMatches(*capabilitySpec, value, values) {
			values = maps.Clone(values)
			if encoded := imageSizeValueForDeclaredPreset(capabilityConfig.Image, fmt.Sprint(value), stringValue(values["imageResolution"])); encoded != "" {
				values["size"] = encoded
			}
		}
		resolved, parameterErr := resolveImageParameterValues(parameters, values)
		if parameterErr != nil {
			return input, parameterErr
		}
		nextConfig["imageParameters"] = resolved
		for _, p := range parameters {
			if value, ok := resolved[p.Name]; ok && isCapabilityOptionFor("image", p.Name) {
				nextConfig[p.Name] = providerConfigOptionValue(value)
			}
		}
		for _, name := range []string{"size", "quality", "imageResolution", "transparentBackground"} {
			if _, ok := resolved[name]; !ok {
				delete(nextConfig, name)
			}
		}
	}
	input["config"] = nextConfig
	var declaredOptions map[string]OptionConstraint
	if capabilitySpec != nil {
		declaredOptions = capabilitySpec.Options
	}
	input["capabilityOptions"] = capabilityOptionsFromConfig(channelModel.Capability, nextConfig, declaredOptions)

	intent := ModelRequestIntentFromTaskInput(input, taskType, operation)
	if capabilitySpec != nil && normalizeCapability(intent.Capability) == "image" {
		intent = normalizeImageSizeIntent(*capabilitySpec, intent)
		input["capabilityOptions"] = maps.Clone(intent.Options)
		for key, value := range intent.Options {
			if isProviderCapabilityOption(key) {
				nextConfig[key] = providerConfigOptionValue(value)
			}
		}
	}
	if normalizeCapability(intent.Capability) != normalizeCapability(channelModel.Capability) {
		return input, ModelCapabilityNotSupported("所选模型与任务能力不匹配")
	}
	if normalizeCapability(channelModel.Capability) != "audio" {
		if capabilitySpec == nil {
			return input, InvalidModelSelection("指定的模型能力配置无效，请联系管理员")
		}
		if match := MatchCapability(*capabilitySpec, intent); !match.Matched {
			return input, modelCapabilityMismatchError(match)
		}
	}

	pricingIntent := intent
	if normalizeCapability(channelModel.Capability) == "image" && (capabilityConfig == nil || capabilityConfig.Image == nil || capabilityConfig.Image.Parameters == nil) {
		pricingOptions := make(map[string]any, len(intent.Options)+2)
		for k, v := range intent.Options {
			pricingOptions[k] = v
		}
		rawQuality := strings.ToLower(strings.TrimSpace(fmt.Sprint(nextConfig["quality"])))
		if legacyImageResolutionTier != "" {
			// Match pre-split price tiers without forwarding the legacy quality field upstream.
			pricingOptions["quality"] = strings.ToLower(legacyImageResolutionTier)
		} else if capabilityConfig == nil || capabilityConfig.Image == nil || !capabilityConfig.Image.Resolution.Supported {
			if rawQuality != "" && rawQuality != "<nil>" && rawQuality != "auto" && rawQuality != "any" {
				pricingOptions["quality"] = rawQuality
			} else if pricingOptions["quality"] == nil || pricingOptions["quality"] == "" || pricingOptions["quality"] == "auto" {
				pricingOptions["quality"] = "1k"
			}
		}
		if rawResolution := strings.ToLower(strings.TrimSpace(fmt.Sprint(nextConfig["imageResolution"]))); rawResolution != "" && rawResolution != "<nil>" && rawResolution != "auto" {
			pricingOptions["imageResolution"] = rawResolution
		}
		if rawSize := strings.ToLower(strings.TrimSpace(fmt.Sprint(nextConfig["size"]))); rawSize != "" && rawSize != "<nil>" && rawSize != "auto" {
			pricingOptions["size"] = rawSize
		}
		pricingIntent.Options = pricingOptions
	}

	var pricingSpecs []CapabilitySpec
	if capabilitySpec != nil {
		pricingSpecs = append(pricingSpecs, *capabilitySpec)
	}
	priceTier := channelModelPriceTierForIntent(*channelModel, pricingIntent, pricingSpecs...)
	if priceTier == nil {
		priceTier = channelModelPriceTierForIntent(*channelModel, intent, pricingSpecs...)
	}
	if priceTier == nil || !ValidatePriceTierPrice(priceTier, channelModel.Capability, channelModel.Protocol) {
		return input, ModelPriceNotConfigured("指定的模型未配置当前规格的有效价格")
	}

	nextConfig["channelId"] = channel.ID
	nextConfig["model"] = channelModel.ModelKey
	nextConfig["channelModelKey"] = channelModel.ModelKey
	nextConfig["priceTierId"] = priceTier.ID
	nextConfig["providerModelKey"] = firstNonEmpty(priceTier.ProviderModelKey, channelModel.ProviderModelKey, channelModel.ModelKey)
	nextConfig["interfaceType"] = string(channelModel.Protocol)
	nextConfig["apiFormat"] = channelAPIFormatForProtocol(channel.APIFormat, channelModel.Protocol)
	return input, nil
}

// applyChannelCapabilityDefaults 只采用管理员保存的能力默认值，且仅填补客户端未表达的参数。
// 这些值随后会写回 capabilityOptions，使能力校验、SKU 选择和 provider 执行看到同一份规格。
func applyChannelCapabilityDefaults(config map[string]any, capability string, profile *ModelCapabilityConfig) {
	setDefault := func(key string, value any) {
		if existing, exists := config[key]; !exists || existing == nil || strings.TrimSpace(fmt.Sprint(existing)) == "" {
			// providerConfig uses string-valued controls, including booleans and counts.
			config[key] = fmt.Sprint(value)
		}
	}
	switch normalizeCapability(capability) {
	case "image":
		if profile == nil || profile.Image == nil {
			return
		}
		if profile.Image.Parameters != nil {
			for _, parameter := range profile.Image.Parameters {
				if parameter.IsEnabled() && parameter.Default != nil && isCapabilityOptionFor("image", parameter.Name) {
					setDefault(parameter.Name, parameter.Default)
				}
			}
			return
		}
		if profile.Image.Size.Parameter != "none" {
			setDefault("size", profile.Image.Size.Default)
		}
		if profile.Image.Resolution.Supported {
			setDefault("imageResolution", profile.Image.Resolution.Default)
		}
		if profile.Image.Quality.Supported {
			setDefault("quality", profile.Image.Quality.Default)
		}
		setDefault("transparentBackground", profile.Image.TransparentBackground.Default)
		setDefault("count", 1)
	case "video":
		if profile == nil || profile.Video == nil {
			return
		}
		if videoDurationSupported(profile.Video) {
			setDefault("videoSeconds", profile.Video.Duration.Default)
		}
		setDefault("size", profile.Video.DefaultRatio)
		setDefault("vquality", profile.Video.DefaultResolution)
		setDefault("videoGenerateAudio", profile.Video.GenerateAudio.Default)
		setDefault("videoWatermark", profile.Video.Watermark.Default)
	}
}

func capabilityOptionsFromConfig(capability string, config map[string]any, declared map[string]OptionConstraint) map[string]any {
	options := map[string]any{}
	if capability == "image" {
		if parameters, ok := config["imageParameters"].(map[string]any); ok {
			return maps.Clone(parameters)
		}
	}
	for key, value := range config {
		canonical := canonicalCapabilityOptionName(key)
		if !isCapabilityOptionFor(capability, canonical) || value == nil || strings.TrimSpace(fmt.Sprint(value)) == "" {
			continue
		}
		if declared != nil {
			if _, ok := declared[canonical]; !ok {
				continue
			}
		}
		options[canonical] = value
	}
	return options
}

func taskInputUsesCustomChannel(input map[string]any) bool {
	if taskInputUsesWorkflowProvider(input) {
		return false
	}
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

func taskInputUsesSystemChannel(input map[string]any) bool {
	config, ok := input["config"].(map[string]any)
	if !ok {
		return false
	}
	channelID, _ := config["channelId"].(string)
	return strings.TrimSpace(channelID) != ""
}

func taskInputUsesWorkflowProvider(input map[string]any) bool {
	config, ok := input["config"].(map[string]any)
	if !ok {
		return false
	}
	// 系统渠道的 interfaceType 是客户端缓存，不是授权事实；必须先走系统模型 admission，
	// 不能通过伪造工作流协议绕开渠道模型、能力和价格校验。
	if strings.TrimSpace(stringValue(config["channelId"])) != "" {
		return false
	}
	return isWorkflowProviderInterface(strings.TrimSpace(fmt.Sprint(config["interfaceType"])))
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

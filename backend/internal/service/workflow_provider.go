package service

// RunningHub 与 ComfyUI Bridge 的协议适配集中在这里。两者都接受“工作流 + 字段覆盖”，
// 但前者由云端 HTTP API 执行，后者由已注册的本地进程领取，因此不能复用普通模型的 URL 拼接逻辑。

import (
	"bytes"
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// WorkflowField 是 RunningHub/ComfyUI 共用的字段描述。Value 与 FieldValue 兼容来源项目
// 的两种命名；Source 可取 referenceImage/referenceVideo/referenceAudio/mask。
type WorkflowField struct {
	ID             string        `json:"id"`
	NodeID         string        `json:"nodeId"`
	ClassType      string        `json:"classType,omitempty"`
	FieldName      string        `json:"fieldName"`
	Value          interface{}   `json:"value,omitempty"`
	FieldValue     interface{}   `json:"fieldValue,omitempty"`
	FieldType      string        `json:"fieldType,omitempty"`
	Label          string        `json:"label,omitempty"`
	Role           string        `json:"role,omitempty"`
	SafeToOverride *bool         `json:"safeToOverride,omitempty"`
	OptionsSource  string        `json:"optionsSource,omitempty"`
	Options        []interface{} `json:"options,omitempty"`
	Min            interface{}   `json:"min,omitempty"`
	Max            interface{}   `json:"max,omitempty"`
	Step           interface{}   `json:"step,omitempty"`
	RandomEnabled  bool          `json:"randomEnabled,omitempty"`
	BindPrompt     bool          `json:"bindPrompt,omitempty"`
	// 指针用于区分“未配置（默认启用）”和明确传入 false。
	Enabled            *bool  `json:"enabled,omitempty"`
	Source             string `json:"source,omitempty"`
	SourceIndex        int    `json:"sourceIndex,omitempty"`
	ImageOrder         int    `json:"imageOrder,omitempty"`
	SourceFromUpstream bool   `json:"sourceFromUpstream,omitempty"`
	Required           bool   `json:"required,omitempty"`
	// nil 兼容旧配置；true 表示来源由字段名推断，false 表示用户在映射面板明确选择。
	SourceAutomatic *bool `json:"sourceAutomatic,omitempty"`
	// 仅在本次反序列化期间保留，用于区分旧数据缺字段与用户明确选择“保留默认值”。
	sourceConfigured bool
}

// UnmarshalJSON 兼容来源项目的字段配置格式。来源项目使用 node/input/default/
// bind_prompt，而画布内部使用 nodeId/fieldName/fieldValue/source；在入口统一归一化，
// 后续 RunningHub 和 Bridge 不需要各自维护一套别名解析。
func (f *WorkflowField) UnmarshalJSON(data []byte) error {
	type plainWorkflowField WorkflowField
	var parsed plainWorkflowField
	if err := json.Unmarshal(data, &parsed); err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*f = WorkflowField(parsed)
	if f.NodeID == "" {
		f.NodeID = workflowFieldRawString(raw, "node", "node_id", "nodeID")
	}
	if f.ClassType == "" {
		f.ClassType = workflowFieldRawString(raw, "class_type", "typeName", "nodeType")
	}
	if f.FieldName == "" {
		f.FieldName = workflowFieldRawString(raw, "input", "inputName", "input_name", "name")
	}
	if f.ID == "" {
		f.ID = workflowFieldRawString(raw, "fieldId", "field_id", "key")
	}
	if f.FieldType == "" {
		f.FieldType = workflowFieldRawString(raw, "type")
	}
	if len(f.Options) == 0 {
		if options, ok := workflowFieldRawSlice(raw, "options", "values", "choices", "enum", "fieldOptions", "field_options"); ok {
			f.Options = options
		}
	}
	if f.Min == nil {
		f.Min, _ = workflowFieldRawAny(raw, "min", "minValue", "min_value")
		if f.Min == nil {
			f.Min, _ = workflowFieldRawNestedAny(raw, "min", "minValue", "min_value")
		}
	}
	if f.Max == nil {
		f.Max, _ = workflowFieldRawAny(raw, "max", "maxValue", "max_value")
		if f.Max == nil {
			f.Max, _ = workflowFieldRawNestedAny(raw, "max", "maxValue", "max_value")
		}
	}
	if f.Step == nil {
		f.Step, _ = workflowFieldRawAny(raw, "step", "stepValue", "step_value")
		if f.Step == nil {
			f.Step, _ = workflowFieldRawNestedAny(raw, "step", "stepValue", "step_value")
		}
	}
	if f.Label == "" {
		f.Label = workflowFieldRawString(raw, "title")
	}
	sourceConfigured := workflowFieldRawHas(raw, "source") || workflowFieldRawHas(raw, "bind") || workflowFieldRawHas(raw, "from")
	if f.Source == "" {
		f.Source = workflowFieldRawString(raw, "bind", "from")
	}
	if !workflowFieldRawHas(raw, "fieldValue") {
		if value, ok := workflowFieldRawAny(raw, "defaultValue", "default_value", "default"); ok {
			f.FieldValue = value
		}
	}
	if !workflowFieldRawHas(raw, "sourceIndex") {
		f.SourceIndex = workflowFieldRawInt(raw, f.SourceIndex, "source_index", "index")
	}
	if !workflowFieldRawHas(raw, "imageOrder") {
		f.ImageOrder = workflowFieldRawInt(raw, f.ImageOrder, "image_order")
	}
	if !workflowFieldRawHas(raw, "required") {
		f.Required = workflowFieldRawBool(raw, f.Required, "isRequired", "is_required")
	}
	if !workflowFieldRawHas(raw, "randomEnabled") {
		f.RandomEnabled = workflowFieldRawBool(raw, f.RandomEnabled, "random_enabled")
	}
	if !workflowFieldRawHas(raw, "bindPrompt") {
		f.BindPrompt = workflowFieldRawBool(raw, f.BindPrompt, "bind_prompt")
	}
	if f.BindPrompt && strings.TrimSpace(f.Source) == "" && !sourceConfigured {
		f.Source = "prompt"
	}
	sourceFromUpstreamConfigured := workflowFieldRawHas(raw, "sourceFromUpstream") || workflowFieldRawHas(raw, "source_from_upstream")
	f.sourceConfigured = sourceConfigured || sourceFromUpstreamConfigured
	if !workflowFieldRawHas(raw, "sourceFromUpstream") && workflowFieldRawHas(raw, "source_from_upstream") {
		f.SourceFromUpstream = workflowFieldRawBool(raw, f.SourceFromUpstream, "source_from_upstream")
	}
	if !sourceConfigured && !sourceFromUpstreamConfigured && strings.TrimSpace(f.Source) == "" {
		// 旧工作流没有保存动态来源时，按字段语义恢复宽高、数量、媒体等画布输入绑定。
		f.Source = workflowDynamicSource(f.FieldName, f.FieldType)
	}
	if !sourceConfigured && !sourceFromUpstreamConfigured && !f.SourceFromUpstream {
		switch strings.ToLower(strings.TrimSpace(f.FieldType)) {
		case "image", "video", "audio":
			// 来源配置默认把媒体字段绑定到上游参考素材。
			f.SourceFromUpstream = true
		}
	}
	if f.ID == "" && f.NodeID != "" && f.FieldName != "" {
		f.ID = f.NodeID + "::" + f.FieldName
	}
	return nil
}

func workflowFieldRawHas(raw map[string]json.RawMessage, key string) bool {
	_, ok := raw[key]
	return ok
}

func workflowFieldRawString(raw map[string]json.RawMessage, keys ...string) string {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok {
			continue
		}
		var text string
		if json.Unmarshal(value, &text) == nil && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
		var generic interface{}
		if json.Unmarshal(value, &generic) == nil && generic != nil {
			text = strings.TrimSpace(fmt.Sprint(generic))
			if text != "" && text != "<nil>" {
				return text
			}
		}
	}
	return ""
}

func workflowFieldRawAny(raw map[string]json.RawMessage, keys ...string) (interface{}, bool) {
	for _, key := range keys {
		value, ok := raw[key]
		if !ok || string(value) == "null" {
			continue
		}
		var decoded interface{}
		if json.Unmarshal(value, &decoded) == nil {
			return decoded, true
		}
	}
	return nil, false
}

func workflowFieldRawSlice(raw map[string]json.RawMessage, keys ...string) ([]interface{}, bool) {
	value, ok := workflowFieldRawAny(raw, keys...)
	if !ok {
		return nil, false
	}
	if items, ok := value.([]interface{}); ok {
		return items, true
	}
	if object, ok := value.(map[string]interface{}); ok {
		for _, key := range []string{"choices", "options", "values", "enum"} {
			if items, ok := object[key].([]interface{}); ok {
				return items, true
			}
		}
	}
	return nil, false
}

func workflowFieldRawNestedAny(raw map[string]json.RawMessage, keys ...string) (interface{}, bool) {
	for _, containerKey := range []string{"options", "values", "choices", "range", "fieldOptions", "field_options"} {
		value, ok := workflowFieldRawAny(raw, containerKey)
		if !ok {
			continue
		}
		if found, ok := workflowNestedFieldValue(value, keys...); ok {
			return found, true
		}
	}
	return nil, false
}

func workflowNestedFieldValue(value interface{}, keys ...string) (interface{}, bool) {
	if items, ok := value.([]interface{}); ok {
		for _, item := range items {
			if found, ok := workflowNestedFieldValue(item, keys...); ok {
				return found, true
			}
		}
		return nil, false
	}
	object, ok := value.(map[string]interface{})
	if !ok {
		return nil, false
	}
	for _, key := range keys {
		if found, exists := object[key]; exists && found != nil {
			return found, true
		}
	}
	if nested, exists := object["range"]; exists {
		return workflowNestedFieldValue(nested, keys...)
	}
	return nil, false
}

func workflowFieldRawInt(raw map[string]json.RawMessage, fallback int, keys ...string) int {
	value, ok := workflowFieldRawAny(raw, keys...)
	if !ok {
		return fallback
	}
	switch item := value.(type) {
	case float64:
		return int(item)
	case json.Number:
		parsed, err := strconv.Atoi(string(item))
		if err == nil {
			return parsed
		}
	case string:
		parsed, err := strconv.Atoi(strings.TrimSpace(item))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func workflowFieldRawBool(raw map[string]json.RawMessage, fallback bool, keys ...string) bool {
	value, ok := workflowFieldRawAny(raw, keys...)
	if !ok {
		return fallback
	}
	switch item := value.(type) {
	case bool:
		return item
	case string:
		parsed, err := strconv.ParseBool(strings.TrimSpace(item))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func isRunningHubInterface(value string) bool {
	pluginID, ok := workflowPluginIDForInterface(strings.ToLower(strings.TrimSpace(value)))
	return ok && pluginID == WorkflowPluginRunningHub
}

func isComfyBridgeInterface(value string) bool {
	pluginID, ok := workflowPluginIDForInterface(strings.ToLower(strings.TrimSpace(value)))
	return ok && pluginID == WorkflowPluginComfyUI
}

func isWorkflowProviderInterface(value string) bool {
	return isRunningHubInterface(value) || isComfyBridgeInterface(value)
}

func validateWorkflowProviderConfig(mode string, config providerConfig) error {
	if mode != "image" && mode != "video" && mode != "audio" {
		return fmt.Errorf("工作流协议暂不支持%s生成", mode)
	}
	interfaceType := strings.ToLower(strings.TrimSpace(config.InterfaceType))
	if !workflowInterfaceSupportsMode(interfaceType, mode) {
		return fmt.Errorf("接口类型 %s 不支持%s生成", config.InterfaceType, mode)
	}
	if isRunningHubInterface(config.InterfaceType) {
		if runningHubAPIKey(config) == "" {
			return errors.New("RunningHub 工作流缺少积分 API Key")
		}
		if _, err := ValidateOutboundURL(runningHubRootURL(config.BaseURL)); err != nil {
			return err
		}
		if strings.TrimSpace(config.WorkflowID) == "" && strings.TrimSpace(config.WebappID) == "" && strings.TrimSpace(config.Model) == "" {
			return errors.New("RunningHub 缺少 workflowId 或 webappId")
		}
		return nil
	}
	if isComfyBridgeInterface(config.InterfaceType) {
		if strings.TrimSpace(config.BridgeID) == "" {
			return errors.New("本地 ComfyUI 缺少 Bridge ID，请先注册并连接 Bridge")
		}
		if len(config.WorkflowJSON) == 0 && strings.TrimSpace(config.WorkflowID) == "" {
			return errors.New("本地 ComfyUI 缺少 API 格式工作流 JSON 或 workflowId")
		}
		return nil
	}
	return errors.New("未知工作流协议")
}

func workflowInterfaceSupportsMode(interfaceType string, mode string) bool {
	switch mode {
	case "image":
		return interfaceType == string(model.ChannelInterfaceRunningHubImage) || interfaceType == string(model.ChannelInterfaceComfyBridgeImage)
	case "video":
		return interfaceType == string(model.ChannelInterfaceRunningHubVideo) || interfaceType == string(model.ChannelInterfaceComfyBridgeVideo)
	case "audio":
		return interfaceType == string(model.ChannelInterfaceRunningHubAudio) || interfaceType == string(model.ChannelInterfaceComfyBridgeAudio)
	default:
		return false
	}
}

func (s *Service) runWorkflowProviderTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if isRunningHubInterface(input.Config.InterfaceType) {
		return s.runRunningHubWorkflow(ctx, input)
	}
	return s.runComfyBridgeWorkflow(ctx, input)
}

func (s *Service) runComfyBridgeWorkflow(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	metadata, _ := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if metadata.Service == nil {
		metadata.Service = s
	}
	workflowID := strings.TrimSpace(input.Config.WorkflowID)
	if workflowID == "" {
		// Bridge-only 渠道可以把模型名直接当作本地 workflows 文件名。
		workflowID = strings.TrimSpace(input.Config.Model)
	}
	workflowFields := workflowFieldsForMode(input.Config.WorkflowFields, input.Mode)
	payload := map[string]any{
		"mode":            input.Mode,
		"prompt":          input.Prompt,
		"model":           input.Config.Model,
		"workflowId":      workflowID,
		"workflowJson":    input.Config.WorkflowJSON,
		"workflowFields":  workflowFields,
		"referenceImages": input.ReferenceImages,
		"referenceVideos": input.ReferenceVideos,
		"referenceAudios": input.ReferenceAudios,
		"mask":            input.Mask,
		"params": map[string]any{
			"size": input.Config.Size, "quality": input.Config.Quality, "count": input.Config.Count,
			"transparentBackground": input.Config.TransparentBackground,
			"videoSeconds":          input.Config.VideoSeconds, "vquality": input.Config.VQuality,
			"videoGenerateAudio": input.Config.VideoGenerateAudio,
			"videoWatermark":     input.Config.VideoWatermark,
			"audioVoice":         input.Config.AudioVoice, "audioFormat": input.Config.AudioFormat,
			"audioSpeed": input.Config.AudioSpeed, "audioInstructions": input.Config.AudioInstructions,
			"systemPrompt": input.Config.SystemPrompt,
		},
		"metadata": input.Metadata,
	}
	request, err := s.enqueueComfyBridgeRequest(ctx, metadata.UserID, input.Config.BridgeID, metadata.TaskID, resumedProviderRequestID(ctx), payload)
	if err != nil {
		return nil, err
	}
	if err := s.recordWorkflowProviderRequest(ctx, request.ID, "queued", nil); err != nil {
		// 入队后 Bridge 可能已经领取，不能把状态写入失败误判成“上游未执行”并退款。
		_ = s.log(metadata.UserID, metadata.TaskID, "error", "本地 ComfyUI Bridge 请求状态保存失败", err.Error())
	}
	completion, err := s.WaitComfyBridgeRequest(ctx, request.ID)
	if err != nil {
		// Wait 在取消/超时分支会清理队列；这里再次幂等清理，覆盖请求尚未进入等待的竞态。
		s.CancelComfyBridgeRequest(request.ID)
		return nil, err
	}
	_ = s.updateWorkflowProviderState(ctx, request.ID, strings.ToLower(completion.Status), nil)
	if completion.Status != "succeeded" {
		if strings.TrimSpace(completion.Error) == "" {
			completion.Error = "本地 ComfyUI Bridge 执行失败"
		}
		return nil, errors.New(completion.Error)
	}
	if completion.Result == nil {
		return nil, errors.New("本地 ComfyUI Bridge 未返回结果")
	}
	return completion.Result, nil
}

func (s *Service) updateWorkflowProviderState(ctx context.Context, requestID string, stage string, nextPollAt *time.Time) error {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.TaskID == "" {
		return nil
	}
	return s.repo.UpdateTaskProviderState(metadata.TaskID, requestID, stage, nextPollAt)
}

// recordWorkflowProviderRequest 只在供应商生成请求首次建立时调用，同时保存任务和账单关联。
// 轮询状态仍走 updateWorkflowProviderState，避免每次轮询都刷新账单 updated_at，掩盖长期未结算订单。
func (s *Service) recordWorkflowProviderRequest(ctx context.Context, requestID string, stage string, nextPollAt *time.Time) error {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.TaskID == "" {
		return nil
	}
	if err := s.repo.UpdateTaskProviderState(metadata.TaskID, requestID, stage, nextPollAt); err != nil {
		return err
	}
	if metadata.BillingOrderID == "" || strings.TrimSpace(requestID) == "" {
		return nil
	}
	return s.repo.UpdateBillingProviderRequestID(metadata.BillingOrderID, strings.TrimSpace(requestID))
}

func (s *Service) runRunningHubWorkflow(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	root := runningHubRootURL(input.Config.BaseURL)
	apiKey := runningHubAPIKey(input.Config)
	if resumed := resumedProviderRequestID(ctx); resumed != "" {
		return s.pollRunningHubWorkflow(ctx, input.Config, root, resumed)
	}
	workflowID := strings.TrimSpace(input.Config.WorkflowID)
	webappID := strings.TrimSpace(input.Config.WebappID)
	if workflowID == "" {
		workflowID = strings.TrimSpace(input.Config.Model)
	}
	mappingWorkflow := input.Config.WorkflowJSON
	if webappID == "" && len(mappingWorkflow) == 0 && workflowID != "" {
		// 获取当前 API 工作流既用于旧配置的字段推断，也用于删除缺失的可选媒体默认值。
		// 某些兼容网关没有该接口，失败时仍允许仅依赖用户已经保存的字段映射提交。
		if fetched, fetchErr := s.fetchRunningHubWorkflowJSON(ctx, root, input.Config, workflowID); fetchErr == nil {
			mappingWorkflow = fetched
		}
	}
	workflowFields := input.Config.WorkflowFields
	if len(workflowFields) == 0 && len(mappingWorkflow) > 0 {
		var inferErr error
		workflowFields, inferErr = workflowFieldsFromManagement(mappingWorkflow, input.Mode)
		if inferErr != nil {
			return nil, inferErr
		}
	}
	workflowFields = workflowFieldsForMode(workflowFields, input.Mode)
	if err := validateWorkflowMediaInputs(workflowFields, input); err != nil {
		return nil, err
	}
	files := map[string]string{}
	for _, media := range append(append(append([]providerMedia{}, input.ReferenceImages...), input.ReferenceVideos...), input.ReferenceAudios...) {
		name, err := s.uploadRunningHubMedia(ctx, root, input.Config, media)
		if err != nil {
			return nil, err
		}
		files[media.ID] = name
	}
	if input.Mask != nil {
		name, err := s.uploadRunningHubMedia(ctx, root, input.Config, *input.Mask)
		if err != nil {
			return nil, err
		}
		files[input.Mask.ID] = name
	}
	nodeInfo, err := runningHubNodeInfoWithWorkflow(workflowFields, files, input, mappingWorkflow)
	if err != nil {
		return nil, err
	}
	// 旧条目可能保存了全部默认字段，却没有把文本节点绑定到任务 Prompt。只在没有任何显式
	// Prompt 映射时回退，并替换同节点同字段的默认值，避免 nodeInfoList 出现互相冲突的重复项。
	if !workflowFieldsBindPrompt(workflowFields) {
		nodeInfo = upsertRunningHubNodeInfo(nodeInfo, runningHubPromptFallback(mappingWorkflow, input.Prompt))
	}
	body := map[string]any{"apiKey": apiKey}
	endpoint := root + "/task/openapi/create"
	if webappID != "" {
		body["webappId"] = webappID
		endpoint = root + "/task/openapi/ai-app/run"
	} else {
		body["workflowId"] = workflowID
	}
	if len(nodeInfo) > 0 {
		body["nodeInfoList"] = nodeInfo
	}
	var submitted map[string]any
	if err := s.runningHubJSON(ctx, input.Config, endpoint, body, &submitted); err != nil {
		return nil, fmt.Errorf("RunningHub 工作流提交失败：%w", err)
	}
	code, validCode := runningHubPayloadCode(submitted)
	if !validCode {
		// 部分 RunningHub 兼容网关省略 code，但已经返回 taskId，按成功提交处理。
		validCode = runningHubTaskID(submitted) != ""
		code = 0
	}
	if !validCode || code != 0 {
		return nil, fmt.Errorf("RunningHub 工作流提交失败：%s", runningHubWorkflowFailureMessage(submitted))
	}
	taskID := runningHubTaskID(submitted)
	if taskID == "" {
		return nil, errors.New("RunningHub 未返回 taskId")
	}
	if err := s.recordWorkflowProviderRequest(ctx, taskID, "submitted", nil); err != nil {
		// 上游已经接受请求；继续轮询可在后续状态写入恢复后保住结果和 taskId。
		metadata, _ := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
		_ = s.log(metadata.UserID, metadata.TaskID, "error", "RunningHub 请求状态保存失败", taskID+"："+err.Error())
	}
	return s.pollRunningHubWorkflow(ctx, input.Config, root, taskID)
}

func runningHubWorkflowFailureMessage(response map[string]any) string {
	message := runningHubFailureMessage(response)
	normalized := strings.ToLower(message)
	if strings.Contains(message, "企业版余额不足") || (strings.Contains(normalized, "enterprise") && strings.Contains(normalized, "balance")) {
		return message + "；工作流提交固定使用积分 API Key，请确认提交 Key 不是企业级素材上传 Key"
	}
	return message
}

func (s *Service) fetchRunningHubWorkflowJSON(ctx context.Context, root string, config providerConfig, workflowID string) (map[string]interface{}, error) {
	var response map[string]any
	if err := s.runningHubJSON(withProviderRequestKind(ctx, "workflow-schema"), config, root+"/api/openapi/getJsonApiFormat", map[string]any{
		"apiKey":     runningHubAPIKey(config),
		"workflowId": workflowID,
	}, &response); err != nil {
		return nil, err
	}
	code, valid := runningHubPayloadCode(response)
	if valid && code != 0 {
		return nil, errors.New(runningHubFailureMessage(response))
	}
	data, _ := response["data"].(map[string]interface{})
	if data == nil {
		return nil, errors.New("RunningHub 工作流参数响应缺少 data")
	}
	raw := data["prompt"]
	if raw == nil {
		return nil, errors.New("RunningHub 工作流参数响应缺少 prompt")
	}
	if text, ok := raw.(string); ok {
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(text), &parsed); err != nil {
			return nil, err
		}
		return parsed, nil
	}
	parsed, ok := raw.(map[string]interface{})
	if !ok {
		return nil, errors.New("RunningHub 工作流参数格式无效")
	}
	return parsed, nil
}

func (s *Service) uploadRunningHubMedia(ctx context.Context, root string, config providerConfig, media providerMedia) (string, error) {
	raw, mimeType, err := mediaBytes(media)
	if err != nil && isPublicMediaURL(strings.TrimSpace(media.URL)) {
		// 任务里可能只携带了已公开的参考图/视频 URL；RunningHub 上传接口需要字节，
		// 这里在 SSRF 白名单校验后下载一次，不把外部 URL 直接交给供应商。
		raw, mimeType, err = getExternalBinary(withProviderRequestKind(ctx, "upload"), strings.TrimSpace(media.URL))
	}
	if err != nil {
		return "", err
	}
	if len(raw) == 0 {
		return "", errors.New("RunningHub 参考素材为空")
	}
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	apiKey := strings.TrimSpace(config.RunningHubUploadKey)
	if apiKey == "" {
		return "", errors.New("RunningHub 参考素材上传需要企业级 API Key，请在 RunningHub 设置中填写“素材上传 API Key（企业级）”")
	}
	_ = writer.WriteField("apiKey", apiKey)
	_ = writer.WriteField("fileType", "input")
	filename := providerMediaFilename(media, mimeType)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", mime.FormatMediaType("form-data", map[string]string{"name": "file", "filename": filename}))
	header.Set("Content-Type", mimeType)
	part, err := writer.CreatePart(header)
	if err != nil {
		return "", err
	}
	if _, err := part.Write(raw); err != nil {
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(withProviderRequestKind(ctx, "upload"), http.MethodPost, root+"/task/openapi/upload", body)
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	ApplyOutboundHeaders(req, config.Headers)
	data, _, err := doBinary(req)
	if err != nil {
		if message := runningHubUploadAuthFailure(err); message != "" {
			return "", errors.New(message)
		}
		return "", fmt.Errorf("RunningHub 参考素材上传失败：%w", err)
	}
	var rawResponse map[string]any
	if err := json.Unmarshal(data, &rawResponse); err != nil {
		return "", errors.New("RunningHub 上传响应不是有效 JSON")
	}
	code, validCode := runningHubPayloadCode(rawResponse)
	if !validCode {
		// 上传接口有少量代理只返回 data.fileName；文件名存在即可视为成功。
		validCode = runningHubFileName(rawResponse) != ""
		code = 0
	}
	if !validCode || code != 0 {
		return "", fmt.Errorf("RunningHub 上传素材失败：%s", runningHubFailureMessage(rawResponse))
	}
	fileName := runningHubFileName(rawResponse)
	if fileName == "" {
		return "", fmt.Errorf("RunningHub 上传素材失败：%s", runningHubFailureMessage(rawResponse))
	}
	return fileName, nil
}

func runningHubUploadAuthFailure(err error) string {
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusUnauthorized {
		return ""
	}
	if !strings.Contains(strings.ToLower(httpErr.Body), "apikey verification failed") {
		return ""
	}
	return "RunningHub 参考素材上传接口认证失败（HTTP 401）：ApiKey verification failed。请确认“素材上传 API Key（企业级）”有效，并且它与 Base URL 属于同一个 RunningHub 站点"
}

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

func (s *Service) runningHubJSON(ctx context.Context, config providerConfig, endpoint string, body interface{}, target *map[string]any) error {
	encoded, err := json.Marshal(body)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	ApplyOutboundHeaders(req, config.Headers)
	data, _, err := doBinary(req)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, target); err != nil {
		return err
	}
	return nil
}

func (s *Service) pollRunningHubWorkflow(ctx context.Context, config providerConfig, root string, taskID string) (map[string]interface{}, error) {
	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		var response map[string]any
		err := s.runningHubJSON(withProviderRequestKind(ctx, "poll"), config, root+"/task/openapi/outputs", map[string]any{"apiKey": runningHubAPIKey(config), "taskId": taskID}, &response)
		if err != nil {
			return nil, fmt.Errorf("RunningHub 查询任务失败：%w", err)
		}
		code, validCode := runningHubPayloadCode(response)
		if !validCode {
			// 成功响应有时只有 outputs/results，没有显式状态码。
			validCode = len(runningHubOutputURLs(response["data"])) > 0
			code = 0
		}
		if !validCode {
			return nil, errors.New("RunningHub 查询响应缺少可识别状态")
		}
		if code == 0 {
			urls := runningHubOutputURLs(response["data"])
			if len(urls) == 0 {
				return nil, errors.New("RunningHub 任务成功但没有返回产物")
			}
			for index, rawURL := range urls {
				urls[index] = resolveRunningHubOutputURL(root, rawURL)
			}
			_ = s.updateWorkflowProviderState(ctx, taskID, "succeeded", nil)
			return s.downloadWorkflowOutputs(ctx, urls)
		}
		if code == 805 || code == 806 {
			return nil, fmt.Errorf("RunningHub 任务失败：%s", runningHubFailureMessage(response))
		}
		stage := "running"
		if code == 813 {
			stage = "queued"
		} else if code != 804 {
			// RunningHub 会扩展暂态码；只对明确失败码结束任务，其余状态继续轮询到终态或超时。
			stage = "pending"
		}
		_ = s.updateWorkflowProviderState(ctx, taskID, stage, ptr(time.Now().Add(2500*time.Millisecond)))
		if err := sleepContext(ctx, 2500*time.Millisecond); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("RunningHub 任务超时（%s）", taskID)
}

// RunningHub 工作流的管理、提交和轮询固定使用积分 API Key；企业级 Key 仅由上传接口单独读取。
func runningHubAPIKey(config providerConfig) string {
	return strings.TrimSpace(config.APIKey)
}

func (s *Service) downloadWorkflowOutputs(ctx context.Context, urls []string) (map[string]interface{}, error) {
	images := make([]map[string]interface{}, 0)
	var video, audio map[string]interface{}
	for _, rawURL := range urls {
		if strings.HasPrefix(rawURL, "data:") {
			mimeType, data, err := decodeProviderDataURL(rawURL)
			if err != nil {
				return nil, err
			}
			if item := workflowOutputValue(mimeType, data); item != nil {
				switch value := item.(type) {
				case map[string]interface{}:
					if strings.HasPrefix(mimeType, "image/") {
						images = append(images, value)
					} else if strings.HasPrefix(mimeType, "video/") {
						video = value
					} else if strings.HasPrefix(mimeType, "audio/") {
						audio = value
					}
				}
			}
			continue
		}
		if !isPublicMediaURL(rawURL) {
			continue
		}
		data, mimeType, err := getExternalBinary(withProviderRequestKind(ctx, "download"), rawURL)
		if err != nil {
			return nil, fmt.Errorf("下载 RunningHub 产物失败：%w", err)
		}
		mimeType = runningHubOutputMimeType(rawURL, mimeType)
		item := workflowOutputValue(mimeType, data)
		if item == nil {
			continue
		}
		value := item.(map[string]interface{})
		switch {
		case strings.HasPrefix(mimeType, "image/"):
			images = append(images, value)
		case strings.HasPrefix(mimeType, "video/"):
			video = value
		case strings.HasPrefix(mimeType, "audio/"):
			audio = value
		}
	}
	result := map[string]interface{}{"mode": "image"}
	if len(images) > 0 {
		result["images"] = images
	}
	if video != nil {
		result["mode"] = "video"
		result["video"] = video
	}
	if audio != nil {
		result["mode"] = "audio"
		result["audio"] = audio
	}
	if len(images) == 0 && video == nil && audio == nil {
		return nil, errors.New("RunningHub 返回的产物类型不受支持")
	}
	return result, nil
}

func runningHubOutputMimeType(rawURL string, declared string) string {
	declared = strings.TrimSpace(strings.Split(declared, ";")[0])
	if declared != "" && declared != "application/octet-stream" {
		return declared
	}
	pathValue := rawURL
	if parsed, err := url.Parse(rawURL); err == nil && parsed.Path != "" {
		pathValue = parsed.Path
	}
	pathValue = strings.ToLower(strings.Split(pathValue, "?")[0])
	for suffix, mimeType := range map[string]string{
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
		".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".m4v": "video/mp4",
		".mp3": "audio/mpeg", ".wav": "audio/wav", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".flac": "audio/flac",
	} {
		if strings.HasSuffix(pathValue, suffix) {
			return mimeType
		}
	}
	return declared
}

func workflowOutputValue(mimeType string, data []byte) interface{} {
	mimeType = strings.TrimSpace(strings.Split(mimeType, ";")[0])
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if len(data) == 0 {
		return nil
	}
	return map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType, "bytes": len(data)}
}

func runningHubRootURL(value string) string {
	base := strings.TrimRight(strings.TrimSpace(value), "/")
	if base == "" {
		base = "https://www.runninghub.cn"
	}
	// 设置页可能保存根地址、/openapi/v2 或带尾部斜杠的任一形式；任务
	// OpenAPI 使用根地址下的 /task/openapi/*，统一剥掉 API 前缀。
	lower := strings.ToLower(base)
	for _, suffix := range []string{"/openapi/v2", "/openapi"} {
		if strings.HasSuffix(lower, suffix) {
			base = base[:len(base)-len(suffix)]
			break
		}
	}
	return strings.TrimRight(base, "/")
}

func resolveRunningHubOutputURL(root string, rawURL string) string {
	rawURL = rewriteRunningHubOutputHost(strings.TrimSpace(rawURL))
	if rawURL == "" || strings.HasPrefix(rawURL, "data:") || isPublicMediaURL(rawURL) {
		return rawURL
	}
	if strings.HasPrefix(rawURL, "//") {
		return "https:" + rawURL
	}
	if strings.HasPrefix(rawURL, "/") {
		return strings.TrimRight(root, "/") + rawURL
	}
	// API 可能返回 output/foo、assets/foo 这类无前导斜杠的相对路径。
	for _, prefix := range []string{"output/", "assets/", "input/"} {
		if strings.HasPrefix(strings.ToLower(rawURL), prefix) {
			return strings.TrimRight(root, "/") + "/" + rawURL
		}
	}
	if runningHubRelativeOutputPath(rawURL) {
		return strings.TrimRight(root, "/") + "/" + strings.TrimLeft(rawURL, "/")
	}
	return rawURL
}

// RunningHub 某些区域会返回旧 COS 域名，参考项目已将其迁移到可访问域名；
// 这里只做固定 host 映射，不接受响应内容提供任意代理目标。
func rewriteRunningHubOutputHost(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Host == "" {
		return rawURL
	}
	if strings.EqualFold(parsed.Host, "rh-images-1252422369.cos.ap-beijing.myqcloud.com") {
		parsed.Host = "rh-images.xiaoyaoyou.com"
		return parsed.String()
	}
	return rawURL
}

func runningHubTaskID(payload map[string]any) string {
	for _, keys := range [][]string{{"data", "taskId"}, {"data", "task_id"}, {"data", "taskID"}, {"data", "id"}, {"taskId"}, {"task_id"}, {"taskID"}, {"id"}} {
		if len(keys) == 2 {
			if value := nestedString(payload, keys[0], keys[1]); value != "" {
				return value
			}
		} else if value := stringValue(payload[keys[0]]); value != "" {
			return value
		}
	}
	return ""
}

func runningHubOutputURLs(value interface{}) []string {
	result := make([]string, 0)
	var visit func(interface{})
	visit = func(current interface{}) {
		switch item := current.(type) {
		case string:
			if strings.HasPrefix(item, "http://") || strings.HasPrefix(item, "https://") || strings.HasPrefix(item, "data:") || (strings.HasPrefix(item, "/") && !strings.HasPrefix(item, "//")) || runningHubRelativeOutputPath(item) {
				result = append(result, item)
			}
		case []interface{}:
			for _, child := range item {
				visit(child)
			}
		case map[string]interface{}:
			for key, child := range item {
				lowerKey := strings.ToLower(strings.TrimSpace(key))
				if lowerKey == "fileurl" || lowerKey == "file_url" || lowerKey == "url" || lowerKey == "downloadurl" || lowerKey == "download_url" || lowerKey == "src" || lowerKey == "output" || lowerKey == "outputs" || lowerKey == "results" || lowerKey == "files" || lowerKey == "data" || lowerKey == "images" || lowerKey == "videos" || lowerKey == "audio" || lowerKey == "audios" || lowerKey == "result" {
					visit(child)
				}
			}
		}
	}
	visit(value)
	seen := map[string]bool{}
	deduped := make([]string, 0, len(result))
	for _, item := range result {
		if !seen[item] {
			seen[item] = true
			deduped = append(deduped, item)
		}
	}
	return deduped
}

func runningHubRelativeOutputPath(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" || strings.Contains(value, "://") || strings.HasPrefix(value, "//") {
		return false
	}
	for _, segment := range strings.Split(strings.Split(value, "?")[0], "/") {
		if segment == ".." {
			return false
		}
	}
	for _, prefix := range []string{"output/", "assets/", "input/"} {
		if strings.HasPrefix(value, prefix) {
			return true
		}
	}
	for _, suffix := range []string{".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v", ".mp3", ".wav", ".ogg", ".m4a", ".flac"} {
		if strings.HasSuffix(strings.Split(value, "?")[0], suffix) {
			return true
		}
	}
	return false
}

func runningHubFailureMessage(payload map[string]any) string {
	for _, key := range []string{"msg", "message", "error", "failReason", "failedReason", "errorMessage"} {
		if value := stringValue(payload[key]); value != "" {
			return runningHubActionableFailureMessage(value)
		}
	}
	if nested, ok := payload["data"].(map[string]interface{}); ok {
		return runningHubFailureMessage(nested)
	}
	return "上游未提供失败原因"
}

func isWorkflowSeedField(value string) bool {
	normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "", " ", "").Replace(strings.TrimSpace(value)))
	return normalized == "seed" || strings.HasSuffix(normalized, "seed") || strings.Contains(normalized, "noiseseed")
}

func runningHubActionableFailureMessage(message string) string {
	normalized := strings.ToLower(message)
	if strings.Contains(normalized, "node_info_mismatch") || strings.Contains(normalized, "node_not_found_in_workflow") {
		return "RunningHub AI 应用的公开参数已变化，请到“设置 → RunningHub 工作流”重新选择该 App 并点击“拉取参数”后再试（上游详情：" + message + "）"
	}
	return message
}

// runningHubPayloadCode 兼容 code/statusCode 以及部分网关返回的字符串状态。
// 统一映射到 RunningHub 公开状态码：0 成功、804 运行中、813 排队中、805/806 失败。
func runningHubPayloadCode(payload map[string]any) (int, bool) {
	if payload == nil {
		return 0, false
	}
	topCode, topValid := runningHubDirectCode(payload)
	if nested, ok := payload["data"].(map[string]interface{}); ok {
		if nestedCode, nestedValid := runningHubPayloadCode(nested); nestedValid {
			// 有些网关把 HTTP 成功包装成顶层 code=0，同时把真实任务状态放在
			// data.code/status；真实任务状态优先，避免把排队任务误判成完成。
			if !topValid || topCode == 0 || nestedCode != 0 {
				return nestedCode, true
			}
		}
	}
	return topCode, topValid
}

func runningHubDirectCode(payload map[string]any) (int, bool) {
	primaryCode := 0
	primaryValid := false
	for _, key := range []string{"code", "statusCode", "status_code"} {
		if value, ok := payload[key]; ok {
			if code, valid := runningHubCode(value); valid {
				if (key == "statusCode" || key == "status_code") && code >= 200 && code < 300 {
					code = 0
				}
				primaryCode, primaryValid = code, true
				break
			}
		}
	}
	for _, key := range []string{"status", "state", "taskStatus", "task_status"} {
		if code, valid := runningHubStatusCode(payload[key]); valid {
			if !primaryValid || primaryCode == 0 || code != 0 {
				return code, true
			}
			break
		}
	}
	if primaryValid {
		return primaryCode, true
	}
	// errorCode=0 通常只是“无错误”标记，不能覆盖 data.status=running。
	for _, key := range []string{"errorCode", "error_code"} {
		if value, ok := payload[key]; ok {
			if code, valid := runningHubCode(value); valid && code != 0 {
				return code, true
			}
		}
	}
	return 0, false
}

func runningHubStatusCode(value interface{}) (int, bool) {
	text := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	if text == "" || text == "<nil>" {
		return 0, false
	}
	if numeric, ok := runningHubCode(text); ok {
		switch numeric {
		case 0, 804, 813, 805, 806:
			return numeric, true
		}
	}
	text = strings.NewReplacer("_", "", "-", "", " ", "").Replace(text)
	switch text {
	case "success", "succeeded", "complete", "completed", "done", "finished", "finish", "3":
		return 0, true
	case "queued", "queue", "pending", "waiting", "created", "submitted":
		return 813, true
	case "running", "processing", "executing", "inprogress", "started", "working", "1", "2":
		return 804, true
	case "failed", "failure", "error", "rejected", "cancelled", "canceled", "expired", "aborted", "4", "5":
		return 805, true
	default:
		return 0, false
	}
}

func nestedString(payload map[string]any, first string, second string) string {
	nested, _ := payload[first].(map[string]interface{})
	return stringValue(nested[second])
}

func runningHubFileName(payload map[string]any) string {
	for _, key := range []string{"fileName", "file_name", "filename", "name"} {
		if value := stringValue(payload[key]); value != "" {
			return value
		}
	}
	for _, container := range []string{"data", "result", "file", "files"} {
		if nested, ok := payload[container].(map[string]interface{}); ok {
			for _, key := range []string{"fileName", "file_name", "filename", "name"} {
				if value := stringValue(nested[key]); value != "" {
					return value
				}
			}
		}
	}
	return ""
}

func runningHubCode(value interface{}) (int, bool) {
	switch item := value.(type) {
	case int:
		if item < 0 {
			return 0, false
		}
		return item, true
	case int64:
		if item < 0 {
			return 0, false
		}
		return int(item), true
	case float64:
		code := int(item)
		if item < 0 || float64(code) != item {
			return 0, false
		}
		return code, true
	case json.Number, string:
		code := mapNumber(item)
		return code, code >= 0
	default:
		return 0, false
	}
}

func mapNumber(value interface{}) int {
	switch item := value.(type) {
	case int:
		return item
	case int64:
		return int(item)
	case float64:
		return int(item)
	case json.Number:
		parsed, _ := strconv.Atoi(string(item))
		return parsed
	case string:
		parsed, _ := strconv.Atoi(strings.TrimSpace(item))
		return parsed
	default:
		return -1
	}
}

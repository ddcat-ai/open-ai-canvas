// RunningHub 的云端工作流协议适配集中在这里：提交流程、上传媒体、组装节点输入。
//
// 同一协议的其余部分按职责拆分在：
//   - workflow_provider_field.go   字段定义的兼容解析
//   - workflow_provider_values.go  画布参数到节点取值的换算
//   - workflow_provider_outputs.go 轮询、输出下载与错误码翻译

package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

func isRunningHubInterface(value string) bool {
	pluginID, ok := workflowPluginIDForInterface(strings.ToLower(strings.TrimSpace(value)))
	return ok && pluginID == WorkflowPluginRunningHub
}

func isWorkflowProviderInterface(value string) bool {
	return isRunningHubInterface(value)
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
	return errors.New("未知工作流协议")
}

func workflowInterfaceSupportsMode(interfaceType string, mode string) bool {
	switch mode {
	case "image":
		return interfaceType == string(model.ChannelInterfaceRunningHubImage)
	case "video":
		return interfaceType == string(model.ChannelInterfaceRunningHubVideo)
	case "audio":
		return interfaceType == string(model.ChannelInterfaceRunningHubAudio)
	default:
		return false
	}
}

func (s *Service) runWorkflowProviderTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if isRunningHubInterface(input.Config.InterfaceType) {
		return s.runRunningHubWorkflow(ctx, input)
	}
	return nil, errors.New("未知工作流协议")
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
		return s.pollRunningHubWorkflow(ctx, input.Config, root, resumed, input.Mode)
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
	return s.pollRunningHubWorkflow(ctx, input.Config, root, taskID, input.Mode)
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

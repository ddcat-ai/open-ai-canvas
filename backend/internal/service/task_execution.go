package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

	"infinite-canvas/backend/internal/model"
)

// processTask 是任务执行阶段唯一的类型分派入口。
// 任务已经在 CreateTask 阶段完成 admission；这里不把无效视频任务降级成内部工作流成功。
func (s *Service) processTask(ctx context.Context, task model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	if err := validateTaskType(task.Type); err != nil {
		return nil, nil, err
	}
	decryptedInput, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return nil, nil, err
	}
	task.InputJSON = decryptedInput
	ctx = withTaskExecutionID(ctx, task.ID)
	ctx = withProviderAnalytics(ctx, s, task)

	if task.Type == "agent_storyboard_rows" {
		return s.processStoryboardRowsTask(ctx, task)
	}
	if task.Type == "canvas_text" || task.Type == "canvas_image" || task.Type == "canvas_video" || task.Type == "canvas_audio" {
		result, err := s.processCanvasGenerationTask(ctx, task.UserID, task.ProjectID, task.Type, task.Prompt, task.InputJSON)
		return result, nil, err
	}
	if task.Type == "agent_storyboard" {
		return s.processAgentStoryboardTask(ctx, task)
	}
	if strings.HasPrefix(task.Type, "video_") {
		if !canRunProviderTask(task) {
			return nil, nil, errors.New("视频任务缺少可执行的模型配置")
		}
		result, err := s.processCanvasGenerationTask(ctx, task.UserID, task.ProjectID, task.Type, task.Prompt, task.InputJSON)
		return result, nil, err
	}
	return nil, nil, errors.New("任务类型没有可用的执行分支")
}

func canRunProviderTask(task model.Task) bool {
	if !strings.HasPrefix(task.Type, "video_") || strings.TrimSpace(task.InputJSON) == "" {
		return false
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return false
	}
	return hasExecutableProviderVideoConfig(input)
}

func hasExecutableProviderVideoConfig(input map[string]any) bool {
	mode, _ := input["mode"].(string)
	config, ok := input["config"].(map[string]any)
	if mode != "video" || !ok {
		return false
	}
	interfaceType := stringValue(config["interfaceType"])
	if isComfyBridgeInterface(interfaceType) {
		workflowJSON, hasWorkflowJSON := config["workflowJson"]
		workflowReady := false
		if hasWorkflowJSON {
			switch value := workflowJSON.(type) {
			case map[string]interface{}:
				workflowReady = len(value) > 0
			case string:
				workflowReady = strings.TrimSpace(value) != ""
			}
		}
		return stringValue(config["bridgeId"]) != "" && (stringValue(config["workflowId"]) != "" || workflowReady)
	}
	if isRunningHubInterface(interfaceType) {
		if stringValue(config["workflowId"]) == "" && stringValue(config["webappId"]) == "" && stringValue(config["model"]) == "" {
			return false
		}
		return stringValue(config["baseUrl"]) != "" && stringValue(config["apiKey"]) != ""
	}
	if stringValue(config["model"]) == "" {
		return false
	}
	return stringValue(config["channelId"]) != "" || (stringValue(config["baseUrl"]) != "" && stringValue(config["apiKey"]) != "")
}

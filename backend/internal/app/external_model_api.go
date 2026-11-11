package app

import (
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

type ModelCallMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// 外部调用只接受生成参数；凭证、传输与任务元数据由服务端准入解析。
type ModelCallParameters struct {
	Thinking      bool   `json:"thinking,omitempty"`
	AspectRatio   string `json:"aspectRatio,omitempty"`
	Resolution    string `json:"resolution,omitempty"`
	Quality       string `json:"quality,omitempty"`
	Count         int    `json:"count,omitempty"`
	Duration      int    `json:"duration,omitempty"`
	GenerateAudio *bool  `json:"generateAudio,omitempty"`
	Watermark     *bool  `json:"watermark,omitempty"`
	Voice         string `json:"voice,omitempty"`
	AudioFormat   string `json:"audioFormat,omitempty"`
	AudioSpeed    string `json:"audioSpeed,omitempty"`
}

type CreateModelCallRequest struct {
	Model      string              `json:"model"`
	Capability string              `json:"capability,omitempty"`
	Prompt     string              `json:"prompt,omitempty"`
	Messages   []ModelCallMessage  `json:"messages,omitempty"`
	Parameters ModelCallParameters `json:"parameters,omitempty"`
	TraceID    string              `json:"-"`
	RequestID  string              `json:"-"`
}

type ModelCall struct {
	ID         string           `json:"id"`
	Model      string           `json:"model"`
	Capability string           `json:"capability"`
	Status     protocol.Status  `json:"status"`
	Result     *protocol.Result `json:"result,omitempty"`
	Reason     string           `json:"reason,omitempty"`
}

type ExternalModel struct {
	ID               string                       `json:"id"`
	Name             string                       `json:"name"`
	Capability       string                       `json:"capability"`
	Description      string                       `json:"description,omitempty"`
	OutputTokenLimit int                          `json:"outputTokenLimit,omitempty"`
	Parameters       map[string]ExternalParameter `json:"parameters"`
	Limitation       string                       `json:"limitation,omitempty"`
}

func (s *Service) ModelCallCatalog(userID string) ([]ExternalModel, error) {
	user, err := s.repo.User(userID)
	if err != nil {
		return nil, err
	}
	catalog, err := s.ModelCatalogForUser(user, nil)
	if err != nil {
		return nil, err
	}
	result := make([]ExternalModel, 0)
	for _, channel := range catalog.Channels {
		for _, m := range channel.Models {
			if m.Available {
				item, err := externalModelSpecification(channel.ID, m)
				if err != nil {
					return nil, err
				}
				result = append(result, item)
			}
		}
	}
	return result, nil
}

func modelCallTaskRequest(req CreateModelCallRequest) (CreateTaskRequest, error) {
	capability := strings.TrimSpace(req.Capability)
	if capability == "" {
		capability = "text"
	}
	switch capability {
	case "text", "image", "video", "audio":
	default:
		return CreateTaskRequest{}, BadAuthRequest("capability 必须为 text、image、video 或 audio")
	}
	channel, modelKey, ok := strings.Cut(strings.TrimSpace(req.Model), "::")
	if !ok || strings.TrimSpace(channel) == "" || strings.TrimSpace(modelKey) == "" {
		return CreateTaskRequest{}, BadAuthRequest("model 必须是 /api/model-calls/models 返回的 channelId::modelKey")
	}
	p := req.Parameters
	if p.Count < 0 || p.Count > 100 || p.Duration < 0 || p.Duration > 3600 {
		return CreateTaskRequest{}, BadAuthRequest("生成参数超出允许范围")
	}
	if capability != "text" && (len(req.Messages) > 0 || p.Thinking) {
		return CreateTaskRequest{}, BadAuthRequest("messages 和文本参数仅适用于 text")
	}
	history := make([]providerTextMessage, 0, len(req.Messages))
	var instructions []string
	for _, msg := range req.Messages {
		if (msg.Role != "system" && msg.Role != "user" && msg.Role != "assistant") || strings.TrimSpace(msg.Content) == "" {
			return CreateTaskRequest{}, BadAuthRequest("消息须包含有效 role 与非空文本 content")
		}
		if msg.Role == "system" {
			instructions = append(instructions, msg.Content)
		} else {
			history = append(history, providerTextMessage{Role: msg.Role, Content: msg.Content})
		}
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" && len(req.Messages) > 0 {
		last := req.Messages[len(req.Messages)-1]
		if last.Role != "user" {
			return CreateTaskRequest{}, BadAuthRequest("未指定 prompt 时最后一条消息须为 user")
		}
		prompt = last.Content
		history = history[:len(history)-1]
	}
	if prompt == "" {
		return CreateTaskRequest{}, BadAuthRequest("必须提供 prompt 或用户消息")
	}
	config := map[string]any{"channelId": channel, "model": modelKey}
	if len(instructions) > 0 {
		config["systemPrompt"] = strings.Join(instructions, "\n\n")
	}
	if p.AspectRatio != "" {
		config["size"] = p.AspectRatio
	}
	if p.Resolution != "" {
		if capability == "image" {
			config["imageResolution"] = p.Resolution
		} else {
			config["vquality"] = p.Resolution
		}
	}
	if p.Quality != "" {
		config["quality"] = p.Quality
	}
	if p.Count > 0 {
		config["count"] = strconv.Itoa(p.Count)
	}
	if p.Duration > 0 {
		config["videoSeconds"] = strconv.Itoa(p.Duration)
	}
	if capability == "video" {
		if p.GenerateAudio != nil {
			config["videoGenerateAudio"] = strconv.FormatBool(*p.GenerateAudio)
		}
		if p.Watermark != nil {
			config["videoWatermark"] = strconv.FormatBool(*p.Watermark)
		}
	}
	if capability == "audio" {
		config["audioVoice"] = p.Voice
		config["audioFormat"] = p.AudioFormat
		config["audioSpeed"] = p.AudioSpeed
	}
	thinkingLevel := ThinkingLevelOff
	if p.Thinking {
		thinkingLevel = ThinkingLevelMedium
	}
	input := map[string]any{"mode": capability, "prompt": prompt, "config": config, "textHistory": history, "textOptions": canvasTextOptions{ThinkingLevel: thinkingLevel}}
	return CreateTaskRequest{Type: "canvas_" + capability, Prompt: prompt, Model: modelKey, Input: input, TraceID: req.TraceID, RequestID: req.RequestID}, nil
}

func (s *Service) CreateModelCall(userID string, req CreateModelCallRequest) (*ModelCall, error) {
	taskReq, err := modelCallTaskRequest(req)
	if err != nil {
		return nil, err
	}
	task, err := s.CreateTask(userID, taskReq)
	if err != nil {
		return nil, err
	}
	return externalModelCall(*task), nil
}

func (s *Service) ModelCall(userID, id string) (*ModelCall, error) {
	task, err := s.repo.TaskForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("模型调用不存在")
	}
	if err != nil {
		return nil, err
	}
	if task.Type != "canvas_text" && task.Type != "canvas_image" && task.Type != "canvas_video" && task.Type != "canvas_audio" {
		return nil, NotFound("模型调用不存在")
	}
	return externalModelCall(*task), nil
}

func externalModelCall(task model.Task) *ModelCall {
	result := &ModelCall{ID: task.ID, Model: task.Model, Capability: strings.TrimPrefix(task.Type, "canvas_"), Status: protocol.Status(task.Status)}
	switch task.Status {
	case model.TaskStatusQueued:
		result.Status = protocol.StatusPending
	case model.TaskStatusRunning:
		result.Status = protocol.StatusProcessing
	case model.TaskStatusFailed, model.TaskStatusCancelled:
		result.Reason = taskForOutput(task).Error
	case model.TaskStatusSucceeded:
		var raw map[string]any
		_ = json.Unmarshal([]byte(task.ResultJSON), &raw)
		result.Result = &protocol.Result{Text: stringValue(raw["text"]), Reasoning: stringValue(raw["reasoning"])}
		result.Result.Images = externalCallMedia(task.ID, raw["images"])
		result.Result.Videos = externalCallMedia(task.ID, raw["video"])
		result.Result.Audios = externalCallMedia(task.ID, raw["audios"])
	}
	return result
}

func externalCallMedia(callID string, value any) []protocol.MediaReference {
	var values []any
	switch v := value.(type) {
	case []any:
		values = v
	case map[string]any:
		values = []any{v}
	}
	result := make([]protocol.MediaReference, 0, len(values))
	for _, value := range values {
		item, ok := value.(map[string]any)
		if !ok {
			continue
		}
		id := stringValue(item["resourceId"])
		if id == "" {
			continue
		}
		result = append(result, protocol.MediaReference{ID: id, URL: "/api/model-calls/" + url.PathEscape(callID) + "/media/" + url.PathEscape(id), MIMEType: stringValue(item["mimeType"])})
	}
	return result
}

func (s *Service) PrepareModelCallMediaDelivery(userID, callID, resourceID string, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	call, err := s.ModelCall(userID, callID)
	if err != nil {
		return nil, err
	}
	if call.Result != nil {
		for _, items := range [][]protocol.MediaReference{call.Result.Images, call.Result.Videos, call.Result.Audios} {
			for _, item := range items {
				if item.ID == resourceID {
					return s.PrepareResourceDelivery(userID, resourceID, options, rangeHeader)
				}
			}
		}
	}
	return nil, NotFound("模型调用产物不存在")
}

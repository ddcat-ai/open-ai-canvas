package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const apiMartVideoPollInterval = 5 * time.Second

type apiMartEnvelope struct {
	Code  *int            `json:"code"`
	Data  json.RawMessage `json:"data"`
	Msg   string          `json:"msg"`
	Error *providerError  `json:"error"`
}

func runAPIMartVideoTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	taskID := resumedProviderRequestID(ctx)
	if taskID == "" {
		body, err := apiMartVideoBody(input)
		if err != nil {
			return nil, err
		}
		data, err := requestAPIMartJSON(ctx, input.Config, http.MethodPost, "/videos/generations", body)
		if err != nil {
			return nil, err
		}
		taskID = apiMartCreatedTaskID(data)
	}
	if taskID == "" {
		return nil, errors.New("APIMart 视频接口没有返回任务 ID")
	}

	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		data, err := requestAPIMartJSON(ctx, input.Config, http.MethodGet, "/tasks/"+url.PathEscape(taskID), nil)
		if err != nil {
			return nil, err
		}
		state, err := apiMartTaskState(data)
		if err != nil {
			return nil, fmt.Errorf("APIMart 视频任务 %s 返回无效状态：%w", taskID, err)
		}
		status := strings.ToLower(strings.TrimSpace(stringField(state, "status")))
		switch status {
		case "completed", "succeeded", "success":
			videoURL := apiMartVideoResultURL(state)
			if videoURL == "" {
				return nil, fmt.Errorf("APIMart 视频任务 %s 已完成但没有返回视频地址", taskID)
			}
			videoData, mimeType, err := getExternalBinary(withProviderRequestKind(ctx, "download"), videoURL)
			if err != nil {
				return nil, fmt.Errorf("APIMart 视频结果下载失败（任务 %s）：%w", taskID, err)
			}
			mimeType = normalizedMediaMimeType(mimeType, videoData)
			video := map[string]interface{}{"dataUrl": dataURL(mimeType, videoData), "mimeType": mimeType}
			if lastFrameURL := apiMartLastFrameURL(state); lastFrameURL != "" {
				video["lastFrameUrl"] = lastFrameURL
			}
			return map[string]interface{}{"mode": "video", "video": video}, nil
		case "failed", "cancelled", "canceled":
			return nil, fmt.Errorf("APIMart 视频生成失败（任务 %s）：%s", taskID, defaultString(apiMartTaskErrorMessage(state), "上游返回失败"))
		case "", "pending", "processing", "submitted", "queued", "running":
			// APIMart 任务刚入队时可能暂时没有状态，继续按官方间隔轮询。
		default:
			return nil, fmt.Errorf("APIMart 视频任务 %s 返回未知状态：%s", taskID, status)
		}
		if err := sleepContext(ctx, apiMartVideoPollInterval); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("APIMart 视频生成超时（任务 %s）", taskID)
}

func apiMartVideoBody(input canvasGenerationInput) (map[string]interface{}, error) {
	if len(input.ReferenceImages) > 9 || len(input.ReferenceVideos) > 3 || len(input.ReferenceAudios) > 3 {
		return nil, errors.New("APIMart 视频最多支持 9 张参考图、3 个参考视频和 3 个参考音频")
	}

	imageURLs := make([]string, 0, len(input.ReferenceImages))
	for _, image := range input.ReferenceImages {
		mediaURL, err := apiMartVideoMediaURL(image, "参考图")
		if err != nil {
			return nil, err
		}
		imageURLs = append(imageURLs, mediaURL)
	}
	videoURLs := make([]string, 0, len(input.ReferenceVideos))
	for _, video := range input.ReferenceVideos {
		mediaURL, err := apiMartVideoMediaURL(video, "参考视频")
		if err != nil {
			return nil, err
		}
		videoURLs = append(videoURLs, mediaURL)
	}
	audioURLs := make([]string, 0, len(input.ReferenceAudios))
	for _, audio := range input.ReferenceAudios {
		mediaURL, err := apiMartVideoMediaURL(audio, "参考音频")
		if err != nil {
			return nil, err
		}
		audioURLs = append(audioURLs, mediaURL)
	}

	body := map[string]interface{}{
		"model":          input.Config.Model,
		"prompt":         strings.TrimSpace(input.Prompt),
		"duration":       normalizeAPIMartVideoDuration(input.Config.VideoSeconds),
		"size":           normalizeSeedanceRatio(input.Config.Size),
		"resolution":     normalizeSeedanceResolution(input.Config.VQuality, input.Config.Model),
		"generate_audio": parseBool(input.Config.VideoGenerateAudio, true),
	}
	if isAPIMartSeedance2Model(input.Config.Model) {
		body["return_last_frame"] = true
	}

	startFrameID := metadataString(input.Metadata, "videoStartFrameNodeId")
	endFrameID := metadataString(input.Metadata, "videoEndFrameNodeId")
	if startFrameID != "" || endFrameID != "" {
		if len(videoURLs) > 0 || len(audioURLs) > 0 {
			return nil, errors.New("APIMart 首尾帧模式不能同时使用参考视频或参考音频")
		}
		if startFrameID != "" && startFrameID == endFrameID {
			return nil, errors.New("APIMart 首帧和尾帧不能选择同一张图片")
		}
		roles, err := apiMartImageRoles(input, imageURLs, startFrameID, endFrameID)
		if err != nil {
			return nil, err
		}
		body["image_with_roles"] = roles
		return body, nil
	}

	if len(imageURLs) > 0 {
		body["image_urls"] = imageURLs
	}
	if len(videoURLs) > 0 {
		body["video_urls"] = videoURLs
	}
	if len(audioURLs) > 0 {
		if len(imageURLs) == 0 && len(videoURLs) == 0 {
			return nil, errors.New("APIMart 参考音频不能单独使用，请同时添加参考图或参考视频")
		}
		body["audio_urls"] = audioURLs
	}
	return body, nil
}

func apiMartImageRoles(input canvasGenerationInput, imageURLs []string, startFrameID string, endFrameID string) ([]map[string]string, error) {
	if len(imageURLs) == 0 {
		return nil, errors.New("APIMart 首尾帧模式需要连接对应的参考图")
	}
	roles := make([]map[string]string, 0, len(imageURLs))
	foundStart := startFrameID == ""
	foundEnd := endFrameID == ""
	for index, image := range input.ReferenceImages {
		if index >= len(imageURLs) {
			break
		}
		role := "reference_image"
		if startFrameID != "" && image.ID == startFrameID {
			role = "first_frame"
			foundStart = true
		} else if endFrameID != "" && image.ID == endFrameID {
			role = "last_frame"
			foundEnd = true
		} else if !strings.HasPrefix(strings.ToLower(imageURLs[index]), "asset://") {
			return nil, errors.New("APIMart 首尾帧模式不能混用普通参考图；额外人物参考请使用 APIMart asset:// 素材")
		}
		roles = append(roles, map[string]string{"url": imageURLs[index], "role": role})
	}
	if !foundStart || !foundEnd {
		return nil, errors.New("APIMart 首尾帧选择已失效，请重新选择已连接的图片")
	}
	return roles, nil
}

func apiMartVideoMediaURL(media providerMedia, label string) (string, error) {
	value := strings.TrimSpace(firstNonEmpty(media.URL, media.DataURL))
	if strings.HasPrefix(strings.ToLower(value), "asset://") {
		return value, nil
	}
	if !isPublicMediaURL(value) {
		return "", fmt.Errorf("APIMart 的%s需要公网 HTTP(S)、OSS 签名地址或 asset:// 素材", label)
	}
	if _, err := ValidateOutboundURL(value); err != nil {
		return "", err
	}
	return value, nil
}

func normalizeAPIMartVideoDuration(value string) int {
	seconds, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || seconds == 0 {
		seconds = 5
	}
	if seconds < 5 {
		return 5
	}
	if seconds > 15 {
		return 15
	}
	return seconds
}

func isAPIMartSeedance2Model(modelName string) bool {
	value := strings.ToLower(strings.TrimSpace(modelName))
	return strings.Contains(value, "seedance-2.0") || strings.Contains(value, "seedance-2-0")
}

func requestAPIMartJSON(ctx context.Context, config providerConfig, method string, path string, body interface{}) (json.RawMessage, error) {
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, apiURL(config.BaseURL, path), reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+config.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	data, mimeType, err := doBinary(req)
	if err != nil {
		var httpErr providerHTTPError
		if errors.As(err, &httpErr) {
			var failure apiMartEnvelope
			if json.Unmarshal([]byte(httpErr.Body), &failure) == nil {
				if failure.Error != nil && strings.TrimSpace(failure.Error.Message) != "" {
					return nil, errors.New(failure.Error.Message)
				}
				if strings.TrimSpace(failure.Msg) != "" {
					return nil, errors.New(failure.Msg)
				}
			}
		}
		return nil, err
	}
	if !strings.Contains(mimeType, "json") && !json.Valid(data) {
		return nil, fmt.Errorf("APIMart 接口返回非 JSON 内容：%s", mimeType)
	}
	var envelope apiMartEnvelope
	if err := json.Unmarshal(data, &envelope); err != nil {
		return nil, err
	}
	if envelope.Error != nil && strings.TrimSpace(envelope.Error.Message) != "" {
		return nil, errors.New(envelope.Error.Message)
	}
	if envelope.Code != nil && *envelope.Code != http.StatusOK {
		return nil, errors.New(defaultString(strings.TrimSpace(envelope.Msg), fmt.Sprintf("APIMart 请求失败（业务码 %d）", *envelope.Code)))
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil, errors.New("APIMart 接口没有返回 data")
	}
	return envelope.Data, nil
}

func apiMartCreatedTaskID(data json.RawMessage) string {
	var items []map[string]interface{}
	if json.Unmarshal(data, &items) == nil && len(items) > 0 {
		return firstNonEmptyString(stringField(items[0], "task_id"), stringField(items[0], "id"))
	}
	var item map[string]interface{}
	if json.Unmarshal(data, &item) == nil {
		return firstNonEmptyString(stringField(item, "task_id"), stringField(item, "id"))
	}
	return ""
}

func apiMartTaskState(data json.RawMessage) (map[string]interface{}, error) {
	var state map[string]interface{}
	if err := json.Unmarshal(data, &state); err != nil {
		return nil, err
	}
	if state == nil {
		return nil, errors.New("任务状态为空")
	}
	return state, nil
}

func apiMartVideoResultURL(state map[string]interface{}) string {
	result, _ := state["result"].(map[string]interface{})
	videos, _ := result["videos"].([]interface{})
	for _, item := range videos {
		video, _ := item.(map[string]interface{})
		for _, key := range []string{"url", "video_url", "videoUrl"} {
			if mediaURL := apiMartURLValue(video[key]); mediaURL != "" {
				return mediaURL
			}
		}
	}
	return ""
}

func apiMartLastFrameURL(state map[string]interface{}) string {
	result, _ := state["result"].(map[string]interface{})
	for _, key := range []string{"last_frame_url", "lastFrameUrl"} {
		if mediaURL := apiMartURLValue(result[key]); mediaURL != "" {
			return mediaURL
		}
	}
	videos, _ := result["videos"].([]interface{})
	for _, item := range videos {
		video, _ := item.(map[string]interface{})
		for _, key := range []string{"last_frame_url", "lastFrameUrl"} {
			if mediaURL := apiMartURLValue(video[key]); mediaURL != "" {
				return mediaURL
			}
		}
	}
	return ""
}

func apiMartURLValue(value interface{}) string {
	switch typed := value.(type) {
	case string:
		candidate := strings.TrimSpace(typed)
		if isPublicMediaURL(candidate) {
			return candidate
		}
	case []interface{}:
		for _, item := range typed {
			if candidate := apiMartURLValue(item); candidate != "" {
				return candidate
			}
		}
	case []string:
		for _, item := range typed {
			if candidate := apiMartURLValue(item); candidate != "" {
				return candidate
			}
		}
	}
	return ""
}

func apiMartTaskErrorMessage(state map[string]interface{}) string {
	if errorValue, ok := state["error"].(map[string]interface{}); ok {
		message := strings.TrimSpace(stringField(errorValue, "message"))
		if message != "" {
			if rawCode := errorValue["code"]; rawCode != nil {
				if code := strings.TrimSpace(fmt.Sprint(rawCode)); code != "" {
					return code + "：" + message
				}
			}
			return message
		}
	}
	return firstNonEmptyString(stringField(state, "fail_reason"), stringField(state, "message"))
}

package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/volcengine/volc-sdk-golang/base"
)

const (
	jiMengSubmitAction = "CVSync2AsyncSubmitTask"
	jiMengResultAction = "CVSync2AsyncGetResult"
	jiMengAPIVersion   = "2022-08-31"
)

type jiMengResponse struct {
	Code      int    `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id"`
	Data      struct {
		TaskID           string   `json:"task_id"`
		Status           string   `json:"status"`
		BinaryDataBase64 []string `json:"binary_data_base64"`
		ImageURLs        []string `json:"image_urls"`
		VideoURL         string   `json:"video_url"`
	} `json:"data"`
}

func isVolcengineJiMengProtocol(protocol string) bool {
	return protocol == "volcengine-jimeng-image" || protocol == "volcengine-jimeng-video"
}

func runVolcengineJiMengImageTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if input.Mask != nil {
		return nil, errors.New("即梦图片协议不支持蒙版编辑，请移除蒙版后重试")
	}
	body := map[string]interface{}{
		"req_key":      input.Config.Model,
		"prompt":       withSystemPrompt(input.Config, input.Prompt),
		"force_single": true,
	}
	if width, height := jiMengImageDimensions(input.Config.Size); width > 0 && height > 0 {
		body["width"] = width
		body["height"] = height
	}
	if len(input.ReferenceImages) > 14 {
		return nil, errors.New("即梦图片协议最多支持 14 张参考图")
	}
	if len(input.ReferenceImages) > 0 {
		images := make([]string, 0, len(input.ReferenceImages))
		for _, image := range input.ReferenceImages {
			raw, _, err := mediaBytes(image)
			if err != nil {
				return nil, fmt.Errorf("读取即梦参考图失败：%w", err)
			}
			images = append(images, base64.StdEncoding.EncodeToString(raw))
		}
		body["binary_data_base64"] = images
	}

	taskID, err := submitJiMengTask(ctx, input.Config, body)
	if err != nil {
		return nil, err
	}
	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		result, err := pollJiMengTask(ctx, input.Config, taskID, `{"return_url":true}`)
		if err != nil {
			return nil, err
		}
		switch strings.ToLower(strings.TrimSpace(result.Data.Status)) {
		case "done":
			images, err := jiMengImageDataURLs(ctx, result)
			if err != nil {
				return nil, fmt.Errorf("即梦图片任务 %s 结果读取失败：%w", taskID, err)
			}
			return map[string]interface{}{"mode": "image", "images": images}, nil
		case "not_found", "expired":
			return nil, fmt.Errorf("即梦图片任务 %s 已失效，请重新生成", taskID)
		}
		if err := sleepContext(ctx, 3*time.Second); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("即梦图片生成超时（任务 %s）", taskID)
}

func runVolcengineJiMengVideoTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if len(input.ReferenceImages) > 1 || len(input.ReferenceVideos) > 0 || len(input.ReferenceAudios) > 0 {
		return nil, errors.New("即梦视频协议只支持一张首帧图，不支持参考视频或音频")
	}
	frames, err := jiMengVideoFrames(input.Config.VideoSeconds)
	if err != nil {
		return nil, err
	}
	body := map[string]interface{}{
		"req_key": input.Config.Model,
		"prompt":  strings.TrimSpace(input.Prompt),
		"frames":  frames,
	}
	if len(input.ReferenceImages) == 0 {
		body["aspect_ratio"] = jiMengVideoAspectRatio(input.Config.Size)
	} else {
		raw, _, err := mediaBytes(input.ReferenceImages[0])
		if err != nil {
			return nil, fmt.Errorf("读取即梦视频首帧图失败：%w", err)
		}
		body["binary_data_base64"] = []string{base64.StdEncoding.EncodeToString(raw)}
	}

	taskID, err := submitJiMengTask(ctx, input.Config, body)
	if err != nil {
		return nil, err
	}
	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		result, err := pollJiMengTask(ctx, input.Config, taskID, "")
		if err != nil {
			return nil, err
		}
		switch strings.ToLower(strings.TrimSpace(result.Data.Status)) {
		case "done":
			videoURL := strings.TrimSpace(result.Data.VideoURL)
			if videoURL == "" {
				return nil, fmt.Errorf("即梦视频任务 %s 已完成但没有返回视频地址", taskID)
			}
			data, mimeType, err := getExternalBinary(withProviderRequestKind(ctx, "download"), videoURL)
			if err != nil {
				return nil, fmt.Errorf("即梦视频任务 %s 下载失败：%w", taskID, err)
			}
			mimeType = normalizedMediaMimeType(mimeType, data)
			return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
		case "not_found", "expired":
			return nil, fmt.Errorf("即梦视频任务 %s 已失效，请重新生成", taskID)
		}
		if err := sleepContext(ctx, 5*time.Second); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("即梦视频生成超时（任务 %s）", taskID)
}

func submitJiMengTask(ctx context.Context, config providerConfig, body map[string]interface{}) (string, error) {
	if resumed := resumedProviderRequestID(ctx); resumed != "" {
		return resumed, nil
	}
	var payload jiMengResponse
	if err := postJiMengJSON(withProviderRequestKind(ctx, "create"), config, jiMengSubmitAction, body, &payload); err != nil {
		return "", err
	}
	if err := validateJiMengResponse(payload); err != nil {
		return "", err
	}
	taskID := strings.TrimSpace(payload.Data.TaskID)
	if taskID == "" {
		return "", errors.New("即梦接口没有返回任务 ID")
	}
	return taskID, nil
}

func pollJiMengTask(ctx context.Context, config providerConfig, taskID string, reqJSON string) (jiMengResponse, error) {
	body := map[string]interface{}{"req_key": config.Model, "task_id": taskID}
	if reqJSON != "" {
		body["req_json"] = reqJSON
	}
	var payload jiMengResponse
	if err := postJiMengJSON(withProviderRequestKind(ctx, "poll"), config, jiMengResultAction, body, &payload); err != nil {
		return payload, err
	}
	return payload, validateJiMengResponse(payload)
}

func postJiMengJSON(ctx context.Context, config providerConfig, action string, body interface{}, target interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		return err
	}
	endpoint, err := url.Parse(strings.TrimSpace(config.BaseURL))
	if err != nil {
		return err
	}
	endpoint.Path = "/"
	query := endpoint.Query()
	query.Set("Action", action)
	query.Set("Version", jiMengAPIVersion)
	endpoint.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(data))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	ApplyOutboundHeaders(req, config.Headers)
	ApplyDefaultOutboundHeaders(req)
	credentials := base.Credentials{
		AccessKeyID:     strings.TrimSpace(config.APIKey),
		SecretAccessKey: strings.TrimSpace(config.SecretKey),
		Region:          "cn-north-1",
		Service:         "cv",
	}
	return doJSON(credentials.Sign(req), target)
}

func validateJiMengResponse(payload jiMengResponse) error {
	if payload.Code == 10000 {
		return nil
	}
	message := strings.TrimSpace(payload.Message)
	if message == "" {
		message = "未知错误"
	}
	if payload.RequestID != "" {
		return fmt.Errorf("即梦接口返回错误 %d：%s（request_id: %s）", payload.Code, message, payload.RequestID)
	}
	return fmt.Errorf("即梦接口返回错误 %d：%s", payload.Code, message)
}

func jiMengImageDataURLs(ctx context.Context, payload jiMengResponse) ([]string, error) {
	images := make([]string, 0, len(payload.Data.ImageURLs)+len(payload.Data.BinaryDataBase64))
	for _, rawURL := range payload.Data.ImageURLs {
		data, mimeType, err := getExternalBinary(withProviderRequestKind(ctx, "download"), rawURL)
		if err != nil {
			return nil, err
		}
		images = append(images, dataURL(normalizedMediaMimeType(mimeType, data), data))
	}
	for _, encoded := range payload.Data.BinaryDataBase64 {
		data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
		if err != nil {
			return nil, err
		}
		images = append(images, dataURL(normalizedMediaMimeType("image/png", data), data))
	}
	if len(images) == 0 {
		return nil, errors.New("任务已完成但没有返回图片")
	}
	return images, nil
}

func jiMengImageDimensions(value string) (int, int) {
	parts := strings.Split(strings.ToLower(normalizePixelSize(value)), "x")
	if len(parts) != 2 {
		return 0, 0
	}
	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return 0, 0
	}
	area := int64(width) * int64(height)
	if area < 1024*1024 || area > 4096*4096 {
		return 0, 0
	}
	return width, height
}

func jiMengVideoFrames(value string) (int, error) {
	seconds, _ := strconv.Atoi(strings.TrimSpace(value))
	switch seconds {
	case 5:
		return 121, nil
	case 10:
		return 241, nil
	default:
		return 0, errors.New("即梦视频仅支持 5 秒或 10 秒，请调整视频时长")
	}
}

func jiMengVideoAspectRatio(value string) string {
	allowed := []string{"16:9", "4:3", "1:1", "3:4", "9:16", "21:9"}
	value = strings.TrimSpace(value)
	for _, candidate := range allowed {
		if value == candidate {
			return candidate
		}
	}
	parts := strings.Split(strings.ToLower(value), "x")
	if len(parts) != 2 {
		return "16:9"
	}
	width, widthErr := strconv.ParseFloat(parts[0], 64)
	height, heightErr := strconv.ParseFloat(parts[1], 64)
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return "16:9"
	}
	ratio := width / height
	best := allowed[0]
	bestDistance := math.MaxFloat64
	for _, candidate := range allowed {
		parts := strings.Split(candidate, ":")
		left, _ := strconv.ParseFloat(parts[0], 64)
		right, _ := strconv.ParseFloat(parts[1], 64)
		if distance := math.Abs(ratio - left/right); distance < bestDistance {
			best = candidate
			bestDistance = distance
		}
	}
	return best
}

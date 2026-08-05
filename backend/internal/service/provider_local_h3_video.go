package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"mime/multipart"
	"strconv"
	"strings"
	"time"
)

// Local MiniMax H3（Mac 薄网关）视频协议：
// 创建优先走 multipart /video/generations/upload，参考图直接上传，无需先公网 OSS。
// 轮询与结果字段兼容 OpenAI/NewAPI Video Generations 风格。

const localH3VideoPollInterval = 5 * time.Second

func runLocalH3VideoTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if err := validateLocalH3VideoInput(input); err != nil {
		return nil, err
	}

	id := resumedProviderRequestID(ctx)
	var created map[string]interface{}
	if id == "" {
		body, contentType, err := localH3VideoUploadBody(input)
		if err != nil {
			return nil, err
		}
		if err := postForm(ctx, input.Config, "/video/generations/upload", contentType, body, &created); err != nil {
			return nil, err
		}
		id = firstNonEmptyString(stringField(created, "task_id"), stringField(created, "id"))
		if id == "" {
			if data, ok := created["data"].(map[string]interface{}); ok {
				id = firstNonEmptyString(stringField(data, "task_id"), stringField(data, "id"))
			}
		}
	}
	if id == "" {
		return nil, errors.New("Local H3 视频接口没有返回任务 ID")
	}

	for deadline := providerPollingDeadline(ctx); time.Now().Before(deadline); {
		result, err := queryLocalH3VideoTask(ctx, input, id)
		if err != nil {
			return nil, err
		}
		if result != nil {
			return result, nil
		}
		if err := sleepContext(ctx, localH3VideoPollInterval); err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("Local H3 视频生成超时（任务 %s）", id)
}

func validateLocalH3VideoInput(input canvasGenerationInput) error {
	if len(input.ReferenceImages) > 9 || len(input.ReferenceVideos) > 3 || len(input.ReferenceAudios) > 3 {
		return errors.New("Local H3 视频最多支持 9 张参考图、3 个参考视频和 3 个参考音频")
	}
	if len(input.ReferenceAudios) > 0 && len(input.ReferenceImages) == 0 && len(input.ReferenceVideos) == 0 {
		return errors.New("Local H3 参考音频不能单独使用，请同时添加参考图或参考视频")
	}
	return nil
}

func localH3VideoUploadBody(input canvasGenerationInput) (*bytes.Buffer, string, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	writeField(writer, "prompt", strings.TrimSpace(input.Prompt))
	writeField(writer, "model", defaultString(strings.TrimSpace(input.Config.Model), "minimax-h3-r2v-sage"))
	writeField(writer, "seconds", strconv.Itoa(normalizeLocalH3VideoSeconds(input.Config.VideoSeconds)))
	if size := normalizeLocalH3VideoSize(input.Config.Size, input.Config.VQuality); size != "" {
		writeField(writer, "size", size)
	}
	if ratio := normalizeLocalH3AspectRatio(input.Config.Size); ratio != "" {
		writeField(writer, "aspect_ratio", ratio)
	}
	// 本地 H3 默认开启图内 enhancer；用户可在渠道侧另配。
	writeField(writer, "use_enhancer", "true")
	if input.Config.VideoGenerateAudio != "" {
		writeField(writer, "generate_audio", strconv.FormatBool(parseBool(input.Config.VideoGenerateAudio, true)))
	}

	for _, image := range input.ReferenceImages {
		if err := writeLocalH3MediaPart(writer, "images", image); err != nil {
			_ = writer.Close()
			return nil, "", err
		}
	}
	for _, video := range input.ReferenceVideos {
		if err := writeLocalH3MediaPart(writer, "videos", video); err != nil {
			_ = writer.Close()
			return nil, "", err
		}
	}
	for _, audio := range input.ReferenceAudios {
		if err := writeLocalH3MediaPart(writer, "audios", audio); err != nil {
			_ = writer.Close()
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return body, writer.FormDataContentType(), nil
}

func writeLocalH3MediaPart(writer *multipart.Writer, field string, media providerMedia) error {
	if strings.HasPrefix(strings.TrimSpace(firstNonEmpty(media.DataURL, media.URL)), "data:") {
		return writeMediaPart(writer, field, media)
	}
	// 已 hydrate 的本地资源一般是 data URL；若仅有可访问 HTTP(S)，先拉成二进制再塞 multipart。
	rawURL := strings.TrimSpace(firstNonEmpty(media.URL, media.DataURL))
	if !strings.HasPrefix(strings.ToLower(rawURL), "http://") && !strings.HasPrefix(strings.ToLower(rawURL), "https://") {
		return fmt.Errorf("Local H3 参考素材无法读取（缺少 data URL 或 HTTP 地址）")
	}
	raw, mimeType, err := getExternalBinary(context.Background(), rawURL)
	if err != nil {
		return fmt.Errorf("Local H3 拉取参考素材失败：%w", err)
	}
	mimeType = normalizedMediaMimeType(firstNonEmpty(media.MimeType, media.Type, mimeType), raw)
	return writeMediaPart(writer, field, providerMedia{
		ID:      media.ID,
		Name:    media.Name,
		Type:    mimeType,
		DataURL: dataURL(mimeType, raw),
	})
}

func queryLocalH3VideoTask(ctx context.Context, input canvasGenerationInput, id string) (map[string]interface{}, error) {
	var payload map[string]interface{}
	if err := getJSON(ctx, input.Config, "/video/generations/"+id, &payload); err != nil {
		return nil, err
	}
	state := payload
	if data, ok := payload["data"].(map[string]interface{}); ok {
		state = data
	}
	status := strings.ToUpper(strings.TrimSpace(stringField(state, "status")))
	switch status {
	case "SUCCESS", "SUCCEEDED", "COMPLETED", "DONE":
		videoURL := firstNonEmptyString(stringField(state, "result_url"), stringField(state, "video_url"), stringField(state, "url"))
		if videoURL == "" {
			return nil, fmt.Errorf("Local H3 视频任务 %s 已成功但没有返回视频地址", id)
		}
		data, mimeType, err := getExternalBinary(withProviderRequestKind(ctx, "download"), videoURL)
		if err != nil {
			// 部分部署 result_url 是相对路径或同主机 /v1/files/{id}
			if relative, relErr := localH3AbsoluteResultURL(input.Config.BaseURL, videoURL); relErr == nil && relative != videoURL {
				data, mimeType, err = getExternalBinary(withProviderRequestKind(ctx, "download"), relative)
			}
			if err != nil {
				// 回退：直接用网关 files 接口
				if fileData, fileMime, fileErr := getBinary(withProviderRequestKind(ctx, "download"), input.Config, "/files/"+id); fileErr == nil {
					return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(normalizedMediaMimeType(fileMime, fileData), fileData), "mimeType": normalizedMediaMimeType(fileMime, fileData)}}, nil
				}
				return nil, fmt.Errorf("Local H3 视频结果下载失败（任务 %s）：%w", id, err)
			}
		}
		mimeType = normalizedMediaMimeType(mimeType, data)
		return map[string]interface{}{"mode": "video", "video": map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}}, nil
	case "FAILURE", "FAILED", "CANCELLED", "CANCELED":
		reason := firstNonEmptyString(stringField(state, "fail_reason"), stringField(state, "error"), stringField(state, "message"))
		return nil, fmt.Errorf("Local H3 视频生成失败（任务 %s）：%s", id, defaultString(reason, "上游返回失败"))
	case "QUEUED", "IN_PROGRESS", "SUBMITTED", "PENDING", "PROCESSING", "RUNNING", "NOT_START", "":
		return nil, nil
	default:
		return nil, fmt.Errorf("Local H3 视频任务 %s 返回未知状态：%s", id, status)
	}
}

func localH3AbsoluteResultURL(baseURL string, resultURL string) (string, error) {
	resultURL = strings.TrimSpace(resultURL)
	if strings.HasPrefix(strings.ToLower(resultURL), "http://") || strings.HasPrefix(strings.ToLower(resultURL), "https://") {
		return resultURL, nil
	}
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		return "", errors.New("缺少 base URL")
	}
	if strings.HasPrefix(resultURL, "/") {
		// base 可能带 /v1
		if strings.HasSuffix(base, "/v1") && strings.HasPrefix(resultURL, "/v1/") {
			return strings.TrimSuffix(base, "/v1") + resultURL, nil
		}
		if !strings.HasSuffix(base, "/v1") && strings.HasPrefix(resultURL, "/v1/") {
			return base + resultURL, nil
		}
		return base + resultURL, nil
	}
	return base + "/" + resultURL, nil
}

func normalizeLocalH3VideoSeconds(value string) int {
	seconds, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || seconds < 1 {
		return 5
	}
	if seconds > 15 {
		return 15
	}
	return seconds
}

func normalizeLocalH3VideoSize(size string, quality string) string {
	raw := strings.ToLower(strings.TrimSpace(firstNonEmpty(quality, size)))
	switch raw {
	case "480", "480p", "low":
		return "480p"
	case "720", "720p", "high", "standard":
		return "720p"
	case "1080", "1080p":
		return "1080p"
	}
	if strings.Contains(raw, "x") {
		// 720x1280 等交给 aspect_ratio；size 仍给一个档
		return "720p"
	}
	if raw == "" {
		return "480p"
	}
	return raw
}

func normalizeLocalH3AspectRatio(size string) string {
	raw := strings.TrimSpace(size)
	if strings.Contains(raw, "x") {
		parts := strings.SplitN(raw, "x", 2)
		width, widthErr := strconv.Atoi(parts[0])
		height, heightErr := strconv.Atoi(parts[1])
		if widthErr == nil && heightErr == nil && width > 0 && height > 0 {
			switch {
			case width == height:
				return "1:1"
			case width > height:
				return "16:9"
			default:
				return "9:16"
			}
		}
	}
	switch raw {
	case "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3":
		return raw
	default:
		return "16:9"
	}
}

package app

// 图片生成（OpenAI / Claude / Gemini / Grok 等手写路径）。

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/model"
)

func runImageTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if _, ok := declarativeProtocolAdapterForContext(ctx, input.Config.InterfaceType); ok {
		return runDeclarativeProtocolTask(ctx, input)
	}
	if input.Config.InterfaceType == string(model.ChannelInterfaceGrokImage) {
		return runGrokImageTask(ctx, input)
	}
	if input.Config.InterfaceType == string(model.ChannelInterfaceVolcengineJiMengImage) {
		return runVolcengineJiMengImageTask(ctx, input)
	}
	if input.Config.InterfaceType == string(model.ChannelInterfaceVolcengineArkImage) {
		return runVolcengineArkImageTask(ctx, input)
	}
	if input.Config.InterfaceType == string(model.ChannelInterfaceGeminiImage) {
		return runGeminiImageTask(ctx, input)
	}
	var payload imageResponse
	if input.Mask != nil {
		// 蒙版编辑是强校验写路径：协议能力不明确时必须失败，不能静默退化为整图重绘。
		if strings.TrimSpace(input.Config.InterfaceType) != string(model.ChannelInterfaceOpenAIImage) {
			return nil, errors.New("当前渠道未声明 OpenAI Images 编辑协议，已拒绝可能忽略蒙版的整图重绘")
		}
		if len(input.ReferenceImages) == 0 {
			return nil, errors.New("蒙版编辑必须提供与蒙版同尺寸的源图片")
		}
	}
	if len(input.ReferenceImages) > 0 || input.Mask != nil {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		writeField(writer, "model", input.Config.Model)
		writeField(writer, "prompt", withSystemPrompt(input.Config, input.Prompt))
		writeField(writer, "n", "1")
		if imageParameterSupported(input.ImageCapability, "response_format") {
			writeField(writer, "response_format", "b64_json")
		}
		if imageParameterSupported(input.ImageCapability, "output_format") {
			writeField(writer, "output_format", "png")
		}
		if imageTransparentBackgroundSupported(input.ImageCapability) && input.Config.TransparentBackground == "true" {
			writeField(writer, "background", "transparent")
		}
		if imageQualitySupported(input.ImageCapability) && input.Config.Quality != "" && !strings.EqualFold(strings.TrimSpace(input.Config.Quality), "auto") {
			writeField(writer, "quality", normalizeImageQuality(input.Config.Quality))
		}
		if key, value := imageSizeParameter(input.ImageCapability, input.Config.Size); value != "" {
			writeField(writer, key, value)
		}
		for _, image := range input.ReferenceImages {
			if err := writeMediaPart(writer, "image", image); err != nil {
				return nil, err
			}
		}
		if input.Mask != nil {
			if err := writeMediaPart(writer, "mask", *input.Mask); err != nil {
				return nil, err
			}
		}
		if err := writer.Close(); err != nil {
			return nil, err
		}
		if err := postForm(ctx, input.Config, "/images/edits", writer.FormDataContentType(), body, &payload); err != nil {
			return nil, err
		}
	} else {
		body := map[string]interface{}{
			"model":  input.Config.Model,
			"prompt": withSystemPrompt(input.Config, input.Prompt),
			"n":      1,
		}
		if imageParameterSupported(input.ImageCapability, "response_format") {
			body["response_format"] = "b64_json"
		}
		if imageParameterSupported(input.ImageCapability, "output_format") {
			body["output_format"] = "png"
		}
		if imageTransparentBackgroundSupported(input.ImageCapability) && input.Config.TransparentBackground == "true" {
			body["background"] = "transparent"
		}
		if imageQualitySupported(input.ImageCapability) && input.Config.Quality != "" && !strings.EqualFold(strings.TrimSpace(input.Config.Quality), "auto") {
			body["quality"] = normalizeImageQuality(input.Config.Quality)
		}
		if key, value := imageSizeParameter(input.ImageCapability, input.Config.Size); value != "" {
			body[key] = value
		}
		if err := postJSON(ctx, input.Config, "/images/generations", body, &payload); err != nil {
			return nil, err
		}
	}
	images, err := imageDataURLs(payload)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"mode": "image", "images": images}, nil
}

func runGeminiImageTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if input.Mask != nil {
		return nil, errors.New("Gemini Images 不支持蒙版编辑，请移除蒙版后重试")
	}
	if len(input.ReferenceVideos) > 0 || len(input.ReferenceAudios) > 0 {
		return nil, errors.New("Gemini Images 不支持参考视频或音频")
	}

	parts := make([]geminiImageContentPart, 0, 1+len(input.ReferenceImages))
	if prompt := strings.TrimSpace(input.Prompt); prompt != "" {
		parts = append(parts, geminiImageContentPart{Text: prompt})
	}
	for _, image := range input.ReferenceImages {
		raw, mimeType, err := geminiImageBytes(image)
		if err != nil {
			return nil, fmt.Errorf("读取 Gemini Images 参考图失败：%w", err)
		}
		parts = append(parts, geminiImageContentPart{InlineData: &geminiImageInlineData{MIMEType: mimeType, Data: base64.StdEncoding.EncodeToString(raw)}})
	}
	if len(parts) == 0 {
		return nil, errors.New("Gemini Images 请求缺少提示词或参考图")
	}

	body := geminiImageRequest{
		Contents: []geminiImageContent{{Role: "user", Parts: parts}},
		GenerationConfig: geminiImageGenerationConfig{
			ResponseModalities: []string{"TEXT", "IMAGE"},
			ImageConfig:        geminiImageConfigFor(input.Config),
		},
	}
	if systemPrompt := strings.TrimSpace(input.Config.SystemPrompt); systemPrompt != "" {
		body.SystemInstruction = &geminiImageContent{Parts: []geminiImageContentPart{{Text: systemPrompt}}}
	}
	var payload map[string]interface{}
	path := "/models/" + url.PathEscape(input.Config.Model) + ":generateContent"
	if err := postGeminiJSON(ctx, input.Config, path, body, &payload); err != nil {
		return nil, err
	}
	images, err := geminiImageDataURLs(payload)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"mode": "image", "images": images}, nil
}

func geminiImageConfigFor(config providerConfig) *geminiImageConfig {
	imageConfig := &geminiImageConfig{}
	size := strings.TrimSpace(config.Size)
	if size != "" && size != "auto" && strings.Count(size, ":") == 1 {
		imageConfig.AspectRatio = size
	}
	switch strings.ToLower(strings.TrimSpace(config.Quality)) {
	case "low", "1k":
		imageConfig.ImageSize = "1K"
	case "medium", "2k":
		imageConfig.ImageSize = "2K"
	case "high", "4k":
		imageConfig.ImageSize = "4K"
	}
	if imageConfig.AspectRatio == "" && imageConfig.ImageSize == "" {
		return nil
	}
	return imageConfig
}

func geminiImageBytes(media providerMedia) ([]byte, string, error) {
	raw, mimeType, err := mediaBytes(media)
	if err != nil {
		return nil, "", err
	}
	if len(raw) == 0 {
		return nil, "", errors.New("参考图片数据为空")
	}
	detected := strings.TrimSpace(strings.Split(http.DetectContentType(raw), ";")[0])
	if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
		if !strings.HasPrefix(strings.ToLower(detected), "image/") {
			return nil, "", fmt.Errorf("参考图片 MIME 类型无效：%s", defaultString(mimeType, detected))
		}
		mimeType = detected
	} else if !strings.HasPrefix(strings.ToLower(detected), "image/") {
		// 以实际字节签名为准，避免错误的 data URL MIME 把非图片内容伪装成图片。
		return nil, "", fmt.Errorf("参考图片内容不是有效图片：%s", defaultString(detected, mimeType))
	}
	return raw, mimeType, nil
}

func geminiImageDataURLs(payload map[string]interface{}) ([]map[string]string, error) {
	if errorValue, ok := payload["error"].(map[string]interface{}); ok {
		if message := stringField(errorValue, "message"); message != "" {
			return nil, errors.New(message)
		}
	}
	candidates, _ := payload["candidates"].([]interface{})
	images := make([]map[string]string, 0)
	for _, candidateValue := range candidates {
		candidate, _ := candidateValue.(map[string]interface{})
		content, _ := candidate["content"].(map[string]interface{})
		parts, _ := content["parts"].([]interface{})
		for _, partValue := range parts {
			part, _ := partValue.(map[string]interface{})
			inlineData, _ := part["inlineData"].(map[string]interface{})
			if inlineData == nil {
				inlineData, _ = part["inline_data"].(map[string]interface{})
			}
			if inlineData != nil {
				data := strings.TrimSpace(stringField(inlineData, "data"))
				mimeType := firstNonEmptyString(stringField(inlineData, "mimeType"), stringField(inlineData, "mime_type"))
				if data == "" {
					continue
				}
				if mimeType == "" {
					mimeType = "image/png"
				}
				if !strings.HasPrefix(strings.ToLower(mimeType), "image/") {
					return nil, fmt.Errorf("Gemini Images 返回了非图片 MIME 类型：%s", mimeType)
				}
				decoded, err := base64.StdEncoding.DecodeString(data)
				if err != nil {
					return nil, fmt.Errorf("Gemini Images 返回的图片数据无效：%w", err)
				}
				images = append(images, map[string]string{"dataUrl": dataURL(mimeType, decoded)})
				continue
			}
			fileData, _ := part["fileData"].(map[string]interface{})
			if fileData != nil {
				if fileURL := firstNonEmptyString(stringField(fileData, "fileUri"), stringField(fileData, "file_uri")); fileURL != "" {
					images = append(images, map[string]string{"dataUrl": fileURL})
				}
			}
		}
	}
	if len(images) == 0 {
		return nil, errors.New("Gemini Images 接口没有返回图片")
	}
	return images, nil
}

func runGrokImageTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	body, path, err := grokImageRequestBody(input)
	if err != nil {
		return nil, err
	}
	var payload imageResponse
	if err := postJSON(ctx, input.Config, path, body, &payload); err != nil {
		return nil, err
	}
	images, err := imageDataURLs(payload)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"mode": "image", "images": images}, nil
}

func grokImageRequestBody(input canvasGenerationInput) (grokImageRequest, string, error) {
	if input.Mask != nil {
		return grokImageRequest{}, "", errors.New("Grok 图片协议不支持蒙版编辑，请移除蒙版后重试")
	}
	body := grokImageRequest{
		Model:          input.Config.Model,
		Prompt:         withSystemPrompt(input.Config, input.Prompt),
		N:              1,
		ResponseFormat: "url",
		// Grok 图片协议用 aspect_ratio 表达画布比例；同时发送 size 会被上游按 OpenAI 枚举校验并拒绝。
		AspectRatio: normalizeGrokImageAspectRatio(input.Config.Size),
		Resolution:  normalizeGrokImageResolution(input.Config.Quality),
	}
	if len(input.ReferenceImages) == 0 {
		return body, "/images/generations", nil
	}
	if len(input.ReferenceImages) != 1 {
		return grokImageRequest{}, "", fmt.Errorf("Grok 图片编辑只支持 1 张参考图，当前连接了 %d 张", len(input.ReferenceImages))
	}
	imageURL, err := grokImageInputURL(input.ReferenceImages[0])
	if err != nil {
		return grokImageRequest{}, "", err
	}
	body.Image = &grokImageInput{URL: imageURL}
	return body, "/images/edits", nil
}

// normalizeGrokImageResolution 把画布 quality（1k/2k/high…）映射为 grok2api / xAI 的 resolution。
func normalizeGrokImageResolution(quality string) string {
	raw := strings.ToLower(strings.TrimSpace(quality))
	switch raw {
	case "", "auto":
		return ""
	case "1k", "low", "standard":
		return "1k"
	case "2k", "medium", "hd", "high", "4k":
		// xAI Imagine 图片通常最高 2k；超出则夹到 2k，避免上游拒参。
		return "2k"
	default:
		return ""
	}
}

// normalizeGrokImageAspectRatio 把画布 size（如 1280x720 / 9:16）转成 grok2api / xAI 接受的 aspect_ratio。
func normalizeGrokImageAspectRatio(size string) string {
	raw := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(size, "×", "x")))
	if raw == "" || raw == "auto" {
		return ""
	}
	if strings.Contains(raw, ":") {
		switch raw {
		case "1:1", "3:4", "4:3", "9:16", "16:9", "2:3", "3:2", "9:19.5", "19.5:9", "1:2", "2:1":
			return raw
		}
	}
	parts := strings.Split(raw, "x")
	if len(parts) != 2 {
		return ""
	}
	w, wErr := strconv.Atoi(parts[0])
	h, hErr := strconv.Atoi(parts[1])
	if wErr != nil || hErr != nil || w <= 0 || h <= 0 {
		return ""
	}
	if w == h {
		return "1:1"
	}
	ratio := float64(w) / float64(h)
	switch {
	case w*9 == h*16 || (ratio >= 1.7 && ratio <= 1.8):
		return "16:9"
	case h*9 == w*16 || (ratio > 0 && ratio <= 1.0/1.7 && ratio >= 1.0/1.8):
		return "9:16"
	case w*3 == h*4 || (ratio > 1.2 && ratio < 1.4):
		return "4:3"
	case h*3 == w*4 || (ratio > 0.7 && ratio < 0.85):
		return "3:4"
	// 像素尺寸路径必须显式覆盖 2:3 / 3:2 / 1:2 / 2:1：冒号字符串能直达（见上方 switch），
	// 但像素路径只靠 w>h 兜底会把 768x1152（2:3，ratio 0.667）错标成 9:16、
	// 1152x768（3:2，ratio 1.5）错标成 16:9，xAI 按错比例裁切生成图。
	case w*3 == h*2 || (ratio >= 0.6 && ratio < 0.72):
		return "2:3"
	case w*2 == h*3 || (ratio > 1.35 && ratio < 1.6):
		return "3:2"
	case h == w*2 || (ratio > 0.45 && ratio < 0.55):
		return "1:2"
	case w == h*2 || (ratio > 1.85 && ratio < 2.2):
		return "2:1"
	case w > h:
		return "16:9"
	default:
		return "9:16"
	}
}

func grokImageInputURL(media providerMedia) (string, error) {
	if isPublicMediaURL(strings.TrimSpace(media.URL)) {
		return strings.TrimSpace(media.URL), nil
	}
	return openAIImageInputURL(media)
}

const (
	volcengineArkImageMinPixels = 3686400
	volcengineArkImageMaxPixels = 4624220
)

func runVolcengineArkImageTask(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	if input.Mask != nil {
		return nil, errors.New("火山方舟图片协议不支持蒙版编辑，请移除蒙版后重试")
	}
	body, err := volcengineArkImageBody(input)
	if err != nil {
		return nil, err
	}
	var payload imageResponse
	if err := postJSON(ctx, input.Config, "/images/generations", body, &payload); err != nil {
		return nil, err
	}
	images, err := volcengineArkImageDataURLs(ctx, input.Config, payload)
	if err != nil {
		return nil, err
	}
	return map[string]interface{}{"mode": "image", "images": images}, nil
}

func volcengineArkImageDataURLs(ctx context.Context, config providerConfig, payload imageResponse) ([]map[string]string, error) {
	images, err := imageDataURLs(payload)
	if err != nil {
		return nil, err
	}
	for _, image := range images {
		value := strings.TrimSpace(image["dataUrl"])
		if strings.HasPrefix(value, "data:image/") {
			continue
		}
		if !isPublicMediaURL(value) {
			return nil, errors.New("火山方舟图片接口没有返回可下载的图片")
		}
		// 方舟默认返回临时 CDN 地址。必须由后端下载成内联结果，后续资源持久化才能
		// 原子地写入服务器或用户配置的对象存储，且不依赖浏览器跨域访问方舟 CDN。
		data, mimeType, err := getProviderExternalBinary(withProviderRequestKind(ctx, "download"), config, value)
		if err != nil {
			return nil, fmt.Errorf("火山方舟图片结果下载失败：%w", err)
		}
		detected := strings.ToLower(strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0]))
		mimeType = strings.ToLower(normalizedMediaMimeType(mimeType, data))
		if len(data) == 0 || strings.Contains(detected, "json") || strings.HasPrefix(detected, "text/") || !strings.HasPrefix(mimeType, "image/") {
			return nil, fmt.Errorf("火山方舟图片结果无效：%s", defaultString(detected, mimeType))
		}
		image["dataUrl"] = dataURL(mimeType, data)
		image["mimeType"] = mimeType
	}
	return images, nil
}

func volcengineArkImageBody(input canvasGenerationInput) (map[string]interface{}, error) {
	body := map[string]interface{}{
		"model":           input.Config.Model,
		"prompt":          withSystemPrompt(input.Config, input.Prompt),
		"n":               1,
		"response_format": "b64_json",
		"watermark":       false,
	}
	if key, value := imageSizeParameter(input.ImageCapability, input.Config.Size); value != "" {
		if key == "size" {
			value = normalizeVolcengineArkImageSize(value)
		}
		body[key] = value
	}
	if len(input.ReferenceImages) == 0 {
		return body, nil
	}
	images := make([]string, 0, len(input.ReferenceImages))
	for _, image := range input.ReferenceImages {
		url, err := openAIImageInputURL(image)
		if err != nil {
			return nil, err
		}
		images = append(images, url)
	}
	if len(images) == 1 {
		body["image"] = images[0]
	} else {
		body["image"] = images
	}
	return body, nil
}

func normalizeVolcengineArkImageSize(value string) string {
	size := normalizePixelSize(value)
	parts := strings.Split(strings.ToLower(size), "x")
	if len(parts) != 2 {
		return size
	}
	width, widthErr := strconv.Atoi(parts[0])
	height, heightErr := strconv.Atoi(parts[1])
	if widthErr != nil || heightErr != nil || width <= 0 || height <= 0 {
		return size
	}
	pixels := int64(width) * int64(height)
	if pixels >= volcengineArkImageMinPixels && pixels <= volcengineArkImageMaxPixels {
		return size
	}
	targetPixels := volcengineArkImageMaxPixels
	round := math.Floor
	if pixels < volcengineArkImageMinPixels {
		targetPixels = volcengineArkImageMinPixels
		round = math.Ceil
	}
	scale := math.Sqrt(float64(targetPixels) / float64(pixels))
	width = int(round(float64(width)*scale/2)) * 2
	height = int(round(float64(height)*scale/2)) * 2
	for width > 2 && height > 2 && int64(width)*int64(height) < volcengineArkImageMinPixels {
		if width >= height {
			width += 2
		} else {
			height += 2
		}
	}
	for width > 2 && height > 2 && int64(width)*int64(height) > volcengineArkImageMaxPixels {
		if width >= height {
			width -= 2
		} else {
			height -= 2
		}
	}
	return strconv.Itoa(width) + "x" + strconv.Itoa(height)
}

func imageDataURLs(payload imageResponse) ([]map[string]string, error) {
	if len(payload.Data) == 0 {
		return nil, errors.New("接口没有返回图片")
	}
	images := make([]map[string]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		if b64, ok := item["b64_json"].(string); ok && b64 != "" {
			images = append(images, map[string]string{"dataUrl": "data:image/png;base64," + b64})
			continue
		}
		if url, ok := item["url"].(string); ok && url != "" {
			images = append(images, map[string]string{"dataUrl": url})
		}
	}
	if len(images) == 0 {
		return nil, errors.New("接口没有返回可用图片")
	}
	return images, nil
}

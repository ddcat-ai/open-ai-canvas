// Agnes 视频模型的内置适配：v2.0 / v2.5 两代请求体与分辨率、比例规范化。

package protocol

import (
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func agnesAdapter() Adapter {
	info := metadata("agnes-video", "Agnes 视频", "Agnes AI", CapabilityVideo, "POST /v1/videos", "GET /agnesapi?video_id={id}&model_name={model}", "application/json")
	info.Version = "1.2.0"
	info.Description = "Agnes AI 官方异步视频协议，支持 Agnes Video V2.0、2.5 与 2.5 Flash。"
	info.RequiresPublicMediaURLs = true
	info.Parameters = []Parameter{
		{Name: "model", Type: "string", Required: true, Mapping: "model", Description: "官方模型 ID：agnes-video-v2.0、agnes-video-2.5 或 agnes-video-2.5-flash。"},
		{Name: "prompt", Type: "string", Required: true, Mapping: "prompt", Description: "视频生成提示词。"},
		{Name: "images", Type: "media[]", Mapping: "first_frame/last_frame/images/image/extra_body.image", Description: "2.5 系列按 mode 映射为关键帧或参考图；V2.0 映射为 image 或关键帧数组。"},
		{Name: "videos", Type: "media[]", Mapping: "videos", Description: "仅 Agnes Video 2.5 reference 模式支持，Flash 与 V2.0 不支持。"},
		{Name: "audios", Type: "media[]", Mapping: "audios", Description: "Agnes Video 2.5 系列 reference 模式支持。"},
		{Name: "duration", Type: "integer", Mapping: "seconds/num_frames", Description: "2.5 系列映射为字符串 seconds；V2.0 按帧率换算 num_frames。"},
		{Name: "aspectRatio", Type: "string", Values: []string{"21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}, Mapping: "aspect_ratio", Description: "2.5 系列画幅比例；历史像素尺寸会在插件边界转换为对应比例。"},
		{Name: "resolution", Type: "string", Values: []string{"720P", "960P", "2K"}, Mapping: "size", Description: "通用层分辨率档位，映射为 Agnes 的 size；Flash 固定 720P。"},
	}
	return builtinAdapter{
		info:        info,
		create:      buildAgnesCreate,
		parseCreate: parseAgnesCreate,
		poll: func(c PollContext) (RequestSpec, error) {
			model := strings.TrimSpace(c.Model)
			if model == "" {
				model = strings.TrimSpace(c.Request.Model)
			}
			path := "/agnesapi?video_id=" + url.QueryEscape(c.TaskID)
			if model != "" {
				path += "&model_name=" + url.QueryEscape(model)
			}
			return RequestSpec{Method: http.MethodGet, Path: path, OriginPath: true}, nil
		},
		parsePoll: parseAgnesPoll,
	}
}

func buildAgnesCreate(r GenerationRequest) (RequestSpec, error) {
	model := strings.TrimSpace(r.Model)
	switch model {
	case "agnes-video-v2.0":
		body, err := buildAgnesV20Body(r)
		if err != nil {
			return RequestSpec{}, err
		}
		return jsonSpec(http.MethodPost, "/v1/videos", body), nil
	case "agnes-video-2.5", "agnes-video-2.5-flash":
		body, err := buildAgnesV25Body(r)
		if err != nil {
			return RequestSpec{}, err
		}
		return jsonSpec(http.MethodPost, "/v1/videos", body), nil
	default:
		return RequestSpec{}, fmt.Errorf("Agnes 不支持模型 %q", model)
	}
}

func buildAgnesV25Body(r GenerationRequest) (map[string]any, error) {
	frameImages, referenceImages, _ := splitVideoImages(r.Images)
	if len(frameImages) > 0 && (len(referenceImages) > 0 || len(r.Videos)+len(r.Audios) > 0) {
		return nil, fmt.Errorf("Agnes 2.5 不能同时混用首尾帧和角色、视频或音频参考素材")
	}
	mode := firstString(r.Extra, "mode")
	if mode == "" {
		switch strings.TrimSpace(r.Operation) {
		case "reference_to_video", "audio_to_video":
			mode = "reference"
		case "image_to_video":
			mode = "keyframe"
		default:
			switch {
			case len(r.Videos) > 0 || len(r.Audios) > 0 || len(referenceImages) > 0:
				mode = "reference"
			case len(frameImages) > 0:
				mode = "keyframe"
			case len(r.Images) > 2:
				mode = "reference"
			case len(r.Images) > 0:
				mode = "keyframe"
			default:
				mode = "text"
			}
		}
	}
	if mode != "text" && mode != "keyframe" && mode != "reference" {
		return nil, fmt.Errorf("Agnes 2.5 mode 必须是 text、keyframe 或 reference")
	}
	seconds := defaultInt(r.Duration, 5)
	if seconds < 4 || seconds > 12 {
		return nil, fmt.Errorf("Agnes 2.5 seconds 必须在 4 到 12 秒之间")
	}
	size, err := normalizeAgnesV25Resolution(defaultValue(r.Resolution, firstString(r.Extra, "size")))
	if err != nil {
		return nil, err
	}
	aspectRatio, err := normalizeAgnesV25AspectRatio(defaultValue(r.AspectRatio, firstString(r.Extra, "aspect_ratio")))
	if err != nil {
		return nil, err
	}
	if r.Model == "agnes-video-2.5-flash" {
		if size != "720P" {
			return nil, fmt.Errorf("Agnes Video 2.5 Flash 仅支持 720P")
		}
		if len(r.Images) > 5 {
			return nil, fmt.Errorf("Agnes Video 2.5 Flash 最多支持 5 张参考图")
		}
		if len(r.Videos) > 0 {
			return nil, fmt.Errorf("Agnes Video 2.5 Flash 不支持参考视频")
		}
	} else if size != "720P" && size != "960P" && size != "2K" {
		return nil, fmt.Errorf("Agnes Video 2.5 size 必须是 720P、960P 或 2K")
	}
	body := map[string]any{
		"model":        r.Model,
		"prompt":       r.Prompt,
		"mode":         mode,
		"seconds":      strconv.Itoa(seconds),
		"size":         size,
		"aspect_ratio": aspectRatio,
		"n":            1,
	}
	if seed, ok := r.Extra["seed"]; ok {
		body["seed"] = seed
	}
	switch mode {
	case "text":
		if len(r.Images)+len(r.Videos)+len(r.Audios) > 0 {
			return nil, fmt.Errorf("Agnes 2.5 text 模式不接受参考媒体")
		}
	case "keyframe":
		if len(r.Images) == 0 || len(r.Images) > 2 || len(r.Videos)+len(r.Audios) > 0 {
			return nil, fmt.Errorf("Agnes 2.5 keyframe 模式需要 1 到 2 张图片，且不接受音视频参考")
		}
		_, referenceImages, _ := splitVideoImages(r.Images)
		if len(referenceImages) > 0 {
			return nil, fmt.Errorf("Agnes 2.5 keyframe 模式不能混用角色或风格参考图")
		}
		frameImages := orderedFrameImages(r.Images)
		if len(frameImages) == 0 {
			return nil, fmt.Errorf("Agnes 2.5 keyframe 模式缺少首帧图片")
		}
		body["first_frame"] = mediaValue(frameImages[0])
		if len(frameImages) > 1 {
			body["last_frame"] = mediaValue(frameImages[1])
		}
	case "reference":
		if len(r.Images)+len(r.Videos)+len(r.Audios) == 0 {
			return nil, fmt.Errorf("Agnes 2.5 reference 模式至少需要一种参考媒体")
		}
		if len(r.Images) > 0 {
			body["images"] = mediaValues(r.Images)
		}
		if len(r.Audios) > 0 {
			body["audios"] = mediaValues(r.Audios)
		}
		if len(r.Videos) > 0 {
			videos := make([]any, 0, len(r.Videos))
			for _, video := range r.Videos {
				videos = append(videos, map[string]any{"url": mediaValue(video)})
			}
			body["videos"] = videos
		}
	}
	return compactMap(body), nil
}

func normalizeAgnesV25Resolution(value string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "auto", "720", "720p":
		return "720P", nil
	case "960", "960p":
		return "960P", nil
	case "2k", "1440", "1440p":
		return "2K", nil
	default:
		return "", fmt.Errorf("Agnes Video 2.5 分辨率必须是 720P、960P 或 2K")
	}
}

func normalizeAgnesV25AspectRatio(value string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(value, "×", "x")))
	if normalized == "" || normalized == "auto" {
		return "16:9", nil
	}
	ratios := []string{"21:9", "16:9", "4:3", "1:1", "3:4", "9:16"}
	for _, ratio := range ratios {
		if normalized == ratio {
			return ratio, nil
		}
	}
	dimensions := strings.Split(normalized, "x")
	if len(dimensions) == 2 {
		width, widthErr := strconv.ParseInt(dimensions[0], 10, 64)
		height, heightErr := strconv.ParseInt(dimensions[1], 10, 64)
		if widthErr == nil && heightErr == nil && width > 0 && height > 0 && width <= 1_000_000 && height <= 1_000_000 {
			for _, ratio := range ratios {
				parts := strings.Split(ratio, ":")
				ratioWidth, _ := strconv.ParseInt(parts[0], 10, 64)
				ratioHeight, _ := strconv.ParseInt(parts[1], 10, 64)
				if width*ratioHeight == height*ratioWidth {
					return ratio, nil
				}
			}
		}
	}
	return "", fmt.Errorf("Agnes Video 2.5 画幅必须是 21:9、16:9、4:3、1:1、3:4 或 9:16")
}

func buildAgnesV20Body(r GenerationRequest) (map[string]any, error) {
	if len(r.Videos)+len(r.Audios) > 0 {
		return nil, fmt.Errorf("Agnes Video V2.0 不支持参考视频或音频")
	}
	_, referenceImages, _ := splitVideoImages(r.Images)
	if r.Operation == "reference_to_video" || len(referenceImages) > 0 {
		return nil, fmt.Errorf("Agnes Video V2.0 不支持角色或风格参考图模式，请改用 Agnes Video 2.5")
	}
	body := map[string]any{"model": r.Model, "prompt": r.Prompt}
	mergeExtra(body, r.Extra, "mode", "width", "height", "num_frames", "frame_rate", "num_inference_steps", "seed", "negative_prompt")
	if r.Duration > 0 {
		frameRate := 24
		if value, ok := r.Extra["frame_rate"].(float64); ok && value >= 1 && value <= 60 {
			frameRate = int(value)
		}
		if value, ok := r.Extra["frame_rate"].(int); ok && value >= 1 && value <= 60 {
			frameRate = value
		}
		if _, supplied := r.Extra["frame_rate"]; !supplied {
			body["frame_rate"] = frameRate
		}
		if _, supplied := r.Extra["num_frames"]; !supplied {
			target := r.Duration * frameRate
			frames := ((target-1+4)/8)*8 + 1
			if frames > 441 {
				frames = 441
			}
			body["num_frames"] = frames
		}
	}
	orderedImages := orderedFrameImages(r.Images)
	if len(orderedImages) == 1 {
		body["image"] = mediaValue(orderedImages[0])
	} else if len(orderedImages) > 1 {
		extraBody := map[string]any{}
		if configured := object(r.Extra["extra_body"]); configured != nil {
			for key, value := range configured {
				extraBody[key] = value
			}
		}
		extraBody["image"] = mediaValues(orderedImages)
		extraBody["mode"] = "keyframes"
		body["extra_body"] = extraBody
	} else if configured := object(r.Extra["extra_body"]); configured != nil {
		body["extra_body"] = configured
	}
	return compactMap(body), nil
}

func parseAgnesCreate(payload map[string]any) (CreateResult, error) {
	id := firstString(payload, "video_id", "task_id", "id")
	if id == "" {
		return CreateResult{}, fmt.Errorf("Agnes 创建响应没有 video_id")
	}
	status := normalizeStatus(firstString(payload, "status"))
	if status == "" {
		status = StatusPending
	}
	return CreateResult{TaskID: id, Status: status}, nil
}

func parseAgnesPoll(c PollContext, payload map[string]any) (PollResult, error) {
	id := defaultValue(firstString(payload, "video_id", "task_id", "id"), c.TaskID)
	status := normalizeStatus(firstString(payload, "status"))
	if status == "" {
		status = StatusProcessing
	}
	message := firstString(payload, "message", "detail")
	if failure := object(payload["error"]); failure != nil {
		message = defaultValue(firstString(failure, "message", "detail", "code"), message)
	}
	if status == StatusFailed {
		return PollResult{TaskID: id, Status: status, Message: defaultValue(message, "Agnes 视频生成失败")}, nil
	}
	if status != StatusSucceeded {
		return PollResult{TaskID: id, Status: status, Message: message}, nil
	}
	metadata := object(payload["metadata"])
	videoURL := firstString(metadata, "url")
	if videoURL == "" {
		videoURL = firstString(payload, "url")
	}
	if videoURL == "" {
		return PollResult{}, fmt.Errorf("Agnes 完成响应没有返回视频 URL")
	}
	return PollResult{TaskID: id, Status: status, Result: &Result{Videos: []MediaReference{{URL: videoURL, Kind: string(CapabilityVideo)}}}}, nil
}

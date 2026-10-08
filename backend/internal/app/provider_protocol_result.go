// 声明式协议插件的结果处理：输出提取、媒体下载重试与错误归类。

package app

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
	"time"

	"yingce/backend/internal/protocol"
)

func appendProtocolQuery(rawURL string, values map[string][]string) (string, error) {
	if len(values) == 0 {
		return rawURL, nil
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	query := parsed.Query()
	for key, items := range values {
		for _, item := range items {
			query.Add(key, item)
		}
	}
	parsed.RawQuery = query.Encode()
	return parsed.String(), nil
}

func finishProtocolResult(ctx context.Context, config providerConfig, mode string, taskID string, result *protocol.Result, pollPolicy videoPollPolicy) (map[string]interface{}, error) {
	if result == nil {
		return nil, errors.New("声明式协议已完成但没有返回结果")
	}
	if mode == "text" {
		output := map[string]interface{}{"mode": "text", "text": result.Text}
		if strings.TrimSpace(result.Reasoning) != "" {
			output["reasoning"] = result.Reasoning
		}
		return output, nil
	}
	var references []protocol.MediaReference
	switch mode {
	case "image":
		references = result.Images
	case "video":
		references = result.Videos
	case "audio":
		references = result.Audios
	default:
		return nil, fmt.Errorf("声明式协议不支持生成模式 %s", mode)
	}
	if len(references) == 0 {
		return nil, errors.New("声明式协议已完成但没有返回媒体地址")
	}
	if output, handled, err := recoverProtocolMedia(ctx, config, mode, references); handled {
		return output, err
	}
	items := make([]interface{}, 0, len(references))
	for _, reference := range references {
		var data []byte
		var mimeType string
		var err error
		if mode == "video" {
			data, mimeType, err = runVideoDownload(ctx, taskID, pollPolicy, func(ctx context.Context) ([]byte, string, error) {
				return protocolMediaBytesOnce(ctx, config, reference)
			})
		} else {
			data, mimeType, err = protocolMediaBytes(ctx, config, reference)
		}
		if err != nil {
			return nil, err
		}
		item := map[string]interface{}{"dataUrl": dataURL(mimeType, data), "mimeType": mimeType}
		items = append(items, item)
	}
	switch mode {
	case "image":
		return map[string]interface{}{"mode": "image", "images": items}, nil
	case "video":
		return map[string]interface{}{"mode": "video", "video": items[0]}, nil
	default:
		return map[string]interface{}{"mode": "audio", "audio": items[0]}, nil
	}
}

// finishProtocolAdapterResult 优先消费 create/poll 已返回的内联或 URL 结果，只有插件明确声明独立结果端点时才下载。
// 空响应或下载失败必须向上失败，不能生成伪素材；application/octet-stream 仅表示传输层未知类型，
// 不会把未知内容伪装成具体图片、视频或音频 MIME。
func finishProtocolAdapterResult(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter, request protocol.GenerationRequest, taskID string, result *protocol.Result, pollPolicy videoPollPolicy) (map[string]interface{}, error) {
	if protocolResultHasOutput(input.Mode, result) {
		return finishProtocolResult(ctx, input.Config, input.Mode, taskID, result, pollPolicy)
	}
	resultAdapter, ok := adapter.(protocol.ResultAdapter)
	capability, hasCapability := adapter.(protocol.ResultCapability)
	if !ok || !hasCapability || !capability.ResultAvailable() {
		return finishProtocolResult(ctx, input.Config, input.Mode, taskID, result, pollPolicy)
	}
	spec, err := resultAdapter.BuildResult(ctx, protocol.PollContext{BaseURL: input.Config.BaseURL, Model: request.Model, Request: request, TaskID: taskID})
	if err != nil {
		return nil, err
	}
	download := func(ctx context.Context) ([]byte, string, error) {
		return executeProtocolBinaryRequest(withProviderRequestKind(ctx, "download"), input.Config, spec)
	}
	var data []byte
	var mimeType string
	if input.Mode == "video" {
		data, mimeType, err = runVideoDownload(ctx, taskID, pollPolicy, download)
	} else {
		data, mimeType, err = download(ctx)
	}
	if err != nil {
		return nil, fmt.Errorf("声明式协议结果下载失败：%w", err)
	}
	if len(data) == 0 {
		return nil, errors.New("声明式协议结果下载返回空内容")
	}
	mimeType = strings.TrimSpace(strings.Split(mimeType, ";")[0])
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	reference := protocol.MediaReference{DataURL: dataURL(mimeType, data), MIMEType: mimeType}
	downloaded := &protocol.Result{}
	switch input.Mode {
	case "image":
		downloaded.Images = []protocol.MediaReference{reference}
	case "video":
		downloaded.Videos = []protocol.MediaReference{reference}
	case "audio":
		downloaded.Audios = []protocol.MediaReference{reference}
	default:
		return nil, fmt.Errorf("声明式协议结果下载不支持生成模式 %s", input.Mode)
	}
	return finishProtocolResult(ctx, input.Config, input.Mode, taskID, downloaded, pollPolicy)
}

func protocolResultHasOutput(mode string, result *protocol.Result) bool {
	if result == nil {
		return false
	}
	switch mode {
	case "text":
		return strings.TrimSpace(result.Text) != ""
	case "image":
		return len(result.Images) > 0
	case "video":
		return len(result.Videos) > 0
	case "audio":
		return len(result.Audios) > 0
	default:
		return false
	}
}

func protocolMediaBytes(ctx context.Context, config providerConfig, reference protocol.MediaReference) ([]byte, string, error) {
	var data []byte
	var mimeType string
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		data, mimeType, err = protocolMediaBytesOnce(ctx, config, reference)
		if err == nil {
			return data, mimeType, nil
		}
		if attempt == 2 || !retryableProtocolMediaDownload(err) {
			break
		}
		if waitErr := sleepContext(ctx, time.Duration(attempt+1)*time.Second); waitErr != nil {
			return nil, "", fmt.Errorf("声明式协议媒体结果下载失败：%w", waitErr)
		}
	}
	return nil, "", fmt.Errorf("声明式协议媒体结果下载失败：%w", err)
}

func protocolMediaBytesOnce(ctx context.Context, config providerConfig, reference protocol.MediaReference) ([]byte, string, error) {
	if strings.TrimSpace(reference.DataURL) != "" {
		mimeType, data, err := decodeProviderDataURL(reference.DataURL)
		return data, mimeType, err
	}
	value := strings.TrimSpace(reference.URL)
	if value == "" {
		return nil, "", errors.New("声明式协议媒体结果地址为空")
	}
	data, mimeType, err := getProviderExternalBinary(withProviderRequestKind(ctx, "download"), config, value)
	return data, normalizedMediaMimeType(mimeType, data), err
}

func retryableProtocolMediaDownload(err error) bool {
	if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	var networkError net.Error
	if errors.As(err, &networkError) && (networkError.Timeout() || networkError.Temporary()) {
		return true
	}
	message := strings.ToLower(err.Error())
	for _, marker := range []string{"tls handshake timeout", "connection reset", "unexpected eof", "broken pipe"} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func protocolResultError(message, taskID string) error {
	message = strings.TrimSpace(message)
	if message == "" {
		message = "上游返回失败状态"
	}
	if taskID == "" {
		return errors.New(message)
	}
	return fmt.Errorf("声明式协议任务失败（任务 %s）：%s", taskID, message)
}

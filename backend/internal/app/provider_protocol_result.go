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
		if err == nil {
			attachProtocolUsage(output, mode, result)
		}
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
	var output map[string]interface{}
	switch mode {
	case "image":
		output = map[string]interface{}{"mode": "image", "images": items}
	case "video":
		output = map[string]interface{}{"mode": "video", "video": items[0]}
	default:
		output = map[string]interface{}{"mode": "audio", "audio": items[0]}
	}
	attachProtocolUsage(output, mode, result)
	return output, nil
}

// attachProtocolUsage 把视频结果的上游 usage（如输出时长、帧率）写入任务结果，
// 供按实际输出时长结算时在资源未探测到时长时兜底。
func attachProtocolUsage(output map[string]interface{}, mode string, result *protocol.Result) {
	if output == nil || result == nil || mode != "video" || len(result.Usage) == 0 {
		return
	}
	output["usage"] = result.Usage
}

// finishProtocolAdapterResult 优先消费 create/poll 已返回的内联或 URL 结果，只有插件明确声明独立结果端点时才下载。
// 空响应或下载失败必须向上失败，不能生成伪素材；application/octet-stream 仅表示传输层未知类型，
// 不会把未知内容伪装成具体图片、视频或音频 MIME。
func finishProtocolAdapterResult(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter, request protocol.GenerationRequest, taskID string, result *protocol.Result, pollPolicy videoPollPolicy) (map[string]interface{}, error) {
	if protocolResultHasOutput(input.Mode, result) {
		return finishProtocolResult(ctx, input.Config, input.Mode, taskID, result, pollPolicy)
	}
	resultAdapter, ok := protocolResultEndpoint(adapter)
	if !ok {
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
	if mimeType == "application/json" || strings.HasSuffix(mimeType, "+json") {
		state, parseErr := adapter.ParsePoll(ctx, protocol.PollContext{BaseURL: input.Config.BaseURL, Model: request.Model, Request: request, TaskID: taskID}, data)
		if parseErr != nil {
			return nil, fmt.Errorf("解析声明式协议结果清单失败：%w", parseErr)
		}
		if state.Status == protocol.StatusFailed || state.Status == protocol.StatusCancelled {
			return nil, protocolTaskFailure(ctx, state.Status, state.Message, taskID)
		}
		if !protocolResultHasOutput(input.Mode, state.Result) {
			return nil, errProtocolResultNotReady
		}
		manifestURL, parseErr := protocolRequestURL(input.Config.BaseURL, spec)
		if parseErr != nil {
			return nil, parseErr
		}
		base, parseErr := url.Parse(manifestURL)
		if parseErr != nil {
			return nil, parseErr
		}
		for _, media := range [][]protocol.MediaReference{state.Result.Images, state.Result.Videos, state.Result.Audios} {
			for index := range media {
				if media[index].URL == "" {
					continue
				}
				reference, err := url.Parse(media[index].URL)
				if err != nil {
					return nil, err
				}
				media[index].URL = base.ResolveReference(reference).String()
			}
		}
		return finishProtocolResult(ctx, input.Config, input.Mode, taskID, state.Result, pollPolicy)
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	reference := protocol.MediaReference{DataURL: dataURL(mimeType, data), MIMEType: mimeType}
	downloaded := &protocol.Result{}
	if result != nil {
		downloaded.Usage = result.Usage
	}
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

// errProtocolResultNotReady 表示上游已报告完成，但独立结果接口返回的清单里还没有媒体。
// 轮询方把它和“完成但没有媒体地址”同样处理：宽限期内继续查原任务，过后按此错误失败。
var errProtocolResultNotReady = errors.New("声明式协议结果清单没有返回媒体地址")

// 有些上游先报告完成、稍后才给出媒体地址。宽限期按查询次数和时长取先到者：
// 视频每 30 秒查一次约等 2 分钟，图片每 2.5 秒查一次约等 1 分钟；超过后按“没有媒体地址”失败，
// 不等到轮询总时限（视频 1 小时、分离式 48 小时）。
const (
	protocolLateResultGrace    = 2 * time.Minute
	protocolLateResultMaxPolls = 24
	protocolLateResultStage    = "上游已完成，等待结果地址"
)

type protocolLateResultWait struct {
	since time.Time
	polls int
}

// keepWaiting 记录一次“已完成但没有媒体”的查询，返回是否仍在宽限期内。
func (w *protocolLateResultWait) keepWaiting(now time.Time) bool {
	if w.since.IsZero() {
		w.since = now
	}
	w.polls++
	return w.polls <= protocolLateResultMaxPolls && now.Sub(w.since) < protocolLateResultGrace
}

// protocolResultEndpoint 返回插件声明的独立结果接口；下载与就绪判断共用同一条件。
func protocolResultEndpoint(adapter protocol.Adapter) (protocol.ResultAdapter, bool) {
	resultAdapter, ok := adapter.(protocol.ResultAdapter)
	capability, hasCapability := adapter.(protocol.ResultCapability)
	return resultAdapter, ok && hasCapability && capability.ResultAvailable()
}

// protocolResultReady 判断“已完成”的结果能否收尾：媒体任务要么已带媒体，要么有独立结果接口可下载。
func protocolResultReady(mode string, result *protocol.Result, adapter protocol.Adapter) bool {
	if mode != "video" && mode != "audio" && mode != "image" {
		return true
	}
	if protocolResultHasOutput(mode, result) {
		return true
	}
	_, ok := protocolResultEndpoint(adapter)
	return ok
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
	value, err := resolveProtocolMediaURL(config.BaseURL, value)
	if err != nil {
		return nil, "", err
	}
	data, mimeType, err := getProviderExternalBinary(withProviderRequestKind(ctx, "download"), config, value)
	return data, normalizedMediaMimeType(mimeType, data), err
}

func resolveProtocolMediaURL(baseURL, rawURL string) (string, error) {
	reference, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", fmt.Errorf("解析声明式协议媒体结果地址失败：%w", err)
	}
	if reference.IsAbs() {
		if (reference.Scheme != "http" && reference.Scheme != "https") || reference.Host == "" {
			return "", errors.New("声明式协议媒体结果地址只支持完整的 HTTP 或 HTTPS URL")
		}
		return reference.String(), nil
	}
	if reference.Host != "" {
		return "", errors.New("声明式协议媒体结果地址不能使用 scheme-relative URL")
	}

	base, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || !base.IsAbs() || base.Host == "" || (base.Scheme != "http" && base.Scheme != "https") {
		return "", errors.New("解析声明式协议媒体结果地址失败：渠道 Base URL 无效")
	}
	resolved := base.ResolveReference(reference)
	if !sameProviderOrigin(baseURL, resolved.String()) {
		return "", errors.New("声明式协议媒体结果地址超出渠道来源")
	}
	return resolved.String(), nil
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

// providerTaskTerminalError 表示协议适配器已从上游响应解析出明确的失败或取消终态。
// 它和超时、断线不同：上游已确认任务结束，调用日志与账单都按失败收尾，不进入待核对。
type providerTaskTerminalError struct {
	TaskID  string
	Status  protocol.Status
	Message string
}

func (e providerTaskTerminalError) Error() string {
	if e.TaskID == "" {
		return e.Message
	}
	return fmt.Sprintf("声明式协议任务失败（任务 %s）：%s", e.TaskID, e.Message)
}

// protocolTaskFailure 构造终态错误，并把同一个终态写回本次上游任务的计费根日志。
// 调用日志在适配器解析响应之前就已落库，日志侧只能按通用字段猜状态；manifest 的 status 表达式、
// statusPaths 和 errorPaths 它都看不到。不回写时，失败任务的根日志仍是 succeeded，账单随之进入待核对。
func protocolTaskFailure(ctx context.Context, status protocol.Status, message, taskID string) error {
	message = strings.TrimSpace(message)
	if message == "" {
		message = "上游返回失败状态"
	}
	failure := providerTaskTerminalError{TaskID: taskID, Status: status, Message: message}
	recordProviderTaskTerminalFailure(ctx, failure)
	return failure
}

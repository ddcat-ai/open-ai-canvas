// 声明式协议的长排队支持：素材前置上传、幂等提交的有限重试，以及提交后释放 worker 的分离式回查。
//
// 分离式回查（manifest detachedPolling）面向“拼车/班次”类上游：任务可能先候车数小时再出片。
// 提交成功或每次回查仍未完成时返回 providerStatePendingError，worker 把任务退回调度并在
// next_poll_at 后再领取；期间不占用 worker 槽位，也不会重新提交上游任务。

package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"yingce/backend/internal/protocol"
)

// detachedProviderTaskMaxAge 是分离式回查任务从首次领取起的最长等待时间；超过后不再退回调度，
// 避免上游丢单时任务永久占用账号的活跃任务名额。
const detachedProviderTaskMaxAge = 48 * time.Hour

// detachedProviderPollDelay 是分离式回查两次领取之间的间隔。
const detachedProviderPollDelay = 15 * time.Second

const idempotentCreateAttempts = 3

func protocolDetachedPolling(adapter protocol.Adapter, mode string) bool {
	return adapter != nil && adapter.Metadata().DetachedPolling && (mode == "video" || mode == "image")
}

// uploadProtocolMedia 按清单 upload 步骤把输入媒体逐个上传到上游，并把返回的素材 ID
// 写入媒体元数据（media.uploadId）。同一媒体在 images/inputs 中各出现一次，只上传一次。
func uploadProtocolMedia(ctx context.Context, input canvasGenerationInput, adapter protocol.Adapter, request *protocol.GenerationRequest) error {
	uploader, ok := adapter.(protocol.MediaUploadAdapter)
	if !ok || len(uploader.UploadKinds()) == 0 {
		return nil
	}
	allowed := map[string]bool{}
	for _, kind := range uploader.UploadKinds() {
		allowed[kind] = true
	}
	uploaded := map[string]string{}
	assign := func(items []protocol.MediaReference) error {
		for index := range items {
			item := &items[index]
			value := firstNonEmpty(item.URL, item.DataURL)
			if !allowed[item.Kind] || value == "" {
				continue
			}
			key := item.Kind + "\x00" + value
			id, done := uploaded[key]
			if !done {
				spec, err := uploader.BuildUpload(ctx, protocol.RequestContext{BaseURL: input.Config.BaseURL, Request: *request}, *item)
				if err != nil {
					return err
				}
				body, err := executeProtocolRequest(withProviderRequestKind(ctx, "upload"), input.Config, spec)
				if err != nil {
					return fmt.Errorf("上传参考素材失败：%w", err)
				}
				if id, err = uploader.ParseUpload(ctx, body); err != nil {
					return err
				}
				uploaded[key] = id
			}
			metadata := make(map[string]any, len(item.Metadata)+1)
			for name, field := range item.Metadata {
				metadata[name] = field
			}
			metadata[protocol.MediaUploadIDKey] = id
			item.Metadata = metadata
		}
		return nil
	}
	for _, items := range [][]protocol.MediaReference{request.Images, request.Videos, request.Audios, request.Inputs} {
		if err := assign(items); err != nil {
			return err
		}
	}
	return nil
}

// executeIdempotentProtocolCreate 只在清单声明 idempotentCreate 时重试 create：上游以宿主幂等键
// 作为任务 ID 去重，重复提交不会产生第二个计费任务。4xx（除 429）是参数问题，重试无意义。
func executeIdempotentProtocolCreate(ctx context.Context, input canvasGenerationInput, spec protocol.RequestSpec, idempotent bool) ([]byte, *protocol.Result, error) {
	attempts := 1
	if idempotent {
		attempts = idempotentCreateAttempts
	}
	var lastErr error
	for attempt := 1; attempt <= attempts; attempt++ {
		body, streamed, err := executeProtocolCreateRequest(withProviderRequestKind(ctx, "create"), input, spec)
		if err == nil || attempt == attempts || !retryableIdempotentCreate(err) {
			return body, streamed, err
		}
		lastErr = err
		if waitErr := sleepContext(ctx, max(time.Duration(attempt)*10*time.Second, providerRetryAfter(err))); waitErr != nil {
			return nil, nil, errors.Join(lastErr, waitErr)
		}
	}
	return nil, nil, lastErr
}

func retryableIdempotentCreate(err error) bool {
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.StatusCode == http.StatusTooManyRequests || httpErr.StatusCode >= http.StatusInternalServerError
	}
	return isTransientTransportError(err)
}

// recordProtocolProviderTask 在提交成功后立即保存上游任务 ID。分离式回查依赖它恢复原任务，
// 不能只依赖调用日志从响应体里猜测 ID（上游 ID 由清单映射，可能不在顶层 id 字段）。
func recordProtocolProviderTask(ctx context.Context, providerTaskID string) error {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Service == nil || metadata.TaskID == "" || strings.TrimSpace(providerTaskID) == "" {
		return nil
	}
	next := time.Now().Add(detachedProviderPollDelay)
	return metadata.Service.recordWorkflowProviderRequest(ctx, providerTaskID, "accepted", &next)
}

// detachedProtocolPending 生成分离式回查的“继续等待”信号；stage 为上游给出的可读阶段，
// queueAhead 为前面的条数（-1 表示未知），用来决定下次回查间隔。
func detachedProtocolPending(taskID string, stage string, queueAhead int) error {
	return providerStatePendingError{TaskID: taskID, Stage: truncateRunes(strings.TrimSpace(stage), 120), Detached: true, PollDelay: detachedPollDelay(queueAhead)}
}

// detachedPollDelay 按排队位置拉长回查间隔：前面几百条时一两分钟内不可能轮到，
// 每 15 秒查一次只会制造无效请求；临近发车再恢复 15 秒，保证出片后及时转存。
func detachedPollDelay(queueAhead int) time.Duration {
	switch {
	case queueAhead > 500:
		return 2 * time.Minute
	case queueAhead > 100:
		return time.Minute
	case queueAhead > 20:
		return 30 * time.Second
	default:
		return detachedProviderPollDelay
	}
}

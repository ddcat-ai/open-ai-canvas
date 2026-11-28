package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

const (
	jimengMediaWorkers    = 3
	jimengMediaCallBudget = 20 * time.Second
)

type JimengImportMediaItem struct {
	ResourceID string          `json:"resourceId"`
	Resource   *model.Resource `json:"resource,omitempty"`
	// Deferred 为 true 表示本次没有开始处理（站点限流或超出时间预算），稍后重试即可。
	Deferred bool `json:"deferred,omitempty"`
	// Error 是可展示的失败原因；Retryable 为 true 表示下载抖动等瞬时失败，客户端可以重试。
	Error     string `json:"error,omitempty"`
	Retryable bool   `json:"retryable,omitempty"`
}

type JimengImportMediaResult struct {
	Items []JimengImportMediaItem `json:"items"`
	// RetryAfterSeconds 大于 0 表示站点每分钟远程导入次数已用完，等待该秒数后继续。
	RetryAfterSeconds int `json:"retryAfterSeconds"`
}

type jimengMediaResolver func(userID, canvasProjectID, projectID string, resourceIDs []string) ([]JimengResolvedMedia, error)

// StoreJimengImportMedia 把即梦分享画布的素材转存为当前用户的资源。即梦的媒体地址是
// 短期签名链接（视频约一小时失效），所以每次现取地址再下载；幂等键由画布 ID 和素材 ID
// 组成，同一素材重复导入不会重复占用存储。每个素材计入运行策略的“每分钟远程导入次数”，
// 单个文件沿用上传大小与每日上传额度限制。
func (s *Service) StoreJimengImportMedia(ctx context.Context, userID, canvasProjectID string, req JimengMediaRequest) (*JimengImportMediaResult, error) {
	return s.storeJimengImportMedia(ctx, userID, canvasProjectID, req, s.ResolveJimengMedia)
}

func (s *Service) storeJimengImportMedia(ctx context.Context, userID, canvasProjectID string, req JimengMediaRequest, resolve jimengMediaResolver) (*JimengImportMediaResult, error) {
	userID = strings.TrimSpace(userID)
	canvasProjectID = strings.TrimSpace(canvasProjectID)
	if userID == "" || canvasProjectID == "" {
		return nil, kernel.Unauthorized("请先打开已同步的故事创作画布")
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	if policy.Request.ResourceImportPerMinute <= 0 {
		return nil, kernel.Forbidden("站点未开放远程素材导入，无法转存即梦素材")
	}
	resolved, err := resolve(userID, canvasProjectID, req.ProjectID, req.ResourceIDs)
	if err != nil {
		return nil, err
	}

	// 元素地址在下载期间保持不变，下载协程直接写回自己负责的那一项。
	items := make([]JimengImportMediaItem, len(resolved))
	result := &JimengImportMediaResult{Items: items}
	limiterKey := "jimeng-import-media:" + userID
	window := time.Minute
	deadline := time.Now().Add(jimengMediaCallBudget)
	var wait sync.WaitGroup
	slots := make(chan struct{}, jimengMediaWorkers)
	var loopErr error
	for index, entry := range resolved {
		items[index] = JimengImportMediaItem{ResourceID: entry.ResourceID, Error: entry.Error}
		if entry.Error != "" {
			continue
		}
		// 限流与时间预算在入队前判定：超出的素材原样退回，由客户端稍后继续。
		allowed, allowErr := s.AllowRequest(ctx, limiterKey, policy.Request.ResourceImportPerMinute, window)
		if allowErr != nil {
			loopErr = allowErr
			break
		}
		if !allowed || time.Now().After(deadline) {
			items[index].Deferred = true
			if !allowed {
				seconds := int((s.RequestRetryAfter(ctx, limiterKey, window) + time.Second - 1) / time.Second)
				result.RetryAfterSeconds = max(result.RetryAfterSeconds, seconds)
			}
			continue
		}
		wait.Add(1)
		slots <- struct{}{}
		go func(item *JimengImportMediaItem, media JimengMedia) {
			defer wait.Done()
			defer func() { <-slots }()
			item.Resource, item.Error, item.Retryable = s.downloadJimengMedia(userID, req.ProjectID, media)
		}(&items[index], *entry.Media)
	}
	// 已入队的下载必须收尾后才能返回，避免请求结束后仍有协程写存储。
	wait.Wait()
	if loopErr != nil {
		return nil, loopErr
	}
	return result, nil
}

func (s *Service) downloadJimengMedia(userID, projectID string, media JimengMedia) (*model.Resource, string, bool) {
	resource, err := s.ImportResourceURL(userID, media.URL, media.Kind, media.Width, media.Height, media.DurationMs, "jimeng-media:"+projectID+":"+media.ResourceID)
	if err != nil {
		message, retryable := jimengMediaError(err)
		return nil, message, retryable
	}
	return resource, "", false
}

// jimengMediaError 返回可展示的失败原因，以及它是否值得重试：只有结构化业务错误的文案
// 可以展示给用户，其余失败原因留在服务端日志。超出大小、额度等 4xx 是确定性失败；
// 下载失败、超时等网关类错误和标记为可重试的错误才重试。
func jimengMediaError(err error) (string, bool) {
	var appErr *kernel.AppError
	if errors.As(err, &appErr) && strings.TrimSpace(appErr.Message) != "" {
		return appErr.Message, appErr.Retryable || appErr.Status >= http.StatusInternalServerError
	}
	return "转存即梦素材失败", false
}

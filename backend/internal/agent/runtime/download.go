package runtime

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// downloadAttempts 是单个资产的最大尝试次数；只对网络错误与 5xx 重试。
const downloadAttempts = 3

// httpStatusError 让重试策略能区分「服务端暂时不可用」与「这个地址本来就不存在」。
type httpStatusError struct {
	url    string
	status int
}

func (e *httpStatusError) Error() string {
	return fmt.Sprintf("下载 %s 失败：HTTP %d", e.url, e.status)
}

// httpFetch 是默认下载器：跟随官方 302、设置总时长上限，重试交给 fetchWithRetry。
func httpFetch(ctx context.Context, url string) (io.ReadCloser, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 30 * time.Minute}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	if response.StatusCode != http.StatusOK {
		response.Body.Close()
		return nil, &httpStatusError{url: url, status: response.StatusCode}
	}
	return response.Body, nil
}

// fetchWithRetry 带退避地取回响应体；调用方负责 Close。
func fetchWithRetry(ctx context.Context, fetch func(context.Context, string) (io.ReadCloser, error), url string) (io.ReadCloser, error) {
	var lastErr error
	for attempt := 1; attempt <= downloadAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		body, err := fetch(ctx, url)
		if err == nil {
			return body, nil
		}
		lastErr = err
		if attempt == downloadAttempts || !retryableDownload(err) {
			break
		}
		timer := time.NewTimer(time.Duration(attempt) * 500 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	return nil, lastErr
}

// retryableDownload 只在服务端过载或链路中断时重试；404 这类确定性失败立刻上抛。
func retryableDownload(err error) bool {
	var status *httpStatusError
	if errors.As(err, &status) {
		return status.status >= 500 || status.status == http.StatusRequestTimeout
	}
	return true
}

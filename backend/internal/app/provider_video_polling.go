package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const defaultVideoPollInterval = 30 * time.Second

type videoPollPolicy struct {
	InitialDelay          time.Duration
	Interval              time.Duration
	MaxNotFoundMisses     int
	MaxMalformedResponses int
	MaxDownloadTries      int
	RetryTransient        bool
	Sleep                 func(context.Context, time.Duration) error
	Notify                func(context.Context, string, videoPollEvent, error)
}

type videoPollEvent string

const (
	videoPollEventRetrying  videoPollEvent = "retrying"
	videoPollEventRecovered videoPollEvent = "recovered"
)

type videoPollOutcome struct {
	Done   bool
	Result map[string]interface{}
}

type videoDownloadError struct {
	TaskID string
	Cause  error
}

func (e videoDownloadError) Error() string {
	if strings.TrimSpace(e.TaskID) == "" {
		return fmt.Sprintf("视频结果下载失败：%v", e.Cause)
	}
	return fmt.Sprintf("视频结果下载失败（任务 %s）：%v", e.TaskID, e.Cause)
}

func (e videoDownloadError) Unwrap() error { return e.Cause }

func defaultVideoPollPolicy() videoPollPolicy {
	return videoPollPolicy{
		InitialDelay:          defaultVideoPollInterval,
		Interval:              defaultVideoPollInterval,
		MaxNotFoundMisses:     3,
		MaxMalformedResponses: 3,
		MaxDownloadTries:      3,
		RetryTransient:        true,
		Sleep:                 sleepContext,
		Notify:                notifyTaskVideoPollEvent,
	}
}

func runVideoPollLoop(ctx context.Context, taskID string, policy videoPollPolicy, query func(context.Context) (videoPollOutcome, error)) (map[string]interface{}, error) {
	policy = normalizeVideoPollPolicy(policy)
	deadline := providerPollingDeadline(ctx)
	pollContext, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	ctx = pollContext
	nextDelay := policy.InitialDelay
	notFoundMisses := 0
	malformedResponses := 0
	retrying := false
	for time.Now().Before(deadline) {
		if nextDelay > 0 {
			if err := policy.Sleep(ctx, nextDelay); err != nil {
				return nil, err
			}
		}
		outcome, err := query(ctx)
		if err != nil {
			if !policy.RetryTransient {
				return nil, err
			}
			retry, notFound := retryableVideoPollError(ctx, err)
			if !retry {
				return nil, err
			}
			malformed := isTransientResponseDecodeError(err)
			if malformed {
				malformedResponses++
				notFoundMisses = 0
				if malformedResponses >= policy.MaxMalformedResponses {
					return nil, err
				}
			} else if notFound {
				malformedResponses = 0
				notFoundMisses++
				if notFoundMisses >= policy.MaxNotFoundMisses {
					return nil, err
				}
			} else {
				malformedResponses = 0
				notFoundMisses = 0
			}
			if !retrying {
				retrying = true
				policy.Notify(ctx, taskID, videoPollEventRetrying, err)
			}
			nextDelay = max(policy.Interval, providerRetryAfter(err))
			continue
		}
		notFoundMisses = 0
		malformedResponses = 0
		nextDelay = policy.Interval
		if retrying {
			retrying = false
			policy.Notify(ctx, taskID, videoPollEventRecovered, nil)
		}
		if outcome.Done {
			return outcome.Result, nil
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return nil, context.DeadlineExceeded
}

func normalizeVideoPollPolicy(policy videoPollPolicy) videoPollPolicy {
	if policy.Interval <= 0 {
		policy.Interval = defaultVideoPollInterval
	}
	if policy.MaxNotFoundMisses <= 0 {
		policy.MaxNotFoundMisses = 3
	}
	if policy.MaxMalformedResponses <= 0 {
		policy.MaxMalformedResponses = 3
	}
	if policy.MaxDownloadTries <= 0 {
		policy.MaxDownloadTries = 3
	}
	if policy.Sleep == nil {
		policy.Sleep = sleepContext
	}
	if policy.Notify == nil {
		policy.Notify = func(context.Context, string, videoPollEvent, error) {}
	}
	return policy
}

func runVideoDownload(ctx context.Context, taskID string, policy videoPollPolicy, download func(context.Context) ([]byte, string, error)) ([]byte, string, error) {
	policy = normalizeVideoPollPolicy(policy)
	var lastErr error
	for attempt := 1; attempt <= policy.MaxDownloadTries; attempt++ {
		data, mimeType, err := download(ctx)
		if err == nil {
			return data, mimeType, nil
		}
		lastErr = err
		retry, _ := retryableVideoPollError(ctx, err)
		if !retry || attempt == policy.MaxDownloadTries {
			return nil, "", videoDownloadError{TaskID: taskID, Cause: err}
		}
		delay := max(policy.Interval, providerRetryAfter(err))
		if err := policy.Sleep(ctx, delay); err != nil {
			return nil, "", err
		}
	}
	return nil, "", videoDownloadError{TaskID: taskID, Cause: lastErr}
}

func retryableVideoPollError(ctx context.Context, err error) (retry bool, notFound bool) {
	if err == nil || ctx.Err() != nil || errors.Is(err, context.Canceled) {
		return false, false
	}
	var downloadError videoDownloadError
	if errors.As(err, &downloadError) {
		return false, false
	}
	if code, _ := ChannelSlotFailureDetails(err); code != "" {
		return true, false
	}
	var circuitOpen providerCircuitOpenError
	if errors.As(err, &circuitOpen) {
		return true, false
	}
	if isTransientResponseDecodeError(err) {
		return true, false
	}
	if errors.Is(err, io.ErrUnexpectedEOF) || errors.Is(err, io.ErrClosedPipe) {
		return true, false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true, false
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		if isProviderTaskNotReadyError(httpErr) {
			return true, true
		}
		if httpErr.StatusCode == http.StatusNotFound {
			return true, true
		}
		switch httpErr.StatusCode {
		case http.StatusRequestTimeout, http.StatusConflict, http.StatusTooEarly, http.StatusTooManyRequests:
			return true, false
		default:
			return httpErr.StatusCode >= http.StatusInternalServerError, false
		}
	}
	var networkError net.Error
	if errors.As(err, &networkError) {
		return networkError.Timeout() || networkError.Temporary(), false
	}
	return false, false
}

func isTransientResponseDecodeError(err error) bool {
	var decodeError providerResponseDecodeError
	if errors.As(err, &decodeError) {
		return true
	}
	var syntaxError *json.SyntaxError
	return errors.As(err, &syntaxError)
}

func notifyTaskVideoPollEvent(ctx context.Context, _ string, event videoPollEvent, eventErr error) {
	metadata, ok := ctx.Value(providerAnalyticsKey{}).(providerAnalyticsContext)
	if !ok || metadata.Service == nil || metadata.Service.repo == nil || metadata.TaskID == "" {
		return
	}
	message := "上游视频查询暂时异常，将继续轮询原任务"
	level := "warn"
	payload := ""
	if eventErr != nil {
		payload = eventErr.Error()
	}
	if event == videoPollEventRecovered {
		message = "上游视频查询已恢复"
		level = "info"
	}
	_ = metadata.Service.log(metadata.UserID, metadata.TaskID, level, message, payload)
}

func isProviderTaskNotReadyError(httpErr providerHTTPError) bool {
	if httpErr.StatusCode != http.StatusBadRequest && httpErr.StatusCode != http.StatusNotFound {
		return false
	}
	var payload map[string]any
	if json.Unmarshal([]byte(httpErr.Body), &payload) != nil {
		return false
	}
	code, message := providerFailureDetails(payload)
	for _, value := range []string{code, message} {
		switch strings.ToLower(strings.TrimSpace(value)) {
		case "task_not_exist", "task_not_found", "task not exist", "task not found":
			return true
		}
	}
	return false
}

func providerRetryAfter(err error) time.Duration {
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) && httpErr.RetryAfter > 0 {
		return httpErr.RetryAfter
	}
	return 0
}

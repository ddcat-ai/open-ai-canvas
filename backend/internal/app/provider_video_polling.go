package app

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

const defaultVideoPollInterval = 30 * time.Second

type videoPollPolicy struct {
	Interval          time.Duration
	MaxNotFoundMisses int
	Sleep             func(context.Context, time.Duration) error
}

type videoPollOutcome struct {
	Done   bool
	Result map[string]interface{}
}

func defaultVideoPollPolicy() videoPollPolicy {
	return videoPollPolicy{
		Interval:          defaultVideoPollInterval,
		MaxNotFoundMisses: 3,
		Sleep:             sleepContext,
	}
}

func runVideoPollLoop(ctx context.Context, taskID string, policy videoPollPolicy, query func(context.Context) (videoPollOutcome, error)) (map[string]interface{}, error) {
	policy = normalizeVideoPollPolicy(policy)
	deadline := providerPollingDeadline(ctx)
	nextDelay := policy.Interval
	notFoundMisses := 0
	for time.Now().Before(deadline) {
		if err := policy.Sleep(ctx, nextDelay); err != nil {
			return nil, err
		}
		outcome, err := query(ctx)
		if err != nil {
			retry, notFound := retryableVideoPollError(ctx, err)
			if !retry {
				return nil, err
			}
			if notFound {
				notFoundMisses++
				if notFoundMisses >= policy.MaxNotFoundMisses {
					return nil, err
				}
			} else {
				notFoundMisses = 0
			}
			nextDelay = max(policy.Interval, providerRetryAfter(err))
			continue
		}
		notFoundMisses = 0
		nextDelay = policy.Interval
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
	if policy.Sleep == nil {
		policy.Sleep = sleepContext
	}
	return policy
}

func retryableVideoPollError(ctx context.Context, err error) (retry bool, notFound bool) {
	if err == nil || ctx.Err() != nil || errors.Is(err, context.Canceled) {
		return false, false
	}
	if code, _ := ChannelSlotFailureDetails(err); code != "" {
		return true, false
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true, false
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
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

func providerRetryAfter(err error) time.Duration {
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) && httpErr.RetryAfter > 0 {
		return httpErr.RetryAfter
	}
	return 0
}

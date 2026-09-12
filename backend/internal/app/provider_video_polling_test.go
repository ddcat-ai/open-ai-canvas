package app

import (
	"context"
	"errors"
	"net/http"
	"reflect"
	"testing"
	"time"
)

func TestVideoPollRecoversFromTransientHTTPError(t *testing.T) {
	attempts := 0
	result, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		switch attempts {
		case 1:
			return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusBadGateway, Status: "502 Bad Gateway"}
		case 2:
			return videoPollOutcome{}, nil
		default:
			return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if attempts != 3 || result["mode"] != "video" {
		t.Fatalf("attempts = %d, result = %#v", attempts, result)
	}
}

func TestVideoPollWaitsBeforeFirstQueryAndUsesRetryAfter(t *testing.T) {
	var waits []time.Duration
	policy := fastVideoPollPolicy()
	policy.Interval = 10 * time.Millisecond
	policy.Sleep = func(_ context.Context, delay time.Duration) error {
		waits = append(waits, delay)
		return nil
	}
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", policy, func(context.Context) (videoPollOutcome, error) {
		attempts++
		if attempts == 1 {
			return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusTooManyRequests, RetryAfter: 20 * time.Millisecond}
		}
		return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if want := []time.Duration{10 * time.Millisecond, 20 * time.Millisecond}; !reflect.DeepEqual(waits, want) {
		t.Fatalf("waits = %v, want %v", waits, want)
	}
}

func TestVideoPollStopsImmediatelyOnAuthenticationError(t *testing.T) {
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusUnauthorized, Status: "401 Unauthorized"}
	})
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusUnauthorized {
		t.Fatalf("error = %#v, want 401 provider error", err)
	}
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
}

func TestVideoPollStopsAfterThreeConsecutiveNotFoundResponses(t *testing.T) {
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusNotFound, Status: "404 Not Found"}
	})
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) || httpErr.StatusCode != http.StatusNotFound {
		t.Fatalf("error = %#v, want 404 provider error", err)
	}
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3", attempts)
	}
}

func TestVideoPollSuccessfulPendingResponseResetsNotFoundCounter(t *testing.T) {
	attempts := 0
	result, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		switch attempts {
		case 1, 3:
			return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusNotFound, Status: "404 Not Found"}
		case 2:
			return videoPollOutcome{}, nil
		default:
			return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if attempts != 4 || result["mode"] != "video" {
		t.Fatalf("attempts = %d, result = %#v", attempts, result)
	}
}

func TestVideoPollContextCancellationInterruptsInitialWait(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	called := false
	_, err := runVideoPollLoop(ctx, "provider-task-1", defaultVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		called = true
		return videoPollOutcome{}, nil
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("error = %v, want context canceled", err)
	}
	if called {
		t.Fatal("query ran after cancellation")
	}
}

func fastVideoPollPolicy() videoPollPolicy {
	policy := defaultVideoPollPolicy()
	policy.Interval = time.Millisecond
	policy.Sleep = func(context.Context, time.Duration) error { return nil }
	return policy
}

func runVideoTaskForTest(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	return runVideoTaskWithPolicy(ctx, input, fastVideoPollPolicy())
}

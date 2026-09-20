package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
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
	policy.InitialDelay = 10 * time.Millisecond
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

func TestVideoPollRetriesMalformedResponseTwiceThenSucceeds(t *testing.T) {
	attempts := 0
	result, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		if attempts <= 2 {
			return videoPollOutcome{}, &json.SyntaxError{Offset: int64(attempts)}
		}
		return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
	})
	if err != nil || attempts != 3 || result["mode"] != "video" {
		t.Fatalf("result = %#v, error = %v, attempts = %d", result, err, attempts)
	}
}

func TestVideoPollStopsAfterThreeMalformedResponses(t *testing.T) {
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		return videoPollOutcome{}, &json.SyntaxError{Offset: int64(attempts)}
	})
	var syntaxError *json.SyntaxError
	if !errors.As(err, &syntaxError) || attempts != 3 {
		t.Fatalf("error = %#v, attempts = %d, want three attempts and syntax error", err, attempts)
	}
}

func TestVideoPollTreatsCircuitAndInterruptedReadsAsTransient(t *testing.T) {
	for _, err := range []error{providerCircuitOpenError{}, io.ErrUnexpectedEOF, io.ErrClosedPipe} {
		retry, notFound := retryableVideoPollError(context.Background(), err)
		if !retry || notFound {
			t.Fatalf("error %T classified as retry=%v notFound=%v", err, retry, notFound)
		}
	}
}

func TestVideoPollNotifiesOnlyWhenRetryStartsAndRecovers(t *testing.T) {
	var events []videoPollEvent
	policy := fastVideoPollPolicy()
	policy.Notify = func(_ context.Context, _ string, event videoPollEvent, _ error) {
		events = append(events, event)
	}
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", policy, func(context.Context) (videoPollOutcome, error) {
		attempts++
		switch attempts {
		case 1, 2:
			return videoPollOutcome{}, providerHTTPError{StatusCode: http.StatusBadGateway}
		case 3:
			return videoPollOutcome{}, nil
		default:
			return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []videoPollEvent{videoPollEventRetrying, videoPollEventRecovered}
	if len(events) != len(want) || events[0] != want[0] || events[1] != want[1] {
		t.Fatalf("events = %#v, want %#v", events, want)
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

func TestVideoPollAppliesFallbackDeadlineToWaitAndQuery(t *testing.T) {
	policy := fastVideoPollPolicy()
	waitHadDeadline := false
	queryHadDeadline := false
	policy.Sleep = func(ctx context.Context, _ time.Duration) error {
		_, waitHadDeadline = ctx.Deadline()
		return nil
	}
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", policy, func(ctx context.Context) (videoPollOutcome, error) {
		_, queryHadDeadline = ctx.Deadline()
		return videoPollOutcome{Done: true, Result: map[string]interface{}{"mode": "video"}}, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !waitHadDeadline || !queryHadDeadline {
		t.Fatalf("wait deadline = %v, query deadline = %v", waitHadDeadline, queryHadDeadline)
	}
}

func TestVideoDownloadRetriesTransientFailure(t *testing.T) {
	attempts := 0
	waits := 0
	policy := fastVideoPollPolicy()
	policy.Sleep = func(context.Context, time.Duration) error {
		waits++
		return nil
	}
	data, mimeType, err := runVideoDownload(context.Background(), "provider-task-1", policy, func(context.Context) ([]byte, string, error) {
		attempts++
		if attempts == 1 {
			return nil, "", providerHTTPError{StatusCode: http.StatusBadGateway, Status: "502 Bad Gateway"}
		}
		return []byte("video"), "video/mp4", nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "video" || mimeType != "video/mp4" || attempts != 2 || waits != 1 {
		t.Fatalf("data = %q, mime = %q, attempts = %d, waits = %d", data, mimeType, attempts, waits)
	}
}

func TestVideoDownloadStopsAfterThreeTransientFailures(t *testing.T) {
	attempts := 0
	_, _, err := runVideoDownload(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) ([]byte, string, error) {
		attempts++
		return nil, "", providerHTTPError{StatusCode: http.StatusServiceUnavailable, Status: "503 Service Unavailable"}
	})
	var httpErr providerHTTPError
	if !errors.As(err, &httpErr) || attempts != 3 {
		t.Fatalf("error = %#v, attempts = %d, want three attempts and provider error", err, attempts)
	}
}

func TestVideoPollDoesNotRetryExhaustedDownload(t *testing.T) {
	attempts := 0
	_, err := runVideoPollLoop(context.Background(), "provider-task-1", fastVideoPollPolicy(), func(context.Context) (videoPollOutcome, error) {
		attempts++
		return videoPollOutcome{}, videoDownloadError{TaskID: "provider-task-1", Cause: providerHTTPError{StatusCode: http.StatusBadGateway}}
	})
	var downloadError videoDownloadError
	if !errors.As(err, &downloadError) || attempts != 1 {
		t.Fatalf("error = %#v, poll attempts = %d, want one exhausted download", err, attempts)
	}
}

func fastVideoPollPolicy() videoPollPolicy {
	policy := defaultVideoPollPolicy()
	policy.InitialDelay = time.Millisecond
	policy.Interval = time.Millisecond
	policy.Sleep = func(context.Context, time.Duration) error { return nil }
	return policy
}

func runVideoTaskForTest(ctx context.Context, input canvasGenerationInput) (map[string]interface{}, error) {
	return runVideoTaskWithPolicy(ctx, input, fastVideoPollPolicy())
}

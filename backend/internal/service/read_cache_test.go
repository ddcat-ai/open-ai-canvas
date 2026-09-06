package service

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestReadCacheCoalescesBurstAndCoolsFailures(t *testing.T) {
	for _, fail := range []bool{false, true} {
		cache := newBoundedReadCache[string, int](4, 1024, 2, time.Minute)
		var calls atomic.Int32
		loadErr := errors.New("database unavailable")
		load := func(context.Context) (int, int, error) {
			calls.Add(1)
			if fail {
				return 0, 0, loadErr
			}
			return 42, 256, nil
		}
		var wg sync.WaitGroup
		for range 100 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				value, err := cache.get(context.Background(), "hot", load)
				if (fail && !errors.Is(err, loadErr)) || (!fail && (err != nil || value != 42)) {
					t.Errorf("value=%d error=%v fail=%v", value, err, fail)
				}
			}()
		}
		wg.Wait()
		if calls.Load() != 1 {
			t.Fatalf("burst caused %d loads (fail=%v)", calls.Load(), fail)
		}
	}
}

func TestReadCacheBoundsLoadsAndInvalidation(t *testing.T) {
	cache := newBoundedReadCache[string, int](2, 512, 1, time.Minute)
	started, release, done := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		_, _ = cache.get(context.Background(), "one", func(context.Context) (int, int, error) {
			close(started)
			<-release
			return 1, 256, nil
		})
	}()
	<-started
	load := func(context.Context) (int, int, error) { return 2, 256, nil }
	if _, err := cache.get(context.Background(), "two", load); !errors.Is(err, errReadCacheBusy) {
		t.Fatalf("unbounded distinct load: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	if _, err := cache.get(ctx, "one", load); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("waiting reader did not cancel: %v", err)
	}
	cache.clear()
	if _, err := cache.get(context.Background(), "two", load); !errors.Is(err, errReadCacheBusy) {
		t.Fatalf("invalidation bypassed in-flight limit: %v", err)
	}
	close(release)
	<-done
	value, err := cache.get(context.Background(), "one", load)
	if err != nil || value != 2 {
		t.Fatalf("in-flight load repopulated invalidated cache: %d %v", value, err)
	}
}

func TestReadCacheBudgetsExpiryAndNoStaleSuccess(t *testing.T) {
	cache := newBoundedReadCache[int, int](3, 512, 1, time.Minute)
	load := func(context.Context) (int, int, error) { return 1, 256, nil }
	for i := range 100 {
		if _, err := cache.get(context.Background(), i, load); err != nil {
			t.Fatal(err)
		}
	}
	if len(cache.entries) > 2 || cache.bytes > 512 {
		t.Fatalf("budget exceeded: entries=%d bytes=%d", len(cache.entries), cache.bytes)
	}
	cache.entries[99].expires = time.Now().Add(-time.Second)
	wantErr := errors.New("load failed")
	value, err := cache.get(context.Background(), 99, func(context.Context) (int, int, error) { return 0, 0, wantErr })
	if value != 0 || !errors.Is(err, wantErr) {
		t.Fatalf("stale success served: %d %v", value, err)
	}
	var calls int
	for range 2 {
		value, err = cache.get(context.Background(), 101, func(context.Context) (int, int, error) {
			calls++
			return 42, 1024, nil
		})
		if value != 42 || err != nil {
			t.Fatalf("oversized load should still return to caller: %d %v", value, err)
		}
	}
	if calls != 2 {
		t.Fatal("oversized entry was retained")
	}
}

func TestReadCacheCancelledLoadCanBeRetried(t *testing.T) {
	cache := newBoundedReadCache[string, int](1, 512, 1, time.Minute)
	_, err := cache.get(context.Background(), "key", func(context.Context) (int, int, error) { return 0, 0, context.Canceled })
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	value, err := cache.get(context.Background(), "key", func(context.Context) (int, int, error) { return 7, 256, nil })
	if err != nil || value != 7 {
		t.Fatalf("cancellation poisoned cache: %d %v", value, err)
	}
}

func TestReadCachePanicDoesNotLeakCapacity(t *testing.T) {
	cache := newBoundedReadCache[string, int](1, 512, 1, time.Minute)
	func() {
		defer func() {
			if recover() != "loader panic" {
				t.Error("original panic was swallowed")
			}
		}()
		_, _ = cache.get(context.Background(), "key", func(context.Context) (int, int, error) { panic("loader panic") })
	}()
	if cache.loads != 0 || len(cache.entries) != 0 {
		t.Fatal("panic leaked load capacity")
	}
	if _, err := cache.get(context.Background(), "key", func(context.Context) (int, int, error) { return 1, 256, nil }); err != nil {
		t.Fatal(err)
	}
}

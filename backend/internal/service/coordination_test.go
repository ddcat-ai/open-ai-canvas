package service

import (
	"context"
	"testing"
	"time"
)

func TestRuntimeCoordinatorWaitsUntilChannelSlotIsReleased(t *testing.T) {
	coordinator := &runtimeCoordinator{instanceID: "test", localRate: map[string]localRateEntry{}, localSlots: map[string]map[string]time.Time{}}
	releaseFirst, acquired, err := coordinator.acquire(context.Background(), "channel:one", 1, time.Minute)
	if err != nil || !acquired {
		t.Fatalf("first acquire = (%v, %v), want acquired", acquired, err)
	}

	result := make(chan error, 1)
	go func() {
		releaseSecond, waitErr := coordinator.acquireWithWait(context.Background(), "channel:one", 1, time.Minute)
		if waitErr == nil {
			releaseSecond()
		}
		result <- waitErr
	}()

	select {
	case err := <-result:
		t.Fatalf("second acquire returned before release: %v", err)
	case <-time.After(50 * time.Millisecond):
	}
	releaseFirst()
	select {
	case err := <-result:
		if err != nil {
			t.Fatalf("second acquire after release: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("second acquire did not resume after release")
	}
}

func TestRuntimeCoordinatorStopsWaitingWhenContextIsCancelled(t *testing.T) {
	coordinator := &runtimeCoordinator{instanceID: "test", localRate: map[string]localRateEntry{}, localSlots: map[string]map[string]time.Time{}}
	release, acquired, err := coordinator.acquire(context.Background(), "channel:one", 1, time.Minute)
	if err != nil || !acquired {
		t.Fatalf("first acquire = (%v, %v), want acquired", acquired, err)
	}
	defer release()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := coordinator.acquireWithWait(ctx, "channel:one", 1, time.Minute); err == nil {
		t.Fatal("acquireWithWait() error = nil after cancellation")
	}
}

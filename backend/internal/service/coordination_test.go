package service

import (
	"context"
	"testing"
	"time"
)

func TestRuntimeCoordinatorLeaseRenewsAndCannotResurrect(t *testing.T) {
	c := &runtimeCoordinator{instanceID: "test", localSlots: map[string]map[string]time.Time{}}
	lease, acquired, err := c.acquireLease(context.Background(), "workers", 1, time.Minute)
	if err != nil || !acquired {
		t.Fatalf("acquire: %v %v", acquired, err)
	}
	c.localSlots["workers"][lease.token] = time.Now().Add(10 * time.Second)
	if err := lease.renew(context.Background()); err != nil {
		t.Fatal(err)
	}
	if time.Until(c.localSlots["workers"][lease.token]) < 50*time.Second {
		t.Fatal("lease was not extended")
	}
	if _, ok, err := c.acquireLease(context.Background(), "workers", 1, time.Minute); err != nil || ok {
		t.Fatalf("capacity exceeded: %v %v", ok, err)
	}
	c.localSlots["workers"][lease.token] = time.Now().Add(-time.Second)
	if err := lease.renew(context.Background()); err == nil {
		t.Fatal("expired lease resurrected")
	}
	replacement, acquired, err := c.acquireLease(context.Background(), "workers", 1, time.Minute)
	if err != nil || !acquired {
		t.Fatalf("abandoned slot not recovered: %v %v", acquired, err)
	}
	lease.release()
	lease.release()
	if err := replacement.renew(context.Background()); err != nil {
		t.Fatalf("old release removed new lease: %v", err)
	}
	replacement.release()
	if len(c.localSlots) != 0 {
		t.Fatal("empty local slot scopes retained")
	}
}

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

func TestChannelSlotRetryDelayStaysWithinBackoffWindow(t *testing.T) {
	for _, base := range []time.Duration{200 * time.Millisecond, 400 * time.Millisecond, 800 * time.Millisecond, 1600 * time.Millisecond, 2 * time.Second} {
		for range 100 {
			if got := channelSlotRetryDelay(base); got < base/2 || got > base {
				t.Fatalf("delay %s outside [%s, %s]", got, base/2, base)
			}
		}
	}
}

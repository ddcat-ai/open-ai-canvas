package app

import (
	"errors"
	"sync"
	"testing"
	"time"
)

func TestCanvasStorageLockKeepsExclusiveStorageBarrier(t *testing.T) {
	svc := &Service{}
	entered, release, exclusive := make(chan struct{}), make(chan struct{}), make(chan struct{})
	done := make(chan error, 1)
	go func() {
		done <- svc.withCanvasStorageLock("owner", func() error {
			close(entered)
			<-release
			return nil
		})
	}()
	<-entered
	go func() {
		svc.storageMu.Lock()
		close(exclusive)
		svc.storageMu.Unlock()
	}()
	select {
	case <-exclusive:
		close(release)
		t.Fatal("exclusive storage operation entered during canvas save")
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	select {
	case <-exclusive:
	case <-time.After(3 * time.Second):
		t.Fatal("exclusive storage operation remained blocked")
	}

	svc.storageMu.Lock()
	go func() { done <- svc.withCanvasStorageLock("other", func() error { return nil }) }()
	select {
	case <-done:
		svc.storageMu.Unlock()
		t.Fatal("canvas save bypassed exclusive storage operation")
	case <-time.After(50 * time.Millisecond):
	}
	svc.storageMu.Unlock()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("canvas save remained blocked")
	}
}

func TestCanvasStorageLockReleasesOwnerOnErrorAndPanic(t *testing.T) {
	svc := &Service{}
	want := errors.New("save failed")
	if err := svc.withCanvasStorageLock("owner", func() error { return want }); err != want {
		t.Fatal(err)
	}
	func() {
		defer func() {
			if recover() != "test panic" {
				t.Error("callback panic was lost")
			}
		}()
		_ = svc.withCanvasStorageLock("owner", func() error { panic("test panic") })
	}()
	if err := svc.withCanvasStorageLock("owner", func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	if len(svc.canvasStorageOwners.locks) != 0 {
		t.Fatal("idle owner lock retained")
	}
	if err := svc.withCanvasStorageLock("", func() error { t.Error("empty owner entered callback"); return nil }); err == nil {
		t.Fatal("empty owner accepted")
	}
}

func TestCanvasStorageOwnerLocksCountWaitersAndReleaseKeys(t *testing.T) {
	var locks canvasStorageOwnerLocks
	var group sync.WaitGroup
	value := 0
	for i := 0; i < 64; i++ {
		group.Add(1)
		go func() {
			defer group.Done()
			release := locks.acquire("shared-team")
			defer release()
			value++
		}()
	}
	group.Wait()
	if value != 64 || len(locks.locks) != 0 {
		t.Fatalf("value=%d retained locks=%d", value, len(locks.locks))
	}
}

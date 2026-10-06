package app

import (
	"bytes"
	"testing"
	"time"
)

func TestChunkQuotaRejectsSingleFileLimit(t *testing.T) {
	svc := newResourceTestService(t)
	if _, err := svc.reserveChunkedUploadQuota("user-1", megabytes(defaultRuntimePolicy().Resource.ResourceUploadMB)); err == nil {
		t.Fatal("chunked upload accepted a file at the exclusive single-file limit")
	}
}

func TestChunkQuotaReservedUploadConsumesOnce(t *testing.T) {
	svc := newResourceTestService(t)
	if err := svc.ReserveChunkUploadSession("user", "session", 7, time.Now().Add(time.Hour), 32); err != nil {
		t.Fatal(err)
	}
	day := time.Now().UTC().Format("2006-01-02")
	if used, _ := svc.repo.DailyUploadBytes("user", day); used != 7 {
		t.Fatalf("quota before receiving bytes=%d", used)
	}
	resource, err := svc.UploadReservedResourceFile("user", "session", "test.txt", 7, "file", 0, 0, 0, bytes.NewReader([]byte("payload")), "logical-key")
	if err != nil {
		t.Fatal(err)
	}
	if resource.Size != 7 {
		t.Fatalf("size=%d", resource.Size)
	}
	if used, _ := svc.repo.DailyUploadBytes("user", day); used != 7 {
		t.Fatalf("quota after completion=%d", used)
	}
	if err := svc.ReserveChunkUploadSession("user", "retry", 7, time.Now().Add(time.Hour), 32); err != nil {
		t.Fatal(err)
	}
	reused, err := svc.UploadReservedResourceFile("user", "retry", "test.txt", 7, "file", 0, 0, 0, bytes.NewReader([]byte("payload")), "logical-key")
	if err != nil || reused.ID != resource.ID {
		t.Fatalf("retry=%v err=%v", reused, err)
	}
	if used, _ := svc.repo.DailyUploadBytes("user", day); used != 7 {
		t.Fatalf("quota after replay=%d", used)
	}
}

func TestChunkQuotaFailedCompletionReleases(t *testing.T) {
	svc := newResourceTestService(t)
	if err := svc.ReserveChunkUploadSession("user", "failed", 7, time.Now().Add(time.Hour), 32); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UploadReservedResourceFile("user", "failed", "test.txt", 7, "file", 0, 0, 0, nil); err == nil {
		t.Fatal("nil file accepted")
	}
	if used, _ := svc.repo.DailyUploadBytes("user", time.Now().UTC().Format("2006-01-02")); used != 0 {
		t.Fatalf("failed upload retained quota=%d", used)
	}
}

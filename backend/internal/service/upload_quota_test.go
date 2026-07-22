package service

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestReserveUserUploadQuotaRejectsSingleFileAtLimit(t *testing.T) {
	svc := newResourceTestService(t)
	_, err := svc.reserveUserUploadQuota("user-1", MaxResourceUploadBytes)
	if err == nil || !strings.Contains(err.Error(), "小于 50MB") {
		t.Fatalf("reserveUserUploadQuota() error = %v", err)
	}
}

func TestReserveUserUploadQuotaRejectsDailyTotalAtLimit(t *testing.T) {
	svc := newResourceTestService(t)
	for range 4 {
		if _, err := svc.reserveUserUploadQuota("user-1", 49<<20); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.reserveUserUploadQuota("user-1", 4<<20); err == nil || !strings.Contains(err.Error(), "小于 200MB") {
		t.Fatalf("reserveUserUploadQuota() error = %v", err)
	}
}

func TestReleaseUserUploadQuotaRestoresCapacity(t *testing.T) {
	svc := newResourceTestService(t)
	day, err := svc.reserveUserUploadQuota("user-1", 49<<20)
	if err != nil {
		t.Fatal(err)
	}
	svc.releaseUserUploadQuota("user-1", day, 49<<20)
	if _, err := svc.reserveUserUploadQuota("user-1", 49<<20); err != nil {
		t.Fatal(err)
	}
}

func TestCommitUserUploadQuotaKeepsDailyUsageWithoutPendingStorage(t *testing.T) {
	svc := newResourceTestService(t)
	day, err := svc.reserveUserUploadQuota("user-1", 49<<20)
	if err != nil {
		t.Fatal(err)
	}
	svc.commitUserUploadQuota("user-1", 49<<20)
	if svc.pendingStorage["user-1"] != 0 {
		t.Fatalf("pending storage = %d", svc.pendingStorage["user-1"])
	}
	usage, err := svc.repo.DailyUploadBytes("user-1", day)
	if err != nil {
		t.Fatal(err)
	}
	if usage != 49<<20 {
		t.Fatalf("daily usage = %d", usage)
	}
}

func TestReserveUserUploadQuotaRejectsTotalStoredFilesAtLimit(t *testing.T) {
	svc := newResourceTestService(t)
	if err := svc.repo.Create(&model.Resource{ID: "resource-1", UserID: "user-1", Status: model.ResourceStatusReady, Size: MaxUserStoredFileBytes - 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.reserveUserUploadQuota("user-1", 1); err == nil || !strings.Contains(err.Error(), "2GB 上限") {
		t.Fatalf("reserveUserUploadQuota() error = %v", err)
	}
}

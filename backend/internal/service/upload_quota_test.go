package service

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestReserveUserUploadQuotaRejectsSingleFileAtLimit(t *testing.T) {
	svc := newResourceTestService(t)
	_, err := svc.reserveUserUploadQuota("user-1", megabytes(defaultRuntimePolicy().Resource.ResourceUploadMB))
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
	if err := svc.repo.Create(&model.Resource{ID: "resource-1", UserID: "user-1", Status: model.ResourceStatusReady, Size: gigabytes(defaultRuntimePolicy().Resource.StoredFileGB) - 1}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.reserveUserUploadQuota("user-1", 1); err == nil || !strings.Contains(err.Error(), "2GB 上限") {
		t.Fatalf("reserveUserUploadQuota() error = %v", err)
	}
}

func TestAccountFileStorageUsageUsesStoredFilePolicy(t *testing.T) {
	svc := newResourceTestService(t)
	if err := svc.repo.Create(&model.Resource{ID: "resource-1", UserID: "user-1", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "ready.png", Size: 3 << 20}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.Resource{ID: "resource-duplicate", UserID: "user-1", Status: model.ResourceStatusReady, Provider: "", ObjectKey: "ready.png", Size: 3 << 20}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.Resource{ID: "resource-failed", UserID: "user-1", Status: model.ResourceStatusFailed, Provider: "local", ObjectKey: "failed.png", Size: 7 << 20}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.Resource{ID: "resource-pending", UserID: "user-1", Status: model.ResourceStatusPending, Provider: "local", ObjectKey: "pending.png", Size: 11 << 20}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.SessionFile{ID: "session-file-1", UserID: "user-1", SessionID: "session-1", Size: 2 << 20}); err != nil {
		t.Fatal(err)
	}
	usage, err := svc.AccountFileStorageUsage("user-1")
	if err != nil {
		t.Fatal(err)
	}
	if usage.UsedBytes != 5<<20 || usage.TotalBytes != gigabytes(defaultRuntimePolicy().Resource.StoredFileGB) {
		t.Fatalf("AccountFileStorageUsage() = %#v", usage)
	}
}

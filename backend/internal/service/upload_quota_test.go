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
	daily := megabytes(defaultRuntimePolicy().Resource.DailyUploadMB)
	chunk := int64(49 << 20)
	for used := int64(0); used+chunk <= daily; used += chunk {
		if _, err := svc.reserveUserUploadQuota("user-1", chunk); err != nil {
			t.Fatal(err)
		}
	}
	// 单文件限(50MB)未命中、今日额度已满 → 拒绝并提示每日上限。
	if _, err := svc.reserveUserUploadQuota("user-1", chunk); err == nil || !strings.Contains(err.Error(), "小于 2GB") {
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
	if _, err := svc.reserveUserUploadQuota("user-1", 1); err == nil || !strings.Contains(err.Error(), "20GB 上限") {
	}
}

func TestAccountFileStorageUsageUsesStoredFilePolicy(t *testing.T) {
	svc := newResourceTestService(t)
	if err := svc.repo.Create(&model.Resource{ID: "resource-1", UserID: "user-1", Status: model.ResourceStatusReady, Size: 3 << 20}); err != nil {
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

package app

import (
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestTaskTypeProducesStoredFile(t *testing.T) {
	for _, taskType := range []string{"canvas_image", "canvas_video", "canvas_audio", "video_generate"} {
		if !taskTypeProducesStoredFile(taskType) {
			t.Fatalf("taskTypeProducesStoredFile(%q) = false", taskType)
		}
	}
	for _, taskType := range []string{"text", "canvas_text"} {
		if taskTypeProducesStoredFile(taskType) {
			t.Fatalf("taskTypeProducesStoredFile(%q) = true", taskType)
		}
	}
}

func TestValidateStoredFileCapacityRejectsFullAccount(t *testing.T) {
	limit := gigabytes(defaultRuntimePolicy().Resource.StoredFileGB)
	for _, test := range []struct {
		name    string
		stored  int64
		pending int64
	}{
		{name: "stored files fill capacity", stored: limit},
		{name: "pending upload fills capacity", stored: limit - 1, pending: 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validateStoredFileCapacity(test.stored, test.pending, limit)
			if err == nil || !strings.Contains(err.Error(), "账号文件容量已达到") {
				t.Fatalf("validateStoredFileCapacity() error = %v", err)
			}
		})
	}
}

func TestValidateStoredFileCapacityAllowsRemainingSpace(t *testing.T) {
	limit := gigabytes(defaultRuntimePolicy().Resource.StoredFileGB)
	if err := validateStoredFileCapacity(limit-2, 1, limit); err != nil {
		t.Fatalf("validateStoredFileCapacity() error = %v", err)
	}
}

func TestRequireStoredFileCapacityForTaskChecksDailyUploadHeadroom(t *testing.T) {
	policy := defaultRuntimePolicy()
	dailyLimit := megabytes(policy.Resource.DailyUploadMB)
	generatedFileBytes := megabytes(policy.Resource.GeneratedFileMB)
	userID := "usr-admission-daily"
	day := time.Now().UTC().Format("2006-01-02")

	for _, test := range []struct {
		name    string
		used    int64
		wantErr bool
	}{
		{name: "exactly one maximum file remains", used: dailyLimit - generatedFileBytes, wantErr: true},
		{name: "one byte above maximum file remains", used: dailyLimit - generatedFileBytes - 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db := newTimelineTaskTestService(t)
			if err := db.Create(&model.UserDailyUploadUsage{ID: userID + ":" + day, UserID: userID, Day: day, Bytes: test.used}).Error; err != nil {
				t.Fatalf("seed daily upload usage: %v", err)
			}
			err := svc.requireStoredFileCapacityForTask(userID, "canvas_image", policy)
			if test.wantErr && (err == nil || !strings.Contains(err.Error(), "最大生成文件")) {
				t.Fatalf("requireStoredFileCapacityForTask() error = %v, want daily headroom rejection", err)
			}
			if !test.wantErr && err != nil {
				t.Fatalf("requireStoredFileCapacityForTask() error = %v, want nil", err)
			}
		})
	}
}

func TestRequireStoredFileCapacityForTaskChecksAssetQuota(t *testing.T) {
	for _, test := range []struct {
		name      string
		configure func(*RuntimePolicySetting)
		payload   string
		wantErr   string
	}{
		{name: "asset count full", configure: func(policy *RuntimePolicySetting) { policy.Resource.AssetCount = 1 }, wantErr: "账号素材数量已达到"},
		{name: "structured storage full", configure: func(policy *RuntimePolicySetting) { policy.Resource.StructuredDataMB = 1 }, payload: strings.Repeat("x", int(megabytes(1))+1), wantErr: "账号画布和素材数据已达到"},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc, db := newTimelineTaskTestService(t)
			policy := defaultRuntimePolicy()
			test.configure(&policy)
			if err := db.Create(&model.Asset{ID: "asset-admission-test", UserID: "usr-admission-asset", PayloadJSON: test.payload}).Error; err != nil {
				t.Fatalf("seed asset: %v", err)
			}
			err := svc.requireStoredFileCapacityForTask("usr-admission-asset", "canvas_image", policy)
			if err == nil || !strings.Contains(err.Error(), test.wantErr) {
				t.Fatalf("requireStoredFileCapacityForTask() error = %v, want %q", err, test.wantErr)
			}
		})
	}
}

func TestRequireStoredFileCapacityForTaskSkipsFileQuotasForText(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	policy := defaultRuntimePolicy()
	policy.Resource.AssetCount = 1
	userID := "usr-admission-text"
	day := time.Now().UTC().Format("2006-01-02")
	if err := db.Create(&model.Asset{ID: "asset-admission-text", UserID: userID}).Error; err != nil {
		t.Fatalf("seed asset: %v", err)
	}
	if err := db.Create(&model.UserDailyUploadUsage{ID: userID + ":" + day, UserID: userID, Day: day, Bytes: megabytes(policy.Resource.DailyUploadMB)}).Error; err != nil {
		t.Fatalf("seed daily upload usage: %v", err)
	}
	if err := db.Create(&model.Resource{ID: "resource-admission-text", UserID: userID, Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "admission-text.bin", Size: gigabytes(policy.Resource.StoredFileGB)}).Error; err != nil {
		t.Fatalf("seed stored resource: %v", err)
	}
	if err := svc.requireStoredFileCapacityForTask(userID, "text", policy); err != nil {
		t.Fatalf("requireStoredFileCapacityForTask(text) error = %v, want nil", err)
	}
}

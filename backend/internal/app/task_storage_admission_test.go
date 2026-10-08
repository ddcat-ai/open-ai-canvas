package app

import (
	"strings"
	"testing"
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

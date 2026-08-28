package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestNormalizedResourceProvider(t *testing.T) {
	for input, want := range map[string]string{"": "local", " LOCAL ": "local", "aliyun": "aliyun", "S3": "s3"} {
		if got := normalizedResourceProvider(input); got != want {
			t.Fatalf("normalizedResourceProvider(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestResourcePhysicalBytesForAdmin(t *testing.T) {
	if got := resourcePhysicalBytesForAdmin(model.Resource{Status: model.ResourceStatusPending, Size: 100}); got != 0 {
		t.Fatalf("pending resource bytes = %d, want 0", got)
	}
	if got := resourcePhysicalBytesForAdmin(model.Resource{Status: model.ResourceStatusReady, Size: 100}); got != 100 {
		t.Fatalf("ready resource bytes = %d, want 100", got)
	}
}

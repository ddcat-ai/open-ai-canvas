package app

import "testing"

func TestCloudAgentMediaApprovalAcceptsAdmittedPixels(t *testing.T) {
	resolved := map[string]any{
		"mode":              "image",
		"capabilityOptions": map[string]any{"size": "16:9", "imageResolution": "2k", "quality": "high"},
		"config":            map[string]any{"size": "2752x1536", "imageResolution": "2k", "quality": "high"},
	}
	for _, size := range []string{"16:9", "2752x1536"} {
		if err := validateCloudAgentResolvedMediaOptions(map[string]any{"size": size, "quality": "high", "imageResolution": "2k"}, resolved); err != nil {
			t.Fatalf("已批准的比例/像素应等价: size=%s err=%v", size, err)
		}
	}
	for _, requested := range []map[string]any{{"size": "1024x1024"}, {"size": "2752x1536", "quality": "low"}, {"size": "2752x1536", "imageResolution": "4k"}} {
		if err := validateCloudAgentResolvedMediaOptions(requested, resolved); err == nil {
			t.Fatalf("规格变动未被拒绝: %+v", requested)
		}
	}
}

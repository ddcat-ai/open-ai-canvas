package app

import "testing"

func TestResolveWorkbenchProviderConfigMapsWorkbenchParameters(t *testing.T) {
	service := &Service{}

	image, err := service.resolveWorkbenchProviderConfig(WorkbenchKindImage, "image-model", "logical-image", "", map[string]any{
		"size": "1024x1024", "quality": "high", "imageResolution": "2k", "count": 2,
	}, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]any{"model": "image-model", "size": "1024x1024", "quality": "high", "imageResolution": "2k", "count": "2"} {
		if image[key] != want {
			t.Errorf("image config[%q] = %#v, want %#v", key, image[key], want)
		}
	}

	video, err := service.resolveWorkbenchProviderConfig(WorkbenchKindVideo, "video-model", "logical-video", "", map[string]any{
		"seconds": 8, "ratio": "9:16", "resolution": "1080P", "generateAudio": true, "watermark": false,
	}, map[string]any{})
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]any{
		"model": "video-model", "videoSeconds": "8", "size": "9:16", "vquality": "1080P",
		"videoGenerateAudio": "true", "videoWatermark": "false",
	} {
		if video[key] != want {
			t.Errorf("video config[%q] = %#v, want %#v", key, video[key], want)
		}
	}
}

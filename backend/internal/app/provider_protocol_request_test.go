package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestProtocolRequestReferenceDurations(t *testing.T) {
	request := protocolRequestFromInput(canvasGenerationInput{
		Mode: "video",
		ReferenceImages: []providerMedia{
			{URL: "https://media.example/still.jpg", Width: 1920, Height: 1080},
			{URL: "https://media.example/animated.webp", DurationMs: 850},
		},
		ReferenceVideos: []providerMedia{{URL: "https://media.example/clip.mp4", DurationMs: 14350}},
		ReferenceAudios: []providerMedia{{URL: "https://media.example/sound.wav", DurationMs: 2000}},
	})
	if len(request.Images) != 2 || len(request.Videos) != 1 || len(request.Audios) != 1 {
		t.Fatalf("unexpected reference counts: %d images, %d videos, %d audio", len(request.Images), len(request.Videos), len(request.Audios))
	}
	still := request.Images[0].Metadata
	if _, ok := still["durationMs"]; ok {
		t.Errorf("still image has durationMs: %v", still["durationMs"])
	}
	if still["width"] != 1920 || still["height"] != 1080 {
		t.Errorf("still image dimensions = %v", still)
	}
	for _, tc := range []struct {
		kind     string
		metadata map[string]any
		want     int64
	}{
		{"animated image", request.Images[1].Metadata, 850},
		{"video", request.Videos[0].Metadata, 14350},
		{"audio", request.Audios[0].Metadata, 2000},
	} {
		if got := tc.metadata["durationMs"]; got != tc.want {
			t.Errorf("%s durationMs = %v, want %d", tc.kind, got, tc.want)
		}
	}
}

func TestProtocolRequestFromInputUsesConfiguredBase64ForOpenAIImage(t *testing.T) {
	request := protocolRequestFromInput(canvasGenerationInput{
		Mode: "image",
		Config: providerConfig{
			InterfaceType: string(model.ChannelInterfaceOpenAIImage),
			ImageParameters: map[string]any{
				"size": "1024x1024",
			},
		},
		ImageCapability: &ImageCapabilityConfig{
			ResponseFormat: ParameterSupport{Supported: true, Default: "b64_json"},
		},
	})

	if got := request.ProviderOptions[string(model.ChannelInterfaceOpenAIImage)]["response_format"]; got != "b64_json" {
		t.Fatalf("response_format = %#v, want b64_json", got)
	}
}

func TestProtocolRequestFromInputOmitsAutomaticOpenAIImageFormat(t *testing.T) {
	request := protocolRequestFromInput(canvasGenerationInput{
		Mode: "image",
		Config: providerConfig{
			InterfaceType:   string(model.ChannelInterfaceOpenAIImage),
			ImageParameters: map[string]any{"size": "1024x1024"},
		},
		ImageCapability: &ImageCapabilityConfig{
			ResponseFormat: ParameterSupport{Supported: true, Default: "auto"},
		},
	})

	if _, ok := request.ProviderOptions[string(model.ChannelInterfaceOpenAIImage)]["response_format"]; ok {
		t.Fatal("response_format should be omitted when the model default is auto")
	}
}

func TestProtocolRequestFromInputKeepsURLForUnsupportedOpenAIImageFormat(t *testing.T) {
	request := protocolRequestFromInput(canvasGenerationInput{
		Mode:   "image",
		Config: providerConfig{InterfaceType: string(model.ChannelInterfaceOpenAIImage)},
		ImageCapability: &ImageCapabilityConfig{
			ResponseFormat: ParameterSupport{Supported: false},
		},
	})

	if _, ok := request.ProviderOptions[string(model.ChannelInterfaceOpenAIImage)]["response_format"]; ok {
		t.Fatal("response_format should be omitted when the capability is unsupported")
	}
}

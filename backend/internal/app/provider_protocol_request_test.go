package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestProtocolRequestFromInputUsesBase64ForOpenAIImage(t *testing.T) {
	request := protocolRequestFromInput(canvasGenerationInput{
		Mode: "image",
		Config: providerConfig{
			InterfaceType: string(model.ChannelInterfaceOpenAIImage),
			ImageParameters: map[string]any{
				"size": "1024x1024",
			},
		},
		ImageCapability: &ImageCapabilityConfig{
			ResponseFormat: ParameterSupport{Supported: true},
		},
	})

	if got := request.ProviderOptions[string(model.ChannelInterfaceOpenAIImage)]["response_format"]; got != "b64_json" {
		t.Fatalf("response_format = %#v, want b64_json", got)
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

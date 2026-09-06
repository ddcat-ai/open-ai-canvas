package service

import "testing"

func TestGeminiWeb2APIImageDefaults(t *testing.T) {
	profile := DefaultImageCapabilityConfig("gemini-web2api-image", "gemini-image")
	if err := validateImageCapabilityConfig(profile); err != nil {
		t.Fatal(err)
	}
	if profile.Size.Parameter != "none" || profile.MaxOutputs != 1 || profile.Quality.Supported || profile.References.MaskSupported || profile.TransparentBackground.Supported || profile.OutputFormat.Supported || profile.ResponseFormat.Supported {
		t.Fatal("proxy image defaults must not advertise unsupported controls")
	}
}

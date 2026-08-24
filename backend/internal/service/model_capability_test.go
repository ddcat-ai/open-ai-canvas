package service

import (
	"fmt"
	"strings"
	"testing"
)

func TestValidateImageTaskRejectsOversizedGrokPromptByUTF8Bytes(t *testing.T) {
	prompt := strings.Repeat("中", 4001)
	input := canvasGenerationInput{
		Mode:   "image",
		Prompt: prompt,
		Config: providerConfig{InterfaceType: "grok-image", Model: "grok-imagine-image-quality"},
	}

	err := validateImageTask(DefaultImageCapabilityConfig("grok-image", "grok-imagine-image-quality"), input)
	if err == nil {
		t.Fatal("validateImageTask() error = nil")
	}
	wantBytes := fmt.Sprintf("%d UTF-8 字节", len(prompt))
	if !strings.Contains(err.Error(), wantBytes) || !strings.Contains(err.Error(), "8000") || !strings.Contains(err.Error(), "连线文本") {
		t.Fatalf("validateImageTask() error = %q", err)
	}
}

func TestValidateImageTaskDoesNotApplyQualityPromptLimitToGrokLite(t *testing.T) {
	prompt := strings.Repeat("中", 4001)
	input := canvasGenerationInput{
		Mode:   "image",
		Prompt: prompt,
		Config: providerConfig{InterfaceType: "grok-image", Model: "grok-imagine-image"},
	}

	if err := validateImageTask(DefaultImageCapabilityConfig("grok-image", "grok-imagine-image"), input); err != nil {
		t.Fatalf("validateImageTask() error = %q", err)
	}
}

func TestValidateImageTaskEnforcesGPTImage2CustomSizeLimits(t *testing.T) {
	profile := DefaultImageCapabilityConfig("openai-image", "gpt-image-2")
	profile.Size.AllowCustom = true

	valid := canvasGenerationInput{Mode: "image", Config: providerConfig{InterfaceType: "openai-image", Model: "gpt-image-2", Size: "3840x1920"}}
	if err := validateImageTask(profile, valid); err != nil {
		t.Fatalf("validateImageTask(valid) error = %v", err)
	}

	tests := map[string]string{
		"4096x2048": "最长边",
		"3840x2161": "16 的倍数",
		"3840x1024": "宽高比",
		"640x640":   "总像素",
	}
	for size, want := range tests {
		t.Run(size, func(t *testing.T) {
			input := canvasGenerationInput{Mode: "image", Config: providerConfig{InterfaceType: "openai-image", Model: "gpt-image-2", Size: size}}
			err := validateImageTask(profile, input)
			if err == nil || !strings.Contains(err.Error(), want) {
				t.Fatalf("validateImageTask(%s) error = %v, want %q", size, err, want)
			}
		})
	}
}

func TestDefaultVideoCapabilityUsesProtocolSpecificResolutionTiers(t *testing.T) {
	tests := map[string][]string{
		"newapi-channel-2":        {"480p", "720p", "1080p", "1440p", "2160p"},
		"volcengine-ark-video":    {"480p", "720p", "1080p"},
		"volcengine-jimeng-video": {"720p"},
		"gemini-veo":              {"720p", "1080p"},
	}
	for protocol, want := range tests {
		t.Run(protocol, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel(protocol, "")
			if profile == nil || profile.Video == nil {
				t.Fatalf("DefaultModelCapabilityConfigForModel(%q) video profile = nil", protocol)
			}
			if fmt.Sprint(profile.Video.Resolutions) != fmt.Sprint(want) {
				t.Fatalf("resolutions = %v, want %v", profile.Video.Resolutions, want)
			}
		})
	}
}

func TestDefaultMiniMaxVideoCapabilitySupportsReferenceGeneration(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("minimax-video", "MiniMax-H3")
	if profile == nil || profile.Video == nil {
		t.Fatal("MiniMax video profile = nil")
	}
	if !containsCapabilityString(profile.Video.Operations, "reference_to_video") {
		t.Fatalf("operations = %v, want reference_to_video", profile.Video.Operations)
	}
}

func TestDefaultVolcengineArkVideoCapabilitySupportsFullModalReference(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("volcengine-ark-video", "doubao-seedance-2-0-260128")
	if profile == nil || profile.Video == nil {
		t.Fatal("Volcengine Ark video profile = nil")
	}
	for _, operation := range []string{"reference_to_video", "audio_to_video"} {
		if !containsCapabilityString(profile.Video.Operations, operation) {
			t.Fatalf("operations = %v, want %s", profile.Video.Operations, operation)
		}
	}
	if profile.Video.References.MaxImages != 9 || profile.Video.References.MaxVideos != 3 || profile.Video.References.MaxAudios != 3 {
		t.Fatalf("reference limits = %#v", profile.Video.References)
	}
}

func TestValidateVolcengineArkFullModalReferenceRejectsTextAndAudioOnly(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("volcengine-ark-video", "doubao-seedance-2-0-260128").Video
	input := canvasGenerationInput{
		Prompt:          "follow the soundtrack",
		Config:          providerConfig{InterfaceType: "volcengine-ark-video", VideoSeconds: "6", Size: "16:9", VQuality: "720p"},
		ReferenceAudios: []providerMedia{{URL: "https://example.com/music.mp3"}},
		Metadata:        map[string]interface{}{"videoEditOperation": "audio_to_video"},
	}
	err := validateVideoTask(profile, input)
	if err == nil || !strings.Contains(err.Error(), "文本+音频") {
		t.Fatalf("validateVideoTask() error = %v", err)
	}

	input.ReferenceImages = []providerMedia{{URL: "https://example.com/subject.png"}}
	if err := validateVideoTask(profile, input); err != nil {
		t.Fatalf("validateVideoTask(full modal) error = %v", err)
	}
}

func TestCapabilitySpecFromModelCapabilityConfigRestoresLegacyWildcardImageSizes(t *testing.T) {
	config := &ModelCapabilityConfig{
		Version: 1,
		Image: &ImageCapabilityConfig{
			Size: ImageSizeConfig{Parameter: "size", Values: []string{"*"}, AllowCustom: true},
		},
	}

	spec, err := CapabilitySpecFromModelCapabilityConfig(config, "image")
	if err != nil {
		t.Fatalf("CapabilitySpecFromModelCapabilityConfig() error = %v", err)
	}
	constraint, ok := spec.Options["size"]
	if !ok {
		t.Fatal("size constraint is missing")
	}
	values := make(map[string]int)
	for _, value := range constraint.Values {
		values[fmt.Sprint(value)]++
	}
	for _, value := range legacyImageSizeValues() {
		if values[value] != 1 {
			t.Fatalf("size constraint missing %q: %v", value, constraint.Values)
		}
	}
	if values["*"] != 1 {
		t.Fatalf("size constraint wildcard count = %d, values = %v", values["*"], constraint.Values)
	}
}

func TestNormalizeResolutionSupportsCommonAliases(t *testing.T) {
	tests := map[string]string{
		"1440":  "1440p",
		"1440p": "1440p",
		"2K":    "1440p",
		"4K":    "2160p",
		"768P":  "768p",
	}
	for input, want := range tests {
		if got := normalizeResolution(input); got != want {
			t.Fatalf("normalizeResolution(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestValidateVideoTaskIgnoresGlobalResolutionWhenCatalogDeclaresNone(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("newapi", "omni").Video
	profile.Duration = VideoDurationConfig{Selection: "enum", Values: []int{8, 10}, Default: 10}
	profile.Ratios = []string{"16:9", "9:16"}
	profile.DefaultRatio = "16:9"
	profile.Resolutions = nil
	profile.DefaultResolution = ""
	profile.References.MaxImages = 0
	profile.Operations = []string{"text_to_video"}
	profile.DefaultOperation = "text_to_video"

	err := validateVideoTask(profile, canvasGenerationInput{
		Config: providerConfig{Model: "omni", VideoSeconds: "10", Size: "16:9", VQuality: "720"},
	})
	if err != nil {
		t.Fatalf("validateVideoTask() error = %v", err)
	}
}

func TestNormalizeVideoCapabilityAllowsOmittedResolution(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("newapi-channel-2", "endpoint-video").Video
	profile.Resolutions = nil
	profile.DefaultResolution = ""

	result, err := NormalizeModelCapabilityConfig("video", "newapi-channel-2", &ModelCapabilityConfig{Version: 1, Video: profile})
	if err != nil {
		t.Fatalf("NormalizeModelCapabilityConfig() error = %v", err)
	}
	if result.Video == nil || len(result.Video.Resolutions) != 0 || result.Video.DefaultResolution != "" {
		t.Fatalf("normalized video resolution = %#v", result.Video)
	}
}

func TestCapabilitySpecFromModelCapabilityConfigProjectsImageSizeOnce(t *testing.T) {
	config := &ModelCapabilityConfig{
		Version: 1,
		Image: &ImageCapabilityConfig{
			References: ImageReferenceConfig{MaxImages: 3, MaskSupported: false},
			Size:       ImageSizeConfig{Parameter: "size", Values: []string{"1:1", "16:9"}, AllowCustom: true},
			MaxOutputs: 4,
		},
	}

	spec, err := CapabilitySpecFromModelCapabilityConfig(config, "image")
	if err != nil {
		t.Fatalf("CapabilitySpecFromModelCapabilityConfig() error = %v", err)
	}
	if got := spec.Options["size"].Values; len(got) != 3 || got[0] != "1:1" || got[1] != "16:9" || got[2] != "*" {
		t.Fatalf("size projection = %#v, want configured values plus wildcard", got)
	}
	if got := spec.Inputs["image"].Max; got != 3 {
		t.Fatalf("image input max = %d, want 3", got)
	}
	if got := spec.Options["count"].Max; got == nil || *got != 4 {
		t.Fatalf("count max = %v, want 4", got)
	}
}

func TestCapabilitySpecFromModelCapabilityConfigProjectsCustomImageSizeAsWildcard(t *testing.T) {
	config := &ModelCapabilityConfig{
		Version: 1,
		Image: &ImageCapabilityConfig{
			Size:       ImageSizeConfig{Parameter: "size", Values: []string{"1:1"}, AllowCustom: true},
			MaxOutputs: 1,
		},
	}

	spec, err := CapabilitySpecFromModelCapabilityConfig(config, "image")
	if err != nil {
		t.Fatalf("CapabilitySpecFromModelCapabilityConfig() error = %v", err)
	}
	if got := spec.Options["size"].Values; len(got) != 2 || got[0] != "1:1" || got[1] != "*" {
		t.Fatalf("custom size projection = %#v, want configured value plus wildcard", got)
	}
}

func TestCapabilitySpecFromModelCapabilityConfigAllowsAudioWithoutConfig(t *testing.T) {
	spec, err := CapabilitySpecFromModelCapabilityConfig(nil, "audio")
	if err != nil {
		t.Fatalf("audio projection error = %v", err)
	}
	if spec.Capability != "audio" || len(spec.Inputs) != 0 || len(spec.Options) != 0 {
		t.Fatalf("audio projection = %#v", spec)
	}
}

func TestValidateVideoTaskRequiresDeclaredMinimumImages(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("newapi-channel-2", "image-required-video").Video
	profile.References.MinImages = 1
	profile.References.MaxImages = 2
	profile.Operations = []string{"image_to_video"}
	profile.DefaultOperation = "image_to_video"

	err := validateVideoTask(profile, canvasGenerationInput{
		Config: providerConfig{Model: "image-required-video", VideoSeconds: "6", Size: "16:9", VQuality: "720"},
	})
	if err == nil || !strings.Contains(err.Error(), "至少需要 1 张参考图") {
		t.Fatalf("validateVideoTask() error = %v", err)
	}
}

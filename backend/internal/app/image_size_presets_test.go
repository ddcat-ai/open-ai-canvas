package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestImageSizePresetsValidationAndRoundTrip(t *testing.T) {
	profile := DefaultImageCapabilityConfig("openai-image", "test")
	profile.Size = ImageSizeConfig{Parameter: "size", Values: []string{"1824x1024", "1920x1080"}, Default: "1824x1024", Presets: []ImageSizePreset{
		{Tier: "1k", Ratio: "16:9", Size: "1824x1024", Width: 1824, Height: 1024},
		{Tier: "2k", Ratio: "16:9", Size: "1920x1080", Width: 1920, Height: 1080},
	}}
	if err := validateImageCapabilityConfig(profile); err != nil {
		t.Fatal(err)
	}
	data, err := json.Marshal(profile)
	if err != nil {
		t.Fatal(err)
	}
	var restored ImageCapabilityConfig
	if err := json.Unmarshal(data, &restored); err != nil || len(restored.Size.Presets) != 2 || restored.Size.Presets[1].Size != "1920x1080" {
		t.Fatalf("presets did not survive JSON round trip: %v", err)
	}

	for _, tc := range []struct {
		name string
		edit func(*ImageCapabilityConfig)
		want string
	}{
		{"invalid tier", func(p *ImageCapabilityConfig) { p.Size.Presets[0].Tier = "8k" }, "档位"},
		{"zero ratio", func(p *ImageCapabilityConfig) { p.Size.Presets[0].Ratio = "0:9" }, "比例"},
		{"mismatched ratio", func(p *ImageCapabilityConfig) { p.Size.Presets[0].Ratio = "9:16" }, "不一致"},
		{"tiny size", func(p *ImageCapabilityConfig) {
			p.Size.Presets[0].Width = 16
			p.Size.Presets[0].Height = 16
			p.Size.Presets[0].Size = "16x16"
		}, "像素"},
		{"size mismatch", func(p *ImageCapabilityConfig) { p.Size.Presets[0].Size = "1024x1024" }, "像素"},
		{"not supported", func(p *ImageCapabilityConfig) { p.Size.Values = []string{"1824x1024"} }, "支持值"},
		{"duplicate equivalent ratio", func(p *ImageCapabilityConfig) { p.Size.Presets[1].Tier = "1k"; p.Size.Presets[1].Ratio = "32:18" }, "重复"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var p ImageCapabilityConfig
			if err := json.Unmarshal(data, &p); err != nil {
				t.Fatal(err)
			}
			tc.edit(&p)
			if err := validateImageCapabilityConfig(&p); err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected %s, got %v", tc.want, err)
			}
		})
	}
}

func TestImageQualityDoesNotSelectResolutionPresets(t *testing.T) {
	profile := DefaultImageCapabilityConfig("openai-image", "test")
	profile.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"1:1"}, Default: "1:1", Presets: []ImageSizePreset{
		{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024},
	}}
	profile.Resolution = ImageResolutionConfig{Supported: false, Default: "auto"}
	profile.Quality = ImageQualityConfig{Supported: true, Values: []string{"medium", "high", "max"}, Default: "medium"}
	if err := validateImageCapabilityConfig(profile); err != nil {
		t.Fatalf("quality-only capability rejected: %v", err)
	}
	for _, quality := range profile.Quality.Values {
		input := canvasGenerationInput{Mode: "image", Prompt: "local test", Config: providerConfig{InterfaceType: "openai-image", Model: "test", Size: "1:1", Quality: quality, Count: "1"}}
		raw := map[string]any{"config": map[string]any{"size": "1:1", "quality": quality}}
		if err := validateImageTaskWithResolvedSize(raw, &input, profile); err != nil {
			t.Fatalf("quality %q rejected: %v", quality, err)
		}
		if input.Config.Size != "1024x1024" || input.Config.Quality != quality {
			t.Fatalf("quality changed preset or value: %+v", input.Config)
		}
	}
	profile.Resolution.Supported = true
	if err := validateImagePresetSelection(profile, "2k", "1:1"); err == nil {
		t.Fatal("independent resolution must still reject an undeclared combination")
	}
}

func TestResolveImageTaskSizeUsesRouteEncodingForDeclaredAlias(t *testing.T) {
	profile := &ImageCapabilityConfig{
		Size: ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"16:9"}, Default: "16:9", Presets: []ImageSizePreset{
			{Tier: "1k", Ratio: "16:9", Size: "1824x1024"},
		}},
		Quality: ImageQualityConfig{Supported: true, Values: []string{"1k"}, Default: "1k"},
	}
	if got := resolveImageTaskSize(profile, string(model.ChannelInterfaceGrokImage), "1824x1024", "1k"); got != "16:9" {
		t.Fatalf("aspect-ratio route got %q, want canonical ratio 16:9", got)
	}
	if got := resolveImageTaskSize(profile, string(model.ChannelInterfaceOpenAIImage), "32:18", "1k"); got != "1824x1024" {
		t.Fatalf("pixel route got %q, want declared pixel size 1824x1024", got)
	}
}

func TestImageSizePresetsEnforceResolutionRatioPair(t *testing.T) {
	profile := DefaultImageCapabilityConfig("grok-image", "grok-imagine-image")
	profile.Resolution.Default = "1k"
	profile.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"1:1", "16:9"}, Default: "1:1", Presets: []ImageSizePreset{
		{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024},
		{Tier: "2k", Ratio: "16:9", Size: "2752x1536", Width: 2752, Height: 1536},
	}}
	if err := validateImageCapabilityConfig(profile); err != nil {
		t.Fatal(err)
	}
	profile.Resolution.Default = "2k"
	if err := validateImageCapabilityConfig(profile); err == nil || !strings.Contains(err.Error(), "默认图片分辨率") {
		t.Fatalf("expected invalid default pair error, got %v", err)
	}
	profile.Resolution.Default = "1k"
	input := canvasGenerationInput{Config: providerConfig{Size: "1:1", ImageResolution: "2k"}}
	if err := validateImageTask(profile, input); err == nil || !strings.Contains(err.Error(), "当前分辨率") {
		t.Fatalf("expected pair validation error, got %v", err)
	}
	input.Config.Size = "16:9"
	if err := validateImageTask(profile, input); err != nil {
		t.Fatal(err)
	}
	profile.Size.AllowCustom = true
	input.Config.Size = "1:1"
	if err := validateImageTask(profile, input); err != nil {
		t.Fatal(err)
	}
}

func pixelSizeTestProfile() *ImageCapabilityConfig {
	profile := DefaultImageCapabilityConfig("openai-image", "gpt-image-2.5-4k")
	profile.Size = ImageSizeConfig{Parameter: "size", Values: []string{"2048x2048", "2752x1536", "2880x2880", "3840x2160"}, Default: "2752x1536", Presets: []ImageSizePreset{
		{Tier: "2k", Ratio: "1:1", Size: "2048x2048", Width: 2048, Height: 2048},
		{Tier: "2k", Ratio: "16:9", Size: "2752x1536", Width: 2752, Height: 1536},
		{Tier: "4k", Ratio: "1:1", Size: "2880x2880", Width: 2880, Height: 2880},
		{Tier: "4k", Ratio: "16:9", Size: "3840x2160", Width: 3840, Height: 2160},
	}}
	profile.Quality = ImageQualityConfig{Supported: true, Values: []string{"2k", "4k"}, Default: "2k"}
	return profile
}

func TestResolveImageTaskSizeUsesTierRatioPreset(t *testing.T) {
	profile := pixelSizeTestProfile()
	for _, tc := range []struct {
		name, size, quality, want string
	}{
		{"2k ratio preset", "16:9", "2k", "2752x1536"},
		{"4k ratio preset", "1:1", "4k", "2880x2880"},
		{"quality alias", "16:9", "medium", "2752x1536"},
		{"fallback to default tier", "1:1", "", "2048x2048"},
		{"pixel passthrough", "2048x2048", "2k", "2048x2048"},
		{"auto passthrough", "auto", "2k", "auto"},
		{"undeclared ratio stays for validation", "3:2", "2k", "3:2"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveImageTaskSize(profile, "openai-image", tc.size, tc.quality); got != tc.want {
				t.Fatalf("resolveImageTaskSize(%q, %q) = %q; want %q", tc.size, tc.quality, got, tc.want)
			}
		})
	}
	aspectProfile := DefaultImageCapabilityConfig("grok-image", "grok-imagine-image")
	aspectProfile.Size = ImageSizeConfig{Parameter: "aspect_ratio", Values: []string{"1:1", "16:9"}, Default: "1:1"}
	if got := resolveImageTaskSize(aspectProfile, "grok-image", "16:9", "2k"); got != "16:9" {
		t.Fatalf("aspect_ratio profile size changed: %q", got)
	}
	if got := resolveImageTaskSize(nil, "openai-image", "16:9", "2k"); got != "16:9" {
		t.Fatalf("nil profile size changed: %q", got)
	}
}

func TestValidateTaskCapabilityRewritesRatioSizeToPixelPreset(t *testing.T) {
	config := DefaultModelCapabilityConfigForModel("openai-image", "gpt-image-2.5-4k")
	config.Image = pixelSizeTestProfile()
	config.Image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"2k", "4k"}, Default: "2k"}
	config.Image.Quality = ImageQualityConfig{Supported: false}
	for _, tc := range []struct {
		name, size, resolution, wantSize string
	}{
		{"2k preset", "16:9", "2k", "2752x1536"},
		{"4k preset", "1:1", "4k", "2880x2880"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := map[string]any{
				"mode": "image", "prompt": "A simple gray circle on a white background.",
				"config": map[string]any{"interfaceType": "openai-image", "model": "gpt-image-2.5-4k", "size": tc.size, "imageResolution": tc.resolution, "count": "1", "capabilityConfig": config},
			}
			data, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			var normalized map[string]any
			if err := json.Unmarshal(data, &normalized); err != nil {
				t.Fatal(err)
			}
			if err := (&Service{}).ValidateTaskCapability(normalized); err != nil {
				t.Fatalf("ValidateTaskCapability() error = %v", err)
			}
			rewritten := normalized["config"].(map[string]any)["size"]
			if rewritten != tc.wantSize {
				t.Fatalf("config.size = %v; want %q", rewritten, tc.wantSize)
			}
		})
	}
	t.Run("undeclared ratio fails validation locally", func(t *testing.T) {
		input := map[string]any{
			"mode": "image", "prompt": "A simple gray circle on a white background.",
			"config": map[string]any{"interfaceType": "openai-image", "model": "gpt-image-2.5-4k", "size": "3:2", "imageResolution": "2k", "count": "1", "capabilityConfig": config},
		}
		data, err := json.Marshal(input)
		if err != nil {
			t.Fatal(err)
		}
		var normalized map[string]any
		if err := json.Unmarshal(data, &normalized); err != nil {
			t.Fatal(err)
		}
		err = (&Service{}).ValidateTaskCapability(normalized)
		if err == nil || !strings.Contains(err.Error(), "支持范围") {
			t.Fatalf("expected local size validation error, got %v", err)
		}
	})
}

func TestValidateTaskCapabilityRewritesOpenAIAspectPresetToPixelSize(t *testing.T) {
	config := DefaultModelCapabilityConfigForModel("openai-image", "gpt-image-2.5-4k")
	config.Image.Size = ImageSizeConfig{
		Parameter: "aspect_ratio",
		Values:    []string{"9:16"},
		Default:   "9:16",
		Presets: []ImageSizePreset{
			{Tier: "2k", Ratio: "9:16", Size: "1536x2752", Width: 1536, Height: 2752},
			{Tier: "4k", Ratio: "9:16", Size: "2160x3840", Width: 2160, Height: 3840},
		},
	}
	config.Image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"2k", "4k"}, Default: "2k"}
	config.Image.Quality = ImageQualityConfig{Supported: false}
	input := map[string]any{
		"mode":   "image",
		"prompt": "A simple gray circle on a white background.",
		"config": map[string]any{
			"interfaceType":    "openai-image",
			"model":            "gpt-image-2.5-4k",
			"size":             "9:16",
			"imageResolution":  "2k",
			"count":            "1",
			"capabilityConfig": config,
		},
	}
	data, err := json.Marshal(input)
	if err != nil {
		t.Fatal(err)
	}
	var normalized map[string]any
	if err := json.Unmarshal(data, &normalized); err != nil {
		t.Fatal(err)
	}
	if err := (&Service{}).ValidateTaskCapability(normalized); err != nil {
		t.Fatalf("ValidateTaskCapability() error = %v", err)
	}
	if got := normalized["config"].(map[string]any)["size"]; got != "1536x2752" {
		t.Fatalf("config.size = %v; want 1536x2752", got)
	}
}

// 比例型线路在任务输入边界把画布比例换算成 preset 像素值后，执行前的 provider 预检会用
// 同一份能力画像再校验一次；换算结果必须继续被认成合法尺寸，否则任务会在发请求前被本地
// 拒绝（线上表现为「图片尺寸不在当前模型支持范围内」，出站记录为 provider-preflight）。
func TestValidateImageTaskAcceptsResolvedPresetPixelSize(t *testing.T) {
	profile := DefaultImageCapabilityConfig("openai-image", "gpt-image-2.5")
	profile.Size = ImageSizeConfig{
		Parameter: "aspect_ratio",
		Values:    []string{"1:1", "4:3"},
		Default:   "1:1",
		Presets: []ImageSizePreset{
			{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024},
			{Tier: "1k", Ratio: "4:3", Size: "1360x1024", Width: 1360, Height: 1024},
			{Tier: "2k", Ratio: "4:3", Size: "2304x1728", Width: 2304, Height: 1728},
		},
	}
	profile.Quality = ImageQualityConfig{Supported: true, Values: []string{"1k", "2k"}, Default: "1k"}

	raw := map[string]any{"config": map[string]any{"size": "4:3", "quality": "1k"}}
	taskInput := canvasGenerationInput{Mode: "image", Prompt: "a simple circle", Config: providerConfig{InterfaceType: "openai-image", Model: "gpt-image-2.5", Size: "4:3", Quality: "1k", Count: "1"}}
	if err := validateImageTaskWithResolvedSize(raw, &taskInput, profile); err != nil {
		t.Fatalf("resolve step error = %v", err)
	}
	if taskInput.Config.Size != "1360x1024" {
		t.Fatalf("resolved size = %q; want 1360x1024", taskInput.Config.Size)
	}
	if got := raw["config"].(map[string]any)["size"]; got != "1360x1024" {
		t.Fatalf("persisted config.size = %v; want 1360x1024", got)
	}

	// 执行前预检用同一份画像再校验已换算的像素值，必须通过。
	if err := validateImageTask(profile, taskInput); err != nil {
		t.Fatalf("provider preflight rejected the resolved pixel size: %v", err)
	}

	// 未声明的像素值仍然拒绝。
	undeclared := taskInput
	undeclared.Config.Size = "2000x2000"
	if err := validateImageTask(profile, undeclared); err == nil || !strings.Contains(err.Error(), "图片尺寸") {
		t.Fatalf("undeclared pixel size should stay rejected, got %v", err)
	}

	// 其他档位的 preset 像素值不能借低档质量通过。
	wrongTier := taskInput
	wrongTier.Config.Size = "2304x1728"
	if err := validateImageTask(profile, wrongTier); err == nil || !strings.Contains(err.Error(), "图片尺寸") {
		t.Fatalf("other-tier pixel size should stay rejected, got %v", err)
	}
}

package app

import (
	"errors"
	"fmt"
	"strings"
	"testing"
)

func TestKlingFlashReleaseRejectsExpandedCapabilityAtSave(t *testing.T) {
	const provider, modelName = "kling-v4-official", "kling-4.0-flash"
	registry := loadOfficialFallbackRegistry()
	for _, test := range []struct {
		name   string
		mutate func(*VideoCapabilityConfig)
	}{
		{"mode", func(video *VideoCapabilityConfig) { video.Operations = append(video.Operations, "extend") }},
		{"resolution", func(video *VideoCapabilityConfig) { video.Resolutions = append(video.Resolutions, "1080p") }},
		{"duration", func(video *VideoCapabilityConfig) { video.Duration.Max = 21 }},
		{"fixed duration", func(video *VideoCapabilityConfig) {
			video.Duration = VideoDurationConfig{Selection: "enum", Values: []int{2}, Default: 2}
		}},
		{"ratio", func(video *VideoCapabilityConfig) { video.Ratios = append(video.Ratios, "2:1") }},
		{"audio reference", func(video *VideoCapabilityConfig) { video.References.MaxAudios = 1 }},
		{"audio toggle", func(video *VideoCapabilityConfig) { video.GenerateAudio.Supported = true }},
	} {
		t.Run(test.name, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel(provider, modelName)
			if _, err := NormalizeModelCapabilityConfigForModel("video", provider, modelName, profile, registry); err != nil {
				t.Fatal(err)
			}
			test.mutate(profile.Video)
			if _, err := NormalizeModelCapabilityConfigForModel("video", provider, modelName, profile, registry); err == nil {
				t.Fatal("accepted out-of-contract configuration")
			}
		})
	}
}

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

func TestValidateVideoTaskRejectsPromptAboveCapabilityLimit(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("autodl-comfyui", "MiniMax H3").Video
	profile.References.PromptMaxChars = 10_000
	input := canvasGenerationInput{
		Mode:   "video",
		Prompt: strings.Repeat("镜", 23_142),
		Config: providerConfig{Model: "MiniMax H3", VideoSeconds: "15", Size: "16:9", VQuality: "768p横"},
	}

	err := validateVideoTask(profile, input)
	if err == nil || !strings.Contains(err.Error(), "最多 10000 个字符") || !strings.Contains(err.Error(), "23142 个字符") || !strings.Contains(err.Error(), "不会自动截断") {
		t.Fatalf("validateVideoTask() error = %v", err)
	}
}

func TestValidateTaskCapabilityChecksReferenceVideoCountAndTotalDuration(t *testing.T) {
	const protocol = "newapi-channel-2"
	const modelName = "custom-video"
	profile := DefaultModelCapabilityConfigForModel(protocol, modelName)
	profile.Video.References.MaxVideos = 2
	totalLimit, unlimited, invalid := 15, 0, -1
	for _, tc := range []struct {
		name      string
		maxTotal  *int
		durations []int64
		wantError string
	}{
		{"equal to limit", &totalLimit, []int64{7000, 8000}, ""},
		{"one millisecond over total", &totalLimit, []int64{7500, 7501}, "参考视频总时长不能超过 15 秒"},
		{"single clip at total limit", &totalLimit, []int64{15000}, ""},
		{"single clip over total limit", &totalLimit, []int64{16021}, "参考视频总时长不能超过 15 秒"},
		{"too many clips under the total limit", &totalLimit, []int64{3000, 3000, 3000}, "参考视频最多支持 2 段"},
		{"explicitly disabled", &unlimited, []int64{8064, 8064}, ""},
		{"no total limit configured", nil, []int64{8064, 8064}, ""},
		{"negative total limit", &invalid, []int64{7000, 8000}, "参考视频总时长上限无效"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			profile.Video.References.MaxTotalVideoDuration = tc.maxTotal
			videos := make([]providerMedia, 0, len(tc.durations))
			for _, duration := range tc.durations {
				videos = append(videos, providerMedia{DurationMs: duration})
			}
			input := map[string]any{
				"mode": "video", "prompt": "combine the clips",
				"config":          map[string]any{"interfaceType": protocol, "model": modelName, "videoSeconds": "6", "capabilityConfig": profile},
				"referenceVideos": videos,
			}
			err := (&Service{}).ValidateTaskCapability(input)
			if tc.wantError == "" {
				if err != nil {
					t.Fatalf("ValidateTaskCapability() error = %v", err)
				}
				return
			}
			if err == nil || err.Error() != tc.wantError {
				t.Fatalf("ValidateTaskCapability() error = %v, want %q", err, tc.wantError)
			}
			if tc.maxTotal != &invalid {
				wantIssue := "unsupported_value"
				if len(tc.durations) > profile.Video.References.MaxVideos {
					wantIssue = "item_count"
				}
				var capabilityErr *modelCapabilityArgumentError
				if !errors.As(err, &capabilityErr) || capabilityErr.Field != "referenceNodeIds" || capabilityErr.Issue != wantIssue {
					t.Fatalf("unexpected capability error: %#v", err)
				}
			}
		})
	}
}

func TestValidateTaskCapabilityChecksReferenceAudioCountAndTotalDuration(t *testing.T) {
	const protocol = "newapi-channel-2"
	const modelName = "custom-video"
	profile := DefaultModelCapabilityConfigForModel(protocol, modelName)
	profile.Video.References.MaxAudios = 2
	profile.Video.References.MaxTotalAudioDuration = ptr(15)
	profile.Video.References.MaxTotalVideoDuration = ptr(15)
	for _, tc := range []struct {
		name      string
		durations []int64
		wantError string
	}{
		{"at total", []int64{7000, 8000}, ""},
		{"one millisecond over total", []int64{7500, 7501}, "参考音频总时长不能超过 15 秒"},
		{"too many under total", []int64{3000, 3000, 3000}, "参考音频最多支持 2 段"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			audios := make([]providerMedia, 0, len(tc.durations))
			for _, duration := range tc.durations {
				audios = append(audios, providerMedia{DurationMs: duration})
			}
			input := map[string]any{
				"mode": "video", "prompt": "combine the references",
				"config":          map[string]any{"interfaceType": protocol, "model": modelName, "videoSeconds": "6", "capabilityConfig": profile},
				"referenceVideos": []providerMedia{{DurationMs: 15000}},
				"referenceAudios": audios,
			}
			err := (&Service{}).ValidateTaskCapability(input)
			if tc.wantError == "" {
				if err != nil {
					t.Fatalf("ValidateTaskCapability() error = %v", err)
				}
			} else if err == nil || err.Error() != tc.wantError {
				t.Fatalf("ValidateTaskCapability() error = %v, want %q", err, tc.wantError)
			}
		})
	}
}

func TestNormalizeVideoCapabilityInheritsTotalReferenceDurationsFromPreset(t *testing.T) {
	for _, tc := range []struct {
		protocol     string
		model        string
		seconds      int
		audioSeconds int
	}{
		{"dashscope-wan3-video", "wan3.0-video", 15, 15},
		{"volcengine-ark-video", "doubao-seedance-2-0-mini-260615", 15, 15},
		{"volcengine-ark-seedance-25", "doubao-seedance-2-5-260628", 30, 30},
		{"kling-v4-official", "kling-4.0-flash", 20, 0},
	} {
		t.Run(tc.model, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel(tc.protocol, tc.model)
			profile.Video.References.MaxTotalVideoDuration = nil
			profile.Video.References.MaxTotalAudioDuration = nil
			normalized, err := NormalizeModelCapabilityConfigForModel("video", tc.protocol, tc.model, profile)
			if err != nil {
				t.Fatal(err)
			}
			if limit := normalized.Video.References.MaxTotalVideoDuration; limit == nil || *limit != tc.seconds {
				t.Fatalf("total reference video duration = %v, want %d seconds", limit, tc.seconds)
			}
			limit := normalized.Video.References.MaxTotalAudioDuration
			if tc.audioSeconds == 0 && limit != nil || tc.audioSeconds > 0 && (limit == nil || *limit != tc.audioSeconds) {
				t.Fatalf("total reference audio duration = %v, want %d seconds or nil for zero", limit, tc.audioSeconds)
			}
		})
	}
}

// 视频提示词由输入框文本、连线内容和技能上下文合成，默认上限必须留出足够余量，
// 否则画布工作流会连同线内容一起被拦在本地。这里锁定默认值与边界行为。
func TestDefaultVideoPromptMaxCharsAllowsComposedCanvasPrompt(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("seedance-videos-compatible", "sd-2.5").Video
	if profile.References.PromptMaxChars != 8000 {
		t.Fatalf("视频默认提示词上限 = %d, want 8000", profile.References.PromptMaxChars)
	}

	// 画布实际合成出的提示词量级（输入框 + 连线 + 技能上下文）必须通过。
	composed := canvasGenerationInput{Mode: "video", Prompt: strings.Repeat("镜", 2399), Config: providerConfig{Model: "sd-2.5", VideoSeconds: "6", Size: "16:9", VQuality: "720p"}}
	if err := validateVideoTask(profile, composed); err != nil {
		t.Fatalf("合成提示词 2399 字符被拒绝: %v", err)
	}
	// 恰好等于上限仍然放行，与前端 `actualChars <= maxChars` 的判定保持一致。
	atLimit := composed
	atLimit.Prompt = strings.Repeat("镜", 8000)
	if err := validateVideoTask(profile, atLimit); err != nil {
		t.Fatalf("提示词 8000 字符被拒绝: %v", err)
	}
	// 超出上限必须明确失败，并保持“不自动截断”的语义。
	overLimit := composed
	overLimit.Prompt = strings.Repeat("镜", 8001)
	err := validateVideoTask(profile, overLimit)
	if err == nil || !strings.Contains(err.Error(), "最多 8000 个字符") || !strings.Contains(err.Error(), "8001 个字符") {
		t.Fatalf("validateVideoTask() error = %v", err)
	}
}

func TestValidateTaskCapabilityRejectsWorkflowPromptAboveConfiguredLimit(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("runninghub-workflow-video", "workflow-video")
	profile.Video.References.PromptMaxChars = 10_000
	input := map[string]any{
		"mode":   "video",
		"prompt": strings.Repeat("镜", 10_001),
		"config": map[string]any{
			"interfaceType":    "runninghub-workflow-video",
			"capabilityConfig": profile,
		},
	}

	err := (&Service{}).ValidateTaskCapability(input)
	if err == nil || !strings.Contains(err.Error(), "完整提示词为 10001 个字符") {
		t.Fatalf("ValidateTaskCapability() error = %v", err)
	}
}

func TestValidateTaskCapabilityRejectsMalformedMediaInput(t *testing.T) {
	input := map[string]any{"mode": "image", "referenceImages": "invalid"}
	if err := (&Service{}).ValidateTaskCapability(input); err == nil {
		t.Fatal("accepted an image task with malformed references")
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

func TestDefaultMiniMaxVideoCapabilitySupportsThirtySecondGeneration(t *testing.T) {
	for _, protocol := range []string{"minimax-video", "metaso-h3"} {
		t.Run(protocol, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel(protocol, "MiniMax-H3").Video
			if profile == nil || profile.Duration.Default != 5 {
				t.Fatalf("MiniMax duration profile = %#v", profile)
			}
			for _, seconds := range []int{3, 4, 15, 16, 20, 30, 31} {
				t.Run(fmt.Sprint(seconds), func(t *testing.T) {
					input := canvasGenerationInput{Mode: "video", Prompt: "a clip", Config: providerConfig{InterfaceType: protocol, Model: "MiniMax-H3", VideoSeconds: fmt.Sprint(seconds), Size: "16:9", VQuality: "768P"}}
					err := validateVideoTask(profile, input)
					valid := seconds >= 4 && seconds <= 30
					if valid && err != nil {
						t.Fatalf("validateVideoTask(%d seconds): %v", seconds, err)
					}
					label := videoDurationAllowedLabel(profile.Duration)
					if !strings.Contains(label, "4–30 秒") {
						t.Fatalf("allowed range label = %q", label)
					}
					want := fmt.Sprintf("视频时长 %d 秒不在当前模型支持范围内（%s）", seconds, label)
					if !valid && (err == nil || !strings.Contains(err.Error(), want)) {
						t.Fatalf("validateVideoTask(%d seconds) error = %v, want %q", seconds, err, want)
					}
					var argumentErr *modelCapabilityArgumentError
					if !valid && (!errors.As(err, &argumentErr) || argumentErr.Field != "durationSeconds" || argumentErr.Issue != "unsupported_value") {
						t.Fatalf("validateVideoTask(%d seconds) lost the field code: %#v", seconds, err)
					}
				})
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

func TestAgnesVideo25CapabilityUsesOfficialLimits(t *testing.T) {
	standard := DefaultModelCapabilityConfigForModel("agnes-video", "agnes-video-2.5").Video
	if standard.Duration.Min != 4 || standard.Duration.Max != 12 || standard.Duration.Default != 5 {
		t.Fatalf("Agnes 2.5 duration = %#v", standard.Duration)
	}
	if fmt.Sprint(standard.Resolutions) != fmt.Sprint([]string{"720P", "960P", "2K"}) || standard.References.MaxVideos != 3 {
		t.Fatalf("Agnes 2.5 capability = %#v", standard)
	}
	flash := DefaultModelCapabilityConfigForModel("agnes-video", "agnes-video-2.5-flash").Video
	if fmt.Sprint(flash.Resolutions) != fmt.Sprint([]string{"720P"}) || flash.References.MaxImages != 5 || flash.References.MaxVideos != 0 {
		t.Fatalf("Agnes 2.5 Flash capability = %#v", flash)
	}
}

func TestNormalizeAgnesVideo25PreservesExplicitCapability(t *testing.T) {
	for _, name := range []string{"agnes-video-2.5", "agnes-video-2.5-flash"} {
		t.Run(name, func(t *testing.T) {
			profile := DefaultModelCapabilityConfigForModel("agnes-video", name)
			profile.Video.References.MaxImages = 1
			profile.Video.Duration.Default = 8
			profile.Video.Ratios, profile.Video.DefaultRatio = []string{"9:16"}, "9:16"
			normalized, err := NormalizeModelCapabilityConfigForModel("video", "agnes-video", name, profile)
			if err != nil {
				t.Fatal(err)
			}
			if normalized.Video.References.MaxImages != 1 || normalized.Video.Duration.Default != 8 || normalized.Video.DefaultRatio != "9:16" || len(normalized.Video.Ratios) != 1 {
				t.Fatalf("explicit capability overwritten: %#v", normalized.Video)
			}
			input := canvasGenerationInput{Config: providerConfig{InterfaceType: "agnes-video", Model: name, VideoSeconds: "15", Size: "9:16", VQuality: "720P"}}
			if err := validateVideoTask(normalized.Video, input); err == nil {
				t.Fatal("out-of-range duration accepted")
			}
		})
	}
}

func TestDefaultVolcengineArkVideoCapabilitySupportsFullModalReference(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("volcengine-ark-video", "doubao-seedance-2-0-260128")
	if profile == nil || profile.Video == nil {
		t.Fatal("Volcengine Ark video profile = nil")
	}
	if !containsCapabilityString(profile.Video.Operations, "reference_to_video") || containsCapabilityString(profile.Video.Operations, "audio_to_video") {
		t.Fatalf("2.0 supports mixed references but not audio alone: %v", profile.Video.Operations)
	}
	if profile.Video.References.MaxImages != 9 || profile.Video.References.MaxVideos != 3 || profile.Video.References.MaxAudios != 3 {
		t.Fatalf("reference limits = %#v", profile.Video.References)
	}
}

func TestDefaultVolcengineArkSeedance25CapabilityUsesOfficialLimits(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("volcengine-ark-seedance-25", "doubao-seedance-2-5-260628")
	if profile == nil || profile.Video == nil {
		t.Fatal("Seedance 2.5 profile = nil")
	}
	if profile.Video.References.MaxImages != 30 || profile.Video.References.MaxVideos != 10 || profile.Video.References.MaxAudios != 10 {
		t.Fatalf("reference limits = %#v", profile.Video.References)
	}
	if profile.Video.Duration.Min != 4 || profile.Video.Duration.Max != 30 || profile.Video.DefaultRatio != "adaptive" || len(profile.Video.Resolutions) != 3 {
		t.Fatalf("output defaults = %#v", profile.Video)
	}
	if !profile.Video.GenerateAudio.Supported || !profile.Video.Watermark.Supported {
		t.Fatalf("audio/watermark support = %#v %#v", profile.Video.GenerateAudio, profile.Video.Watermark)
	}
}

func TestOfficialVideoModelPresetsAreModelSpecific(t *testing.T) {
	for _, tc := range []struct {
		provider, name                   string
		images, videos, audios, duration int
		audioSwitch                      bool
	}{
		{"volcengine-ark-seedance-25", "doubao-seedance-2-5-flash-261115", 10, 5, 5, 30, true},
		{"dashscope-wan3-video", "wan3.0-video-prime", 10, 5, 5, 30, true},
		{"kling-v4-official", "kling-4.0", 10, 5, 0, 30, false},
		{"kling-v4-official", "kling-4.0-flash", 10, 5, 0, 20, false},
	} {
		profile := DefaultModelCapabilityConfigForModel(tc.provider, tc.name)
		video := profile.Video
		if video.References.MaxImages != tc.images || video.References.MaxVideos != tc.videos || video.References.MaxAudios != tc.audios || video.Duration.Max != tc.duration || video.GenerateAudio.Supported != tc.audioSwitch {
			t.Fatalf("%s: %+v", tc.name, video)
		}
		if _, err := NormalizeModelCapabilityConfigForModel("video", tc.provider, tc.name, profile); err != nil {
			t.Errorf("%s: %v", tc.name, err)
		}
	}
}

func TestDefaultWeNewH3VideoCapabilityUsesDocumentedLimits(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("wenew-h3-video", "MiniMax-H3")
	if profile == nil || profile.Video == nil {
		t.Fatal("WeNew H3 profile = nil")
	}
	if profile.Video.References.MaxImages != 9 || profile.Video.References.MaxAudios != 3 || profile.Video.References.MaxVideos != 0 {
		t.Fatalf("reference limits = %#v", profile.Video.References)
	}
	if profile.Video.Duration.Min != 4 || profile.Video.Duration.Max != 15 || profile.Video.DefaultResolution != "768p" {
		t.Fatalf("output defaults = %#v", profile.Video)
	}
	if profile.Video.GenerateAudio.Supported || profile.Video.Watermark.Supported || containsCapabilityString(profile.Video.Operations, "audio_to_video") {
		t.Fatalf("unsupported WeNew capabilities = %#v", profile.Video)
	}
}
func TestValidateVolcengineArkFullModalReferenceRejectsTextAndAudioOnly(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("volcengine-ark-video", "doubao-seedance-2-0-260128").Video
	input := canvasGenerationInput{
		Prompt:          "follow the soundtrack",
		Config:          providerConfig{InterfaceType: "volcengine-ark-video", VideoSeconds: "6", Size: "16:9", VQuality: "720p"},
		ReferenceAudios: []providerMedia{{URL: "https://example.com/music.mp3"}},
		Metadata:        map[string]interface{}{"videoEditOperation": "reference_to_video"},
	}
	err := validateVideoTask(profile, input)
	if err == nil || !strings.Contains(err.Error(), "文本+音频") {
		t.Fatalf("validateVideoTask() error = %v", err)
	}

	input.ReferenceImages = []providerMedia{{URL: "https://example.com/subject.png"}}
	if err := validateVideoTask(profile, input); err != nil {
		t.Fatalf("validateVideoTask(full modal) error = %v", err)
	}
	input.Metadata["videoEditOperation"] = "audio_to_video"
	if err := validateVideoTask(profile, input); err == nil {
		t.Fatal("accepted an undeclared audio-to-video operation")
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

func TestNormalizeVideoCapabilityAllowsOmittedRatio(t *testing.T) {
	profile := DefaultModelCapabilityConfigForModel("autodl-comfyui", "minimax_h3_lightx2v_no_pic").Video
	profile.Ratios = nil
	profile.DefaultRatio = ""
	profile.Resolutions = []string{"480p竖", "480p横"}
	profile.DefaultResolution = "480p竖"

	result, err := NormalizeModelCapabilityConfigForModel("video", "autodl-comfyui", "minimax_h3_lightx2v_no_pic", &ModelCapabilityConfig{Version: 1, Video: profile})
	if err != nil {
		t.Fatalf("NormalizeModelCapabilityConfig() error = %v", err)
	}
	if result.Video == nil || len(result.Video.Ratios) != 0 || result.Video.DefaultRatio != "" {
		t.Fatalf("normalized video ratios = %#v", result.Video)
	}
	if err := validateVideoTask(result.Video, canvasGenerationInput{Config: providerConfig{Model: "minimax_h3_lightx2v_no_pic", VideoSeconds: "6", VQuality: "480p竖"}}); err != nil {
		t.Fatalf("validateVideoTask() error = %v", err)
	}
}

func TestCapabilitySpecFromModelCapabilityConfigProjectsImageSizePresets(t *testing.T) {
	config := &ModelCapabilityConfig{
		Version: 1,
		Image: &ImageCapabilityConfig{
			References: ImageReferenceConfig{MaxImages: 4},
			Size: ImageSizeConfig{
				Parameter: "aspect_ratio",
				Values:    []string{"16:9"},
				Default:   "16:9",
				Presets: []ImageSizePreset{
					{Tier: "4k", Ratio: "16:9", Size: "3840x2160", Width: 3840, Height: 2160},
				},
			},
			Quality:    ImageQualityConfig{Supported: false, Default: "auto"},
			MaxOutputs: 1,
		},
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(config, "image")
	if err != nil {
		t.Fatal(err)
	}
	if spec.Options["quality"].Values != nil {
		t.Fatalf("quality must stay undeclared when unsupported: %#v", spec.Options["quality"])
	}
	if spec.ImageSize == nil || spec.ImageSize.Parameter != "aspect_ratio" || len(spec.ImageSize.Presets) != 1 || spec.ImageSize.Presets[0].Tier != "4k" {
		t.Fatalf("imageSize presets = %#v", spec.ImageSize)
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

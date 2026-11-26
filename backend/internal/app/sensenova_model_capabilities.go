package app

const (
	senseNovaTextProtocol = "sensenova-chat"
	senseNovaImageModel   = "sensenova-u1.6-lite"
)

func senseNovaTextCapability(modelName string) *TextCapabilityConfig {
	streaming := true
	profile := &TextCapabilityConfig{
		Streaming:           &streaming,
		ContextWindowTokens: 1048576,
		MaxOutputTokens:     131072,
		// These are conservative host limits when the vendor does not publish
		// a media count/size ceiling, not advertised SenseNova model limits.
		References: TextReferenceConfig{PromptMaxChars: 32000, MaxImages: 16, MaxImageBytes: 30 * 1024 * 1024},
		Thinking: &TextThinkingConfig{
			Mode:      ThinkingModeLevels,
			Default:   ThinkingLevelHigh,
			Switch:    ThinkingSwitchConfig{Kind: ThinkingSwitchThinkingType},
			Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityEffort, Field: "reasoning_effort"},
		},
	}
	switch modelName {
	case "sensenova-6.8-flash":
		profile.Thinking.Mode = ThinkingModeAlways
		// xhigh is not a host ThinkingLevel; do not relabel it as max.
		profile.Thinking.Levels = []string{"minimal", "low", "medium", "high", "max"}
	case "sensenova-6.8-flash-lite":
		// This model's context window is not documented. Keep the local
		// conservative fallback instead of advertising an invented 1M window.
		profile.ContextWindowTokens = 128000
		profile.MaxOutputTokens = 65536
		profile.Thinking.Levels = []string{"off", "low", "medium", "high", "max"}
	case "deepseek-flash":
		profile.MaxOutputTokens = 393216
		// The vendor accepts 200 images, while the host capability contract
		// currently caps text references at 100. Keep the stricter local bound.
		profile.References.MaxImages = 100
		profile.References.MaxImageBytes = 50 * 1024 * 1024
		profile.Thinking.Levels = []string{"off", "low", "high", "max"}
	case "glm-5.3":
		profile.References.MaxImages = 0
		profile.References.MaxImageBytes = 0
		profile.Thinking.Mode = ThinkingModeAlways
		profile.Thinking.Default = ThinkingLevelMax
		profile.Thinking.Levels = []string{"low", "high", "max"}
	case "kimi-k3":
		// 128K is the documented default output budget. The actual maximum is
		// dynamic (remaining context) and is enforced by the upstream model.
		profile.Thinking.Default = ThinkingLevelMax
		profile.Thinking.Levels = []string{"off", "low", "medium", "high", "max"}
	default:
		return nil
	}
	return profile
}

func senseNovaImageCapability() *ImageCapabilityConfig {
	return &ImageCapabilityConfig{
		References: ImageReferenceConfig{PromptMaxChars: 32000, MaxImages: 5, MaxImageBytes: 30 * 1024 * 1024},
		Size: ImageSizeConfig{
			Parameter: "size",
			Values:    []string{"auto", "2048x2048", "2720x1536", "1536x2720", "1664x2496", "2496x1664", "4096x4096"},
			Default:   "2048x2048", AllowCustom: true,
		},
		Quality:        ImageQualityConfig{Values: []string{}, Default: "auto"},
		Resolution:     ImageResolutionConfig{Values: []string{}, Default: "auto"},
		ResponseFormat: ParameterSupport{Supported: true, Default: "url"},
		OutputFormat:   ParameterSupport{Supported: true},
		MaxOutputs:     1,
	}
}

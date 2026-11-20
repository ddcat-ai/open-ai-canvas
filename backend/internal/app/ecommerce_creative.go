package app

// Creative options are persisted with the same draft snapshot consumed by planning.
type EcommerceCreativeOptions struct {
	TextMode           string `json:"textMode"`
	CopyTone           string `json:"copyTone"`
	FontStyle          string `json:"fontStyle"`
	ColorRhythm        string `json:"colorRhythm"`
	InformationDensity string `json:"informationDensity"`
	LayoutStyle        string `json:"layoutStyle"`
}

func validateEcommerceCreativeOptions(options *EcommerceCreativeOptions) error {
	if options == nil {
		return nil
	}
	fields := []struct {
		label   string
		value   string
		allowed []string
	}{
		{"图中文字", options.TextMode, []string{"auto", "rich", "concise", "none"}},
		{"文案语气", options.CopyTone, []string{"professional", "brand", "lifestyle", "technical", "editorial", "campaign"}},
		{"字体风格", options.FontStyle, []string{"auto", "modern-sans", "geometric", "editorial-serif", "rounded", "display"}},
		{"色彩节奏", options.ColorRhythm, []string{"unified", "tonal", "alternating", "contrast", "scene"}},
		{"信息密度", options.InformationDensity, []string{"auto", "airy", "balanced", "detailed"}},
		{"版式风格", options.LayoutStyle, []string{"auto", "editorial", "feature-cards", "immersive", "minimal", "comparison"}},
	}
	for _, field := range fields {
		valid := field.value == ""
		for _, value := range field.allowed {
			valid = valid || field.value == value
		}
		if !valid {
			return BadAuthRequest(field.label + "选项无效，请重新选择")
		}
	}
	return nil
}

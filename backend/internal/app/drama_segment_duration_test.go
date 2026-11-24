package app

import (
	"errors"
	"testing"

	"yingce/backend/internal/production"
)

func TestVideoDurationMessagesNameValueAndAllowedRange(t *testing.T) {
	enum := VideoDurationConfig{Selection: "enum", Values: []int{10, 5}, Default: 5}
	rangeStep := VideoDurationConfig{Selection: "range", Min: 5, Max: 30, Step: 1, Default: 5}
	if got := videoDurationAllowedLabel(enum); got != "可选 5、10 秒" {
		t.Fatalf("enum label = %q", got)
	}
	if got := videoDurationAllowedLabel(rangeStep); got != "5–30 秒，步长 1" {
		t.Fatalf("range label = %q", got)
	}
	if got := videoDurationSupportLabel(VideoDurationConfig{Selection: "range", Min: 4, Max: 12, Step: 4}); got != "4–12 秒（步长 4）" {
		t.Fatalf("stepped support label = %q", got)
	}
	// 多档等差枚举按区间描述，不列出几十个档位。
	consecutive := VideoDurationConfig{Selection: "enum", Values: []int{4, 5, 6, 7, 8, 9, 10}}
	if got := videoDurationAllowedLabel(consecutive); got != "可选 4–10 秒" {
		t.Fatalf("consecutive enum label = %q", got)
	}
	if got := videoDurationAllowedLabel(VideoDurationConfig{Selection: "enum", Values: []int{5, 10, 15, 20}}); got != "可选 5–20 秒，步长 5" {
		t.Fatalf("stepped enum label = %q", got)
	}
	if got := videoDurationSupportLabel(VideoDurationConfig{Selection: "enum", Values: []int{4, 6, 10, 12}}); got != "4、6、10、12 秒" {
		t.Fatalf("uneven enum support label = %q", got)
	}

	profile := &VideoCapabilityConfig{Duration: enum, References: VideoReferenceConfig{PromptMaxChars: 100}, Operations: []string{"text_to_video"}, DefaultOperation: "text_to_video"}
	err := validateVideoTask(profile, canvasGenerationInput{Mode: "video", Prompt: "镜头", Config: providerConfig{VideoSeconds: "4"}})
	var argumentErr *modelCapabilityArgumentError
	if !errors.As(err, &argumentErr) || argumentErr.Field != "durationSeconds" || argumentErr.Issue != "unsupported_value" {
		t.Fatalf("field code changed: %#v", err)
	}
	if err.Error() != "视频时长 4 秒不在当前模型支持范围内（可选 5、10 秒）" {
		t.Fatalf("enum duration message = %q", err.Error())
	}
	if err := validateVideoTask(profile, canvasGenerationInput{Mode: "video", Prompt: "镜头", Config: providerConfig{VideoSeconds: "abc"}}); err == nil || err.Error() != "视频时长不在当前模型支持范围内（可选 5、10 秒）" {
		t.Fatalf("unparsable duration message = %v", err)
	}

	if err := dramaSegmentDurationError(2, 5, rangeStep); err != nil {
		t.Fatalf("allowed segment duration rejected: %v", err)
	}
	if err := dramaSegmentDurationError(2, 4, rangeStep); err == nil || err.Error() != "第 3 段需要 4 秒，所选模型只支持 5–30 秒；请调整分镜时长或换用其他视频模型" {
		t.Fatalf("segment duration message = %v", err)
	}
}

// 能力合同切换过选择方式后，另一组字段可能残留旧值；段视频只按生效的那组取整，取到的秒数必须能通过准入。
func TestDramaDurationOptionsFollowDeclaredSelection(t *testing.T) {
	stale := VideoDurationConfig{Selection: "range", Min: 5, Max: 30, Step: 1, Values: []int{4, 8}, Default: 5}
	options := dramaDurationOptions(stale)
	if seconds := production.SnapVideoSeconds(3500, options); seconds != 5 || !videoDurationAllowed(stale, seconds) {
		t.Fatalf("range contract snapped to %d using stale enum values", seconds)
	}
	if low, high := options.Bounds(); low != 5 || high != 30 {
		t.Fatalf("range bounds = %d–%d", low, high)
	}
	enum := VideoDurationConfig{Selection: "enum", Values: []int{6, 12}, Min: 1, Max: 60, Step: 1, Default: 6}
	options = dramaDurationOptions(enum)
	if seconds := production.SnapVideoSeconds(3500, options); seconds != 6 || dramaMaxVideoSeconds(options) != 12 {
		t.Fatalf("enum contract snapped to %d (max %d) using stale range fields", seconds, dramaMaxVideoSeconds(options))
	}
	if limits := (production.StoryboardSettings{SegmentMode: production.SegmentAuto}).SegmentLimits(options); limits.MinMs != 6000 || limits.MaxMs != 12000 {
		t.Fatalf("auto segment limits must follow the model range: %+v", limits)
	}
}

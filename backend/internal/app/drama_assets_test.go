package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
)

// 线上实际出现的模型合同：只有 16:9 / 9:16 / 1:1 三档像素值，没有 3:4。
func pixelOnlyImageSpec() CapabilitySpec {
	return CapabilitySpec{
		Capability: "image",
		Options:    map[string]OptionConstraint{"size": {Values: []any{"auto", "1824x1024", "1024x1824", "1024x1024"}}},
		ImageSize: &CapabilityImageSize{Parameter: "size", Presets: []CapabilityImageSizePreset{
			{Tier: "1k", Ratio: "16:9", Size: "1824x1024", Width: 1824, Height: 1024},
			{Tier: "1k", Ratio: "9:16", Size: "1024x1824", Width: 1024, Height: 1824},
			{Tier: "1k", Ratio: "1:1", Size: "1024x1024", Width: 1024, Height: 1024},
		}},
	}
}

func TestDramaImageSizeSnapsToDeclaredPreset(t *testing.T) {
	spec := pixelOnlyImageSpec()
	defaults := map[string]any{"size": "1824x1024"}
	cases := map[string]string{"9:16": "1024x1824", "16:9": "1824x1024", "1:1": "1024x1024"}
	for ratio, want := range cases {
		if got := dramaImageRequestForSpec(spec, defaults, ratio, ""); got.Size != want || got.Issue != "" {
			t.Fatalf("%s => %+v, want %q", ratio, got, want)
		}
	}
	// 没有接近的档位（4:3、3:4 离 1:1 与 16:9/9:16 都超过容差）时报错，绝不悄悄出方图。
	for _, ratio := range []string{"4:3", "3:4"} {
		if got := dramaImageRequestForSpec(spec, defaults, ratio, ""); got.Issue == "" || got.Size != "" {
			t.Fatalf("%s must be rejected, got %+v", ratio, got)
		}
	}
	if got := dramaImageRequestForSpec(spec, defaults, "16:9", "2k"); got.Issue == "" {
		t.Fatalf("unsupported tier must be rejected, got %+v", got)
	}
}

func TestDramaImageSizeKeepsRatioModelsAndRejectsUndeclared(t *testing.T) {
	ratioSpec := CapabilitySpec{Capability: "image", Options: map[string]OptionConstraint{"size": {Values: []any{"1:1", "3:4", "9:16"}}}}
	if got := dramaImageRequestForSpec(ratioSpec, nil, "3:4", ""); got.Size != "3:4" {
		t.Fatalf("declared ratio must pass through, got %+v", got)
	}
	if got := dramaImageRequestForSpec(ratioSpec, nil, "16:9", ""); got.Issue == "" {
		t.Fatalf("16:9 on a portrait-only model must be rejected, got %+v", got)
	}
	if got := dramaImageRequestForSpec(CapabilitySpec{Capability: "image"}, nil, "9:16", ""); got.Issue == "" {
		t.Fatalf("models without a size option cannot honour the ratio, got %+v", got)
	}
	// 独立分辨率参数的模型：档位明确下发，尺寸取该档位的预设。
	tiered := CapabilitySpec{Capability: "image", Options: map[string]OptionConstraint{"size": {Values: []any{"16:9", "1:1"}}, "imageResolution": {Values: []any{"1k", "2k"}}}, ImageSize: &CapabilityImageSize{Parameter: "aspect_ratio", Presets: []CapabilityImageSizePreset{
		{Tier: "1k", Ratio: "16:9", Size: "1824x1024"}, {Tier: "2k", Ratio: "16:9", Size: "2752x1536"}, {Tier: "1k", Ratio: "1:1", Size: "1024x1024"}, {Tier: "2k", Ratio: "1:1", Size: "2048x2048"},
	}}}
	if got := dramaImageRequestForSpec(tiered, map[string]any{"imageResolution": "2k"}, "16:9", ""); got.Size != "16:9" || got.Resolution != "2k" {
		t.Fatalf("default tier must be sent explicitly, got %+v", got)
	}
	if got := dramaImageRequestForSpec(tiered, map[string]any{"imageResolution": "2k"}, "16:9", "1k"); got.Resolution != "1k" {
		t.Fatalf("chosen tier must win over the model default, got %+v", got)
	}
	if !dramaImageRatioMismatch(1024, 1024, "16:9") || dramaImageRatioMismatch(1824, 1024, "16:9") || dramaImageRatioMismatch(0, 0, "16:9") {
		t.Fatal("result ratio check must flag square images only")
	}
}

func TestDramaAssetSchemesRenderWithoutPlaceholders(t *testing.T) {
	for _, scheme := range production.AssetSchemes() {
		assets := production.AssetSettings{Mode: scheme.Mode}.Normalized()
		if assets.CharacterRatio != scheme.Ratio || assets.CharacterPrompt == "" || assets.ScenePrompt == "" {
			t.Fatalf("scheme %s should fill defaults: %+v", scheme.Mode, assets)
		}
		for _, kind := range []string{"character", "scene"} {
			prompt := production.CastImagePrompt(assets, kind, "林逸", "黑发少年，青色道袍", "国风动画", "冷色调")
			if strings.Contains(prompt, "{{") || !strings.Contains(prompt, "林逸") || !strings.Contains(prompt, "国风动画") {
				t.Fatalf("%s/%s rendered badly: %s", scheme.Mode, kind, prompt)
			}
		}
	}
	custom := production.AssetSettings{Mode: production.AssetModeCustom, CharacterPrompt: "{{角色名称}} {{未知变量}}"}.Normalized()
	if problem := production.ValidateAssetPrompts(custom); !strings.Contains(problem, "{{未知变量}}") {
		t.Fatalf("unknown placeholder must be rejected: %q", problem)
	}
	if custom.CharacterRatio != production.AssetImageRatio {
		t.Fatalf("custom scheme keeps a valid ratio: %q", custom.CharacterRatio)
	}
}

func TestDramaJobDetailKeepsEveryAttempt(t *testing.T) {
	svc, fake := newDramaTestService(t)
	fake.fail = func(req CreateTaskRequest) bool { return req.Type == "canvas_video" }
	projectID := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	runDramaTicks(t, svc, projectID, 14)
	jobs, err := svc.DramaJobs("usr-drama", projectID, 200)
	if err != nil {
		t.Fatal(err)
	}
	var failed, succeeded *DramaJobView
	for index := range jobs {
		if jobs[index].Kind == model.DramaJobSegmentVideo && jobs[index].Status == model.DramaJobFailed && failed == nil {
			failed = &jobs[index]
		}
		if jobs[index].Kind == model.DramaJobCastImage && jobs[index].Status == model.DramaJobSucceeded && succeeded == nil {
			succeeded = &jobs[index]
		}
	}
	if failed == nil || succeeded == nil {
		t.Fatalf("expected a failed video job and a finished frame job: %+v", jobs)
	}
	detail, err := svc.DramaJobDetail("usr-drama", projectID, failed.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Attempts) == 0 || !strings.Contains(detail.Attempts[0].Error, "上游拒绝") || detail.Target == "" {
		t.Fatalf("failed job must list its rejected submissions: %+v", detail)
	}
	detail, err = svc.DramaJobDetail("usr-drama", projectID, succeeded.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Attempts) != 1 || detail.Attempts[0].Task == nil || len(detail.Attempts[0].Task.ResourceIDs) != 1 || detail.Attempts[0].Task.Prompt == "" {
		t.Fatalf("finished job must show its task, prompt and output: %+v", detail.Attempts)
	}
	if _, err := svc.DramaJobDetail("someone-else", projectID, succeeded.ID); err == nil {
		t.Fatal("job detail must be scoped to the project owner")
	}
}

func TestDramaListFiltersAndCountsByStatus(t *testing.T) {
	svc, _ := newDramaTestService(t)
	createTestDrama(t, svc, DramaReviewAuto)
	page, err := svc.ListDramas("usr-drama", DramaListRequest{Page: 1, PageSize: 24})
	if err != nil {
		t.Fatal(err)
	}
	items := page["items"].([]DramaListItem)
	counts := page["statusCounts"].(map[string]int64)
	if len(items) != 1 || page["total"].(int64) != 1 || counts["all"] != 1 {
		t.Fatalf("list must only count drama projects: %+v", page)
	}
	page, _ = svc.ListDramas("usr-drama", DramaListRequest{Page: 1, PageSize: 24, Query: "不存在的书名"})
	if len(page["items"].([]DramaListItem)) != 0 {
		t.Fatalf("search must filter by name: %+v", page)
	}
	page, _ = svc.ListDramas("usr-drama", DramaListRequest{Page: 1, PageSize: 24, Status: model.DramaStatusCompleted})
	if page["total"].(int64) != 0 {
		t.Fatalf("status filter must apply: %+v", page)
	}
	if _, err := svc.ListDramas("usr-drama", DramaListRequest{Page: 1, PageSize: 24, Status: "bogus"}); err == nil {
		t.Fatal("unknown status must be rejected")
	}
}

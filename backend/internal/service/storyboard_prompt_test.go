package service

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestStoryboardCinematicQualityContractIncludesRequestedCountAndDuration(t *testing.T) {
	contract := storyboardCinematicQualityContract(30, 7)
	if !strings.Contains(contract, "严格等于 30 秒") {
		t.Fatalf("contract does not include requested duration: %s", contract)
	}
	if !strings.Contains(contract, "严格输出 7 个镜头") {
		t.Fatalf("contract does not include requested shot count: %s", contract)
	}
}

func TestStoryboardCinematicQualityContractIncludesCameraLanguageGuide(t *testing.T) {
	contract := storyboardCinematicQualityContract(0, 0)
	for _, term := range []string{"先确定观众此刻跟随谁", "大远景只承担空间", "一个镜头只保留一个主运镜", "明确人物左右位置", "避免每镜都推进"} {
		if !strings.Contains(contract, term) {
			t.Fatalf("camera language guide is missing %q: %s", term, contract)
		}
	}
}

func TestStoryboardPromptsLeaveAspectRatioToVideoNode(t *testing.T) {
	contract := storyboardCinematicQualityContract(0, 0)
	if !strings.Contains(contract, "不要讨论画幅配置") {
		t.Fatalf("contract does not delegate aspect ratio: %s", contract)
	}
	if strings.Contains(defaultStoryboardPromptTemplate(), "2.39:1") {
		t.Fatal("default storyboard prompt still hard-codes 2.39:1")
	}
	prompt := buildStoryboardVideoPrompt("【风格组合】仙侠·宏大叙事·3D 动漫", "高清、明亮、空间层次清楚", agentStoryboardShot{
		Duration: 8, Description: "剑仙踏云进入画面", VisualPrompt: "剑仙位于画面左侧", VideoPrompt: "向前踏出一步后停住", Camera: "平视中景", Motion: "缓慢推近后停住", TimeBeats: "0-4秒：进入；4-8秒：停住",
	})
	if strings.Contains(prompt, "2.39:1") || strings.Contains(prompt, "画幅") {
		t.Fatal("compiled storyboard video prompt still mentions output aspect ratio")
	}
}

func TestRemoveFixedMediaRestrictionsKeepsCurrentProjectMedium(t *testing.T) {
	template := "保留这一行\n- 不要在 visualPrompt 或 videoPrompt 中使用 3D动漫、动画、二次元、游戏CG、卡通渲染。\n继续保留"
	filtered := removeFixedMediaRestrictions(template)
	if strings.Contains(filtered, "不要在 visualPrompt") {
		t.Fatal("fixed 3D/cartoon restriction was not removed")
	}
	if !strings.Contains(filtered, "保留这一行") || !strings.Contains(filtered, "继续保留") {
		t.Fatal("unrelated template content was removed")
	}
}

func TestValidateStoryboardShotCount(t *testing.T) {
	plan := agentStoryboardPlan{Shots: make([]agentStoryboardShot, 3)}
	if err := validateStoryboardShotCount(plan, 3); err != nil {
		t.Fatalf("expected matching shot count to pass: %v", err)
	}
	if err := validateStoryboardShotCount(plan, 2); err == nil {
		t.Fatal("expected mismatched shot count to fail")
	}
	if err := validateStoryboardShotCount(plan, 0); err != nil {
		t.Fatalf("expected automatic shot count to pass: %v", err)
	}
}

func TestValidateStoryboardComplexityRejectsOverloadedShot(t *testing.T) {
	plan := agentStoryboardPlan{Shots: []agentStoryboardShot{{
		Duration: 5, CharacterIDs: []string{"a", "b", "c"}, MustHave: []string{"一", "二", "三", "四"}, TimeBeats: "0-1秒：起，1-2秒：承，2-4秒：转，4-5秒：合", Motion: "航拍推进并升降",
	}}}
	if err := validateStoryboardComplexity(plan); err == nil {
		t.Fatal("expected overloaded shot to fail complexity validation")
	}
}

func TestValidateStoryboardPlanTreatsComplexityAsAdvisory(t *testing.T) {
	plan := agentStoryboardPlan{Shots: []agentStoryboardShot{{
		Duration:     8,
		CharacterIDs: []string{"a", "b", "c"},
		MustHave:     []string{"一", "二", "三", "四"},
		Motion:       "航拍推进并升降",
	}}}
	characters := []storyboardCharacterCard{{AssetID: "a"}, {AssetID: "b"}, {AssetID: "c"}}

	if err := validateStoryboardPlan(plan, 0, 0, characters, nil); err != nil {
		t.Fatalf("complexity should be advisory for an otherwise valid plan: %v", err)
	}
}

func TestValidateStoryboardComplexityAcceptsSingleDirectedMove(t *testing.T) {
	plan := agentStoryboardPlan{Shots: []agentStoryboardShot{{
		Duration: 8, CharacterIDs: []string{"a", "b"}, MustHave: []string{"身份稳定", "动作落点", "结尾状态"}, TimeBeats: "0-2秒：建立；2-6秒：动作；6-8秒：反应", Motion: "缓慢推近后停住", Dialogue: "你终于来了。",
	}}}
	if err := validateStoryboardComplexity(plan); err != nil {
		t.Fatalf("expected focused shot to pass complexity validation: %v", err)
	}
}

func TestNormalizeAutomaticStoryboardDurationsPreservesLongDialogue(t *testing.T) {
	plan := agentStoryboardPlan{Shots: []agentStoryboardShot{{
		Duration: 8,
		Dialogue: strings.Repeat("字", 50),
	}}}

	normalizeAutomaticStoryboardDurations(&plan, 0)

	if plan.Shots[0].Duration < 10 {
		t.Fatalf("duration = %d, want at least 10", plan.Shots[0].Duration)
	}
	if err := validateStoryboardComplexity(plan); err != nil {
		t.Fatalf("normalized automatic duration should pass: %v", err)
	}
}

func TestResolveStoryboardAssetsUsesStableCanvasNodeIDs(t *testing.T) {
	assets := []storyboardAsset{
		{ID: "environment", Title: "天宫", Tags: []string{"场景:天宫"}},
		{ID: "character-node", Title: "青莲剑仙", CharacterAssetID: "character-1", CharacterVersionID: "version-3"},
	}
	resolved := resolveStoryboardAssets(assets, []storyboardAssetRef{{NodeID: "character-node", Role: "character", Priority: 100}, {NodeID: "environment", Role: "environment", Priority: 80}})
	if len(resolved) != 2 || resolved[0].ID != "character-node" || resolved[1].ID != "environment" {
		t.Fatalf("expected stable asset order from model references: %#v", resolved)
	}
}

func TestValidateStoryboardAssetRefsRejectsInventedNodeID(t *testing.T) {
	plan := agentStoryboardPlan{Shots: []agentStoryboardShot{{AssetRefs: []storyboardAssetRef{{NodeID: "invented", Role: "prop", Priority: 50}}}}}
	err := validateStoryboardAssetRefs(plan, []storyboardAsset{{ID: "real", Title: "真实道具"}})
	if err == nil || !strings.Contains(err.Error(), "不在当前画布资产目录") {
		t.Fatalf("expected invented node id to fail, got %v", err)
	}
}

func TestExtractStoryboardAssetsIncludesMediaAndExcludesShotOutputs(t *testing.T) {
	snapshot := map[string]any{"nodes": []interface{}{
		map[string]interface{}{"id": "image", "type": "image", "title": "角色参考", "metadata": map[string]interface{}{"content": "resource:image", "assetCategory": "character"}},
		map[string]interface{}{"id": "video", "type": "video", "title": "动作参考", "metadata": map[string]interface{}{"content": "resource:video"}},
		map[string]interface{}{"id": "audio", "type": "audio", "title": "环境声", "metadata": map[string]interface{}{"content": "resource:audio"}},
		map[string]interface{}{"id": "output", "type": "video", "title": "旧镜头", "metadata": map[string]interface{}{"content": "resource:output", "workflowKind": "shot"}},
	}}
	assets := extractStoryboardAssets(snapshot)
	if len(assets) != 3 || assets[0].ID != "image" || assets[1].ID != "video" || assets[2].ID != "audio" {
		t.Fatalf("unexpected assets: %#v", assets)
	}
}

func TestNormalizeStoryboardAssetsBoundsAndDeduplicatesInput(t *testing.T) {
	assets := normalizeStoryboardAssets([]storyboardAsset{
		{ID: " asset-1 ", Title: " 场景图 ", Type: "IMAGE", Tags: []string{"雨夜", "雨夜", strings.Repeat("长", 80)}, Prompt: strings.Repeat("镜", 700)},
		{ID: "asset-1", Title: "重复", Type: "image"},
		{ID: "text-1", Title: "文本", Type: "text"},
	})
	if len(assets) != 1 {
		t.Fatalf("expected one normalized asset, got %#v", assets)
	}
	if assets[0].ID != "asset-1" || assets[0].Type != "image" || len(assets[0].Tags) != 2 {
		t.Fatalf("unexpected normalized asset: %#v", assets[0])
	}
	if utf8.RuneCountInString(assets[0].Prompt) != 600 || utf8.RuneCountInString(assets[0].Tags[1]) != 64 {
		t.Fatalf("expected bounded prompt and tag lengths: %#v", assets[0])
	}
}

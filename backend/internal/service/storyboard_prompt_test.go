package service

import (
	"strings"
	"testing"
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

func TestValidateStoryboardComplexityAcceptsSingleDirectedMove(t *testing.T) {
	plan := agentStoryboardPlan{Shots: []agentStoryboardShot{{
		Duration: 8, CharacterIDs: []string{"a", "b"}, MustHave: []string{"身份稳定", "动作落点", "结尾状态"}, TimeBeats: "0-2秒：建立；2-6秒：动作；6-8秒：反应", Motion: "缓慢推近后停住", Dialogue: "你终于来了。",
	}}}
	if err := validateStoryboardComplexity(plan); err != nil {
		t.Fatalf("expected focused shot to pass complexity validation: %v", err)
	}
}

func TestMatchStoryboardAssetsForShotPrioritizesCurrentCharacterCards(t *testing.T) {
	assets := []storyboardAsset{
		{ID: "environment", Title: "天宫", Tags: []string{"场景:天宫"}},
		{ID: "character-node", Title: "青莲剑仙", CharacterAssetID: "character-1", CharacterVersionID: "version-3"},
	}
	matched := matchStoryboardAssetsForShot(assets, agentStoryboardShot{CharacterIDs: []string{"character-1"}, AssetTags: []string{"场景:天宫"}})
	if len(matched) != 2 || matched[0].ID != "character-node" {
		t.Fatalf("expected current character card before optional tagged assets: %#v", matched)
	}
}

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
	for _, term := range []string{"S01 大远景 ELS", "A05 倾斜角 Dutch Angle", "M15 希区柯克变焦", "C06 前景叠层", "N02 反应镜头", "禁止每 3-5 秒更换一次运镜"} {
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
	plan := fallbackAgentStoryboardPlan("测试故事")
	if strings.Contains(plan.StyleGuide+plan.Shots[0].VideoPrompt, "2.39:1") || strings.Contains(plan.StyleGuide+plan.Shots[0].VideoPrompt, "画幅") {
		t.Fatal("fallback storyboard still mentions output aspect ratio")
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

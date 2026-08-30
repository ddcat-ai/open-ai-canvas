package service

import (
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestNormalizeNovelWorkbenchBriefUsesConfigurableDefault(t *testing.T) {
	brief, err := normalizeNovelWorkbenchBrief(StartNovelWorkbenchRequest{
		Premise:    "一个返乡记者发现全镇人都在隐瞒同一场失踪案。",
		OutputMode: novelWorkbenchModeScreenplay,
	})
	if err != nil {
		t.Fatalf("normalizeNovelWorkbenchBrief() error = %v", err)
	}
	if brief.TargetUnitCount != 12 {
		t.Fatalf("TargetUnitCount = %d, want configurable default 12", brief.TargetUnitCount)
	}
	if brief.TargetUnitLength != 900 || brief.UnitDurationSeconds != 90 {
		t.Fatalf("unexpected defaults: length=%d duration=%d", brief.TargetUnitLength, brief.UnitDurationSeconds)
	}

	brief, err = normalizeNovelWorkbenchBrief(StartNovelWorkbenchRequest{
		Premise:          "同一故事的连载版本。",
		OutputMode:       novelWorkbenchModeNovel,
		TargetUnitCount:  137,
		TargetUnitLength: 2400,
	})
	if err != nil {
		t.Fatalf("normalize configurable novel() error = %v", err)
	}
	if brief.TargetUnitCount != 137 || brief.TargetUnitLength != 2400 || brief.UnitDurationSeconds != 0 {
		t.Fatalf("brief did not retain supplied scope: %+v", brief)
	}
}

func TestNormalizeNovelWorkbenchBriefLimitsSelections(t *testing.T) {
	brief, err := normalizeNovelWorkbenchBrief(StartNovelWorkbenchRequest{
		Premise:  "女主回到十年前，决定查清父亲蒙冤的真相。",
		Genre:    []string{"古装", "悬疑", "复仇反杀"},
		Audience: []string{"女性爽感向", "悬疑反转偏好"},
	})
	if err != nil {
		t.Fatalf("normalize selection choices() error = %v", err)
	}
	if brief.Genre != "古装、悬疑、复仇反杀" || brief.Audience != "女性爽感向、悬疑反转偏好" {
		t.Fatalf("choices were not normalized: %+v", brief)
	}

	_, err = normalizeNovelWorkbenchBrief(StartNovelWorkbenchRequest{
		Premise: "一部题材过于分散的作品。",
		Genre:   []string{"古装", "悬疑", "奇幻", "校园"},
	})
	if err == nil {
		t.Fatal("more than three genres should be rejected")
	}
}

func TestValidateNovelWorkbenchBootstrapRequiresContinuousArcs(t *testing.T) {
	brief := novelWorkbenchBrief{TargetUnitCount: 10}
	output := novelWorkbenchBootstrapOutput{
		Title:      "归来者",
		Logline:    "失踪十年的女儿带着一个不能公开的真相回到故乡。",
		StoryBible: map[string]any{"corePromise": "每次靠近真相都要付出关系代价"},
		Arcs: []novelWorkbenchArc{
			{Title: "归乡", StartUnit: 1, EndUnit: 4, Mission: "让主角重新进入家族", KeyConflict: "身份不被承认", ExitDebt: "发现母亲伪造了死亡证明"},
			{Title: "追证", StartUnit: 5, EndUnit: 10, Mission: "追查死亡证明", KeyConflict: "亲情与真相互相撕裂", ExitDebt: "真相公开后谁来承担后果"},
		},
	}
	if err := validateNovelWorkbenchBootstrap(&output, brief); err != nil {
		t.Fatalf("valid arcs rejected: %v", err)
	}
	if output.Arcs[0].Index != 1 || output.Arcs[1].Index != 2 {
		t.Fatalf("arc indexes not normalized: %+v", output.Arcs)
	}

	output.Arcs[1].StartUnit = 6
	if err := validateNovelWorkbenchBootstrap(&output, brief); err == nil {
		t.Fatal("gapped arcs should be rejected")
	}
}

func TestApplyNovelWorkbenchWritebackPreservesExecutionState(t *testing.T) {
	state := novelWorkbenchState{CharacterStates: []string{"旧状态"}, OpenDebts: []string{"旧债务"}}
	output := novelWorkbenchUnitOutput{
		Summary: "主角拿到了证明，但因此失去唯一的盟友。",
		Writeback: novelWorkbenchWriteback{
			CharacterStates:    []string{"主角掌握证明且不再信任盟友"},
			RelationshipStates: []string{"主角与盟友公开决裂"},
			OpenDebts:          []string{"证明的来源仍然不明"},
			NextUnitBridge:     "盟友在敌人阵营出现，逼主角决定是否公开证明。",
		},
	}
	next := applyNovelWorkbenchWriteback(state, novelWorkbenchArc{Title: "追证"}, 5, "第05集｜反证", output)
	if next.CompletedUnit != 5 || next.CurrentArc != "追证" || next.NextUnitBridge == "" {
		t.Fatalf("writeback did not advance run state: %+v", next)
	}
	if len(next.CharacterStates) != 1 || next.CharacterStates[0] == "旧状态" {
		t.Fatalf("character state was not replaced: %+v", next.CharacterStates)
	}
	if len(next.AuditTrail) != 1 || next.AuditTrail[0].Title != "第05集｜反证" {
		t.Fatalf("audit trail missing: %+v", next.AuditTrail)
	}
}

func TestNovelWorkbenchCompletionDefersContinuationUntilTaskSuccess(t *testing.T) {
	run := &model.NovelWorkbenchRun{Status: novelWorkbenchStatusRunning, CurrentTaskID: "current-task"}
	prepareNovelWorkbenchContinuation(run, "第 1 单元已写回，等待第 2 单元")
	directive := novelWorkbenchContinuationDirective(2, "生成第 2 单元")
	if directive["nextPhase"] != novelWorkbenchPhaseUnit || intValue(directive["nextUnit"]) != 2 {
		t.Fatalf("continuation directive = %#v", directive)
	}
	if _, exists := directive["nextTaskId"]; exists {
		t.Fatalf("continuation must not create a task before current task succeeds: %#v", directive)
	}
	if run.Status != novelWorkbenchStatusQueued || run.CurrentTaskID != "" {
		t.Fatalf("run should wait without holding a successor task: %#v", run)
	}
}

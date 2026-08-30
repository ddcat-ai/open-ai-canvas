package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestNovelWorkbenchV3MockedArcSealedFlow(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV3TestControl(4)
	bootstrap := novelWorkbenchV3BootstrapOutput{Title: canonical.Title, Logline: canonical.Logline, Bible: canonical.Bible, StoryMap: canonical.StoryMap, Style: canonical.Style}
	plan := novelWorkbenchV3TestArcPlan(canonical.StoryMap[0])
	draft := novelWorkbenchV3Draft{Unit: 1, Title: "夜审", Content: strings.Repeat("沈宁当众拿出半页婚书，逼对手承认看见血印；对手只好封锁西院，留下一条新的追查路径。", 24), Summary: "沈宁把血印变成公开问题，对手封锁西院。"}
	arcReview := novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: true, Verdict: "故事弧接力可执行。"}
	renderReview := novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: true, Warnings: []novelWorkbenchV3ReviewIssue{{Code: "PACING", Unit: 1, Evidence: "转折后的停顿偏短。", RepairAction: "后续可在反应镜头中补一拍。"}}, Verdict: "可提交；篇幅与节奏提醒不阻断正文。"}

	calls := []string{}
	upstream := newNovelWorkbenchV3MockServer(t, func(prompt string) any {
		switch {
		case strings.Contains(prompt, "中文长线叙事架构师"):
			calls = append(calls, "bootstrap")
			return bootstrap
		case strings.Contains(prompt, "长线作品的故事弧策划编辑"):
			calls = append(calls, "planner")
			return plan
		case strings.Contains(prompt, "独立的长线连续性审稿编辑"):
			calls = append(calls, "arc-review")
			return arcReview
		case strings.Contains(prompt, "独立的中文商业叙事审稿编辑"):
			calls = append(calls, "render-review")
			return renderReview
		case strings.Contains(prompt, "执行主笔"):
			calls = append(calls, "writer")
			return draft
		default:
			t.Fatalf("unexpected V3 prompt: %s", prompt)
			return nil
		}
	})
	defer upstream.Close()

	svc, db := newNovelWorkbenchV3FlowTestService(t)
	project, run := createNovelWorkbenchV3TestRun(t, db, canonical.Brief, newNovelWorkbenchV3Control(canonical.Brief))
	config := novelWorkbenchV3TestConfig(upstream)
	bootstrapTask := createNovelWorkbenchV3FlowTask(t, db, project, run, config, novelWorkbenchPhaseBootstrap, 0, "task_v3_bootstrap")
	bootstrapResult, _, err := svc.processNovelWorkbenchTask(context.Background(), bootstrapTask)
	if err != nil {
		t.Fatalf("V3 bootstrap failed: %v", err)
	}
	if bootstrapResult["nextPhase"] != novelWorkbenchPhaseUnit || intValue(bootstrapResult["nextUnit"]) != 1 {
		t.Fatalf("V3 bootstrap continuation = %#v", bootstrapResult)
	}

	unitTask := createNovelWorkbenchV3FlowTask(t, db, project, run, config, novelWorkbenchPhaseUnit, 1, "task_v3_unit_1")
	result, _, err := svc.processNovelWorkbenchTask(context.Background(), unitTask)
	if err != nil {
		t.Fatalf("V3 unit failed: %v", err)
	}
	if result["nextPhase"] != novelWorkbenchPhaseUnit || intValue(result["nextUnit"]) != 2 {
		t.Fatalf("V3 continuation = %#v", result)
	}
	if got := strings.Join(calls, ","); got != "bootstrap,planner,arc-review,writer,render-review" {
		t.Fatalf("V3 model call order = %q", got)
	}

	persisted, err := svc.repo.NovelWorkbenchRun(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := decodeNovelWorkbenchV3State(persisted.DynamicStateJSON)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Status != novelWorkbenchStatusQueued || persisted.CompletedUnitCount != 1 || state.CompletedUnit != 1 || state.FactStates["question_blood_mark"] != "seeded" || state.CurrentArc == nil {
		t.Fatalf("persisted V3 state = %#v / %#v", persisted, state)
	}
	units, err := svc.repo.ProjectUnits(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 1 || units[0].SourceText != draft.Content || units[0].WordCount != model.ProjectUnitWordCount(draft.Content) || units[0].Status != model.ProjectUnitStatusReady {
		t.Fatalf("public V3 unit = %#v", units)
	}
	artifacts, err := svc.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"book_canon", "arc_plan", "arc_review", "arc_seal", "draft_accepted", "render_review", "commit_record"} {
		if !strings.Contains(novelWorkbenchV3ArtifactKinds(artifacts), required) {
			t.Fatalf("V3 artifacts missing %s: %s", required, novelWorkbenchV3ArtifactKinds(artifacts))
		}
	}
}

func TestNovelWorkbenchV3RepairsArcPlanBeforeCallingWriter(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV3TestControl(4)
	invalid := novelWorkbenchV3TestArcPlan(canonical.StoryMap[0])
	invalid.Packets[0].FactActions[0].FactID = "missing_fact"
	valid := novelWorkbenchV3TestArcPlan(canonical.StoryMap[0])
	writerCalls := 0
	plannerCalls := 0
	repairPrompt := ""
	upstream := newNovelWorkbenchV3MockServer(t, func(prompt string) any {
		switch {
		case strings.Contains(prompt, "独立的长线连续性审稿编辑"):
			return novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: true, Verdict: "可封存"}
		case strings.Contains(prompt, "定向重编一个尚未封存"):
			plannerCalls++
			repairPrompt = prompt
			return valid
		case strings.Contains(prompt, "长线作品的故事弧策划编辑"):
			plannerCalls++
			return invalid
		case strings.Contains(prompt, "独立的中文商业叙事审稿编辑"):
			return novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: true, Verdict: "可提交"}
		case strings.Contains(prompt, "执行主笔"):
			writerCalls++
			return novelWorkbenchV3Draft{Unit: 1, Title: "夜审", Content: strings.Repeat("沈宁在祖祠当众指出血印，逼对手封锁西院。", 30), Summary: "血印成为公开问题。"}
		default:
			t.Fatalf("unexpected V3 prompt: %s", prompt)
			return nil
		}
	})
	defer upstream.Close()

	svc, db := newNovelWorkbenchV3FlowTestService(t)
	project, run := createNovelWorkbenchV3ReadyRun(t, db, canonical)
	task := createNovelWorkbenchV3FlowTask(t, db, project, run, novelWorkbenchV3TestConfig(upstream), novelWorkbenchPhaseUnit, 1, "task_v3_plan_repair")
	result, _, err := svc.processNovelWorkbenchTask(context.Background(), task)
	if err != nil {
		t.Fatalf("V3 plan repair failed: %v", err)
	}
	if plannerCalls != 2 || writerCalls != 1 || result["blocked"] == true {
		t.Fatalf("V3 plan repair result=%#v planner=%d writer=%d", result, plannerCalls, writerCalls)
	}
	if !strings.Contains(repairPrompt, "missing_fact") || !strings.Contains(repairPrompt, "不存在的账本") {
		t.Fatalf("V3 plan repair omitted deterministic failure: %s", repairPrompt)
	}
	artifacts, err := svc.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(novelWorkbenchV3ArtifactKinds(artifacts), "arc_plan_rejected") || strings.Contains(novelWorkbenchV3ArtifactKinds(artifacts), "quality_block") {
		t.Fatalf("V3 plan repair artifacts = %s", novelWorkbenchV3ArtifactKinds(artifacts))
	}
}

func TestNovelWorkbenchV3UsesOneTargetedProseRepairAndStopsWithoutContinuation(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV3TestControl(4)
	plan := novelWorkbenchV3TestArcPlan(canonical.StoryMap[0])
	writerCalls := 0
	patchCalls := 0
	reviewCalls := 0
	repairPrompt := ""
	initialDraft := novelWorkbenchV3Draft{Unit: 1, Title: "夜审", Content: strings.Repeat("沈宁隔着烛火盯住牌位，众人尚未看清血印。", 24) + "她暂时收起白帛。", Summary: "沈宁看见血印，但尚未公开。"}
	upstream := newNovelWorkbenchV3MockServer(t, func(prompt string) any {
		switch {
		case strings.Contains(prompt, "独立的长线连续性审稿编辑"):
			return novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: true, Verdict: "可封存"}
		case strings.Contains(prompt, "长线作品的故事弧策划编辑"):
			return plan
		case strings.Contains(prompt, "局部修订编辑"):
			patchCalls++
			repairPrompt = prompt
			return novelWorkbenchV3LocalizedPatch{Unit: 1, Replacements: []novelWorkbenchV3TextReplacement{{Original: "她暂时收起白帛。", Replacement: "沈宁当众举起白帛，血印映在烛火下，众人看见沈瑶琴脸色骤变并下令封锁西院。"}}, Summary: "血印成为公开问题，西院被封。"}
		case strings.Contains(prompt, "独立的中文商业叙事审稿编辑"):
			reviewCalls++
			if reviewCalls == 1 {
				return novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: false, BlockingIssues: []novelWorkbenchV3ReviewIssue{{Code: "REQUIRED_EVENT_MISSING", Unit: 1, ReferenceIDs: []string{"question_blood_mark"}, Evidence: "正文没有让血印被旁人看见。", RepairAction: "让沈宁当众展示血印并得到对手的可见反应。"}}, Verdict: "关键事件缺失。"}
			}
			return novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: true, Verdict: "修复后可提交"}
		case strings.Contains(prompt, "执行主笔"):
			writerCalls++
			return initialDraft
		default:
			t.Fatalf("unexpected V3 prompt: %s", prompt)
			return nil
		}
	})
	defer upstream.Close()

	svc, db := newNovelWorkbenchV3FlowTestService(t)
	project, run := createNovelWorkbenchV3ReadyRun(t, db, canonical)
	task := createNovelWorkbenchV3FlowTask(t, db, project, run, novelWorkbenchV3TestConfig(upstream), novelWorkbenchPhaseUnit, 1, "task_v3_prose_repair")
	result, _, err := svc.processNovelWorkbenchTask(context.Background(), task)
	if err != nil {
		t.Fatalf("V3 prose repair failed: %v", err)
	}
	if writerCalls != 1 || patchCalls != 1 || reviewCalls != 2 || result["blocked"] == true || !strings.Contains(repairPrompt, "REQUIRED_EVENT_MISSING") {
		t.Fatalf("V3 prose repair result=%#v writer=%d patch=%d review=%d repair=%s", result, writerCalls, patchCalls, reviewCalls, repairPrompt)
	}
	artifacts, err := svc.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	kinds := novelWorkbenchV3ArtifactKinds(artifacts)
	if !strings.Contains(kinds, "prose_attempt") || !strings.Contains(kinds, "prose_recovery") {
		t.Fatalf("V3 localized repair artifacts = %s", kinds)
	}
}

func TestNovelWorkbenchV3RepairsReviewerProtocolWithoutRewritingPlanOrDraft(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV3TestControl(4)
	plan := novelWorkbenchV3TestArcPlan(canonical.StoryMap[0])
	plannerCalls := 0
	arcReviewCalls := 0
	writerCalls := 0
	renderReviewCalls := 0
	upstream := newNovelWorkbenchV3MockServer(t, func(prompt string) any {
		switch {
		case strings.Contains(prompt, "独立的长线连续性审稿编辑"):
			arcReviewCalls++
			if arcReviewCalls == 1 {
				return "not-json"
			}
			return novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: true, Verdict: "报告修复后可封存"}
		case strings.Contains(prompt, "长线作品的故事弧策划编辑"):
			plannerCalls++
			return plan
		case strings.Contains(prompt, "独立的中文商业叙事审稿编辑"):
			renderReviewCalls++
			if renderReviewCalls == 1 {
				return "not-json"
			}
			return novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: true, Verdict: "报告修复后可提交"}
		case strings.Contains(prompt, "执行主笔"):
			writerCalls++
			return novelWorkbenchV3Draft{Unit: 1, Title: "夜审", Content: strings.Repeat("沈宁当众展示血印，沈瑶琴封锁西院，沈宁决定追入西院。", 28), Summary: "血印公开，西院成为行动目标。"}
		default:
			t.Fatalf("unexpected V3 prompt: %s", prompt)
			return nil
		}
	})
	defer upstream.Close()

	svc, db := newNovelWorkbenchV3FlowTestService(t)
	project, run := createNovelWorkbenchV3ReadyRun(t, db, canonical)
	task := createNovelWorkbenchV3FlowTask(t, db, project, run, novelWorkbenchV3TestConfig(upstream), novelWorkbenchPhaseUnit, 1, "task_v3_review_protocol")
	result, _, err := svc.processNovelWorkbenchTask(context.Background(), task)
	if err != nil {
		t.Fatalf("V3 reviewer protocol repair failed: %v", err)
	}
	if result["blocked"] == true || plannerCalls != 1 || writerCalls != 1 || arcReviewCalls != 2 || renderReviewCalls != 2 {
		t.Fatalf("V3 reviewer protocol result=%#v planner=%d writer=%d arcReview=%d renderReview=%d", result, plannerCalls, writerCalls, arcReviewCalls, renderReviewCalls)
	}
	artifacts, err := svc.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	kinds := novelWorkbenchV3ArtifactKinds(artifacts)
	if !strings.Contains(kinds, "arc_review_rejected") || !strings.Contains(kinds, "render_review_rejected") || strings.Contains(kinds, "draft_rejected") {
		t.Fatalf("reviewer protocol artifacts = %s", kinds)
	}
}

func TestNovelWorkbenchV3StopsOnRepeatedRepairFingerprintWithoutContinuation(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV3TestControl(4)
	plan := novelWorkbenchV3TestArcPlan(canonical.StoryMap[0])
	writerCalls := 0
	patchCalls := 0
	initialDraft := novelWorkbenchV3Draft{Unit: 1, Title: "夜审", Content: strings.Repeat("沈宁查验血印。", 44) + "她转身离开祖祠。", Summary: "血印被看见。"}
	upstream := newNovelWorkbenchV3MockServer(t, func(prompt string) any {
		switch {
		case strings.Contains(prompt, "独立的长线连续性审稿编辑"):
			return novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: true, Verdict: "可封存"}
		case strings.Contains(prompt, "长线作品的故事弧策划编辑"):
			return plan
		case strings.Contains(prompt, "局部修订编辑"):
			patchCalls++
			return novelWorkbenchV3LocalizedPatch{Unit: 1, Replacements: []novelWorkbenchV3TextReplacement{{Original: "她转身离开祖祠。", Replacement: "她盯着西院方向，知道必须立刻找出封锁背后的东西。"}}, Summary: "血印被看见，西院成为行动目标。"}
		case strings.Contains(prompt, "独立的中文商业叙事审稿编辑"):
			return novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: false, BlockingIssues: []novelWorkbenchV3ReviewIssue{{Code: "EXIT_DEBT_MISSING", Unit: 1, Evidence: "正文结尾没有留下西院封锁后的行动债务。", RepairAction: "让对手封锁西院，并让主角获得必须进入西院的明确压力。"}}, Verdict: "结尾债务缺失。"}
		case strings.Contains(prompt, "执行主笔"):
			writerCalls++
			return initialDraft
		default:
			t.Fatalf("unexpected V3 prompt: %s", prompt)
			return nil
		}
	})
	defer upstream.Close()

	svc, db := newNovelWorkbenchV3FlowTestService(t)
	project, run := createNovelWorkbenchV3ReadyRun(t, db, canonical)
	task := createNovelWorkbenchV3FlowTask(t, db, project, run, novelWorkbenchV3TestConfig(upstream), novelWorkbenchPhaseUnit, 1, "task_v3_render_block")
	result, _, err := svc.processNovelWorkbenchTask(context.Background(), task)
	if err != nil {
		t.Fatalf("V3 quality block must be controlled: %v", err)
	}
	if result["blocked"] != true || result["nextPhase"] != nil || writerCalls != 1 || patchCalls != 1 {
		t.Fatalf("V3 quality block result=%#v writers=%d patches=%d", result, writerCalls, patchCalls)
	}
	persisted, err := svc.repo.NovelWorkbenchRun(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Status != novelWorkbenchStatusFailed || persisted.PipelineStage != novelWorkbenchV3PipelineBlocked || !strings.Contains(persisted.QualityBlockReason, "同一失败指纹") || !strings.Contains(persisted.QualityBlockReason, "EXIT_DEBT_MISSING") {
		t.Fatalf("V3 blocked run = %#v", persisted)
	}
	var unitCount int64
	if err := db.Model(&model.ProjectUnit{}).Where("project_id = ?", project.ID).Count(&unitCount).Error; err != nil {
		t.Fatal(err)
	}
	if unitCount != 0 {
		t.Fatalf("blocked V3 run must not commit a unit, got %d", unitCount)
	}
}

func TestNovelWorkbenchV3BoundaryContractSeparatesCurrentAndNextUnit(t *testing.T) {
	control := newNovelWorkbenchV3TestControl(4)
	state := novelWorkbenchV3InitialState(control)
	plan := novelWorkbenchV3TestArcPlan(control.StoryMap[0])
	pkg := novelWorkbenchV3ArcPackage{Version: novelWorkbenchV3ArcPlanVersion, ArcID: control.StoryMap[0].ID, Title: control.StoryMap[0].Title, StartUnit: 1, EndUnit: 2, Packets: plan.Packets}
	boundary, err := novelWorkbenchV3BoundaryContractForPacket(control, state, pkg, plan.Packets[0])
	if err != nil {
		t.Fatal(err)
	}
	if boundary.CurrentExitStates["char_shen"].Location != "祖祠" || boundary.NextUnit != 2 || boundary.NextUnitEntryBridge != plan.Packets[1].EntryBridge {
		t.Fatalf("boundary contract = %#v", boundary)
	}
	writerPrompt := buildNovelWorkbenchV3WriterPrompt(control, state, pkg, plan.Packets[0], boundary, "")
	reviewPrompt := buildNovelWorkbenchV3RenderReviewPrompt(control, state, pkg, plan.Packets[0], boundary, novelWorkbenchV3Draft{Unit: 1, Title: "夜审", Content: "沈宁在祖祠收束本集。", Summary: "祖祠切点成立。"})
	if !strings.Contains(writerPrompt, "currentExitStates") || !strings.Contains(writerPrompt, "下一单元入口动作") || !strings.Contains(reviewPrompt, "nextUnitEntryBridge") || !strings.Contains(reviewPrompt, "不能因为本集尚未实际完成下一集动作而拦截") {
		t.Fatalf("boundary instructions missing from prompts:\nwriter=%s\nreview=%s", writerPrompt, reviewPrompt)
	}
}

func TestNovelWorkbenchV3RecoveryHistoryStopsRepeatedFingerprintAcrossResume(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV3TestControl(4)
	svc, db := newNovelWorkbenchV3FlowTestService(t)
	_, run := createNovelWorkbenchV3ReadyRun(t, db, canonical)
	draft := novelWorkbenchV3Draft{Unit: 1, Title: "夜审", Content: "沈宁先守在祖祠门内。", Summary: "她准备继续跟踪。"}
	review := novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: false, BlockingIssues: []novelWorkbenchV3ReviewIssue{{Code: "STATE_CONTRADICTION", Unit: 1, ReferenceIDs: []string{"char_shen"}, Evidence: "正文提前离开祖祠。", RepairAction: "本集保留在祖祠，下一集再离开。"}}, Verdict: "状态冲突。"}
	failure := novelWorkbenchV3ReviewFailure(review)
	fingerprint := novelWorkbenchV3ReviewFingerprint(review)
	paraphrasedReview := novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: false, BlockingIssues: []novelWorkbenchV3ReviewIssue{{Code: "STATE_CONTRADICTION", Unit: 1, ReferenceIDs: []string{"char_shen"}, Evidence: "沈宁在本集切点已被写成走出祖祠。", RepairAction: "将跨出祖祠的动作移到下一单元开场。"}}, Verdict: "角色切点仍不一致。"}
	if err := svc.createNovelWorkbenchV3Artifact(&run, 1, "prose_attempt", 1, novelWorkbenchV3ProseAttemptRecord{Version: novelWorkbenchV3EngineVersion, Unit: 1, Attempt: 1, Strategy: novelWorkbenchV3RecoveryInitial, Draft: draft, DraftSHA256: novelWorkbenchV3DraftSHA256(draft)}, ""); err != nil {
		t.Fatal(err)
	}
	if err := svc.createNovelWorkbenchV3Artifact(&run, 1, "render_review_attempt", 1, novelWorkbenchV3RenderReviewAttemptRecord{Version: novelWorkbenchV3EngineVersion, Unit: 1, Attempt: 1, Strategy: novelWorkbenchV3RecoveryInitial, DraftSHA256: novelWorkbenchV3DraftSHA256(draft), Review: review, Failure: failure, FailureFingerprint: fingerprint}, ""); err != nil {
		t.Fatal(err)
	}
	if err := svc.createNovelWorkbenchV3Artifact(&run, 1, "prose_recovery", 2, novelWorkbenchV3ProseRecoveryRecord{Version: novelWorkbenchV3EngineVersion, Unit: 1, Attempt: 2, Strategy: novelWorkbenchV3RecoveryLocalizedPatch, SourceFailureFingerprint: fingerprint}, ""); err != nil {
		t.Fatal(err)
	}
	if err := svc.createNovelWorkbenchV3Artifact(&run, 1, "prose_attempt", 2, novelWorkbenchV3ProseAttemptRecord{Version: novelWorkbenchV3EngineVersion, Unit: 1, Attempt: 2, Strategy: novelWorkbenchV3RecoveryLocalizedPatch, SourceFailureFingerprint: fingerprint, Draft: draft, DraftSHA256: novelWorkbenchV3DraftSHA256(draft)}, ""); err != nil {
		t.Fatal(err)
	}
	if err := svc.createNovelWorkbenchV3Artifact(&run, 1, "render_review_attempt", 2, novelWorkbenchV3RenderReviewAttemptRecord{Version: novelWorkbenchV3EngineVersion, Unit: 1, Attempt: 2, Strategy: novelWorkbenchV3RecoveryLocalizedPatch, SourceFailureFingerprint: fingerprint, DraftSHA256: novelWorkbenchV3DraftSHA256(draft), Review: paraphrasedReview, Failure: novelWorkbenchV3ReviewFailure(paraphrasedReview), FailureFingerprint: novelWorkbenchV3ReviewFingerprint(paraphrasedReview)}, ""); err != nil {
		t.Fatal(err)
	}
	history, err := svc.novelWorkbenchV3ProseRecoveryHistory(&run, 1)
	if err != nil {
		t.Fatal(err)
	}
	strategy, reason := novelWorkbenchV3RecoveryStrategy(history)
	if strategy != "" || history.LocalizedPatchAttempts != 1 || history.AttemptCount != 2 || !strings.Contains(reason, "同一失败指纹") {
		t.Fatalf("persistent recovery history=%#v strategy=%q reason=%q", history, strategy, reason)
	}
}

func TestNovelWorkbenchV3PriorQualityBlockGetsOneFullRewrite(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV3TestControl(4)
	svc, db := newNovelWorkbenchV3FlowTestService(t)
	_, run := createNovelWorkbenchV3ReadyRun(t, db, canonical)
	review := novelWorkbenchV3ReviewReport{Unit: 1, OverallPass: false, BlockingIssues: []novelWorkbenchV3ReviewIssue{{Code: "STATE_CONTRADICTION", Unit: 1, Evidence: "既有候选正文与下一单元衔接冲突。", RepairAction: "按边界重新处理结尾。"}}, Verdict: "不通过。"}
	if err := svc.createNovelWorkbenchV3Artifact(&run, 1, "render_review_attempt", 1, map[string]any{"review": review, "failure": novelWorkbenchV3ReviewFailure(review)}, ""); err != nil {
		t.Fatal(err)
	}
	history, err := svc.novelWorkbenchV3ProseRecoveryHistory(&run, 1)
	if err != nil {
		t.Fatal(err)
	}
	strategy, reason := novelWorkbenchV3RecoveryStrategy(history)
	if strategy != novelWorkbenchV3RecoveryFullRewrite || reason != "" || history.LatestDraft != nil {
		t.Fatalf("prior-block recovery history=%#v strategy=%q reason=%q", history, strategy, reason)
	}
}

func TestNovelWorkbenchV3LocalizedPatchRequiresUniqueVerbatimSource(t *testing.T) {
	draft := novelWorkbenchV3Draft{Unit: 1, Title: "夜审", Content: "沈宁看见血印。沈宁看见血印。", Summary: "旧摘要。"}
	_, err := applyNovelWorkbenchV3LocalizedPatch(draft, novelWorkbenchV3LocalizedPatch{Unit: 1, Replacements: []novelWorkbenchV3TextReplacement{{Original: "沈宁看见血印。", Replacement: "沈宁当众展示血印。"}}, Summary: "新摘要。"})
	if err == nil || !strings.Contains(err.Error(), "唯一") {
		t.Fatalf("ambiguous localized patch should be rejected, got %v", err)
	}
	patched, err := applyNovelWorkbenchV3LocalizedPatch(draft, novelWorkbenchV3LocalizedPatch{Unit: 1, Replacements: []novelWorkbenchV3TextReplacement{{Original: "沈宁看见血印。沈宁看见血印。", Replacement: "沈宁当众展示血印。"}}, Summary: "新摘要。"})
	if err != nil || patched.Content != "沈宁当众展示血印。" || patched.Summary != "新摘要。" {
		t.Fatalf("valid localized patch = %#v, err=%v", patched, err)
	}
}

func TestNovelWorkbenchV3StateComesOnlyFromSealedPacketAndEndgameGate(t *testing.T) {
	control := newNovelWorkbenchV3TestControl(4)
	state := novelWorkbenchV3InitialState(control)
	pkg := novelWorkbenchV3ArcPackage{Version: novelWorkbenchV3ArcPlanVersion, ArcID: "arc_open", Title: "祖祠重局", StartUnit: 1, EndUnit: 2}
	packet := novelWorkbenchV3TestArcPlan(control.StoryMap[0]).Packets[0]
	next, err := applyNovelWorkbenchV3Packet(control, state, pkg, packet, novelWorkbenchV3Draft{Unit: 1, Title: "夜审", Content: "正文并不提供状态写回。", Summary: "血印公开。"})
	if err != nil {
		t.Fatal(err)
	}
	if next.CharacterStates["char_shen"].Status != "被软禁" || next.CharacterStates["char_shen"].Location != "祖祠" || next.FactStates["question_blood_mark"] != "seeded" {
		t.Fatalf("packet-derived state = %#v", next)
	}
	next.CompletedUnit = 4
	next.FactStates["promise_identity"] = "active"
	if err := validateNovelWorkbenchV3PostCommit(control, next, 4); err == nil || !strings.Contains(err.Error(), "结局仍未收束") {
		t.Fatalf("unresolved final promise must block, got %v", err)
	}
}

func newNovelWorkbenchV3FlowTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:novel-workbench-v3-flow-"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Project{}, &model.NovelWorkbenchRun{}, &model.NovelWorkbenchArtifact{}, &model.ProjectUnit{}, &model.Task{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}, db
}

func createNovelWorkbenchV3FlowTask(t *testing.T, db *gorm.DB, project model.Project, run model.NovelWorkbenchRun, config providerConfig, phase string, unit int, id string) model.Task {
	t.Helper()
	inputJSON, err := json.Marshal(novelWorkbenchTaskInput{Mode: "text", Config: config, RunID: run.ID, Phase: phase, Unit: unit})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	task := model.Task{ID: id, UserID: project.UserID, ProjectID: project.ID, Type: novelWorkbenchTaskType, Status: model.TaskStatusRunning, Stage: "模拟执行", Progress: 10, Prompt: "模拟小说工作台", InputJSON: string(inputJSON), CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	return task
}

func novelWorkbenchV3ArtifactKinds(artifacts []model.NovelWorkbenchArtifact) string {
	kinds := make([]string, 0, len(artifacts))
	for _, artifact := range artifacts {
		kinds = append(kinds, artifact.Kind)
	}
	return strings.Join(kinds, ",")
}

func newNovelWorkbenchV3TestControl(target int) novelWorkbenchV3Control {
	brief := novelWorkbenchBrief{
		ProjectName: "弧级测试", Premise: "沈宁在替嫁夜发现祖祠血印，必须在抄家前找回身份真相。", OutputMode: novelWorkbenchModeScreenplay,
		Genre: "古装复仇", Audience: "女性情感向", TargetUnitCount: target, TargetUnitLength: 900, UnitDurationSeconds: 90,
		Tone: "克制紧张", EndingDirection: "真相回收", StructurePreference: "强冲突", CustomRequirements: "",
	}
	return novelWorkbenchV3Control{
		EngineVersion: novelWorkbenchV3EngineVersion, Title: "替嫁夜的血印", Logline: "替嫁庶女借祖祠血印夺回身份，在抄家倒计时中反制侯府。", Brief: brief,
		Bible: novelWorkbenchV3Bible{
			Premise: "替嫁庶女借祖祠血印夺回身份。", EndingPromise: "血印与婚书真相在抄家前公开，沈宁保住家人。", Theme: "身份由行动而非门第定义。",
			WorldRules: []string{"侯府祖祠内的旧物不得私毁。", "公开的族规程序会限制侯府处置新妇。"},
			Characters: []novelWorkbenchV3Character{
				{ID: "char_shen", Name: "沈宁", Role: "替嫁庶女", Desire: "保住沈家并夺回身份", Fear: "重演前世灭门", Voice: "冷静、短句、先问证据", InitialState: "被迫替嫁"},
				{ID: "char_yaoqin", Name: "沈瑶琴", Role: "嫡姐", Desire: "守住嫡女身份", Fear: "婚书夹层暴露", Voice: "温软外壳下带刺", InitialState: "掌控替嫁安排"},
			},
			Facts: []novelWorkbenchV3Fact{
				{ID: "question_blood_mark", Statement: "祖祠血印为何与沈宁指纹相合？", Kind: "question", IntroducedByUnit: 1, ResolveByUnit: 4, OwnerIDs: []string{"char_shen"}},
				{ID: "promise_identity", Statement: "沈宁能否找到婚书夹层并夺回身份？", Kind: "promise", IntroducedByUnit: 2, ResolveByUnit: 4, OwnerIDs: []string{"char_shen", "char_yaoqin"}},
			},
		},
		StoryMap: []novelWorkbenchV3StoryArc{
			{ID: "arc_open", Title: "祖祠重局", StartUnit: 1, EndUnit: 2, Mission: "让血印成为公开问题并逼出西院线索。", TurningPoint: "沈瑶琴封锁西院反而留下破绽。", ExitPromise: "沈宁必须潜入西院找婚书夹层。"},
			{ID: "arc_close", Title: "婚书翻案", StartUnit: 3, EndUnit: 4, Mission: "取得夹层并公开身份真相。", TurningPoint: "侯府族规被迫反噬嫡姐。", ExitPromise: "血印、婚书与沈家危机一并收束。"},
		},
		Style: novelWorkbenchV3StyleGuide{NarrativeVoice: "紧张克制", PacingRules: []string{"每单元只推进一个可见关键选择。", "结尾留下可执行行动债务。"}, ForbiddenDrift: []string{"不得把未证实怀疑写成既成事实。", "不得让角色无来源知情。"}},
	}
}

func novelWorkbenchV3TestArcPlan(arc novelWorkbenchV3StoryArc) novelWorkbenchV3ArcPlanOutput {
	return novelWorkbenchV3ArcPlanOutput{
		EntryDigest: "沈宁被锁在祖祠，血印尚未公开。", ArcSummary: "血印公开后，西院成为下一步行动目标。",
		Packets: []novelWorkbenchV3EpisodePacket{
			{Unit: arc.StartUnit, Title: "血印夜审", EntryBridge: "沈宁被锁祖祠，必须先阻止验身。", Goal: "把血印变成不能私下抹去的公开问题。", Pressure: "沈瑶琴要在族人面前按程序定罪。", Choice: "沈宁当众展示血印而不直接指控身份真相。", Turn: "沈瑶琴为封锁血印而下令封西院。", ExitDebt: "沈宁必须进入西院，确认封锁的是何物。", CharacterIDs: []string{"char_shen", "char_yaoqin"}, FactActions: []novelWorkbenchV3FactAction{{FactID: "question_blood_mark", Action: "introduce", VisibleEvent: "沈宁当众把染血白帛按在牌位指印上，众人看见血痕相合。"}}, CharacterChanges: []novelWorkbenchV3CharacterChange{{CharacterID: "char_shen", ToStatus: "被软禁", ToLocation: "祖祠", Reason: "沈瑶琴以查验血印为由暂不放人。"}}, KnowledgeGrants: []novelWorkbenchV3KnowledgeGrant{{CharacterID: "char_shen", FactIDs: []string{"question_blood_mark"}, Reason: "沈宁亲手比对血印。"}}, RequiredEvents: []string{"沈宁当众展示血印。", "沈瑶琴封锁西院。", "沈宁获得进入西院的行动债务。"}, AllowedConclusion: "读者只能确认血印与沈宁有关，尚不能确认其来源或沈瑶琴的动机。", ForbiddenConclusions: []string{"不能确认血印证明沈宁嫡女身份。", "不能确认沈瑶琴封院只为隐藏婚书。"}},
			{Unit: arc.StartUnit + 1, Title: "西院封门", EntryBridge: "西院被封，沈宁必须借族规争取进入机会。", Goal: "让婚书夹层成为可追查的读者承诺。", Pressure: "沈瑶琴安排人转移西院旧物。", Choice: "沈宁以祖祠血印未清为由要求核对替嫁婚书。", Turn: "婚书烧穿一角，夹层轮廓被沈宁看到。", ExitDebt: "沈宁必须在夹层被毁前取到婚书。", CharacterIDs: []string{"char_shen", "char_yaoqin"}, FactActions: []novelWorkbenchV3FactAction{{FactID: "question_blood_mark", Action: "advance", VisibleEvent: "西院旧物里出现与牌位同款的暗红封蜡。"}, {FactID: "promise_identity", Action: "introduce", VisibleEvent: "烧穿婚书露出夹层轮廓，身份线索被读者明确看见。"}}, RequiredEvents: []string{"沈宁借族规要求核对婚书。", "婚书夹层轮廓出现。", "西院行动债务形成。"}, AllowedConclusion: "读者确认婚书藏有身份线索，尚不能确认夹层内容。", ForbiddenConclusions: []string{"不能提前公开夹层的出生时辰。"}},
		},
	}
}

func createNovelWorkbenchV3TestRun(t *testing.T, db *gorm.DB, brief novelWorkbenchBrief, control novelWorkbenchV3Control) (model.Project, model.NovelWorkbenchRun) {
	t.Helper()
	now := time.Now()
	controlJSON, err := json.Marshal(control)
	if err != nil {
		t.Fatal(err)
	}
	stateJSON, err := json.Marshal(newNovelWorkbenchV3State())
	if err != nil {
		t.Fatal(err)
	}
	project := model.Project{ID: "project_" + newID(), UserID: "user_v3_flow", Name: "V3 Flow " + newID(), Type: "short-drama", AspectRatio: "9:16", Status: model.ProjectStatusActive, CreatedAt: now, UpdatedAt: now}
	run := model.NovelWorkbenchRun{ID: "run_" + newID(), UserID: project.UserID, ProjectID: project.ID, OutputMode: brief.OutputMode, EngineVersion: novelWorkbenchV3EngineVersion, Status: novelWorkbenchStatusQueued, Stage: "等待建立弧级创作档案", PipelineStage: novelWorkbenchV3PipelineBootstrap, QualityPolicy: novelWorkbenchV3QualityPolicy, TargetUnitCount: brief.TargetUnitCount, ControlJSON: string(controlJSON), DynamicStateJSON: string(stateJSON), CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	return project, run
}

func createNovelWorkbenchV3ReadyRun(t *testing.T, db *gorm.DB, control novelWorkbenchV3Control) (model.Project, model.NovelWorkbenchRun) {
	t.Helper()
	project, run := createNovelWorkbenchV3TestRun(t, db, control.Brief, control)
	stateJSON, err := json.Marshal(novelWorkbenchV3InitialState(control))
	if err != nil {
		t.Fatal(err)
	}
	run.DynamicStateJSON = string(stateJSON)
	run.Stage = "等待封存首个故事弧"
	run.PipelineStage = novelWorkbenchV3PipelinePrepare
	if err := db.Model(&model.NovelWorkbenchRun{}).Where("id = ?", run.ID).Updates(map[string]any{"dynamic_state_json": run.DynamicStateJSON, "stage": run.Stage, "pipeline_stage": run.PipelineStage}).Error; err != nil {
		t.Fatal(err)
	}
	return project, run
}

func novelWorkbenchV3TestConfig(upstream *httptest.Server) providerConfig {
	return providerConfig{BaseURL: upstream.URL, APIKey: "mock-key", Model: "mock-text", InterfaceType: string(model.ChannelInterfaceChatCompletion), AllowLocalChannel: true}
}

func newNovelWorkbenchV3MockServer(t *testing.T, response func(prompt string) any) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload struct {
			Messages []struct {
				Content string `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("decode mock request: %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		if len(payload.Messages) == 0 {
			t.Error("mock request has no message")
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		content, err := json.Marshal(response(payload.Messages[len(payload.Messages)-1].Content))
		if err != nil {
			t.Errorf("marshal mock response: %v", err)
			writer.WriteHeader(http.StatusInternalServerError)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []map[string]any{{"message": map[string]any{"content": string(content)}}}})
	}))
}

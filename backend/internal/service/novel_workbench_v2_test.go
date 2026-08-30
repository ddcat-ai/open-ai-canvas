package service

import (
	"strings"
	"testing"
)

func TestNovelWorkbenchV2ControlValidatesCanonicalDocuments(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	if err := validateNovelWorkbenchV2Control(&control, control.Brief); err != nil {
		t.Fatalf("valid V2 control rejected: %v", err)
	}

	control.Documents.ChapterRoadmap[1].StartUnit = 5
	if err := validateNovelWorkbenchV2Control(&control, control.Brief); err == nil {
		t.Fatal("gapped roadmap should be rejected")
	}
}

func TestNovelWorkbenchV2RejectsUnknownOrUnseededLedgerChanges(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	state := initialNovelWorkbenchV2State(control)

	err := validateNovelWorkbenchV2Writeback(control, state, novelWorkbenchV2Writeback{
		ForeshadowChanges: []novelWorkbenchV2StateTransition{{ID: "foreshadow_missing", From: "planned", To: "introduced"}},
	}, 1)
	if err == nil {
		t.Fatal("unknown ledger ID should be rejected")
	}

	err = validateNovelWorkbenchV2Writeback(control, state, novelWorkbenchV2Writeback{
		ForeshadowChanges: []novelWorkbenchV2StateTransition{{ID: "foreshadow_seal", From: "planned", To: "paid"}},
	}, 1)
	if err == nil {
		t.Fatal("payoff without an earlier introduction should be rejected")
	}
}

func TestNovelWorkbenchV2RequiresLedgerToBeSeededBeforePayoff(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	control.Documents.ForeshadowLedger[0].PayoffByUnit = control.Documents.ForeshadowLedger[0].IntroducedByUnit
	if err := validateNovelWorkbenchV2Control(&control, control.Brief); err == nil {
		t.Fatal("a ledger item cannot be introduced and paid off in the same unit")
	}
}

func TestNovelWorkbenchV2EnforcesControlCardAndDeadlines(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	state := initialNovelWorkbenchV2State(control)
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, 1)
	if !ok {
		t.Fatal("missing unit one roadmap")
	}
	card := novelWorkbenchV2ControlCard{
		Unit: 1, RoadmapID: roadmap.ID, Mission: "让主角被迫进局", OpeningHook: "婚书被撕", CoreConflict: "主角无法自证", Escalation: "证人倒戈", Reversal: "印章出现", ClosingHook: "敌人拿走印章", NextDebt: "找回印章",
		CausalSpine:       []string{"侯爷当众撕毁婚书，印章裂纹已被众人看见。", "沈宁主动拿出印章要求当场核验。", "侯爷担心裂纹暴露伪造，夺走印章阻止核验。", "沈宁确认侯爷惧怕印章并获得追查目标。"},
		ReversalAnchorIDs: []string{"foreshadow_seal"},
		IntroduceIDs:      []string{"foreshadow_seal", "promise_identity"},
	}
	if err := validateNovelWorkbenchV2ControlCard(&card, control, roadmap, 1); err != nil {
		t.Fatalf("valid screenplay card rejected: %v", err)
	}
	causalSpine := card.CausalSpine
	card.CausalSpine = nil
	if err := validateNovelWorkbenchV2ControlCard(&card, control, roadmap, 1); err == nil {
		t.Fatal("control card without causal spine should be rejected")
	}
	card.CausalSpine = causalSpine
	card.ReversalAnchorIDs = []string{"missing_anchor"}
	if err := validateNovelWorkbenchV2ControlCard(&card, control, roadmap, 1); err == nil {
		t.Fatal("control card with unknown reversal anchor should be rejected")
	}
	card.ReversalAnchorIDs = []string{"foreshadow_seal"}
	if err := validateNovelWorkbenchV2ControlCardDeadlinePlan(control, state, card, 1); err != nil {
		t.Fatalf("card did not schedule due ledger entries: %v", err)
	}
	writeback := novelWorkbenchV2Writeback{
		ForeshadowChanges: []novelWorkbenchV2StateTransition{{ID: "foreshadow_seal", From: "planned", To: "introduced"}},
		PromiseChanges:    []novelWorkbenchV2StateTransition{{ID: "promise_identity", From: "planned", To: "introduced"}},
		NextUnitBridge:    "敌人开始利用印章。",
	}
	if err := validateNovelWorkbenchV2ControlCardExecution(card, writeback); err != nil {
		t.Fatalf("card writeback should be accepted: %v", err)
	}

	state.CompletedUnit = 2
	state.ForeshadowStates["foreshadow_seal"] = "introduced"
	state.PromiseStates["promise_identity"] = "introduced"
	if err := validateNovelWorkbenchV2Preflight(control, state, 3); err != nil {
		t.Fatalf("valid preflight rejected: %v", err)
	}
	state.CompletedUnit = 3
	if err := validateNovelWorkbenchV2Preflight(control, state, 4); err == nil {
		t.Fatal("expired unresolved foreshadow should stop the next unit")
	}
}

func TestNovelWorkbenchV2CompilesPlanPreviewAndEpisodeContract(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	preview, err := compileNovelWorkbenchV2Plan(control)
	if err != nil {
		t.Fatalf("valid control plan rejected: %v", err)
	}
	if len(preview.Units) != 3 {
		t.Fatalf("plan units = %#v", preview.Units)
	}
	if got := strings.Join(preview.Units[0].Introductions, ","); got != "foreshadow_seal,promise_identity" {
		t.Fatalf("unit one planned introductions = %q", got)
	}
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, 1)
	if !ok {
		t.Fatal("missing unit one roadmap")
	}
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, initialNovelWorkbenchV2State(control), roadmap, 1)
	if err != nil {
		t.Fatalf("compile unit one contract: %v", err)
	}
	if got := strings.Join([]string{contract.RequiredIntroductions[0].ID, contract.RequiredIntroductions[1].ID}, ","); got != "foreshadow_seal,promise_identity" || len(contract.RequiredPayoffs) != 0 {
		t.Fatalf("unit one contract = %#v", contract)
	}
	card := novelWorkbenchV2ControlCard{IntroduceIDs: []string{"foreshadow_seal"}}
	if err := validateNovelWorkbenchV2EpisodeContractCard(contract, card); err == nil || !strings.Contains(err.Error(), "promise_identity") {
		t.Fatalf("missing contract action should be rejected, got %v", err)
	}
	card.IntroduceIDs = append(card.IntroduceIDs, "promise_identity")
	if err := validateNovelWorkbenchV2EpisodeContractCard(contract, card); err != nil {
		t.Fatalf("complete contract card rejected: %v", err)
	}
}

func TestNovelWorkbenchV2PlanPreviewRejectsUnscheduledLedgerAction(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	control.Documents.ChapterRoadmap[0].PlannedIntroductions = []string{"foreshadow_seal"}
	if _, err := compileNovelWorkbenchV2Plan(control); err == nil || !strings.Contains(err.Error(), "promise_identity") {
		t.Fatalf("missing plan entry should fail bootstrap validation, got %v", err)
	}
}

func TestNovelWorkbenchV2FirstLaunchQualityGate(t *testing.T) {
	review := novelWorkbenchV2ReviewReport{Unit: 1, OverallPass: true, Signals: map[string]int{}}
	for _, signal := range novelWorkbenchV2QualitySignals {
		review.Signals[signal] = 7
	}
	if err := validateNovelWorkbenchV2Quality(review, 1); err != nil {
		t.Fatalf("strong first-unit review rejected: %v", err)
	}
	review.Signals["stateGuard"] = 6
	if err := validateNovelWorkbenchV2Quality(review, 1); err == nil {
		t.Fatal("first launch gate must require a seven-point state guard")
	}
}

func TestNovelWorkbenchV2RepairsOnlyInvalidReviewReferenceMetadata(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	review := novelWorkbenchV2ReviewReport{
		Unit:         1,
		OverallPass:  true,
		Signals:      map[string]int{},
		ReferenceIDs: []string{"char_hero", "styleGuide"},
		Warnings: []novelWorkbenchV2ReviewIssue{{
			Code: "style_note", Severity: "warning", ReferenceID: "styleGuide", Evidence: "节奏仍需更紧凑", RepairAction: "后续遵守风格指南",
		}},
	}
	for _, signal := range novelWorkbenchV2QualitySignals {
		review.Signals[signal] = 8
	}
	if err := validateNovelWorkbenchV2Review(&review, control, 1); err == nil {
		t.Fatal("direct validation must still reject an unknown review reference")
	}
	discarded := repairNovelWorkbenchV2ReviewReferences(&review, control)
	if len(discarded) != 1 || discarded[0] != "styleguide" {
		t.Fatalf("discarded review references = %#v", discarded)
	}
	if err := validateNovelWorkbenchV2Review(&review, control, 1); err != nil {
		t.Fatalf("repaired review should validate: %v", err)
	}
	if len(review.ReferenceIDs) != 1 || review.ReferenceIDs[0] != "char_hero" || review.Warnings[0].ReferenceID != "" {
		t.Fatalf("repaired report retained invalid metadata: %#v", review)
	}
}

func TestNovelWorkbenchV2LeavesTargetLengthToEditorialReview(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	state := initialNovelWorkbenchV2State(control)
	card := novelWorkbenchV2ControlCard{
		Unit: 1, RoadmapID: "arc_entry", Mission: "主角被迫进局", OpeningHook: "婚书被撕", CoreConflict: "主角无法自证", Escalation: "证人倒戈", Reversal: "印章出现", ClosingHook: "敌人拿走印章", NextDebt: "找回印章",
		CausalSpine: []string{"婚书被撕，印章裂纹已被看见。", "主角亮出印章要求核验。", "反派担心伪造暴露而夺印。", "主角获得追查印章的行动目标。"},
	}
	output := novelWorkbenchV2UnitOutput{
		Unit: 1, Title: "长篇幅稿", Content: strings.Repeat("字", control.Brief.TargetUnitLength*4), Summary: "测试摘要",
		Writeback: novelWorkbenchV2Writeback{NextUnitBridge: "下一集继续追查印章。"},
	}
	err := validateNovelWorkbenchV2Unit(&output, control, state, card, 1)
	if err != nil {
		t.Fatalf("length alone should reach editorial review, got %v", err)
	}
}

func TestNovelWorkbenchV2RepairPromptIncludesActionsAndStateLocks(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	state := initialNovelWorkbenchV2State(control)
	card := novelWorkbenchV2ControlCard{
		Unit: 1, RoadmapID: "arc_entry", Mission: "主角被迫进局", OpeningHook: "婚书被撕", CoreConflict: "主角无法自证", Escalation: "证人倒戈", Reversal: "印章出现", ClosingHook: "敌人拿走印章", NextDebt: "找回印章",
		CausalSpine:          []string{"婚书被撕，印章裂纹已被看见。", "主角亮出印章要求核验。", "反派担心伪造暴露而夺印。", "主角获得追查印章的行动目标。"},
		ReversalAnchorIDs:    []string{"foreshadow_seal"},
		RequiredCharacterIDs: []string{"char_hero"},
	}
	review := novelWorkbenchV2ReviewReport{
		BlockingIssues: []novelWorkbenchV2ReviewIssue{{
			Code: "UNIT_LENGTH_EXCEEDS_TARGET", Evidence: "正文超过目标长度", RepairAction: "压缩为紧凑完整单元",
		}},
		Verdict: "修正后复审。",
	}
	repairContext := novelWorkbenchV2ReviewRepairContext(review)
	if !strings.Contains(repairContext, "修复动作：压缩为紧凑完整单元") {
		t.Fatalf("repair context omitted blocker action: %q", repairContext)
	}
	prompt := buildNovelWorkbenchV2RepairPrompt(control, state, card, 1, "上一稿", repairContext)
	for _, expected := range []string{"char_hero：隐忍", "字数不是硬性返修条件", "所有 blocker 均必须逐项完成 repairAction", "压缩为紧凑完整单元"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("repair prompt missing %q", expected)
		}
	}
}

func TestNovelWorkbenchV2ReviewPromptMakesLengthAnEditorialDecision(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	state := initialNovelWorkbenchV2State(control)
	card := novelWorkbenchV2ControlCard{Unit: 1, RoadmapID: "arc_entry"}
	output := novelWorkbenchV2UnitOutput{Unit: 1, Title: "首集", Content: strings.Repeat("正文", 700), Summary: "测试摘要"}
	prompt := buildNovelWorkbenchV2ReviewPrompt(control, state, card, output, 1)
	for _, expected := range []string{"没有固定的字数上下限", "UNIT_PACING_LENGTH_NOTE", "UNIT_PACING_LENGTH_MISMATCH", "不能只要求压缩或扩写到某个字数"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("review prompt missing %q", expected)
		}
	}
}

func TestNovelWorkbenchV2ControlCardPromptCarriesCausalRulesAndPriorBlock(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	state := initialNovelWorkbenchV2State(control)
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, 1)
	if !ok {
		t.Fatal("missing unit one roadmap")
	}
	prompt := buildNovelWorkbenchV2ControlCardPrompt(control, state, roadmap, 1, "blocker: 反派动作没有因果")
	for _, expected := range []string{"causalSpine 必须至少四步", "reversalAnchorIds 必须列出", "可用地点锚点", "locationDetail", "blocker: 反派动作没有因果"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("control card prompt missing %q", expected)
		}
	}
}

func TestNovelWorkbenchV2FinalUnitRequiresFullSettlement(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	state := initialNovelWorkbenchV2State(control)
	state.CompletedUnit = 5
	state.ForeshadowStates["foreshadow_seal"] = "paid"
	state.PromiseStates["promise_identity"] = "paid"
	state.PlotlineStates["plot_truth"] = "resolved"
	if err := validateNovelWorkbenchV2PostCommit(control, state, 5); err != nil {
		t.Fatalf("fully settled final state rejected: %v", err)
	}
	state.PromiseStates["promise_identity"] = "active"
	if err := validateNovelWorkbenchV2PostCommit(control, state, 5); err == nil {
		t.Fatal("unpaid reader promise must block final completion")
	}
}

func TestNovelWorkbenchV2FactContractRejectsUnrecordedLocationJump(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	control.Documents.Worldbuilding.Locations = []string{"loc_ancestral_hall：祖祠", "loc_west_courtyard：西院"}
	state := initialNovelWorkbenchV2State(control)
	state.CharacterLocations["char_hero"] = "loc_ancestral_hall"
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, 1)
	if !ok {
		t.Fatal("missing unit one roadmap")
	}
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, 1)
	if err != nil {
		t.Fatal(err)
	}
	card := novelWorkbenchV2ControlCard{
		Unit: 1, RoadmapID: roadmap.ID, Mission: "主角守住现场", OpeningHook: "封门石下落", CoreConflict: "主角无法离开祖祠", Escalation: "对手逼迫交物", Reversal: "裂纹印章出现", ClosingHook: "门锁落下", NextDebt: "查明印章来源",
		CausalSpine:          []string{"封门石正在下落，祖祠入口仍被守住。", "沈宁主动要求当场核验印章。", "侯爷担心裂纹暴露而下令封门。", "沈宁确认对手惧怕印章并留下追查目标。"},
		ReversalAnchorIDs:    []string{"foreshadow_seal"},
		RequiredCharacterIDs: []string{"char_hero"},
		IntroduceIDs:         []string{"foreshadow_seal", "promise_identity"},
	}
	card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
	card.FactContract.CharacterPlacements[0].LocationID = "loc_west_courtyard"
	if err := validateNovelWorkbenchV2FactContract(control, state, contract, &card); err == nil || !strings.Contains(err.Error(), "必须写明 fromLocationId") {
		t.Fatalf("unrecorded location jump should be rejected, got %v", err)
	}
}

func TestNovelWorkbenchV2FactContractCanonicalizesUniqueLocationDetail(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	control.Documents.Worldbuilding.Locations = []string{"loc_houfu_ancestral_hall：镇北侯府祖祠", "loc_houfu_inner_court：镇北侯府内宅"}
	state := initialNovelWorkbenchV2State(control)
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, 1)
	if !ok {
		t.Fatal("missing unit one roadmap")
	}
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, 1)
	if err != nil {
		t.Fatal(err)
	}
	card := novelWorkbenchV2ControlCard{
		Unit: 1, RoadmapID: roadmap.ID, Mission: "主角守住现场", OpeningHook: "封门石下落", CoreConflict: "主角无法离开祖祠", Escalation: "对手逼迫交物", Reversal: "裂纹印章出现", ClosingHook: "门锁落下", NextDebt: "查明印章来源",
		CausalSpine:          []string{"封门石正在下落，祖祠入口仍被守住。", "沈宁主动要求当场核验印章。", "侯爷担心裂纹暴露而下令封门。", "沈宁确认对手惧怕印章并留下追查目标。"},
		ReversalAnchorIDs:    []string{"foreshadow_seal"},
		RequiredCharacterIDs: []string{"char_hero"},
		IntroduceIDs:         []string{"foreshadow_seal", "promise_identity"},
	}
	card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
	card.FactContract.CharacterPlacements[0].LocationID = "侯府祖祠外门"
	if err := validateNovelWorkbenchV2FactContract(control, state, contract, &card); err != nil {
		t.Fatalf("unique location detail should resolve to its anchor: %v", err)
	}
	placement := card.FactContract.CharacterPlacements[0]
	if placement.LocationID != "loc_houfu_ancestral_hall" || placement.LocationDetail != "侯府祖祠外门" {
		t.Fatalf("location was not canonicalized correctly: %#v", placement)
	}
}

func TestNovelWorkbenchV2FactContractRejectsUnknownLocationDetail(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	control.Documents.Worldbuilding.Locations = []string{"loc_houfu_ancestral_hall：镇北侯府祖祠", "loc_houfu_inner_court：镇北侯府内宅"}
	state := initialNovelWorkbenchV2State(control)
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, 1)
	if !ok {
		t.Fatal("missing unit one roadmap")
	}
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, 1)
	if err != nil {
		t.Fatal(err)
	}
	card := novelWorkbenchV2ControlCard{
		Unit: 1, RoadmapID: roadmap.ID, Mission: "主角守住现场", OpeningHook: "封门石下落", CoreConflict: "主角无法离开祖祠", Escalation: "对手逼迫交物", Reversal: "裂纹印章出现", ClosingHook: "门锁落下", NextDebt: "查明印章来源",
		CausalSpine:          []string{"封门石正在下落，祖祠入口仍被守住。", "沈宁主动要求当场核验印章。", "侯爷担心裂纹暴露而下令封门。", "沈宁确认侯爷惧怕印章并留下追查目标。"},
		ReversalAnchorIDs:    []string{"foreshadow_seal"},
		RequiredCharacterIDs: []string{"char_hero"},
		IntroduceIDs:         []string{"foreshadow_seal", "promise_identity"},
	}
	card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
	card.FactContract.CharacterPlacements[0].LocationID = "陌生盐仓外门"
	if err := validateNovelWorkbenchV2FactContract(control, state, contract, &card); err == nil || !strings.Contains(err.Error(), "使用未知地点") {
		t.Fatalf("unknown location detail should remain blocked, got %v", err)
	}
}

func TestNovelWorkbenchV2WritebackCanonicalizesLocationDetail(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	control.Documents.Worldbuilding.Locations = []string{"loc_houfu_ancestral_hall：镇北侯府祖祠", "loc_houfu_inner_court：镇北侯府内宅"}
	writeback := novelWorkbenchV2Writeback{LocationChanges: []novelWorkbenchV2LocationChange{{
		CharacterID:    "char_hero",
		FromLocationID: "侯府祖祠外门",
		ToLocationID:   "侯府内宅正门",
		Note:           "主角被婆子押送至内宅审问。",
	}}}
	normalizeNovelWorkbenchV2WritebackLocations(control, initialNovelWorkbenchV2State(control), &writeback)
	change := writeback.LocationChanges[0]
	if change.FromLocationID != "loc_houfu_ancestral_hall" || change.ToLocationID != "loc_houfu_inner_court" {
		t.Fatalf("writeback locations were not canonicalized: %#v", change)
	}
}

func TestNovelWorkbenchV2FactContractRejectsTemporalKnowledgeBreach(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	state := initialNovelWorkbenchV2State(control)
	state.CompletedUnit = 1
	state.ForeshadowStates["foreshadow_seal"] = "introduced"
	state.PromiseStates["promise_identity"] = "introduced"
	state.ForeshadowStartedAt["foreshadow_seal"] = 1
	state.PromiseStartedAt["promise_identity"] = 1
	state.EvidenceLevels["foreshadow_seal"] = "lead"
	state.EvidenceLevels["promise_identity"] = "lead"
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, 2)
	if !ok {
		t.Fatal("missing unit two roadmap")
	}
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, 2)
	if err != nil {
		t.Fatal(err)
	}
	card := novelWorkbenchV2ControlCard{
		Unit: 2, RoadmapID: roadmap.ID, Mission: "反派试探主角", OpeningHook: "密信送到府门", CoreConflict: "反派想抢走印章", Escalation: "证人临阵退缩", Reversal: "印章裂纹仍在", ClosingHook: "反派下令搜府", NextDebt: "主角必须先找到证人",
		CausalSpine:          []string{"印章裂纹已在上一集现场出现。", "反派主动派人搜查印章。", "主角利用侯爷怕裂纹被复验的风险拖延搜查。", "众人确认搜查无果，主角获得寻找证人的窗口。"},
		ReversalAnchorIDs:    []string{"foreshadow_seal"},
		RequiredCharacterIDs: []string{"char_enemy"},
	}
	card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
	card.FactContract.KnowledgeAccess = []novelWorkbenchV2KnowledgeAccess{{CharacterID: "char_enemy", FactIDs: []string{"foreshadow_seal"}, AcquireInUnit: false}}
	if err := validateNovelWorkbenchV2FactContract(control, state, contract, &card); err == nil || !strings.Contains(err.Error(), "尚未获知") {
		t.Fatalf("temporal knowledge breach should be rejected, got %v", err)
	}
}

func TestNovelWorkbenchV2FactContractRejectsEvidenceLeap(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	state := initialNovelWorkbenchV2State(control)
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, 1)
	if !ok {
		t.Fatal("missing unit one roadmap")
	}
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, 1)
	if err != nil {
		t.Fatal(err)
	}
	card := novelWorkbenchV2ControlCard{
		Unit: 1, RoadmapID: roadmap.ID, Mission: "主角守住现场", OpeningHook: "婚书被撕", CoreConflict: "主角无法自证", Escalation: "对手逼迫交物", Reversal: "裂纹印章出现", ClosingHook: "门锁落下", NextDebt: "查明印章来源",
		CausalSpine:          []string{"婚书被撕，印章裂纹已被看见。", "沈宁主动亮出印章要求核验。", "侯爷担心伪造暴露而夺走印章。", "沈宁确认侯爷惧怕印章并留下追查目标。"},
		ReversalAnchorIDs:    []string{"foreshadow_seal"},
		RequiredCharacterIDs: []string{"char_hero"},
		IntroduceIDs:         []string{"foreshadow_seal", "promise_identity"},
	}
	card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
	card.FactContract.EvidenceClaims[0].Level = "proven"
	card.FactContract.EvidenceClaims[0].Links = []novelWorkbenchV2EvidenceLink{
		{Kind: "origin", Description: "印章从祖祠供桌下被当众取出。", ReferenceIDs: []string{"foreshadow_seal"}},
		{Kind: "verification", Description: "族老当众核验印文与旧谱一致。", ReferenceIDs: []string{"foreshadow_seal"}},
		{Kind: "testimony", Description: "证人当场确认印章曾被侯爷调包。", ReferenceIDs: []string{"foreshadow_seal"}},
	}
	if err := validateNovelWorkbenchV2FactContract(control, state, contract, &card); err == nil || !strings.Contains(err.Error(), "不能从 unseen 跳到 proven") {
		t.Fatalf("evidence leap should be rejected, got %v", err)
	}
}

func TestNovelWorkbenchV2FactContractRequiresCustodyForProof(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	state := initialNovelWorkbenchV2State(control)
	state.ForeshadowStates["foreshadow_seal"] = "introduced"
	state.EvidenceLevels["foreshadow_seal"] = "corroborated"
	state.PromiseStates["promise_identity"] = "introduced"
	state.EvidenceLevels["promise_identity"] = "lead"
	state.CharacterKnowledge["char_hero"] = []string{"foreshadow_seal", "promise_identity"}
	state.CompletedUnit = 1
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, 2)
	if !ok {
		t.Fatal("missing unit two roadmap")
	}
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, 2)
	if err != nil {
		t.Fatal(err)
	}
	card := novelWorkbenchV2ControlCard{
		Unit: 2, RoadmapID: roadmap.ID, Mission: "核验印章来源", OpeningHook: "旧谱被取出", CoreConflict: "侯爷阻止核验", Escalation: "证人改口", Reversal: "印章来处被锁定", ClosingHook: "证据被转移", NextDebt: "追回交接人",
		CausalSpine:          []string{"裂纹印章已是可相互印证的线索。", "沈宁主动要求以旧谱复验印文。", "侯爷为阻止来源暴露而试图带走旧谱。", "众人只确认印章来历待追，未能直接定罪。"},
		ReversalAnchorIDs:    []string{"foreshadow_seal"},
		RequiredCharacterIDs: []string{"char_hero"},
	}
	card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
	card.FactContract.KnowledgeAccess = []novelWorkbenchV2KnowledgeAccess{{CharacterID: "char_hero", FactIDs: []string{"foreshadow_seal"}, AcquireInUnit: false}}
	card.FactContract.EvidenceClaims[0].Level = "proven"
	card.FactContract.EvidenceClaims[0].Links = []novelWorkbenchV2EvidenceLink{
		{Kind: "origin", Description: "旧谱明确记载印章由哪一支保管。", ReferenceIDs: []string{"foreshadow_seal"}},
		{Kind: "verification", Description: "族老当众核验印文与旧谱一致。", ReferenceIDs: []string{"foreshadow_seal"}},
		{Kind: "testimony", Description: "证人只确认见过印章，未说明交接过程。", ReferenceIDs: []string{"foreshadow_seal"}},
	}
	if err := validateNovelWorkbenchV2FactContract(control, state, contract, &card); err == nil || !strings.Contains(err.Error(), "来源、交接链和核验") {
		t.Fatalf("proof without custody chain should be rejected, got %v", err)
	}
}

func TestNovelWorkbenchV2FactContractRequiresEvidenceWriteback(t *testing.T) {
	control := newNovelWorkbenchV2TestControl(5)
	state := initialNovelWorkbenchV2State(control)
	card := novelWorkbenchV2ControlCard{
		Unit: 1, RoadmapID: "arc_entry", Mission: "主角守住现场", OpeningHook: "婚书被撕", CoreConflict: "主角无法自证", Escalation: "对手逼迫交物", Reversal: "裂纹印章出现", ClosingHook: "门锁落下", NextDebt: "查明印章来源",
		CausalSpine:          []string{"婚书被撕，印章裂纹已被看见。", "沈宁主动亮出印章要求核验。", "侯爷担心伪造暴露而夺走印章。", "沈宁确认侯爷惧怕印章并留下追查目标。"},
		ReversalAnchorIDs:    []string{"foreshadow_seal"},
		RequiredCharacterIDs: []string{"char_hero"},
		IntroduceIDs:         []string{"foreshadow_seal", "promise_identity"},
	}
	card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
	output := novelWorkbenchV2UnitOutput{
		Unit: 1, Title: "裂纹", Content: strings.Repeat("沈宁拿出印章，逼侯爷当场核验。", 36), Summary: "沈宁亮出裂纹印章。",
		Writeback: novelWorkbenchV2Writeback{
			ForeshadowChanges: []novelWorkbenchV2StateTransition{{ID: "foreshadow_seal", From: "planned", To: "introduced", Note: "裂纹首次可见"}},
			PromiseChanges:    []novelWorkbenchV2StateTransition{{ID: "promise_identity", From: "planned", To: "introduced", Note: "身份疑点公开"}},
			KnowledgeGrants: []novelWorkbenchV2KnowledgeGrant{
				{CharacterID: "char_hero", FactIDs: []string{"foreshadow_seal"}, SourceIDs: []string{"foreshadow_seal"}, Note: "沈宁当场看到裂纹印章。"},
				{CharacterID: "char_hero", FactIDs: []string{"promise_identity"}, SourceIDs: []string{"promise_identity"}, Note: "沈宁当场得到身份疑点。"},
			},
			NextUnitBridge: "侯爷带走印章去找证人。",
		},
	}
	if err := validateNovelWorkbenchV2Unit(&output, control, state, card, 1); err == nil || !strings.Contains(err.Error(), "升至 lead 但正文未写回") {
		t.Fatalf("missing evidence writeback should be rejected, got %v", err)
	}
}

func newNovelWorkbenchV2TestControl(target int) novelWorkbenchV2Control {
	brief := novelWorkbenchBrief{ProjectName: "归印", Premise: "被夺身份的女主必须找回祖传印章。", OutputMode: novelWorkbenchModeScreenplay, TargetUnitCount: target, TargetUnitLength: 900, UnitDurationSeconds: 90}
	return novelWorkbenchV2Control{
		EngineVersion: novelWorkbenchV2EngineVersion,
		Title:         "归印",
		Logline:       "被夺身份的女主用一枚祖传印章撕开侯府阴谋。",
		Brief:         brief,
		Documents: novelWorkbenchV2Documents{
			ProjectOverview:     novelWorkbenchV2ProjectOverview{CorePromise: "每次接近身份真相都要付出关系代价", CentralConflict: "女主必须在复仇与亲情之间选择", EndingResolution: "身份真相公开并承担代价", AudiencePayoff: "反转与关系清算"},
			ThemeAndProposition: novelWorkbenchV2Theme{Theme: "身份", Proposition: "真相不能替代选择", Price: "信任被重建前必须先被打碎"},
			Worldbuilding:       novelWorkbenchV2Worldbuilding{Rules: []string{"侯府印章能决定继承权"}, Locations: []string{"侯府"}, Constraints: []string{"不能靠突然出现的证据解决"}},
			CastBible: []novelWorkbenchV2Character{
				{ID: "char_hero", Name: "沈宁", Role: "女主", Desire: "取回身份", Fear: "再次失去亲人", BlindSpot: "过度自责", Voice: "克制锋利", Arc: "从隐忍到主动", InitialState: "隐忍"},
				{ID: "char_enemy", Name: "侯爷", Role: "反派", Desire: "掩盖夺权", Fear: "印章现世", BlindSpot: "轻视沈宁", Voice: "温和压迫", Arc: "从掌控到失控", InitialState: "掌控"},
			},
			RelationshipMap:     []novelWorkbenchV2Relationship{{ID: "rel_hero_enemy", FromID: "char_hero", ToID: "char_enemy", Description: "养女与夺权者", InitialState: "互相试探"}},
			MainPlotlines:       []novelWorkbenchV2Plotline{{ID: "plot_truth", Title: "身份真相", Goal: "公开侯府夺权证据", InitialState: "open", ResolutionByUnit: target}},
			ForeshadowLedger:    []novelWorkbenchV2LedgerItem{{ID: "foreshadow_seal", Description: "祖传印章的裂纹", IntroducedByUnit: 1, PayoffByUnit: 3, OwnerIDs: []string{"char_hero"}}},
			ReaderPromiseLedger: []novelWorkbenchV2LedgerItem{{ID: "promise_identity", Description: "女主真实身份", IntroducedByUnit: 1, PayoffByUnit: 4, OwnerIDs: []string{"char_hero"}}},
			ChapterRoadmap: []novelWorkbenchV2Roadmap{
				{ID: "arc_entry", Title: "被迫入局", StartUnit: 1, EndUnit: 3, Mission: "让女主拿到印章线索", Escalation: "敌人不断先手", KeyTurn: "印章被抢走", ExitDebt: "身份揭露在即", PlannedIntroductions: []string{"foreshadow_seal", "promise_identity"}, PlannedPayoffs: []string{"foreshadow_seal"}},
				{ID: "arc_settlement", Title: "真相清算", StartUnit: 4, EndUnit: target, Mission: "公开真相", Escalation: "亲情反噬", KeyTurn: "证据反转", ExitDebt: "以代价完成新身份", PlannedIntroductions: []string{}, PlannedPayoffs: []string{"promise_identity"}},
			},
			StyleGuide: novelWorkbenchV2StyleGuide{NarrativeVoice: "克制而锋利", PacingRules: []string{"每集推进一个因果结果"}, ForbiddenDrift: []string{"不得靠巧合解决核心冲突"}},
		},
	}
}

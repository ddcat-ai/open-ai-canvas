package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestNovelWorkbenchV2MockedEndToEndFlow(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV2TestControl(5)
	bootstrap := novelWorkbenchV2BootstrapOutput{Title: canonical.Title, Logline: canonical.Logline, Documents: canonical.Documents}
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(canonical.Documents.ChapterRoadmap, 1)
	if !ok {
		t.Fatal("fixture does not cover unit one")
	}
	card := novelWorkbenchV2ControlCard{
		Unit: 1, RoadmapID: roadmap.ID, Mission: "沈宁被迫入局", OpeningHook: "婚书被撕", CoreConflict: "沈宁无法自证", Escalation: "证人倒戈", Reversal: "裂纹印章出现", ClosingHook: "侯爷夺走印章", NextDebt: "找回印章",
		CausalSpine:       []string{"婚书被撕，裂纹印章已经落在众人眼前。", "沈宁主动亮出印章要求当场核验。", "侯爷担心裂纹暴露伪造，抢走印章中断核验。", "沈宁确认侯爷惧怕印章，获得下一单元追查目标。"},
		ReversalAnchorIDs: []string{"foreshadow_seal"},
		IntroduceIDs:      []string{"foreshadow_seal", "promise_identity"}, RequiredCharacterIDs: []string{"char_hero", "char_enemy"}, RequiredRelationshipIDs: []string{"rel_hero_enemy"},
	}
	card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
	unit := novelWorkbenchV2UnitOutput{
		Unit: 1, Title: "裂纹", Content: strings.Repeat("沈宁攥紧掌心的印章，在众目睽睽下逼问侯爷；每一次退让都让真相更近一步。", 32), Summary: "沈宁在婚书被撕后亮出裂纹印章，侯爷夺印离场。",
		Writeback: novelWorkbenchV2Writeback{
			ForeshadowChanges: []novelWorkbenchV2StateTransition{{ID: "foreshadow_seal", From: "planned", To: "introduced", Note: "裂纹首次可见"}},
			PromiseChanges:    []novelWorkbenchV2StateTransition{{ID: "promise_identity", From: "planned", To: "introduced", Note: "身份疑点公开"}},
			EvidenceUpdates: []novelWorkbenchV2EvidenceUpdate{
				{EvidenceID: "foreshadow_seal", From: "unseen", To: "lead", Note: "裂纹印章在现场被看见"},
				{EvidenceID: "promise_identity", From: "unseen", To: "lead", Note: "身份疑点在现场被提出"},
			},
			KnowledgeGrants: []novelWorkbenchV2KnowledgeGrant{
				{CharacterID: "char_hero", FactIDs: []string{"foreshadow_seal"}, SourceIDs: []string{"foreshadow_seal"}, Note: "沈宁当场看到裂纹印章。"},
				{CharacterID: "char_hero", FactIDs: []string{"promise_identity"}, SourceIDs: []string{"promise_identity"}, Note: "沈宁当场得到身份疑点。"},
			},
			NextUnitBridge: "侯爷带着印章去见真正的证人。",
		},
	}
	review := novelWorkbenchV2ReviewReport{Unit: 1, OverallPass: true, Signals: map[string]int{}, ReferenceIDs: []string{"char_hero", "foreshadow_seal", "styleGuide"}, Verdict: "可提交"}
	for _, signal := range novelWorkbenchV2QualitySignals {
		review.Signals[signal] = 8
	}

	responses := map[string]any{"bootstrap": bootstrap, "card": card, "writer": unit, "review": review}
	calls := make([]string, 0, 4)
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/chat/completions" {
			http.NotFound(writer, request)
			return
		}
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
		prompt := payload.Messages[len(payload.Messages)-1].Content
		kind := novelWorkbenchV2MockResponseKind(prompt)
		calls = append(calls, kind)
		content, err := json.Marshal(responses[kind])
		if err != nil {
			t.Errorf("marshal mock response: %v", err)
			writer.WriteHeader(http.StatusInternalServerError)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []map[string]any{{"message": map[string]any{"content": string(content)}}}})
	}))
	defer upstream.Close()

	svc, db := newNovelWorkbenchV2FlowTestService(t)
	config := providerConfig{BaseURL: upstream.URL, APIKey: "mock-key", Model: "mock-text", InterfaceType: string(model.ChannelInterfaceChatCompletion), AllowLocalChannel: true}
	project, run := createNovelWorkbenchV2FlowRun(t, db, canonical.Brief, newNovelWorkbenchV2Control(canonical.Brief))
	bootstrapTask := createNovelWorkbenchV2FlowTask(t, db, project, run, config, novelWorkbenchPhaseBootstrap, 0, "task_v2_bootstrap")
	bootstrapResult, _, err := svc.processNovelWorkbenchTask(context.Background(), bootstrapTask)
	if err != nil {
		t.Fatalf("bootstrap flow failed: %v", err)
	}
	if bootstrapResult["nextPhase"] != novelWorkbenchPhaseUnit || intValue(bootstrapResult["nextUnit"]) != 1 {
		t.Fatalf("bootstrap continuation = %#v", bootstrapResult)
	}

	unitTask := createNovelWorkbenchV2FlowTask(t, db, project, run, config, novelWorkbenchPhaseUnit, 1, "task_v2_unit_1")
	unitResult, _, err := svc.processNovelWorkbenchTask(context.Background(), unitTask)
	if err != nil {
		t.Fatalf("unit flow failed: %v", err)
	}
	if unitResult["nextPhase"] != novelWorkbenchPhaseUnit || intValue(unitResult["nextUnit"]) != 2 {
		t.Fatalf("unit continuation = %#v", unitResult)
	}
	if got := strings.Join(calls, ","); got != "bootstrap,card,writer,review" {
		t.Fatalf("mock call sequence = %q", got)
	}

	persistedRun, err := svc.repo.NovelWorkbenchRun(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := decodeNovelWorkbenchV2State(persistedRun.DynamicStateJSON)
	if err != nil {
		t.Fatal(err)
	}
	if persistedRun.Status != novelWorkbenchStatusQueued || persistedRun.CompletedUnitCount != 1 || state.CompletedUnit != 1 || state.ForeshadowStates["foreshadow_seal"] != "introduced" || state.PromiseStates["promise_identity"] != "introduced" {
		t.Fatalf("persisted V2 state = %#v / %#v", persistedRun, state)
	}
	units, err := svc.repo.ProjectUnits(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(units) != 1 || units[0].Status != model.ProjectUnitStatusReady || units[0].SourceText != unit.Content {
		t.Fatalf("public project unit = %#v", units)
	}
	artifacts, err := svc.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := novelWorkbenchV2ArtifactKinds(artifacts); got != "control_canon,plan_preview,commit_record,control_card,control_card_audit,creative_delta,draft_accepted,episode_contract,episode_spec,review_report" {
		t.Fatalf("artifact audit trail = %q", got)
	}
	var controlCardAudit novelWorkbenchV2ControlCardAuditRecord
	for _, artifact := range artifacts {
		if artifact.Kind == "control_card_audit" {
			if err := json.Unmarshal([]byte(artifact.ContentJSON), &controlCardAudit); err != nil {
				t.Fatalf("decode control-card audit: %v", err)
			}
		}
		if artifact.Kind != "review_report" {
			continue
		}
		var report struct {
			Review                       novelWorkbenchV2ReviewReport `json:"review"`
			DiscardedInvalidReferenceIDs []string                     `json:"discardedInvalidReferenceIds"`
		}
		if err := json.Unmarshal([]byte(artifact.ContentJSON), &report); err != nil {
			t.Fatalf("decode stored review report: %v", err)
		}
		if len(report.DiscardedInvalidReferenceIDs) != 1 || report.DiscardedInvalidReferenceIDs[0] != "styleguide" {
			t.Fatalf("stored discarded references = %#v", report.DiscardedInvalidReferenceIDs)
		}
		if len(report.Review.ReferenceIDs) != 2 {
			t.Fatalf("stored review references = %#v", report.Review.ReferenceIDs)
		}
	}
	if controlCardAudit.SchemaVersion != novelWorkbenchV2ControlCardAuditVersion || controlCardAudit.Outcome != "compiled" || controlCardAudit.Ruleset != "compiled-control-v3" || len(controlCardAudit.Validations) != 5 || len(controlCardAudit.RawResponseSHA256) != 64 {
		t.Fatalf("accepted control-card audit = %#v", controlCardAudit)
	}
}

func TestNovelWorkbenchV2StopsAfterThreeRepairsWithoutContinuation(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls++
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []map[string]any{{"message": map[string]any{"content": "not-json"}}}})
	}))
	defer upstream.Close()

	svc, db := newNovelWorkbenchV2FlowTestService(t)
	canonical := newNovelWorkbenchV2TestControl(5)
	project, run := createNovelWorkbenchV2FlowRun(t, db, canonical.Brief, canonical)
	state := initialNovelWorkbenchV2State(canonical)
	stateJSON, _ := json.Marshal(state)
	run.DynamicStateJSON = string(stateJSON)
	if err := svc.repo.UpdateNovelWorkbenchRun(&run); err != nil {
		t.Fatal(err)
	}
	config := providerConfig{BaseURL: upstream.URL, APIKey: "mock-key", Model: "mock-text", InterfaceType: string(model.ChannelInterfaceChatCompletion), AllowLocalChannel: true}
	task := createNovelWorkbenchV2FlowTask(t, db, project, run, config, novelWorkbenchPhaseUnit, 1, "task_v2_blocked")
	result, _, err := svc.processNovelWorkbenchTask(context.Background(), task)
	if err != nil {
		t.Fatalf("quality block should be a controlled task result: %v", err)
	}
	if calls != novelWorkbenchV2MaxCreativeDeltaAttempts || result["nextPhase"] != nil || result["blocked"] != true {
		t.Fatalf("quality block result=%#v calls=%d", result, calls)
	}
	persistedRun, err := svc.repo.NovelWorkbenchRun(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if persistedRun.Status != novelWorkbenchStatusFailed || persistedRun.PipelineStage != novelWorkbenchV2PipelineBlocked || persistedRun.CurrentTaskID != "" || persistedRun.QualityBlockReason == "" {
		t.Fatalf("blocked run = %#v", persistedRun)
	}
	artifacts, err := svc.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	var block novelWorkbenchV2QualityBlockRecord
	for _, artifact := range artifacts {
		if artifact.Kind == "quality_block" {
			if err := json.Unmarshal([]byte(artifact.ContentJSON), &block); err != nil {
				t.Fatalf("decode quality block: %v", err)
			}
			break
		}
	}
	if block.Class != novelWorkbenchV2BlockClassStructure || block.Stage != "creative_delta" || block.Unit != 1 {
		t.Fatalf("quality block classification = %#v", block)
	}
	var unitCount int64
	if err := db.Model(&model.ProjectUnit{}).Where("project_id = ?", project.ID).Count(&unitCount).Error; err != nil {
		t.Fatal(err)
	}
	if unitCount != 0 {
		t.Fatalf("blocked run must not commit a unit, got %d", unitCount)
	}
}

func TestNovelWorkbenchV2RepairsMissingContractActionBeforeDraft(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV2TestControl(5)
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(canonical.Documents.ChapterRoadmap, 1)
	if !ok {
		t.Fatal("fixture does not cover unit one")
	}
	initialCard := novelWorkbenchV2ControlCard{
		Unit: 1, RoadmapID: roadmap.ID, Mission: "沈宁被迫入局", OpeningHook: "婚书被撕", CoreConflict: "沈宁无法自证", Escalation: "证人倒戈", Reversal: "裂纹印章出现", ClosingHook: "侯爷夺走印章", NextDebt: "找回印章",
		CausalSpine:       []string{"婚书被撕，裂纹印章已经落在众人眼前。", "沈宁主动亮出印章要求当场核验。", "侯爷担心裂纹暴露伪造，抢走印章中断核验。", "沈宁确认侯爷惧怕印章，获得下一单元追查目标。"},
		ReversalAnchorIDs: []string{"foreshadow_seal"},
		IntroduceIDs:      []string{"foreshadow_seal"}, RequiredCharacterIDs: []string{"char_hero", "char_enemy"}, RequiredRelationshipIDs: []string{"rel_hero_enemy"},
	}
	initialCard.FactContract = novelWorkbenchV2TestFactContract(initialCard.RequiredCharacterIDs, initialCard.ReversalAnchorIDs, initialCard.IntroduceIDs, initialCard.PayoffIDs)
	repairedCard := initialCard
	repairedCard.IntroduceIDs = append(repairedCard.IntroduceIDs, "promise_identity")
	repairedCard.FactContract = novelWorkbenchV2TestFactContract(repairedCard.RequiredCharacterIDs, repairedCard.ReversalAnchorIDs, repairedCard.IntroduceIDs, repairedCard.PayoffIDs)
	unit := novelWorkbenchV2UnitOutput{
		Unit: 1, Title: "裂纹", Content: strings.Repeat("沈宁攥紧掌心的印章，在众目睽睽下逼问侯爷；每一次退让都让真相更近一步。", 32), Summary: "沈宁在婚书被撕后亮出裂纹印章，侯爷夺印离场。",
		Writeback: novelWorkbenchV2Writeback{
			ForeshadowChanges: []novelWorkbenchV2StateTransition{{ID: "foreshadow_seal", From: "planned", To: "introduced", Note: "裂纹首次可见"}},
			PromiseChanges:    []novelWorkbenchV2StateTransition{{ID: "promise_identity", From: "planned", To: "introduced", Note: "身份疑点公开"}},
			EvidenceUpdates: []novelWorkbenchV2EvidenceUpdate{
				{EvidenceID: "foreshadow_seal", From: "unseen", To: "lead", Note: "裂纹印章在现场被看见"},
				{EvidenceID: "promise_identity", From: "unseen", To: "lead", Note: "身份疑点在现场被提出"},
			},
			KnowledgeGrants: []novelWorkbenchV2KnowledgeGrant{
				{CharacterID: "char_hero", FactIDs: []string{"foreshadow_seal"}, SourceIDs: []string{"foreshadow_seal"}, Note: "沈宁当场看到裂纹印章。"},
				{CharacterID: "char_hero", FactIDs: []string{"promise_identity"}, SourceIDs: []string{"promise_identity"}, Note: "沈宁当场得到身份疑点。"},
			},
			NextUnitBridge: "侯爷带着印章去见真正的证人。",
		},
	}
	review := novelWorkbenchV2ReviewReport{Unit: 1, OverallPass: true, Signals: map[string]int{}, Verdict: "可提交"}
	for _, signal := range novelWorkbenchV2QualitySignals {
		review.Signals[signal] = 8
	}

	cardCalls := 0
	repairPrompt := ""
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
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
		prompt := payload.Messages[len(payload.Messages)-1].Content
		var response any
		switch {
		case strings.Contains(prompt, "修复第 1 单元控制卡"):
			cardCalls++
			repairPrompt = prompt
			response = repairedCard
		case strings.Contains(prompt, "长线作品的单元策划编辑"):
			cardCalls++
			response = initialCard
		case strings.Contains(prompt, "执行主笔"):
			response = unit
		case strings.Contains(prompt, "独立的中文商业叙事审稿编辑"):
			response = review
		default:
			t.Errorf("unexpected prompt: %s", prompt)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		content, err := json.Marshal(response)
		if err != nil {
			t.Errorf("marshal mock response: %v", err)
			writer.WriteHeader(http.StatusInternalServerError)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []map[string]any{{"message": map[string]any{"content": string(content)}}}})
	}))
	defer upstream.Close()

	svc, db := newNovelWorkbenchV2FlowTestService(t)
	project, run := createNovelWorkbenchV2FlowRun(t, db, canonical.Brief, canonical)
	stateJSON, _ := json.Marshal(initialNovelWorkbenchV2State(canonical))
	run.DynamicStateJSON = string(stateJSON)
	if err := svc.repo.UpdateNovelWorkbenchRun(&run); err != nil {
		t.Fatal(err)
	}
	config := providerConfig{BaseURL: upstream.URL, APIKey: "mock-key", Model: "mock-text", InterfaceType: string(model.ChannelInterfaceChatCompletion), AllowLocalChannel: true}
	task := createNovelWorkbenchV2FlowTask(t, db, project, run, config, novelWorkbenchPhaseUnit, 1, "task_v2_contract_repair")
	result, _, err := svc.processNovelWorkbenchTask(context.Background(), task)
	if err != nil {
		t.Fatalf("contract-repair flow failed: %v", err)
	}
	if cardCalls != 1 || result["nextPhase"] != novelWorkbenchPhaseUnit || intValue(result["nextUnit"]) != 2 {
		t.Fatalf("compiled-card result=%#v cardCalls=%d", result, cardCalls)
	}
	if repairPrompt != "" {
		t.Fatalf("compiled control must not ask the model to repair a missing contract action: %q", repairPrompt)
	}
	artifacts, err := svc.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(novelWorkbenchV2ArtifactKinds(artifacts), "control_card_rejected") || strings.Contains(novelWorkbenchV2ArtifactKinds(artifacts), "quality_block") {
		t.Fatalf("compiled control artifacts = %s", novelWorkbenchV2ArtifactKinds(artifacts))
	}
}

func TestNovelWorkbenchV2ControlCardRepairDoesNotRetainOmittedMovement(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV2TestControl(5)
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(canonical.Documents.ChapterRoadmap, 1)
	if !ok {
		t.Fatal("fixture does not cover unit one")
	}
	state := initialNovelWorkbenchV2State(canonical)
	state.CharacterLocations["char_hero"] = "loc_houfu"
	contract, err := compileNovelWorkbenchV2EpisodeContract(canonical, state, roadmap, 1)
	if err != nil {
		t.Fatalf("compile contract: %v", err)
	}
	newCard := func() novelWorkbenchV2ControlCard {
		card := novelWorkbenchV2ControlCard{
			Unit: 1, RoadmapID: roadmap.ID, Mission: "沈宁被迫入局", OpeningHook: "婚书被撕", CoreConflict: "沈宁无法自证", Escalation: "证人倒戈", Reversal: "裂纹印章出现", ClosingHook: "侯爷夺走印章", NextDebt: "找回印章",
			CausalSpine:       []string{"婚书被撕，裂纹印章已经落在众人眼前。", "沈宁主动亮出印章要求当场核验。", "侯爷担心裂纹暴露伪造，抢走印章中断核验。", "沈宁确认侯爷惧怕印章，获得下一单元追查目标。"},
			ReversalAnchorIDs: []string{"foreshadow_seal"},
			IntroduceIDs:      []string{"foreshadow_seal", "promise_identity"}, RequiredCharacterIDs: []string{"char_hero"}, RequiredRelationshipIDs: []string{"rel_hero_enemy"},
		}
		card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
		card.FactContract.CharacterPlacements[0].LocationID = "loc_houfu"
		return card
	}
	firstCard := newCard()
	firstCard.FactContract.CharacterPlacements[0].FromLocationID = "侯府"
	firstCard.FactContract.CharacterPlacements[0].MovementCause = "角色仍在同一地点，不得声明移动。"
	firstRaw, err := json.Marshal(firstCard)
	if err != nil {
		t.Fatalf("marshal first card: %v", err)
	}

	// The repair response intentionally omits optional movement fields, exactly
	// as a model does when it retracts an earlier invalid movement declaration.
	repairedRaw, err := json.Marshal(newCard())
	if err != nil {
		t.Fatalf("marshal repaired card: %v", err)
	}
	var repairedPayload map[string]any
	if err := json.Unmarshal(repairedRaw, &repairedPayload); err != nil {
		t.Fatalf("decode repaired card: %v", err)
	}
	factContract := repairedPayload["factContract"].(map[string]any)
	repairedPlacement := factContract["characterPlacements"].([]any)[0].(map[string]any)
	delete(repairedPlacement, "fromLocationId")
	delete(repairedPlacement, "movementCause")
	repairedRaw, err = json.Marshal(repairedPayload)
	if err != nil {
		t.Fatalf("marshal omitted-movement repair: %v", err)
	}

	cardCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		cardCalls++
		response := string(firstRaw)
		if cardCalls > 1 {
			response = string(repairedRaw)
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []map[string]any{{"message": map[string]any{"content": response}}}})
	}))
	defer upstream.Close()

	svc, db := newNovelWorkbenchV2FlowTestService(t)
	project, run := createNovelWorkbenchV2FlowRun(t, db, canonical.Brief, canonical)
	config := providerConfig{BaseURL: upstream.URL, APIKey: "mock-key", Model: "mock-text", InterfaceType: string(model.ChannelInterfaceChatCompletion), AllowLocalChannel: true}
	task := createNovelWorkbenchV2FlowTask(t, db, project, run, config, novelWorkbenchPhaseUnit, 1, "task_v2_omitted_movement_repair")
	card, _, err := svc.generateNovelWorkbenchV2ControlCard(context.Background(), &run, task, canonical, state, roadmap, contract, 1, config)
	if err != nil {
		t.Fatalf("control-card repair failed: %v", err)
	}
	if cardCalls != 2 {
		t.Fatalf("control-card repair calls = %d, want 2", cardCalls)
	}
	placement := card.FactContract.CharacterPlacements[0]
	if placement.FromLocationID != "" || placement.MovementCause != "" {
		t.Fatalf("repair retained omitted movement fields: %#v", placement)
	}
}

func TestNovelWorkbenchV2NormalizesUnusedStableContextEvidenceClaims(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV2TestControl(5)
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(canonical.Documents.ChapterRoadmap, 2)
	if !ok {
		t.Fatal("fixture does not cover unit two")
	}
	state := initialNovelWorkbenchV2State(canonical)
	state.ForeshadowStates["foreshadow_seal"] = "introduced"
	state.PromiseStates["promise_identity"] = "introduced"
	state.EvidenceLevels["foreshadow_seal"] = "lead"
	state.EvidenceLevels["promise_identity"] = "lead"
	contract, err := compileNovelWorkbenchV2EpisodeContract(canonical, state, roadmap, 2)
	if err != nil {
		t.Fatalf("compile contract: %v", err)
	}
	card := novelWorkbenchV2ControlCard{
		Unit: 2, RoadmapID: roadmap.ID, Mission: "沈宁守住印章", OpeningHook: "侯爷逼她交印", CoreConflict: "沈宁无法证明来源", Escalation: "证人改口", Reversal: "裂纹留下新痕", ClosingHook: "侯爷收走旧匣", NextDebt: "找回旧匣",
		CausalSpine:       []string{"侯爷拿走旧匣，裂纹印章仍在沈宁掌心。", "沈宁主动用印章逼问旧匣去向。", "侯爷担心裂纹暴露伪造，只能改口拖延。", "沈宁留下可追查的旧匣去向，确认下一步目标。"},
		ReversalAnchorIDs: []string{"foreshadow_seal"}, RequiredCharacterIDs: []string{"char_hero"}, RequiredRelationshipIDs: []string{"rel_hero_enemy"},
	}
	card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
	card.FactContract.EvidenceClaims = append(card.FactContract.EvidenceClaims, novelWorkbenchV2EvidenceClaim{
		EvidenceID: "promise_identity", Level: "lead",
		Links:                []novelWorkbenchV2EvidenceLink{{Kind: "discovery", Description: "前集已经公开身份疑点，当前没有新增证据。", ReferenceIDs: []string{"promise_identity"}}},
		AllowedConclusion:    "只能确认身份疑点仍需继续追查。",
		ProhibitedConclusion: "不得据此确认真实身份或任何人的责任。",
	})
	raw, err := json.Marshal(card)
	if err != nil {
		t.Fatalf("marshal card: %v", err)
	}

	cardCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		cardCalls++
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []map[string]any{{"message": map[string]any{"content": string(raw)}}}})
	}))
	defer upstream.Close()

	svc, db := newNovelWorkbenchV2FlowTestService(t)
	project, run := createNovelWorkbenchV2FlowRun(t, db, canonical.Brief, canonical)
	config := providerConfig{BaseURL: upstream.URL, APIKey: "mock-key", Model: "mock-text", InterfaceType: string(model.ChannelInterfaceChatCompletion), AllowLocalChannel: true}
	task := createNovelWorkbenchV2FlowTask(t, db, project, run, config, novelWorkbenchPhaseUnit, 2, "task_v2_context_evidence_normalization")
	accepted, _, err := svc.generateNovelWorkbenchV2ControlCard(context.Background(), &run, task, canonical, state, roadmap, contract, 2, config)
	if err != nil {
		t.Fatalf("control card failed: %v", err)
	}
	if cardCalls != 1 {
		t.Fatalf("control card calls = %d, want 1", cardCalls)
	}
	if len(accepted.FactContract.EvidenceClaims) != 1 || accepted.FactContract.EvidenceClaims[0].EvidenceID != "foreshadow_seal" {
		t.Fatalf("accepted evidence claims = %#v", accepted.FactContract.EvidenceClaims)
	}
	artifacts, err := svc.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	var audit novelWorkbenchV2ControlCardAuditRecord
	for _, artifact := range artifacts {
		if artifact.Kind == "control_card_audit" {
			if err := json.Unmarshal([]byte(artifact.ContentJSON), &audit); err != nil {
				t.Fatalf("decode normalization audit: %v", err)
			}
			break
		}
	}
	var removed novelWorkbenchV2ControlCardEvidenceAuditEntry
	for _, decision := range audit.EvidenceDecisions {
		if decision.EvidenceID == "promise_identity" {
			removed = decision
			break
		}
	}
	if audit.Outcome != "accepted_with_normalization" || audit.InputEvidenceClaimCount != 2 || audit.OutputEvidenceClaimCount != 1 || removed.Action != "removed" || removed.Classification != "unused_stable_context" {
		t.Fatalf("normalization audit = %#v", audit)
	}
}

func TestNovelWorkbenchV2RejectsBackgroundEvidenceProgression(t *testing.T) {
	canonical := newNovelWorkbenchV2TestControl(5)
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(canonical.Documents.ChapterRoadmap, 2)
	if !ok {
		t.Fatal("fixture does not cover unit two")
	}
	state := initialNovelWorkbenchV2State(canonical)
	state.ForeshadowStates["foreshadow_seal"] = "introduced"
	state.PromiseStates["promise_identity"] = "introduced"
	state.EvidenceLevels["foreshadow_seal"] = "lead"
	state.EvidenceLevels["promise_identity"] = "lead"
	contract, err := compileNovelWorkbenchV2EpisodeContract(canonical, state, roadmap, 2)
	if err != nil {
		t.Fatalf("compile contract: %v", err)
	}
	card := novelWorkbenchV2ControlCard{
		Unit: 2, RoadmapID: roadmap.ID, Mission: "沈宁守住印章", OpeningHook: "侯爷逼她交印", CoreConflict: "沈宁无法证明来源", Escalation: "证人改口", Reversal: "裂纹留下新痕", ClosingHook: "侯爷收走旧匣", NextDebt: "找回旧匣",
		CausalSpine:       []string{"侯爷拿走旧匣，裂纹印章仍在沈宁掌心。", "沈宁主动用印章逼问旧匣去向。", "侯爷担心裂纹暴露伪造，只能改口拖延。", "沈宁留下可追查的旧匣去向，确认下一步目标。"},
		ReversalAnchorIDs: []string{"foreshadow_seal"}, RequiredCharacterIDs: []string{"char_hero"}, RequiredRelationshipIDs: []string{"rel_hero_enemy"},
	}
	card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
	card.FactContract.KnowledgeAccess = append(card.FactContract.KnowledgeAccess, novelWorkbenchV2KnowledgeAccess{CharacterID: "char_hero", FactIDs: []string{"promise_identity"}, Source: "沈宁已在前集公开身份疑点。", AcquireInUnit: false})
	card.FactContract.EvidenceClaims = append(card.FactContract.EvidenceClaims, novelWorkbenchV2EvidenceClaim{
		EvidenceID: "promise_identity", Level: "corroborated",
		Links: []novelWorkbenchV2EvidenceLink{
			{Kind: "discovery", Description: "前集已经公开身份疑点，当前没有新增证据。", ReferenceIDs: []string{"promise_identity"}},
			{Kind: "testimony", Description: "沈宁只能重述前集已知身份疑点。", ReferenceIDs: []string{"promise_identity", "char_hero"}},
		},
		AllowedConclusion:    "只能确认身份疑点仍需继续追查。",
		ProhibitedConclusion: "不得据此确认真实身份或任何人的责任。",
	})
	if err := validateNovelWorkbenchV2FactContract(canonical, state, contract, &card); err == nil || !strings.Contains(err.Error(), "不能在未列为反转、引入或回收锚点时变更证据等级") {
		t.Fatalf("background evidence progression should be rejected, got %v", err)
	}
}

func TestNovelWorkbenchV2PassesReviewerActionsIntoRepair(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	canonical := newNovelWorkbenchV2TestControl(5)
	roadmap, ok := novelWorkbenchV2RoadmapForUnit(canonical.Documents.ChapterRoadmap, 1)
	if !ok {
		t.Fatal("fixture does not cover unit one")
	}
	card := novelWorkbenchV2ControlCard{
		Unit: 1, RoadmapID: roadmap.ID, Mission: "沈宁被迫入局", OpeningHook: "婚书被撕", CoreConflict: "沈宁无法自证", Escalation: "证人倒戈", Reversal: "裂纹印章出现", ClosingHook: "侯爷夺走印章", NextDebt: "找回印章",
		CausalSpine:       []string{"婚书被撕，裂纹印章已经落在众人眼前。", "沈宁主动亮出印章要求当场核验。", "侯爷担心裂纹暴露伪造，抢走印章中断核验。", "沈宁确认侯爷惧怕印章，获得下一单元追查目标。"},
		ReversalAnchorIDs: []string{"foreshadow_seal"},
		IntroduceIDs:      []string{"foreshadow_seal", "promise_identity"}, RequiredCharacterIDs: []string{"char_hero"}, RequiredRelationshipIDs: []string{"rel_hero_enemy"},
	}
	card.FactContract = novelWorkbenchV2TestFactContract(card.RequiredCharacterIDs, card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs)
	unit := novelWorkbenchV2UnitOutput{
		Unit: 1, Title: "裂纹", Content: strings.Repeat("沈宁握紧印章，逼侯爷退让。", 42), Summary: "沈宁亮出裂纹印章。",
		Writeback: novelWorkbenchV2Writeback{
			ForeshadowChanges: []novelWorkbenchV2StateTransition{{ID: "foreshadow_seal", From: "planned", To: "introduced", Note: "裂纹首次可见"}},
			PromiseChanges:    []novelWorkbenchV2StateTransition{{ID: "promise_identity", From: "planned", To: "introduced", Note: "身份疑点公开"}},
			EvidenceUpdates: []novelWorkbenchV2EvidenceUpdate{
				{EvidenceID: "foreshadow_seal", From: "unseen", To: "lead", Note: "裂纹印章在现场被看见"},
				{EvidenceID: "promise_identity", From: "unseen", To: "lead", Note: "身份疑点在现场被提出"},
			},
			KnowledgeGrants: []novelWorkbenchV2KnowledgeGrant{
				{CharacterID: "char_hero", FactIDs: []string{"foreshadow_seal"}, SourceIDs: []string{"foreshadow_seal"}, Note: "沈宁当场看到裂纹印章。"},
				{CharacterID: "char_hero", FactIDs: []string{"promise_identity"}, SourceIDs: []string{"promise_identity"}, Note: "沈宁当场得到身份疑点。"},
			},
			NextUnitBridge: "侯爷带着印章去见真正的证人。",
		},
	}
	failedReview := novelWorkbenchV2ReviewReport{
		Unit: 1, OverallPass: false, Signals: map[string]int{},
		BlockingIssues: []novelWorkbenchV2ReviewIssue{{
			Code: "PROOF_GAP", Severity: "blocker", ReferenceID: "foreshadow_seal", Evidence: "证据链少一步核验", RepairAction: "补入侯爷当场承认印章来源的动作",
		}},
		Verdict: "证据链尚未闭合。",
	}
	passedReview := novelWorkbenchV2ReviewReport{Unit: 1, OverallPass: true, Signals: map[string]int{}, Verdict: "可提交"}
	for _, signal := range novelWorkbenchV2QualitySignals {
		failedReview.Signals[signal] = 8
		passedReview.Signals[signal] = 8
	}

	writerCalls := 0
	repairPrompt := ""
	upstream := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
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
		prompt := payload.Messages[len(payload.Messages)-1].Content
		var response any
		switch {
		case strings.Contains(prompt, "长线作品的单元策划编辑"):
			response = card
		case strings.Contains(prompt, "执行主笔"), strings.Contains(prompt, "进行一次定向正文返修"):
			writerCalls++
			if writerCalls == 2 {
				repairPrompt = prompt
			}
			response = unit
		case strings.Contains(prompt, "独立的中文商业叙事审稿编辑"):
			if writerCalls == 1 {
				response = failedReview
			} else {
				response = passedReview
			}
		default:
			t.Errorf("unexpected prompt: %s", prompt)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		content, err := json.Marshal(response)
		if err != nil {
			t.Errorf("marshal mock response: %v", err)
			writer.WriteHeader(http.StatusInternalServerError)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{"choices": []map[string]any{{"message": map[string]any{"content": string(content)}}}})
	}))
	defer upstream.Close()

	svc, db := newNovelWorkbenchV2FlowTestService(t)
	project, run := createNovelWorkbenchV2FlowRun(t, db, canonical.Brief, canonical)
	stateJSON, _ := json.Marshal(initialNovelWorkbenchV2State(canonical))
	run.DynamicStateJSON = string(stateJSON)
	if err := svc.repo.UpdateNovelWorkbenchRun(&run); err != nil {
		t.Fatal(err)
	}
	config := providerConfig{BaseURL: upstream.URL, APIKey: "mock-key", Model: "mock-text", InterfaceType: string(model.ChannelInterfaceChatCompletion), AllowLocalChannel: true}
	task := createNovelWorkbenchV2FlowTask(t, db, project, run, config, novelWorkbenchPhaseUnit, 1, "task_v2_repair_actions")
	result, _, err := svc.processNovelWorkbenchTask(context.Background(), task)
	if err != nil {
		t.Fatalf("repair flow failed: %v", err)
	}
	if writerCalls != 2 || result["nextPhase"] != novelWorkbenchPhaseUnit || intValue(result["nextUnit"]) != 2 {
		t.Fatalf("repair result=%#v writerCalls=%d", result, writerCalls)
	}
	for _, expected := range []string{"补入侯爷当场承认印章来源的动作", "本次失败单", "不得改写已提交单元"} {
		if !strings.Contains(repairPrompt, expected) {
			t.Fatalf("repair prompt omitted %q", expected)
		}
	}
	artifacts, err := svc.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		t.Fatal(err)
	}
	var packet novelWorkbenchV2RepairPacket
	for _, artifact := range artifacts {
		if artifact.Kind != "review_report" || artifact.Attempt != 1 {
			continue
		}
		var record struct {
			RepairPacket novelWorkbenchV2RepairPacket `json:"repairPacket"`
		}
		if err := json.Unmarshal([]byte(artifact.ContentJSON), &record); err != nil {
			t.Fatal(err)
		}
		packet = record.RepairPacket
		break
	}
	if packet.Stage != "review" || packet.FailureCode != "PROOF_GAP" || !strings.Contains(packet.Failure, "证据链少一步核验") || !strings.Contains(strings.Join(packet.RequiredFix, "\n"), "补入侯爷当场承认印章来源的动作") {
		t.Fatalf("review repair packet = %#v", packet)
	}
}

func newNovelWorkbenchV2FlowTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:novel-workbench-v2-flow-"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Project{}, &model.NovelWorkbenchRun{}, &model.NovelWorkbenchArtifact{}, &model.ProjectUnit{}, &model.Task{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}, db
}

func createNovelWorkbenchV2FlowRun(t *testing.T, db *gorm.DB, brief novelWorkbenchBrief, control novelWorkbenchV2Control) (model.Project, model.NovelWorkbenchRun) {
	t.Helper()
	now := time.Now()
	controlJSON, err := json.Marshal(control)
	if err != nil {
		t.Fatal(err)
	}
	stateJSON, err := json.Marshal(newNovelWorkbenchV2State())
	if err != nil {
		t.Fatal(err)
	}
	project := model.Project{ID: "project_" + newID(), UserID: "user_v2_flow", Name: "V2 Flow " + newID(), Type: "short-drama", AspectRatio: "9:16", Status: model.ProjectStatusActive, CreatedAt: now, UpdatedAt: now}
	run := model.NovelWorkbenchRun{ID: "run_" + newID(), UserID: project.UserID, ProjectID: project.ID, OutputMode: brief.OutputMode, EngineVersion: novelWorkbenchV2EngineVersion, Status: novelWorkbenchStatusQueued, Stage: "等待建立创作控制档案", PipelineStage: novelWorkbenchV2PipelineBootstrap, QualityPolicy: novelWorkbenchV2QualityPolicy, TargetUnitCount: brief.TargetUnitCount, ControlJSON: string(controlJSON), DynamicStateJSON: string(stateJSON), CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	return project, run
}

func createNovelWorkbenchV2FlowTask(t *testing.T, db *gorm.DB, project model.Project, run model.NovelWorkbenchRun, config providerConfig, phase string, unit int, id string) model.Task {
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

func novelWorkbenchV2MockResponseKind(prompt string) string {
	switch {
	case strings.Contains(prompt, "中文长线叙事的总控编辑"):
		return "bootstrap"
	case strings.Contains(prompt, "长线作品的单元策划编辑"):
		return "card"
	case strings.Contains(prompt, "执行主笔"):
		return "writer"
	case strings.Contains(prompt, "独立的中文商业叙事审稿编辑"):
		return "review"
	default:
		return "unknown"
	}
}

func novelWorkbenchV2ArtifactKinds(artifacts []model.NovelWorkbenchArtifact) string {
	kinds := make([]string, 0, len(artifacts))
	for _, artifact := range artifacts {
		kinds = append(kinds, artifact.Kind)
	}
	return strings.Join(kinds, ",")
}

func novelWorkbenchV2TestFactContract(characterIDs []string, groups ...[]string) novelWorkbenchV2FactContract {
	placements := make([]novelWorkbenchV2CharacterPlacement, 0, len(characterIDs))
	for _, characterID := range characterIDs {
		placements = append(placements, novelWorkbenchV2CharacterPlacement{CharacterID: characterID, LocationID: "侯府", Presence: "on_screen"})
	}
	evidenceIDs := map[string]struct{}{}
	for _, values := range groups {
		for _, evidenceID := range values {
			if evidenceID = normalizeNovelWorkbenchV2ID(evidenceID); evidenceID != "" {
				evidenceIDs[evidenceID] = struct{}{}
			}
		}
	}
	claims := make([]novelWorkbenchV2EvidenceClaim, 0, len(evidenceIDs))
	knowledge := make([]novelWorkbenchV2KnowledgeAccess, 0, len(evidenceIDs))
	knowledgeOwner := ""
	if len(characterIDs) > 0 {
		knowledgeOwner = characterIDs[0]
	}
	for evidenceID := range evidenceIDs {
		claims = append(claims, novelWorkbenchV2EvidenceClaim{
			EvidenceID: evidenceID,
			Level:      "lead",
			Links: []novelWorkbenchV2EvidenceLink{{
				Kind:         "discovery",
				Description:  "该线索在本集现场被明确看见。",
				ReferenceIDs: []string{evidenceID},
			}},
			AllowedConclusion:    "只能证明该线索已经在现场出现。",
			ProhibitedConclusion: "不得据此直接认定身份、作者或罪责。",
		})
		if knowledgeOwner != "" {
			knowledge = append(knowledge, novelWorkbenchV2KnowledgeAccess{
				CharacterID:   knowledgeOwner,
				FactIDs:       []string{evidenceID},
				Source:        "角色在本集现场看到并取得该线索。",
				SourceIDs:     []string{evidenceID},
				AcquireInUnit: true,
			})
		}
	}
	sort.Slice(claims, func(left, right int) bool { return claims[left].EvidenceID < claims[right].EvidenceID })
	sort.Slice(knowledge, func(left, right int) bool { return knowledge[left].FactIDs[0] < knowledge[right].FactIDs[0] })
	return novelWorkbenchV2FactContract{CharacterPlacements: placements, KnowledgeAccess: knowledge, EvidenceClaims: claims}
}

package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/model"
)

// The compiled-control path keeps durable continuity data out of probabilistic
// model output. The model contributes only a creative delta and prose; Go owns
// stable IDs, facts, ledger transitions, and the writeback committed to state.
const (
	novelWorkbenchV2CompiledControlVersion   = 3
	novelWorkbenchV2MaxCreativeDeltaAttempts = 2
	novelWorkbenchV2MaxProseAttempts         = 2
)

type novelWorkbenchV2CreativeDelta struct {
	OpeningHook    string   `json:"openingHook"`
	CoreConflict   string   `json:"coreConflict"`
	Escalation     string   `json:"escalation"`
	Reversal       string   `json:"reversal"`
	ClosingHook    string   `json:"closingHook"`
	NextDebt       string   `json:"nextDebt"`
	NarrativeBeats []string `json:"narrativeBeats"`
	CausalSpine    []string `json:"causalSpine"`
}

// novelWorkbenchV2PersistenceContract is the boundary between a unit's
// dramatized events and facts that may survive into later units. The compiler
// derives it from the accepted roadmap and frozen state; the model can show a
// fact on screen, but it cannot add its own persistent result.
type novelWorkbenchV2PersistenceContract struct {
	FrozenContinuity []string                        `json:"frozenContinuity"`
	RequiredFacts    []novelWorkbenchV2NarrativeFact `json:"requiredFacts"`
	ActiveFacts      []novelWorkbenchV2NarrativeFact `json:"activeFacts"`
	ForbiddenEffects []string                        `json:"forbiddenEffects"`
}

type novelWorkbenchV2EpisodeSpec struct {
	Version                 int                                 `json:"version"`
	Unit                    int                                 `json:"unit"`
	RoadmapID               string                              `json:"roadmapId"`
	Mission                 string                              `json:"mission"`
	RoadmapEscalation       string                              `json:"roadmapEscalation"`
	RoadmapKeyTurn          string                              `json:"roadmapKeyTurn"`
	RoadmapExitDebt         string                              `json:"roadmapExitDebt"`
	Contract                novelWorkbenchV2EpisodeContract     `json:"contract"`
	ReversalAnchorIDs       []string                            `json:"reversalAnchorIds"`
	RequiredCharacterIDs    []string                            `json:"requiredCharacterIds"`
	RequiredRelationshipIDs []string                            `json:"requiredRelationshipIds"`
	IntroduceIDs            []string                            `json:"introduceIds"`
	PayoffIDs               []string                            `json:"payoffIds"`
	FactContract            novelWorkbenchV2FactContract        `json:"factContract"`
	PersistenceContract     novelWorkbenchV2PersistenceContract `json:"persistenceContract"`
	RequiredWriteback       novelWorkbenchV2Writeback           `json:"requiredWriteback"`
}

// novelWorkbenchV2DraftContent is deliberately smaller than UnitOutput. A
// writer cannot accidentally invent a historical from-state, a location move,
// or an evidence level because those fields are compiled separately.
type novelWorkbenchV2DraftContent struct {
	Title   string `json:"title"`
	Content string `json:"content"`
	Summary string `json:"summary"`
}

// novelWorkbenchV2RepairPacket is both user-facing audit data and the exact
// repair instruction sent back to the model. It makes every retry narrow and
// observable instead of asking for another unconstrained full rewrite.
type novelWorkbenchV2RepairPacket struct {
	SchemaVersion int      `json:"schemaVersion"`
	Stage         string   `json:"stage"`
	Attempt       int      `json:"attempt"`
	FailureClass  string   `json:"failureClass"`
	FailureCode   string   `json:"failureCode"`
	Failure       string   `json:"failure"`
	AffectedIDs   []string `json:"affectedIds,omitempty"`
	RequiredFix   []string `json:"requiredFix"`
	Warnings      []string `json:"warnings,omitempty"`
	Preserve      []string `json:"preserve"`
}

func compileNovelWorkbenchV2EpisodeSpec(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, contract novelWorkbenchV2EpisodeContract, unit int) (novelWorkbenchV2EpisodeSpec, error) {
	state = normalizeNovelWorkbenchV2State(state)
	scopedRoadmap := novelWorkbenchV2ScopedRoadmap(control, state, roadmap, contract)
	spec := novelWorkbenchV2EpisodeSpec{
		Version:                 novelWorkbenchV2CompiledControlVersion,
		Unit:                    unit,
		RoadmapID:               roadmap.ID,
		Mission:                 strings.TrimSpace(scopedRoadmap.Mission),
		RoadmapEscalation:       strings.TrimSpace(scopedRoadmap.Escalation),
		RoadmapKeyTurn:          strings.TrimSpace(scopedRoadmap.KeyTurn),
		RoadmapExitDebt:         strings.TrimSpace(scopedRoadmap.ExitDebt),
		Contract:                contract,
		ReversalAnchorIDs:       []string{},
		RequiredCharacterIDs:    []string{},
		RequiredRelationshipIDs: []string{},
		IntroduceIDs:            novelWorkbenchV2LedgerActionIDs(contract.RequiredIntroductions),
		PayoffIDs:               novelWorkbenchV2LedgerActionIDs(contract.RequiredPayoffs),
		RequiredWriteback: novelWorkbenchV2Writeback{
			NarrativeFacts:      []novelWorkbenchV2NarrativeFact{},
			CharacterChanges:    []novelWorkbenchV2StateTransition{},
			LocationChanges:     []novelWorkbenchV2LocationChange{},
			KnowledgeGrants:     []novelWorkbenchV2KnowledgeGrant{},
			EvidenceUpdates:     []novelWorkbenchV2EvidenceUpdate{},
			RelationshipChanges: []novelWorkbenchV2StateTransition{},
			PlotlineChanges:     []novelWorkbenchV2StateTransition{},
			ForeshadowChanges:   []novelWorkbenchV2StateTransition{},
			PromiseChanges:      []novelWorkbenchV2StateTransition{},
		},
	}
	spec.PersistenceContract = compileNovelWorkbenchV2PersistenceContract(state, scopedRoadmap, unit)
	spec.RequiredWriteback.NarrativeFacts = append([]novelWorkbenchV2NarrativeFact{}, spec.PersistenceContract.RequiredFacts...)

	ledgerAnchors := map[string]struct{}{}
	for _, id := range append(append([]string{}, spec.IntroduceIDs...), spec.PayoffIDs...) {
		ledgerAnchors[id] = struct{}{}
	}
	if len(ledgerAnchors) == 0 {
		if id := novelWorkbenchV2CompiledContextAnchor(control, state, contract.RelevantLedgerIDs); id != "" {
			ledgerAnchors[id] = struct{}{}
		}
	}
	for id := range ledgerAnchors {
		spec.ReversalAnchorIDs = append(spec.ReversalAnchorIDs, id)
	}
	sort.Strings(spec.ReversalAnchorIDs)
	if len(spec.ReversalAnchorIDs) == 0 && control.Brief.OutputMode == novelWorkbenchModeScreenplay {
		if len(control.Documents.MainPlotlines) > 0 {
			spec.ReversalAnchorIDs = []string{normalizeNovelWorkbenchV2ID(control.Documents.MainPlotlines[0].ID)}
		} else if len(control.Documents.RelationshipMap) > 0 {
			spec.ReversalAnchorIDs = []string{normalizeNovelWorkbenchV2ID(control.Documents.RelationshipMap[0].ID)}
		}
	}

	requiredCharacters := novelWorkbenchV2IDSet(contract.RequiredCharacterIDs)
	for id := range ledgerAnchors {
		if item, found := novelWorkbenchV2LedgerItemForID(control, id); found {
			for _, ownerID := range item.OwnerIDs {
				requiredCharacters[normalizeNovelWorkbenchV2ID(ownerID)] = struct{}{}
			}
		}
	}
	if len(requiredCharacters) == 0 && len(control.Documents.CastBible) > 0 {
		requiredCharacters[normalizeNovelWorkbenchV2ID(control.Documents.CastBible[0].ID)] = struct{}{}
	}
	for id := range requiredCharacters {
		spec.RequiredCharacterIDs = append(spec.RequiredCharacterIDs, id)
	}
	sort.Strings(spec.RequiredCharacterIDs)
	characterSet := novelWorkbenchV2IDSet(spec.RequiredCharacterIDs)
	for _, relationship := range control.Documents.RelationshipMap {
		if _, fromIncluded := characterSet[normalizeNovelWorkbenchV2ID(relationship.FromID)]; !fromIncluded {
			continue
		}
		if _, toIncluded := characterSet[normalizeNovelWorkbenchV2ID(relationship.ToID)]; toIncluded {
			spec.RequiredRelationshipIDs = append(spec.RequiredRelationshipIDs, normalizeNovelWorkbenchV2ID(relationship.ID))
		}
	}
	sort.Strings(spec.RequiredRelationshipIDs)

	factContract, grants, evidenceUpdates, err := compileNovelWorkbenchV2FactContract(control, state, spec, ledgerAnchors)
	if err != nil {
		return spec, err
	}
	spec.FactContract = factContract
	spec.RequiredWriteback.KnowledgeGrants = grants
	spec.RequiredWriteback.EvidenceUpdates = evidenceUpdates
	for _, action := range contract.RequiredIntroductions {
		spec.addLedgerTransition(state, action, "introduced")
	}
	for _, action := range contract.RequiredPayoffs {
		spec.addLedgerTransition(state, action, "paid")
	}
	for _, plotline := range control.Documents.MainPlotlines {
		id := normalizeNovelWorkbenchV2ID(plotline.ID)
		if unit >= plotline.ResolutionByUnit && strings.ToLower(strings.TrimSpace(state.PlotlineStates[id])) != "resolved" {
			spec.RequiredWriteback.PlotlineChanges = append(spec.RequiredWriteback.PlotlineChanges, novelWorkbenchV2StateTransition{
				ID: id, From: state.PlotlineStates[id], To: "resolved", Note: "系统编译：本单元必须完成既定主线收束。",
			})
		}
	}

	defaultCard := spec.controlCard(novelWorkbenchV2NormalizeCreativeDelta(spec, novelWorkbenchV2CreativeDelta{}))
	defaultWriteback := spec.writeback(defaultCard.NextDebt)
	if err := validateNovelWorkbenchV2ControlCard(&defaultCard, control, roadmap, unit); err != nil {
		return spec, fmt.Errorf("编译控制卡无效：%w", err)
	}
	if err := validateNovelWorkbenchV2EpisodeContractCard(contract, defaultCard); err != nil {
		return spec, fmt.Errorf("编译控制卡不满足创作契约：%w", err)
	}
	if err := validateNovelWorkbenchV2FactContract(control, state, contract, &defaultCard); err != nil {
		return spec, fmt.Errorf("编译事实契约无效：%w", err)
	}
	if err := validateNovelWorkbenchV2Writeback(control, state, defaultWriteback, unit); err != nil {
		return spec, fmt.Errorf("编译写回无效：%w", err)
	}
	if err := validateNovelWorkbenchV2ControlCardExecution(defaultCard, defaultWriteback); err != nil {
		return spec, fmt.Errorf("编译写回不满足控制卡：%w", err)
	}
	if err := validateNovelWorkbenchV2EpisodeContractExecution(contract, defaultWriteback); err != nil {
		return spec, fmt.Errorf("编译写回不满足创作契约：%w", err)
	}
	if err := validateNovelWorkbenchV2FactContractExecution(control, state, defaultCard, defaultWriteback); err != nil {
		return spec, fmt.Errorf("编译写回不满足事实契约：%w", err)
	}
	return spec, nil
}

func compileNovelWorkbenchV2PersistenceContract(state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, unit int) novelWorkbenchV2PersistenceContract {
	state = normalizeNovelWorkbenchV2State(state)
	contract := novelWorkbenchV2PersistenceContract{
		FrozenContinuity: []string{},
		RequiredFacts:    []novelWorkbenchV2NarrativeFact{},
		ActiveFacts:      []novelWorkbenchV2NarrativeFact{},
		ForbiddenEffects: []string{
			"不得新增未被本合同列出的跨集权限、释放或拘押、地点转场、时间安排、物件交接、关系承诺或证据结论。",
			"未列入合同的结果只能写成当场提议、受阻尝试或下一集待解决压力，不能写成已经生效的事实。",
		},
	}
	if bridge := strings.TrimSpace(state.NextUnitBridge); bridge != "" {
		contract.FrozenContinuity = append(contract.FrozenContinuity, bridge)
	}

	activeByID := map[string]novelWorkbenchV2NarrativeFact{}
	for rawID, rawFact := range state.NarrativeFacts {
		id := normalizeNovelWorkbenchV2ID(firstNonEmptyString(rawFact.ID, rawID))
		if id == "" || strings.ToLower(strings.TrimSpace(rawFact.Status)) != "active" {
			continue
		}
		rawFact.ID = id
		rawFact.Statement = strings.TrimSpace(rawFact.Statement)
		if rawFact.Statement == "" {
			continue
		}
		activeByID[id] = rawFact
	}

	if mission := strings.TrimSpace(roadmap.Mission); mission != "" && roadmap.StartUnit > 0 {
		fact := novelWorkbenchV2NarrativeFact{
			ID:              novelWorkbenchV2RoadmapMissionFactID(roadmap, roadmap.StartUnit),
			Statement:       mission,
			Status:          "active",
			EstablishedUnit: roadmap.StartUnit,
		}
		if unit == roadmap.StartUnit {
			if _, exists := activeByID[fact.ID]; !exists {
				contract.RequiredFacts = append(contract.RequiredFacts, fact)
			}
		} else if unit > roadmap.StartUnit {
			// A legacy run may predate compiler-owned narrative facts. The
			// completed start unit is still an accepted source of this roadmap
			// outcome, so expose it as a read-only continuity fact.
			if _, exists := activeByID[fact.ID]; !exists && state.CompletedUnit >= roadmap.StartUnit {
				activeByID[fact.ID] = fact
			}
		}
	}
	for _, fact := range activeByID {
		contract.ActiveFacts = append(contract.ActiveFacts, fact)
	}
	sort.Slice(contract.RequiredFacts, func(left, right int) bool { return contract.RequiredFacts[left].ID < contract.RequiredFacts[right].ID })
	sort.Slice(contract.ActiveFacts, func(left, right int) bool { return contract.ActiveFacts[left].ID < contract.ActiveFacts[right].ID })
	return contract
}

func novelWorkbenchV2RoadmapMissionFactID(roadmap novelWorkbenchV2Roadmap, unit int) string {
	return fmt.Sprintf("fact_%s_u_%03d_mission", normalizeNovelWorkbenchV2ID(roadmap.ID), unit)
}

func novelWorkbenchV2CompiledContextAnchor(control novelWorkbenchV2Control, state novelWorkbenchV2State, candidates []string) string {
	type candidate struct {
		id       string
		started  int
		evidence int
	}
	available := make([]candidate, 0, len(candidates))
	for _, raw := range candidates {
		id := normalizeNovelWorkbenchV2ID(raw)
		if id == "" || !novelWorkbenchV2CompiledLedgerVisible(control, state, id) {
			continue
		}
		started := state.ForeshadowStartedAt[id]
		if promiseStarted := state.PromiseStartedAt[id]; promiseStarted > started {
			started = promiseStarted
		}
		available = append(available, candidate{id: id, started: started, evidence: novelWorkbenchV2EvidenceLevelRank(novelWorkbenchV2EffectiveEvidenceLevel(control, state, id))})
	}
	if len(available) == 0 {
		return ""
	}
	sort.Slice(available, func(left, right int) bool {
		if available[left].started != available[right].started {
			return available[left].started > available[right].started
		}
		if available[left].evidence != available[right].evidence {
			return available[left].evidence > available[right].evidence
		}
		return available[left].id < available[right].id
	})
	return available[0].id
}

// A chapter roadmap can describe a four-to-eight-unit arc. Its future IDs are
// useful for a human dashboard but unsafe as current-unit model context. The
// compiler strips future actions from the work order until their ledger action
// or established state makes them available.
func novelWorkbenchV2ScopedRoadmap(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, contract novelWorkbenchV2EpisodeContract) novelWorkbenchV2Roadmap {
	scoped := roadmap
	due := map[string]struct{}{}
	for _, action := range append(append([]novelWorkbenchV2LedgerAction{}, contract.RequiredIntroductions...), contract.RequiredPayoffs...) {
		due[normalizeNovelWorkbenchV2ID(action.ID)] = struct{}{}
	}
	unsafeFutureAction := false
	for _, raw := range append(append([]string{}, roadmap.PlannedIntroductions...), roadmap.PlannedPayoffs...) {
		id := normalizeNovelWorkbenchV2ID(raw)
		if id == "" {
			continue
		}
		if _, dueNow := due[id]; dueNow {
			continue
		}
		if novelWorkbenchV2CompiledLedgerVisible(control, state, id) {
			continue
		}
		unsafeFutureAction = true
		break
	}
	scoped.PlannedIntroductions = novelWorkbenchV2LedgerActionIDs(contract.RequiredIntroductions)
	scoped.PlannedPayoffs = novelWorkbenchV2LedgerActionIDs(contract.RequiredPayoffs)
	if unsafeFutureAction {
		scoped.KeyTurn = "本单元只执行已编译动作，不提前使用本弧段尚未到期的关键转折。"
		scoped.ExitDebt = "围绕本集已编译锚点形成下一单元可见的行动压力。"
	}
	return scoped
}

func novelWorkbenchV2CompiledLedgerVisible(control novelWorkbenchV2Control, state novelWorkbenchV2State, id string) bool {
	id = normalizeNovelWorkbenchV2ID(id)
	if novelWorkbenchV2EffectiveEvidenceLevel(control, state, id) != "unseen" {
		return true
	}
	if _, found := novelWorkbenchV2LedgerItemForID(control, id); !found {
		return false
	}
	if status, found := state.ForeshadowStates[id]; found {
		return strings.ToLower(strings.TrimSpace(status)) != "" && strings.ToLower(strings.TrimSpace(status)) != "planned"
	}
	if status, found := state.PromiseStates[id]; found {
		return strings.ToLower(strings.TrimSpace(status)) != "" && strings.ToLower(strings.TrimSpace(status)) != "planned"
	}
	return false
}

func (spec *novelWorkbenchV2EpisodeSpec) addLedgerTransition(state novelWorkbenchV2State, action novelWorkbenchV2LedgerAction, to string) {
	id := normalizeNovelWorkbenchV2ID(action.ID)
	transition := novelWorkbenchV2StateTransition{ID: id, To: to, Note: "系统编译：本单元必须完成已冻结的账本动作。"}
	if action.Ledger == "reader_promise" {
		transition.From = state.PromiseStates[id]
		spec.RequiredWriteback.PromiseChanges = append(spec.RequiredWriteback.PromiseChanges, transition)
		return
	}
	transition.From = state.ForeshadowStates[id]
	spec.RequiredWriteback.ForeshadowChanges = append(spec.RequiredWriteback.ForeshadowChanges, transition)
}

func compileNovelWorkbenchV2FactContract(control novelWorkbenchV2Control, state novelWorkbenchV2State, spec novelWorkbenchV2EpisodeSpec, ledgerAnchors map[string]struct{}) (novelWorkbenchV2FactContract, []novelWorkbenchV2KnowledgeGrant, []novelWorkbenchV2EvidenceUpdate, error) {
	factContract := novelWorkbenchV2FactContract{CharacterPlacements: []novelWorkbenchV2CharacterPlacement{}, KnowledgeAccess: []novelWorkbenchV2KnowledgeAccess{}, EvidenceClaims: []novelWorkbenchV2EvidenceClaim{}}
	grants := []novelWorkbenchV2KnowledgeGrant{}
	updates := []novelWorkbenchV2EvidenceUpdate{}
	for _, characterID := range spec.RequiredCharacterIDs {
		locationID := novelWorkbenchV2CurrentCharacterLocation(state, characterID)
		presence := "on_screen"
		if locationID == "" {
			presence = "unknown"
		}
		factContract.CharacterPlacements = append(factContract.CharacterPlacements, novelWorkbenchV2CharacterPlacement{CharacterID: characterID, LocationID: locationID, Presence: presence})
	}

	anchorIDs := make([]string, 0, len(ledgerAnchors))
	for id := range ledgerAnchors {
		anchorIDs = append(anchorIDs, normalizeNovelWorkbenchV2ID(id))
	}
	sort.Strings(anchorIDs)
	for _, evidenceID := range anchorIDs {
		item, found := novelWorkbenchV2LedgerItemForID(control, evidenceID)
		if !found {
			return factContract, grants, updates, fmt.Errorf("编译事实契约找不到账本锚点 %s", evidenceID)
		}
		characterID := novelWorkbenchV2CompiledFactOwner(item, spec.RequiredCharacterIDs)
		if characterID == "" {
			return factContract, grants, updates, fmt.Errorf("编译事实契约无法为 %s 分配角色", evidenceID)
		}
		known := novelWorkbenchV2CharacterKnowsFact(control, state, characterID, evidenceID)
		access := novelWorkbenchV2KnowledgeAccess{CharacterID: characterID, FactIDs: []string{evidenceID}, AcquireInUnit: !known}
		if !known {
			access.Source = "本集通过可见行动取得并核验该账本锚点。"
			access.SourceIDs = []string{evidenceID}
			grants = append(grants, novelWorkbenchV2KnowledgeGrant{CharacterID: characterID, FactIDs: []string{evidenceID}, SourceIDs: []string{evidenceID}, Note: "系统编译：正文必须展示角色获得该线索。"})
		}
		factContract.KnowledgeAccess = append(factContract.KnowledgeAccess, access)

		prior := novelWorkbenchV2EffectiveEvidenceLevel(control, state, evidenceID)
		target := prior
		if prior == "unseen" {
			if !novelWorkbenchV2IDInList(spec.IntroduceIDs, evidenceID) {
				return factContract, grants, updates, fmt.Errorf("编译事实契约不能让未引入账本锚点 %s 充当反转依据", evidenceID)
			}
			target = "lead"
		}
		claim := novelWorkbenchV2CompiledEvidenceClaim(evidenceID, target)
		factContract.EvidenceClaims = append(factContract.EvidenceClaims, claim)
		if novelWorkbenchV2EvidenceLevelRank(target) > novelWorkbenchV2EvidenceLevelRank(prior) {
			updates = append(updates, novelWorkbenchV2EvidenceUpdate{EvidenceID: evidenceID, From: prior, To: target, Note: "系统编译：本集将该锚点推进到允许的证据等级。"})
		}
	}
	return factContract, grants, updates, nil
}

func novelWorkbenchV2CompiledFactOwner(item novelWorkbenchV2LedgerItem, candidates []string) string {
	allowed := novelWorkbenchV2IDSet(candidates)
	for _, ownerID := range item.OwnerIDs {
		if id := normalizeNovelWorkbenchV2ID(ownerID); id != "" {
			if _, exists := allowed[id]; exists {
				return id
			}
		}
	}
	if len(candidates) > 0 {
		return normalizeNovelWorkbenchV2ID(candidates[0])
	}
	return ""
}

func novelWorkbenchV2CompiledEvidenceClaim(evidenceID string, level string) novelWorkbenchV2EvidenceClaim {
	links := []novelWorkbenchV2EvidenceLink{{Kind: "discovery", Description: "本集以可见行动呈现该账本锚点的出现。", ReferenceIDs: []string{evidenceID}}}
	switch level {
	case "corroborated":
		links = append(links, novelWorkbenchV2EvidenceLink{Kind: "verification", Description: "本集通过可见核验确认该锚点并未被误读。", ReferenceIDs: []string{evidenceID}})
	case "proven":
		links = []novelWorkbenchV2EvidenceLink{
			{Kind: "origin", Description: "本集给出该账本锚点可追溯的来源说明。", ReferenceIDs: []string{evidenceID}},
			{Kind: "custody", Description: "本集展示该账本锚点的保管或交接过程。", ReferenceIDs: []string{evidenceID}},
			{Kind: "verification", Description: "本集完成对该账本锚点的可见核验。", ReferenceIDs: []string{evidenceID}},
		}
	}
	return novelWorkbenchV2EvidenceClaim{
		EvidenceID:           evidenceID,
		Level:                level,
		Links:                links,
		AllowedConclusion:    "只能确认该账本锚点的当前可见程度，仍须继续核验。",
		ProhibitedConclusion: "不得据此直接确认最终身份、动机、作者或责任归属。",
	}
}

func novelWorkbenchV2NormalizeCreativeDelta(spec novelWorkbenchV2EpisodeSpec, delta novelWorkbenchV2CreativeDelta) novelWorkbenchV2CreativeDelta {
	delta.OpeningHook = strings.TrimSpace(delta.OpeningHook)
	delta.CoreConflict = strings.TrimSpace(delta.CoreConflict)
	delta.Escalation = strings.TrimSpace(delta.Escalation)
	delta.Reversal = strings.TrimSpace(delta.Reversal)
	delta.ClosingHook = strings.TrimSpace(delta.ClosingHook)
	delta.NextDebt = strings.TrimSpace(delta.NextDebt)
	if delta.OpeningHook == "" {
		delta.OpeningHook = fmt.Sprintf("第%d单元开场，既有压力立刻逼近主角。", spec.Unit)
	}
	if delta.CoreConflict == "" {
		delta.CoreConflict = firstNonEmptyString(spec.Mission, "主角必须在当前压力下作出代价明确的选择。")
	}
	if delta.Escalation == "" {
		delta.Escalation = firstNonEmptyString(spec.RoadmapEscalation, "对手为维护利益加码，主角的选择成本上升。")
	}
	if delta.Reversal == "" {
		delta.Reversal = firstNonEmptyString(spec.RoadmapKeyTurn, "既有账本锚点被重新使用，局势出现可见反转。")
	}
	if delta.ClosingHook == "" {
		delta.ClosingHook = firstNonEmptyString(spec.RoadmapExitDebt, "新的明确压力迫使主角进入下一单元。")
	}
	if delta.NextDebt == "" {
		delta.NextDebt = firstNonEmptyString(spec.RoadmapExitDebt, delta.ClosingHook, "下一单元必须回应本集留下的明确行动压力。")
	}
	delta.NarrativeBeats = cleanNovelWorkbenchV2Strings(delta.NarrativeBeats)
	for _, fallback := range []string{delta.OpeningHook, delta.CoreConflict, delta.ClosingHook} {
		if len(delta.NarrativeBeats) >= 3 {
			break
		}
		delta.NarrativeBeats = append(delta.NarrativeBeats, fallback)
	}
	spine := make([]string, 0, 4)
	for _, step := range cleanNovelWorkbenchV2Strings(delta.CausalSpine) {
		if len([]rune(step)) >= 8 {
			spine = append(spine, step)
		}
	}
	for _, fallback := range []string{
		firstNonEmptyString(spec.Contract.PriorUnitBridge, "既有压力已经落在主角眼前，无法继续回避。"),
		fmt.Sprintf("主角围绕“%s”作出可见且主动的选择。", delta.CoreConflict),
		fmt.Sprintf("对手为维护自身利益，以“%s”作出有动机的反应。", delta.Escalation),
		fmt.Sprintf("行动留下“%s”，形成下一单元必须回应的压力。", delta.NextDebt),
	} {
		if len(spine) >= 4 {
			break
		}
		spine = append(spine, fallback)
	}
	delta.CausalSpine = spine
	return delta
}

func (spec novelWorkbenchV2EpisodeSpec) controlCard(delta novelWorkbenchV2CreativeDelta) novelWorkbenchV2ControlCard {
	delta = novelWorkbenchV2NormalizeCreativeDelta(spec, delta)
	return novelWorkbenchV2ControlCard{
		Unit:                    spec.Unit,
		RoadmapID:               spec.RoadmapID,
		Mission:                 spec.Mission,
		OpeningHook:             delta.OpeningHook,
		CoreConflict:            delta.CoreConflict,
		Escalation:              delta.Escalation,
		Reversal:                delta.Reversal,
		ClosingHook:             delta.ClosingHook,
		NextDebt:                delta.NextDebt,
		NarrativeBeats:          delta.NarrativeBeats,
		CausalSpine:             delta.CausalSpine,
		ReversalAnchorIDs:       append([]string{}, spec.ReversalAnchorIDs...),
		RequiredCharacterIDs:    append([]string{}, spec.RequiredCharacterIDs...),
		RequiredRelationshipIDs: append([]string{}, spec.RequiredRelationshipIDs...),
		IntroduceIDs:            append([]string{}, spec.IntroduceIDs...),
		PayoffIDs:               append([]string{}, spec.PayoffIDs...),
		FactContract:            spec.FactContract,
	}
}

func (spec novelWorkbenchV2EpisodeSpec) writeback(nextUnitBridge string) novelWorkbenchV2Writeback {
	writeback := spec.RequiredWriteback
	writeback.NextUnitBridge = firstNonEmptyString(strings.TrimSpace(nextUnitBridge), spec.RoadmapExitDebt, "下一单元必须回应本集留下的行动压力。")
	return writeback
}

func (spec novelWorkbenchV2EpisodeSpec) materializeOutput(draft novelWorkbenchV2DraftContent, card novelWorkbenchV2ControlCard) novelWorkbenchV2UnitOutput {
	content := strings.TrimSpace(draft.Content)
	title := strings.TrimSpace(draft.Title)
	if title == "" {
		title = fmt.Sprintf("第%d单元", spec.Unit)
	}
	summary := strings.TrimSpace(draft.Summary)
	if summary == "" && content != "" {
		summary = truncateRunes(content, 140)
	}
	return novelWorkbenchV2UnitOutput{Unit: spec.Unit, Title: title, Content: content, Summary: summary, Writeback: spec.writeback(card.NextDebt)}
}

func novelWorkbenchV2IDInList(values []string, id string) bool {
	id = normalizeNovelWorkbenchV2ID(id)
	for _, value := range values {
		if normalizeNovelWorkbenchV2ID(value) == id {
			return true
		}
	}
	return false
}

func newNovelWorkbenchV2RepairPacket(stage string, attempt int, err error, control novelWorkbenchV2Control, contract novelWorkbenchV2EpisodeContract, card *novelWorkbenchV2ControlCard, review *novelWorkbenchV2ReviewReport) novelWorkbenchV2RepairPacket {
	failure := strings.TrimSpace(errorText(err))
	packet := novelWorkbenchV2RepairPacket{
		SchemaVersion: novelWorkbenchV2CompiledControlVersion,
		Stage:         stage,
		Attempt:       attempt,
		RequiredFix:   []string{},
		Warnings:      []string{},
		Preserve: []string{
			"保持已冻结的创作契约、账本动作和事实契约不变。",
			"不得改写已提交单元、动态状态或新增未建档的长期谜团。",
		},
	}
	if review != nil {
		if blocker, found := novelWorkbenchV2PrimaryReviewBlocker(*review); found {
			code := novelWorkbenchV2ReviewIssueCode(blocker)
			evidence := firstNonEmptyString(strings.TrimSpace(blocker.Evidence), "独立审稿指出该项无法提交。")
			failure = fmt.Sprintf("审稿拦截 [%s]：%s", code, evidence)
			packet.FailureClass = "narrative"
			packet.FailureCode = code
			packet.RequiredFix = novelWorkbenchV2ReviewBlockerFixes(*review)
			packet.Warnings = novelWorkbenchV2ReviewWarnings(*review)
		}
	}
	if packet.FailureCode == "" {
		if failure == "" {
			failure = "本次候选稿未通过创作控制校验。"
		}
		packet.FailureClass = novelWorkbenchV2RepairFailureClass(stage, failure)
		packet.FailureCode = novelWorkbenchV2RepairFailureCode(stage, failure)
		packet.RequiredFix = append(packet.RequiredFix, failure)
	}
	packet.Failure = failure
	packet.AffectedIDs = novelWorkbenchV2RepairAffectedIDs(control, contract, card, review, failure)
	packet.RequiredFix = cleanNovelWorkbenchV2Strings(packet.RequiredFix)
	if len(packet.RequiredFix) == 0 {
		packet.RequiredFix = []string{"仅修复本次失败项，并保留已通过的正文内容。"}
	}
	packet.Warnings = cleanNovelWorkbenchV2Strings(packet.Warnings)
	return packet
}

func novelWorkbenchV2PrimaryReviewBlocker(review novelWorkbenchV2ReviewReport) (novelWorkbenchV2ReviewIssue, bool) {
	for _, issue := range review.BlockingIssues {
		severity := strings.ToLower(strings.TrimSpace(issue.Severity))
		if severity == "blocker" || severity == "fatal" || severity == "" {
			return issue, true
		}
	}
	return novelWorkbenchV2ReviewIssue{}, false
}

func novelWorkbenchV2ReviewIssueCode(issue novelWorkbenchV2ReviewIssue) string {
	code := strings.ToUpper(strings.TrimSpace(issue.Code))
	if code == "" {
		return "REVIEW_BLOCKER"
	}
	return code
}

func novelWorkbenchV2ReviewBlockerFixes(review novelWorkbenchV2ReviewReport) []string {
	fixes := make([]string, 0, len(review.BlockingIssues))
	for _, issue := range review.BlockingIssues {
		severity := strings.ToLower(strings.TrimSpace(issue.Severity))
		if severity != "" && severity != "blocker" && severity != "fatal" {
			continue
		}
		code := novelWorkbenchV2ReviewIssueCode(issue)
		fix := firstNonEmptyString(strings.TrimSpace(issue.RepairAction), strings.TrimSpace(issue.Evidence))
		if fix != "" {
			fixes = append(fixes, fmt.Sprintf("[%s] %s", code, fix))
		}
	}
	return fixes
}

func novelWorkbenchV2ReviewWarnings(review novelWorkbenchV2ReviewReport) []string {
	warnings := make([]string, 0, len(review.Warnings))
	for _, issue := range review.Warnings {
		code := novelWorkbenchV2ReviewIssueCode(issue)
		detail := firstNonEmptyString(strings.TrimSpace(issue.RepairAction), strings.TrimSpace(issue.Evidence))
		if detail != "" {
			warnings = append(warnings, fmt.Sprintf("[%s] %s", code, detail))
		}
	}
	return warnings
}

func novelWorkbenchV2RepairFailureClass(stage string, failure string) string {
	lower := strings.ToLower(failure)
	if strings.Contains(lower, "json") || strings.Contains(lower, "decode") {
		return "format"
	}
	if stage == "review" || strings.Contains(lower, "审稿") || strings.Contains(lower, "质量信号") {
		return "narrative"
	}
	return "structural"
}

func novelWorkbenchV2RepairFailureCode(stage string, failure string) string {
	lower := strings.ToLower(failure)
	switch {
	case strings.Contains(lower, "json") || strings.Contains(lower, "decode"):
		return "JSON_INVALID"
	case strings.Contains(lower, "地点"):
		return "FACT_LOCATION_CONFLICT"
	case strings.Contains(lower, "证据"):
		return "FACT_EVIDENCE_CONFLICT"
	case strings.Contains(lower, "原状态"):
		return "STATE_TRANSITION_CONFLICT"
	case strings.Contains(lower, "越知") || strings.Contains(lower, "知情"):
		return "TEMPORAL_KNOWLEDGE_CONFLICT"
	case stage == "review" || strings.Contains(lower, "审稿"):
		return "REVIEW_BLOCKER"
	default:
		return "VALIDATION_FAILED"
	}
}

func novelWorkbenchV2RepairAffectedIDs(control novelWorkbenchV2Control, contract novelWorkbenchV2EpisodeContract, card *novelWorkbenchV2ControlCard, review *novelWorkbenchV2ReviewReport, failure string) []string {
	ids := map[string]struct{}{}
	for _, action := range append(append([]novelWorkbenchV2LedgerAction{}, contract.RequiredIntroductions...), contract.RequiredPayoffs...) {
		ids[normalizeNovelWorkbenchV2ID(action.ID)] = struct{}{}
	}
	if card != nil {
		for _, group := range [][]string{card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs} {
			for _, id := range group {
				ids[normalizeNovelWorkbenchV2ID(id)] = struct{}{}
			}
		}
	}
	if review != nil {
		for _, id := range review.ReferenceIDs {
			ids[normalizeNovelWorkbenchV2ID(id)] = struct{}{}
		}
		for _, issue := range append(append([]novelWorkbenchV2ReviewIssue{}, review.BlockingIssues...), review.Warnings...) {
			if id := normalizeNovelWorkbenchV2ID(issue.ReferenceID); id != "" {
				ids[id] = struct{}{}
			}
		}
	}
	known, err := novelWorkbenchV2KnownIDsForControl(control)
	if err == nil {
		lower := strings.ToLower(failure)
		for id := range known.all {
			if strings.Contains(lower, id) {
				ids[id] = struct{}{}
			}
		}
	}
	result := make([]string, 0, len(ids))
	for id := range ids {
		if id != "" {
			result = append(result, id)
		}
	}
	sort.Strings(result)
	return result
}

func (s *Service) generateNovelWorkbenchV2CreativeDelta(ctx context.Context, run *model.NovelWorkbenchRun, task model.Task, control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, spec novelWorkbenchV2EpisodeSpec, resolvedConfig providerConfig) (novelWorkbenchV2CreativeDelta, string, error) {
	prompt := buildNovelWorkbenchV2CreativeDeltaPrompt(control, state, roadmap, spec)
	var lastDelta novelWorkbenchV2CreativeDelta
	var validationErr error
	for attempt := 1; attempt <= novelWorkbenchV2MaxCreativeDeltaAttempts; attempt++ {
		generated, err := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: prompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: 2_400})
		if err != nil {
			return lastDelta, prompt, err
		}
		raw := stringValue(generated["text"])
		candidate := novelWorkbenchV2CreativeDelta{}
		validationErr = decodeNovelWorkbenchV2JSONObject(raw, &candidate)
		if validationErr == nil {
			return novelWorkbenchV2NormalizeCreativeDelta(spec, candidate), prompt, nil
		}
		fallbackCard := spec.controlCard(novelWorkbenchV2NormalizeCreativeDelta(spec, novelWorkbenchV2CreativeDelta{}))
		packet := newNovelWorkbenchV2RepairPacket("creative_delta", attempt, validationErr, control, spec.Contract, &fallbackCard, nil)
		if err := s.createNovelWorkbenchV2Artifact(run, spec.Unit, "creative_delta_rejected", attempt, map[string]any{"raw": raw, "error": validationErr.Error(), "repairPacket": packet}, prompt); err != nil {
			return lastDelta, prompt, err
		}
		if attempt < novelWorkbenchV2MaxCreativeDeltaAttempts {
			if err := s.updateNovelWorkbenchV2Progress(run, task.ID, novelWorkbenchV2PipelineRepair, fmt.Sprintf("第 %d 单元：修复创意增量（第 %d/%d 轮）", spec.Unit, attempt, novelWorkbenchV2MaxCreativeDeltaAttempts-1), 23); err != nil {
				return lastDelta, prompt, err
			}
			prompt = buildNovelWorkbenchV2CreativeDeltaRepairPrompt(control, state, roadmap, spec, raw, packet)
		}
	}
	return lastDelta, prompt, validationErr
}

func buildNovelWorkbenchV2CreativeDeltaPrompt(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, spec novelWorkbenchV2EpisodeSpec) string {
	specJSON, _ := json.Marshal(spec)
	persistenceJSON, _ := json.Marshal(spec.PersistenceContract)
	workPackageJSON := novelWorkbenchV2EpisodeWorkPackageJSON(control, state, roadmap, spec.Contract)
	formatInstruction := "本集将被拍成竖屏短剧，开场要立刻给压力，结尾要留下可见的下一集债务。"
	if control.Brief.OutputMode == novelWorkbenchModeNovel {
		formatInstruction = "本集将写成小说章节，场景、行动、情绪和因果要自然连贯，不能写成分镜提纲。"
	}
	return fmt.Sprintf(`你是长线作品的单元策划编辑。只为第 %d 单元提供创意增量，不负责管理状态机。

%s
系统已编译并冻结以下内容：稳定 ID、路线图绑定、角色与关系范围、地点、知情权限、证据等级、账本状态迁移和提交写回。它们不是你的输出字段，也不能被改写。你只决定本集的戏剧表达：开场压力、核心冲突、升级、反转、尾钩、下一集债务，以及可执行的叙事节拍和四步因果脊柱。

已编译单元规格：%s
持久事实合同：%s
本集工作包：%s

要求：
1. causalSpine 至少四步，顺序必须是既有前提、主角主动选择、对手的自利反应、可见结果与下一集压力。
2. 不得把未建档的秘密、道具、人物或地点用作反转解释；只能围绕已编译的锚点和本集工作包展开。
3. 未列入持久事实合同 requiredFacts 的跨集结果不得写成已生效，包括权限、释放或拘押、转场、时间安排、物件交接、关系承诺和证据结论；可改为当场尝试、受阻提议或下一集压力。
4. frozenContinuity 是本集开场即成立的事实。若要改变其中任何限制，必须在叙事节拍中先写出可见原因、动作和后果，且结果仍须在持久事实合同中获得授权。
5. 不得输出 unit、roadmapId、任何 ID 数组、factContract、writeback 或状态字段。
6. 信息不足的字段可留空，系统会用路线图补齐；不要为了填字段虚构事实。

只输出 JSON：
{"openingHook":"","coreConflict":"","escalation":"","reversal":"","closingHook":"","nextDebt":"","narrativeBeats":[""],"causalSpine":["","","",""]}`,
		spec.Unit, formatInstruction, string(specJSON), string(persistenceJSON), workPackageJSON)
}

func buildNovelWorkbenchV2CreativeDeltaRepairPrompt(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, spec novelWorkbenchV2EpisodeSpec, raw string, packet novelWorkbenchV2RepairPacket) string {
	specJSON, _ := json.Marshal(spec)
	persistenceJSON, _ := json.Marshal(spec.PersistenceContract)
	packetJSON, _ := json.Marshal(packet)
	workPackageJSON := novelWorkbenchV2EpisodeWorkPackageJSON(control, state, roadmap, spec.Contract)
	return fmt.Sprintf(`修复第 %d 单元的创意增量 JSON。只处理这一次失败单，不要重做控制档案。

失败单：%s
已编译单元规格：%s
持久事实合同：%s
本集工作包：%s
上一份输出：%s

保留失败单列出的不可改项。只输出创意增量 JSON，不要输出 ID、事实契约、writeback、Markdown 或解释。`, spec.Unit, string(packetJSON), string(specJSON), string(persistenceJSON), workPackageJSON, raw)
}

func buildNovelWorkbenchV2CompiledWriterPrompt(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, spec novelWorkbenchV2EpisodeSpec, card novelWorkbenchV2ControlCard) string {
	specJSON, _ := json.Marshal(spec)
	cardJSON, _ := json.Marshal(card)
	persistenceJSON, _ := json.Marshal(spec.PersistenceContract)
	workPackageJSON := novelWorkbenchV2EpisodeWorkPackageJSON(control, state, roadmap, spec.Contract)
	formatInstruction := "写成可拍摄的竖屏短剧剧本，包含必要场景、动作、对白和音效；不得把控制卡照抄成提纲。"
	if control.Brief.OutputMode == novelWorkbenchModeNovel {
		formatInstruction = "写成可直接阅读的完整小说章节，使用连续叙事、行动、对白、心理和场景；不要写成场景标签、分镜或拍摄指令。"
	}
	return fmt.Sprintf(`你是这部作品的执行主笔。只写第 %d 单元正文。%s

本集工作包：%s
已编译单元规格：%s
持久事实合同：%s
本单元控制卡：%s

系统已经锁定并会自动提交所有稳定 ID、已知地点、知情权限、证据等级、账本迁移和下一单元状态。你不能也不需要输出 writeback、from/to、地点移动或任何状态 JSON。factContract 中 presence=unknown 表示旧项目尚未留下可靠地点状态：可写必要场景，但不能把该地点当作已持久化的跨集结论。正文必须让读者实际看见已编译的引入、回收、知情获得、证据链和因果脊柱，不能只靠系统写回伪造它们。
持久事实合同是唯一允许跨集生效的结果清单。requiredFacts 必须由正文以可见行动兑现，系统会自动提交；activeFacts 与 frozenContinuity 必须保持连续。除非某结果语义已列入 requiredFacts，禁止把新权限、释放或拘押、地点转场、具体时间安排、物件交接、关系承诺或证据结论写成已经生效的事实。若控制卡需要这些内容但合同未授权，只能写为当场提议、受阻尝试或未解的尾钩。frozenContinuity 中的限制若要改变，必须先写出可见的触发、过程和结果。

执行要求：
1. 落实控制卡的开场压力、核心冲突、升级、反转、尾钩与下一集债务；不得改写已提交事实。
2. 不得引入未建档的核心人物、关系、长期谜团、证据链或债务。
3. 每一步 causalSpine 都要有可见动作、动机和结果；对手不能无动机地配合剧情。
4. 证据只能支持事实契约的 allowedConclusion，角色只能使用已获知或正文中可见获得的信息。
5. 用户希望约 %d 字、约 %d 秒，这只是节奏参考，不是硬性字数门槛。请完整承载本集戏剧功能，不注水，也不为压缩而删除因果。

只输出 JSON：
{"title":"","content":"","summary":""}`,
		spec.Unit, formatInstruction, workPackageJSON, string(specJSON), string(persistenceJSON), string(cardJSON), control.Brief.TargetUnitLength, control.Brief.UnitDurationSeconds)
}

func buildNovelWorkbenchV2CompiledRepairPrompt(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, spec novelWorkbenchV2EpisodeSpec, card novelWorkbenchV2ControlCard, raw string, packet novelWorkbenchV2RepairPacket) string {
	specJSON, _ := json.Marshal(spec)
	cardJSON, _ := json.Marshal(card)
	packetJSON, _ := json.Marshal(packet)
	persistenceJSON, _ := json.Marshal(spec.PersistenceContract)
	workPackageJSON := novelWorkbenchV2EpisodeWorkPackageJSON(control, state, roadmap, spec.Contract)
	return fmt.Sprintf(`对第 %d 单元进行一次定向正文返修。保留上一稿中未被失败单指出、且不违反冻结事实的有效内容；只修复失败单中的问题，不能重写控制档案或发明新的长期设定。

本次失败单：%s
本集工作包：%s
已编译单元规格：%s
持久事实合同：%s
控制卡：%s
上一稿：%s

必须逐项完成 requiredFix，同时严格保持 preserve。系统会自动处理 writeback，所以不要输出状态、ID、地点变更或账本迁移。若失败单出现 UNCOMPILED_PERSISTENT_FACT，含义是正文声称了合同未授权的跨集结果：应删除、改为当场未决，或收束为合同 requiredFacts 中已有的结果，绝不能尝试“补写 writeback”。只输出 JSON：
{"title":"","content":"","summary":""}`,
		spec.Unit, string(packetJSON), workPackageJSON, string(specJSON), string(persistenceJSON), string(cardJSON), raw)
}

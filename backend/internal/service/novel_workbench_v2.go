package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	novelWorkbenchV2EngineVersion           = 2
	novelWorkbenchV2QualityPolicy           = "compiled-control-v3"
	novelWorkbenchV2ContractVersion         = 2
	novelWorkbenchV2PlanVersion             = 1
	novelWorkbenchV2ControlCardAuditVersion = 1
	novelWorkbenchV2MaxLedgerActions        = 3
	novelWorkbenchV2PipelineBootstrap       = "bootstrap"
	novelWorkbenchV2PipelinePrepare         = "prepare"
	novelWorkbenchV2PipelineDraft           = "draft"
	novelWorkbenchV2PipelineReview          = "review"
	novelWorkbenchV2PipelineRepair          = "repair"
	novelWorkbenchV2PipelineCommit          = "commit"
	novelWorkbenchV2PipelineBlocked         = "quality_blocked"
	novelWorkbenchV2BlockClassStructure     = "structure"
	novelWorkbenchV2BlockClassNarrative     = "narrative"
	novelWorkbenchStatusArchived            = "archived"
	novelWorkbenchV2MaxRepairAttempts       = 1
	novelWorkbenchV2MaxDraftAttempts        = 1 + novelWorkbenchV2MaxRepairAttempts
)

var novelWorkbenchV2QualitySignals = []string{
	"antiAi", "storyLogic", "stateGuard", "emotion", "blockbuster", "visiblePayoff",
	"readerPull", "titleHook", "characterVoice", "domainTranslation", "novelty", "continuity",
}

// novelWorkbenchV2Control is the application's native representation of the
// canonical files used by long-form fiction control systems. It stays as JSON
// so a project remains portable between SQLite and PostgreSQL, while the
// fields below are deliberately structured enough for deterministic guards.
type novelWorkbenchV2Control struct {
	EngineVersion int                       `json:"engineVersion"`
	Title         string                    `json:"title"`
	Logline       string                    `json:"logline"`
	Brief         novelWorkbenchBrief       `json:"brief"`
	Documents     novelWorkbenchV2Documents `json:"documents"`
}

type novelWorkbenchV2Documents struct {
	ProjectOverview     novelWorkbenchV2ProjectOverview `json:"projectOverview"`
	ThemeAndProposition novelWorkbenchV2Theme           `json:"themeAndProposition"`
	Worldbuilding       novelWorkbenchV2Worldbuilding   `json:"worldbuilding"`
	CastBible           []novelWorkbenchV2Character     `json:"castBible"`
	RelationshipMap     []novelWorkbenchV2Relationship  `json:"relationshipMap"`
	MainPlotlines       []novelWorkbenchV2Plotline      `json:"mainPlotlines"`
	ForeshadowLedger    []novelWorkbenchV2LedgerItem    `json:"foreshadowLedger"`
	ReaderPromiseLedger []novelWorkbenchV2LedgerItem    `json:"readerPromiseLedger"`
	ChapterRoadmap      []novelWorkbenchV2Roadmap       `json:"chapterRoadmap"`
	StyleGuide          novelWorkbenchV2StyleGuide      `json:"styleGuide"`
	WritingLog          []novelWorkbenchV2WritingLog    `json:"writingLog"`
}

type novelWorkbenchV2ProjectOverview struct {
	CorePromise      string `json:"corePromise"`
	CentralConflict  string `json:"centralConflict"`
	EndingResolution string `json:"endingResolution"`
	AudiencePayoff   string `json:"audiencePayoff"`
}

type novelWorkbenchV2Theme struct {
	Theme       string `json:"theme"`
	Proposition string `json:"proposition"`
	Price       string `json:"price"`
}

type novelWorkbenchV2Worldbuilding struct {
	Rules       []string `json:"rules"`
	Locations   []string `json:"locations"`
	Constraints []string `json:"constraints"`
}

type novelWorkbenchV2Character struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	Desire       string `json:"desire"`
	Fear         string `json:"fear"`
	BlindSpot    string `json:"blindSpot"`
	Voice        string `json:"voice"`
	Arc          string `json:"arc"`
	InitialState string `json:"initialState"`
}

type novelWorkbenchV2Relationship struct {
	ID           string `json:"id"`
	FromID       string `json:"fromId"`
	ToID         string `json:"toId"`
	Description  string `json:"description"`
	InitialState string `json:"initialState"`
}

type novelWorkbenchV2Plotline struct {
	ID               string `json:"id"`
	Title            string `json:"title"`
	Goal             string `json:"goal"`
	InitialState     string `json:"initialState"`
	ResolutionByUnit int    `json:"resolutionByUnit"`
}

// LedgerItem is shared by foreshadow and reader-promise ledgers. Status is
// held in dynamic state; the canonical record carries only the immutable plan.
type novelWorkbenchV2LedgerItem struct {
	ID               string   `json:"id"`
	Description      string   `json:"description"`
	IntroducedByUnit int      `json:"introducedByUnit"`
	PayoffByUnit     int      `json:"payoffByUnit"`
	OwnerIDs         []string `json:"ownerIds"`
}

// Roadmap entries intentionally cover a continuous range rather than forcing
// a 500-episode project into one enormous context payload. Each unit receives
// a dedicated control card before prose is generated.
type novelWorkbenchV2Roadmap struct {
	ID                   string   `json:"id"`
	Title                string   `json:"title"`
	StartUnit            int      `json:"startUnit"`
	EndUnit              int      `json:"endUnit"`
	Mission              string   `json:"mission"`
	Escalation           string   `json:"escalation"`
	KeyTurn              string   `json:"keyTurn"`
	ExitDebt             string   `json:"exitDebt"`
	PlannedIntroductions []string `json:"plannedIntroductions"`
	PlannedPayoffs       []string `json:"plannedPayoffs"`
}

type novelWorkbenchV2StyleGuide struct {
	NarrativeVoice string   `json:"narrativeVoice"`
	PacingRules    []string `json:"pacingRules"`
	ForbiddenDrift []string `json:"forbiddenDrift"`
}

type novelWorkbenchV2WritingLog struct {
	Unit    int       `json:"unit"`
	Title   string    `json:"title"`
	Summary string    `json:"summary"`
	At      time.Time `json:"at"`
}

type novelWorkbenchV2State struct {
	CompletedUnit       int                                      `json:"completedUnit"`
	CurrentRoadmapID    string                                   `json:"currentRoadmapId"`
	CurrentRoadmapTitle string                                   `json:"currentRoadmapTitle"`
	LastUnitSummary     string                                   `json:"lastUnitSummary"`
	NextUnitBridge      string                                   `json:"nextUnitBridge"`
	NarrativeFacts      map[string]novelWorkbenchV2NarrativeFact `json:"narrativeFacts"`
	CharacterStates     map[string]string                        `json:"characterStates"`
	CharacterLocations  map[string]string                        `json:"characterLocations"`
	CharacterKnowledge  map[string][]string                      `json:"characterKnowledge"`
	RelationshipStates  map[string]string                        `json:"relationshipStates"`
	PlotlineStates      map[string]string                        `json:"plotlineStates"`
	ForeshadowStates    map[string]string                        `json:"foreshadowStates"`
	PromiseStates       map[string]string                        `json:"promiseStates"`
	EvidenceLevels      map[string]string                        `json:"evidenceLevels"`
	ForeshadowStartedAt map[string]int                           `json:"foreshadowStartedAt"`
	PromiseStartedAt    map[string]int                           `json:"promiseStartedAt"`
	OpenDebtIDs         []string                                 `json:"openDebtIds"`
	AuditTrail          []novelWorkbenchAuditEntry               `json:"auditTrail"`
}

// novelWorkbenchV2NarrativeFact is a compiler-owned cross-unit result. It
// records an approved roadmap outcome without asking prose generation to
// invent a new state transition or writeback shape.
type novelWorkbenchV2NarrativeFact struct {
	ID              string `json:"id"`
	Statement       string `json:"statement"`
	Status          string `json:"status"`
	EstablishedUnit int    `json:"establishedUnit"`
}

type novelWorkbenchV2BootstrapOutput struct {
	Title     string                    `json:"title"`
	Logline   string                    `json:"logline"`
	Documents novelWorkbenchV2Documents `json:"documents"`
}

type novelWorkbenchV2ControlCard struct {
	Unit                    int                          `json:"unit"`
	RoadmapID               string                       `json:"roadmapId"`
	Mission                 string                       `json:"mission"`
	OpeningHook             string                       `json:"openingHook"`
	CoreConflict            string                       `json:"coreConflict"`
	Escalation              string                       `json:"escalation"`
	Reversal                string                       `json:"reversal"`
	ClosingHook             string                       `json:"closingHook"`
	NextDebt                string                       `json:"nextDebt"`
	NarrativeBeats          []string                     `json:"narrativeBeats"`
	CausalSpine             []string                     `json:"causalSpine"`
	ReversalAnchorIDs       []string                     `json:"reversalAnchorIds"`
	RequiredCharacterIDs    []string                     `json:"requiredCharacterIds"`
	RequiredRelationshipIDs []string                     `json:"requiredRelationshipIds"`
	IntroduceIDs            []string                     `json:"introduceIds"`
	PayoffIDs               []string                     `json:"payoffIds"`
	FactContract            novelWorkbenchV2FactContract `json:"factContract"`
}

// novelWorkbenchV2FactContract makes the three most expensive continuity
// failures explicit before prose is drafted: physical location, permitted
// knowledge and the maximum conclusion supported by an evidence chain.
// It is authored in the normal control-card call and validated locally, so it
// improves first-pass quality without adding a separate model call.
type novelWorkbenchV2FactContract struct {
	CharacterPlacements []novelWorkbenchV2CharacterPlacement `json:"characterPlacements"`
	KnowledgeAccess     []novelWorkbenchV2KnowledgeAccess    `json:"knowledgeAccess"`
	EvidenceClaims      []novelWorkbenchV2EvidenceClaim      `json:"evidenceClaims"`
}

type novelWorkbenchV2CharacterPlacement struct {
	CharacterID    string `json:"characterId"`
	LocationID     string `json:"locationId"`
	LocationDetail string `json:"locationDetail,omitempty"`
	Presence       string `json:"presence"`
	FromLocationID string `json:"fromLocationId,omitempty"`
	MovementCause  string `json:"movementCause,omitempty"`
}

type novelWorkbenchV2KnowledgeAccess struct {
	CharacterID   string   `json:"characterId"`
	FactIDs       []string `json:"factIds"`
	Source        string   `json:"source"`
	SourceIDs     []string `json:"sourceIds"`
	AcquireInUnit bool     `json:"acquireInUnit"`
}

type novelWorkbenchV2EvidenceClaim struct {
	EvidenceID           string                         `json:"evidenceId"`
	Level                string                         `json:"level"`
	Links                []novelWorkbenchV2EvidenceLink `json:"links"`
	AllowedConclusion    string                         `json:"allowedConclusion"`
	ProhibitedConclusion string                         `json:"prohibitedConclusion"`
}

type novelWorkbenchV2EvidenceLink struct {
	Kind         string   `json:"kind"`
	Description  string   `json:"description"`
	ReferenceIDs []string `json:"referenceIds"`
}

// novelWorkbenchV2LedgerAction is a deterministic requirement compiled from
// the canonical ledger. It is intentionally separate from a model-authored
// control card: the model can decide how an action appears on screen, but not
// whether a due action exists.
type novelWorkbenchV2LedgerAction struct {
	ID           string   `json:"id"`
	Ledger       string   `json:"ledger"`
	Description  string   `json:"description"`
	OwnerIDs     []string `json:"ownerIds"`
	DeadlineUnit int      `json:"deadlineUnit"`
}

type novelWorkbenchV2StateLock struct {
	ID    string `json:"id"`
	Kind  string `json:"kind"`
	State string `json:"state"`
}

// novelWorkbenchV2EpisodeContract is the small, frozen work order supplied to
// planning, writing and review for one unit. It gives the model only the
// creative decisions while deterministic lifecycle decisions remain in Go.
type novelWorkbenchV2EpisodeContract struct {
	Version               int                            `json:"version"`
	Unit                  int                            `json:"unit"`
	RoadmapID             string                         `json:"roadmapId"`
	RoadmapTitle          string                         `json:"roadmapTitle"`
	RequiredIntroductions []novelWorkbenchV2LedgerAction `json:"requiredIntroductions"`
	RequiredPayoffs       []novelWorkbenchV2LedgerAction `json:"requiredPayoffs"`
	RelevantLedgerIDs     []string                       `json:"relevantLedgerIds"`
	RequiredCharacterIDs  []string                       `json:"requiredCharacterIds"`
	StateLocks            []novelWorkbenchV2StateLock    `json:"stateLocks"`
	OpenDebtIDs           []string                       `json:"openDebtIds"`
	PriorUnitBridge       string                         `json:"priorUnitBridge"`
}

// novelWorkbenchV2PlanUnit is the deterministic lifecycle schedule for one
// unit. It is derived from immutable ledger deadlines during bootstrap and is
// retained as an audit artifact, not treated as generated prose.
type novelWorkbenchV2PlanUnit struct {
	Unit          int      `json:"unit"`
	RoadmapID     string   `json:"roadmapId"`
	Introductions []string `json:"introductions"`
	Payoffs       []string `json:"payoffs"`
}

type novelWorkbenchV2PlanPreview struct {
	Version         int                        `json:"version"`
	TargetUnitCount int                        `json:"targetUnitCount"`
	Units           []novelWorkbenchV2PlanUnit `json:"units"`
}

type novelWorkbenchV2QualityBlockRecord struct {
	Class    string                           `json:"class"`
	Stage    string                           `json:"stage"`
	Unit     int                              `json:"unit"`
	Reason   string                           `json:"reason"`
	Contract *novelWorkbenchV2EpisodeContract `json:"contract,omitempty"`
}

// novelWorkbenchV2ControlCardAuditRecord makes local guard decisions visible
// after the fact. It intentionally stores a response fingerprint rather than
// duplicating accepted model output; the accepted normalized card remains the
// canonical artifact, and rejected attempts retain their raw response.
type novelWorkbenchV2ControlCardAuditRecord struct {
	SchemaVersion            int                                             `json:"schemaVersion"`
	Unit                     int                                             `json:"unit"`
	Attempt                  int                                             `json:"attempt"`
	Outcome                  string                                          `json:"outcome"`
	Ruleset                  string                                          `json:"ruleset"`
	RawResponseSHA256        string                                          `json:"rawResponseSha256"`
	InputEvidenceClaimCount  int                                             `json:"inputEvidenceClaimCount"`
	OutputEvidenceClaimCount int                                             `json:"outputEvidenceClaimCount"`
	Contract                 novelWorkbenchV2ControlCardAuditContract        `json:"contract"`
	EvidenceDecisions        []novelWorkbenchV2ControlCardEvidenceAuditEntry `json:"evidenceDecisions,omitempty"`
	Validations              []novelWorkbenchV2ControlCardAuditValidation    `json:"validations"`
	ValidationError          string                                          `json:"validationError,omitempty"`
}

type novelWorkbenchV2ControlCardAuditContract struct {
	RoadmapID               string                      `json:"roadmapId"`
	RequiredIntroductionIDs []string                    `json:"requiredIntroductionIds"`
	RequiredPayoffIDs       []string                    `json:"requiredPayoffIds"`
	RelevantLedgerIDs       []string                    `json:"relevantLedgerIds"`
	RequiredCharacterIDs    []string                    `json:"requiredCharacterIds"`
	StateLocks              []novelWorkbenchV2StateLock `json:"stateLocks"`
	OpenDebtIDs             []string                    `json:"openDebtIds"`
}

type novelWorkbenchV2ControlCardEvidenceAuditEntry struct {
	EvidenceID      string `json:"evidenceId"`
	RequestedLevel  string `json:"requestedLevel"`
	PriorLevel      string `json:"priorLevel"`
	Classification  string `json:"classification"`
	Action          string `json:"action"`
	Reason          string `json:"reason"`
	KnownLedger     bool   `json:"knownLedger"`
	RequiredAnchor  bool   `json:"requiredAnchor"`
	UsedByKnowledge bool   `json:"usedByKnowledge"`
	RelevantToUnit  bool   `json:"relevantToUnit"`
}

type novelWorkbenchV2ControlCardAuditValidation struct {
	Stage  string `json:"stage"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail,omitempty"`
}

type novelWorkbenchV2ControlCardEvidenceNormalization struct {
	InputEvidenceClaimCount  int                                             `json:"inputEvidenceClaimCount"`
	OutputEvidenceClaimCount int                                             `json:"outputEvidenceClaimCount"`
	EvidenceDecisions        []novelWorkbenchV2ControlCardEvidenceAuditEntry `json:"evidenceDecisions"`
}

// novelWorkbenchV2EpisodeWorkPackage deliberately excludes unrelated future
// roadmaps and ledgers. It keeps a unit prompt focused while leaving the
// complete canonical archive in durable storage for deterministic validation.
type novelWorkbenchV2EpisodeWorkPackage struct {
	ProjectOverview  novelWorkbenchV2ProjectOverview `json:"projectOverview"`
	Theme            novelWorkbenchV2Theme           `json:"theme"`
	WorldRules       []string                        `json:"worldRules"`
	WorldConstraints []string                        `json:"worldConstraints"`
	StyleGuide       novelWorkbenchV2StyleGuide      `json:"styleGuide"`
	Roadmap          novelWorkbenchV2Roadmap         `json:"roadmap"`
	Contract         novelWorkbenchV2EpisodeContract `json:"contract"`
	RelevantLedger   []novelWorkbenchV2LedgerAction  `json:"relevantLedger"`
	CastBible        []novelWorkbenchV2Character     `json:"castBible"`
	RelationshipMap  []novelWorkbenchV2Relationship  `json:"relationshipMap"`
	MainPlotlines    []novelWorkbenchV2Plotline      `json:"mainPlotlines"`
	DynamicState     novelWorkbenchV2State           `json:"dynamicState"`
	RecentWritingLog []novelWorkbenchV2WritingLog    `json:"recentWritingLog"`
}

type novelWorkbenchV2StateTransition struct {
	ID   string `json:"id"`
	From string `json:"from"`
	To   string `json:"to"`
	Note string `json:"note"`
}

type novelWorkbenchV2Writeback struct {
	NarrativeFacts      []novelWorkbenchV2NarrativeFact   `json:"narrativeFacts"`
	CharacterChanges    []novelWorkbenchV2StateTransition `json:"characterChanges"`
	LocationChanges     []novelWorkbenchV2LocationChange  `json:"locationChanges"`
	KnowledgeGrants     []novelWorkbenchV2KnowledgeGrant  `json:"knowledgeGrants"`
	EvidenceUpdates     []novelWorkbenchV2EvidenceUpdate  `json:"evidenceUpdates"`
	RelationshipChanges []novelWorkbenchV2StateTransition `json:"relationshipChanges"`
	PlotlineChanges     []novelWorkbenchV2StateTransition `json:"plotlineChanges"`
	ForeshadowChanges   []novelWorkbenchV2StateTransition `json:"foreshadowChanges"`
	PromiseChanges      []novelWorkbenchV2StateTransition `json:"promiseChanges"`
	NextUnitBridge      string                            `json:"nextUnitBridge"`
}

type novelWorkbenchV2LocationChange struct {
	CharacterID    string `json:"characterId"`
	FromLocationID string `json:"fromLocationId"`
	ToLocationID   string `json:"toLocationId"`
	Note           string `json:"note"`
}

type novelWorkbenchV2KnowledgeGrant struct {
	CharacterID string   `json:"characterId"`
	FactIDs     []string `json:"factIds"`
	SourceIDs   []string `json:"sourceIds"`
	Note        string   `json:"note"`
}

type novelWorkbenchV2EvidenceUpdate struct {
	EvidenceID string `json:"evidenceId"`
	From       string `json:"from"`
	To         string `json:"to"`
	Note       string `json:"note"`
}

type novelWorkbenchV2UnitOutput struct {
	Unit      int                       `json:"unit"`
	Title     string                    `json:"title"`
	Content   string                    `json:"content"`
	Summary   string                    `json:"summary"`
	Writeback novelWorkbenchV2Writeback `json:"writeback"`
}

type novelWorkbenchV2ReviewIssue struct {
	Code         string `json:"code"`
	Severity     string `json:"severity"`
	ReferenceID  string `json:"referenceId"`
	Evidence     string `json:"evidence"`
	RepairAction string `json:"repairAction"`
}

type novelWorkbenchV2ReviewReport struct {
	Unit           int                           `json:"unit"`
	OverallPass    bool                          `json:"overallPass"`
	Signals        map[string]int                `json:"signals"`
	BlockingIssues []novelWorkbenchV2ReviewIssue `json:"blockingIssues"`
	Warnings       []novelWorkbenchV2ReviewIssue `json:"warnings"`
	ReferenceIDs   []string                      `json:"referenceIds"`
	Verdict        string                        `json:"verdict"`
}

type RebuildNovelWorkbenchRequest struct {
	Config         map[string]any `json:"config"`
	LogicalModelID string         `json:"logicalModelId"`
}

func newNovelWorkbenchV2Control(brief novelWorkbenchBrief) novelWorkbenchV2Control {
	return novelWorkbenchV2Control{
		EngineVersion: novelWorkbenchV2EngineVersion,
		Brief:         brief,
		Documents: novelWorkbenchV2Documents{
			StyleGuide: novelWorkbenchV2StyleGuide{NarrativeVoice: strings.TrimSpace(brief.Tone)},
		},
	}
}

func newNovelWorkbenchV2State() novelWorkbenchV2State {
	return novelWorkbenchV2State{
		NarrativeFacts:      map[string]novelWorkbenchV2NarrativeFact{},
		CharacterStates:     map[string]string{},
		CharacterLocations:  map[string]string{},
		CharacterKnowledge:  map[string][]string{},
		RelationshipStates:  map[string]string{},
		PlotlineStates:      map[string]string{},
		ForeshadowStates:    map[string]string{},
		PromiseStates:       map[string]string{},
		EvidenceLevels:      map[string]string{},
		ForeshadowStartedAt: map[string]int{},
		PromiseStartedAt:    map[string]int{},
		OpenDebtIDs:         []string{},
		AuditTrail:          []novelWorkbenchAuditEntry{},
	}
}

func decodeNovelWorkbenchV2Control(raw string) (novelWorkbenchV2Control, error) {
	var control novelWorkbenchV2Control
	if strings.TrimSpace(raw) == "" {
		return control, errors.New("创作控制档案为空")
	}
	if err := json.Unmarshal([]byte(raw), &control); err != nil {
		return control, fmt.Errorf("创作控制档案损坏：%w", err)
	}
	if control.EngineVersion == 0 {
		control.EngineVersion = novelWorkbenchV2EngineVersion
	}
	return control, nil
}

func decodeNovelWorkbenchV2State(raw string) (novelWorkbenchV2State, error) {
	if strings.TrimSpace(raw) == "" {
		return newNovelWorkbenchV2State(), nil
	}
	var state novelWorkbenchV2State
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return state, fmt.Errorf("创作动态状态损坏：%w", err)
	}
	state = normalizeNovelWorkbenchV2State(state)
	return state, nil
}

func normalizeNovelWorkbenchV2State(state novelWorkbenchV2State) novelWorkbenchV2State {
	if state.NarrativeFacts == nil {
		state.NarrativeFacts = map[string]novelWorkbenchV2NarrativeFact{}
	}
	if state.CharacterStates == nil {
		state.CharacterStates = map[string]string{}
	}
	if state.CharacterLocations == nil {
		state.CharacterLocations = map[string]string{}
	}
	if state.CharacterKnowledge == nil {
		state.CharacterKnowledge = map[string][]string{}
	}
	if state.RelationshipStates == nil {
		state.RelationshipStates = map[string]string{}
	}
	if state.PlotlineStates == nil {
		state.PlotlineStates = map[string]string{}
	}
	if state.ForeshadowStates == nil {
		state.ForeshadowStates = map[string]string{}
	}
	if state.PromiseStates == nil {
		state.PromiseStates = map[string]string{}
	}
	if state.EvidenceLevels == nil {
		state.EvidenceLevels = map[string]string{}
	}
	if state.ForeshadowStartedAt == nil {
		state.ForeshadowStartedAt = map[string]int{}
	}
	if state.PromiseStartedAt == nil {
		state.PromiseStartedAt = map[string]int{}
	}
	if state.OpenDebtIDs == nil {
		state.OpenDebtIDs = []string{}
	}
	if state.AuditTrail == nil {
		state.AuditTrail = []novelWorkbenchAuditEntry{}
	}
	return state
}

func novelWorkbenchV2ControlReady(control novelWorkbenchV2Control) bool {
	return strings.TrimSpace(control.Title) != "" && strings.TrimSpace(control.Logline) != "" && len(control.Documents.ChapterRoadmap) > 0
}

func (s *Service) processNovelWorkbenchV2Task(ctx context.Context, task model.Task, run *model.NovelWorkbenchRun, input novelWorkbenchTaskInput, config map[string]any, resolvedConfig providerConfig) (map[string]interface{}, error) {
	switch input.Phase {
	case novelWorkbenchPhaseBootstrap:
		return s.processNovelWorkbenchV2Bootstrap(ctx, task, run, input, resolvedConfig)
	case novelWorkbenchPhaseUnit:
		return s.processNovelWorkbenchV2Unit(ctx, task, run, input, resolvedConfig)
	default:
		return nil, fmt.Errorf("创作控制系统不支持的任务阶段：%s", input.Phase)
	}
}

func (s *Service) updateNovelWorkbenchV2Progress(run *model.NovelWorkbenchRun, taskID string, pipeline string, stage string, progress int) error {
	run.PipelineStage = pipeline
	run.Stage = stage
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return err
	}
	return s.repo.UpdateTaskProgress(taskID, stage, progress)
}

func (s *Service) blockNovelWorkbenchV2Quality(run *model.NovelWorkbenchRun, taskID string, reason string) error {
	return s.blockNovelWorkbenchV2WithRecord(run, taskID, novelWorkbenchV2BlockClassStructure, "control", 0, reason, nil)
}

func (s *Service) blockNovelWorkbenchV2WithRecord(run *model.NovelWorkbenchRun, taskID string, class string, stage string, unit int, reason string, contract *novelWorkbenchV2EpisodeContract) error {
	class = strings.TrimSpace(class)
	if class == "" {
		class = novelWorkbenchV2BlockClassStructure
	}
	label := "结构/排程校验"
	if class == novelWorkbenchV2BlockClassNarrative {
		label = "正文/审稿质量"
	}
	reason = truncateRunes(strings.TrimSpace(reason), 4_000)
	if reason == "" {
		reason = "未提供具体原因"
	}
	run.Status = novelWorkbenchStatusFailed
	run.Stage = "质量拦截"
	run.PipelineStage = novelWorkbenchV2PipelineBlocked
	run.QualityBlockReason = label + "：" + reason
	run.LastError = run.QualityBlockReason
	run.CurrentTaskID = ""
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return err
	}
	blockRecord := novelWorkbenchV2QualityBlockRecord{Class: class, Stage: strings.TrimSpace(stage), Unit: unit, Reason: reason, Contract: contract}
	if err := s.createNovelWorkbenchV2Artifact(run, unit, "quality_block", 0, blockRecord, ""); err != nil {
		return err
	}
	return s.repo.UpdateTaskProgress(taskID, "质量拦截，已保留审稿记录", 100)
}

func (s *Service) createNovelWorkbenchV2Artifact(run *model.NovelWorkbenchRun, unit int, kind string, attempt int, content any, prompt string) error {
	encoded, err := json.Marshal(content)
	if err != nil {
		return err
	}
	now := time.Now()
	return s.repo.CreateNovelWorkbenchArtifact(&model.NovelWorkbenchArtifact{
		ID: newID(), RunID: run.ID, ProjectID: run.ProjectID, Unit: unit, Kind: kind, Attempt: attempt,
		Version: novelWorkbenchV2EngineVersion, ContentJSON: string(encoded), Prompt: strings.TrimSpace(prompt), CreatedAt: now, UpdatedAt: now,
	})
}

func (s *Service) processNovelWorkbenchV2Bootstrap(ctx context.Context, task model.Task, run *model.NovelWorkbenchRun, input novelWorkbenchTaskInput, resolvedConfig providerConfig) (map[string]interface{}, error) {
	control, err := decodeNovelWorkbenchV2Control(run.ControlJSON)
	if err != nil {
		return nil, err
	}
	if err := s.updateNovelWorkbenchV2Progress(run, task.ID, novelWorkbenchV2PipelineBootstrap, "建立全套创作控制档案", 24); err != nil {
		return nil, err
	}
	prompt := buildNovelWorkbenchV2BootstrapPrompt(control.Brief)
	var output novelWorkbenchV2BootstrapOutput
	var validationErr error
	var raw string
	for attempt := 1; attempt <= novelWorkbenchV2MaxDraftAttempts; attempt++ {
		generated, generateErr := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: prompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: novelWorkbenchBootstrapTokenLimit(control.Brief.TargetUnitCount)})
		if generateErr != nil {
			return nil, generateErr
		}
		raw = stringValue(generated["text"])
		// JSON omission means "zero value" for this attempt, not "reuse the
		// previous draft's value". Reusing a struct here lets repair drafts
		// inherit fields that the model deliberately removed.
		candidate := novelWorkbenchV2BootstrapOutput{}
		validationErr = decodeNovelWorkbenchV2JSONObject(raw, &candidate)
		if validationErr == nil {
			validationErr = validateNovelWorkbenchV2Bootstrap(&candidate, control.Brief)
		}
		if validationErr == nil {
			output = candidate
			break
		}
		repairPacket := newNovelWorkbenchV2RepairPacket("bootstrap", attempt, validationErr, control, novelWorkbenchV2EpisodeContract{}, nil, nil)
		if err := s.createNovelWorkbenchV2Artifact(run, 0, "bootstrap_attempt", attempt, map[string]any{"raw": raw, "error": validationErr.Error(), "repairPacket": repairPacket}, prompt); err != nil {
			return nil, err
		}
		if attempt < novelWorkbenchV2MaxDraftAttempts {
			if err := s.updateNovelWorkbenchV2Progress(run, task.ID, novelWorkbenchV2PipelineRepair, fmt.Sprintf("修复控制档案（第 %d/%d 轮）", attempt, novelWorkbenchV2MaxDraftAttempts-1), 40+attempt*12); err != nil {
				return nil, err
			}
			prompt = buildNovelWorkbenchV2BootstrapRepairPromptWithPacket(control.Brief, raw, repairPacket)
		}
	}
	if validationErr != nil {
		if err := s.blockNovelWorkbenchV2WithRecord(run, task.ID, novelWorkbenchV2BlockClassStructure, "bootstrap", 0, fmt.Sprintf("控制档案初稿加 %d 轮自动返修后仍未通过：%v", novelWorkbenchV2MaxRepairAttempts, validationErr), nil); err != nil {
			return nil, err
		}
		return map[string]interface{}{"projectId": run.ProjectID, "blocked": true, "reason": run.QualityBlockReason}, nil
	}

	control.EngineVersion = novelWorkbenchV2EngineVersion
	control.Title = output.Title
	control.Logline = output.Logline
	control.Documents = output.Documents
	planPreview, err := compileNovelWorkbenchV2Plan(control)
	if err != nil {
		return nil, err
	}
	state := initialNovelWorkbenchV2State(control)
	controlJSON, err := json.Marshal(control)
	if err != nil {
		return nil, err
	}
	stateJSON, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	run.ControlJSON = string(controlJSON)
	run.DynamicStateJSON = string(stateJSON)
	run.CompletedUnitCount = 0
	run.CurrentUnit = 0
	run.CurrentTaskID = ""
	run.LastError = ""
	run.QualityBlockReason = ""
	run.QualityPolicy = novelWorkbenchV2QualityPolicy
	prepareNovelWorkbenchContinuation(run, "控制档案完成，等待第 1 单元")
	run.PipelineStage = novelWorkbenchV2PipelinePrepare
	if err := s.createNovelWorkbenchV2Artifact(run, 0, "control_canon", 0, control, ""); err != nil {
		return nil, err
	}
	if err := s.createNovelWorkbenchV2Artifact(run, 0, "plan_preview", 0, planPreview, ""); err != nil {
		return nil, err
	}
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return nil, err
	}
	if err := s.repo.UpdateTaskProgress(task.ID, "保存控制档案", 90); err != nil {
		return nil, err
	}
	result := novelWorkbenchContinuationDirective(1, "生成第 1 单元")
	result["projectId"] = run.ProjectID
	result["title"] = control.Title
	result["logline"] = control.Logline
	result["roadmapCount"] = len(control.Documents.ChapterRoadmap)
	result["status"] = run.Status
	return result, nil
}

func (s *Service) processNovelWorkbenchV2Unit(ctx context.Context, task model.Task, run *model.NovelWorkbenchRun, input novelWorkbenchTaskInput, resolvedConfig providerConfig) (map[string]interface{}, error) {
	expectedUnit := run.CompletedUnitCount + 1
	if input.Unit != expectedUnit || input.Unit < 1 || input.Unit > run.TargetUnitCount {
		return nil, fmt.Errorf("当前应生成第 %d 单元，收到第 %d 单元", expectedUnit, input.Unit)
	}
	control, err := decodeNovelWorkbenchV2Control(run.ControlJSON)
	if err != nil {
		return nil, err
	}
	state, err := decodeNovelWorkbenchV2State(run.DynamicStateJSON)
	if err != nil {
		return nil, err
	}
	if err := validateNovelWorkbenchV2Control(&control, control.Brief); err != nil {
		return nil, fmt.Errorf("控制档案不完整：%w", err)
	}
	run.QualityPolicy = novelWorkbenchV2QualityPolicy
	if err := validateNovelWorkbenchV2Preflight(control, state, input.Unit); err != nil {
		if blockErr := s.blockNovelWorkbenchV2WithRecord(run, task.ID, novelWorkbenchV2BlockClassStructure, "preflight", input.Unit, err.Error(), nil); blockErr != nil {
			return nil, blockErr
		}
		return map[string]interface{}{"projectId": run.ProjectID, "blocked": true, "reason": run.QualityBlockReason}, nil
	}

	roadmap, found := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, input.Unit)
	if !found {
		return nil, fmt.Errorf("第 %d 单元没有路线图", input.Unit)
	}
	contract, contractErr := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, input.Unit)
	if contractErr != nil {
		if blockErr := s.blockNovelWorkbenchV2WithRecord(run, task.ID, novelWorkbenchV2BlockClassStructure, "contract", input.Unit, fmt.Sprintf("第 %d 单元创作契约无法编译：%v", input.Unit, contractErr), nil); blockErr != nil {
			return nil, blockErr
		}
		return map[string]interface{}{"projectId": run.ProjectID, "unit": input.Unit, "blocked": true, "reason": run.QualityBlockReason}, nil
	}
	if err := s.updateNovelWorkbenchV2Progress(run, task.ID, novelWorkbenchV2PipelinePrepare, fmt.Sprintf("第 %d 单元：生成控制卡", input.Unit), 16); err != nil {
		return nil, err
	}
	if err := s.createNovelWorkbenchV2Artifact(run, input.Unit, "episode_contract", 0, contract, ""); err != nil {
		return nil, err
	}
	spec, specErr := compileNovelWorkbenchV2EpisodeSpec(control, state, roadmap, contract, input.Unit)
	if specErr != nil {
		if blockErr := s.blockNovelWorkbenchV2WithRecord(run, task.ID, novelWorkbenchV2BlockClassStructure, "compiled_spec", input.Unit, fmt.Sprintf("编译式控制卡无法建立：%v", specErr), &contract); blockErr != nil {
			return nil, blockErr
		}
		return map[string]interface{}{"projectId": run.ProjectID, "unit": input.Unit, "blocked": true, "reason": run.QualityBlockReason}, nil
	}
	if err := s.createNovelWorkbenchV2Artifact(run, input.Unit, "episode_spec", 0, spec, ""); err != nil {
		return nil, err
	}
	if err := s.updateNovelWorkbenchV2Progress(run, task.ID, novelWorkbenchV2PipelinePrepare, fmt.Sprintf("第 %d 单元：生成创意增量", input.Unit), 20); err != nil {
		return nil, err
	}
	delta, cardPrompt, cardErr := s.generateNovelWorkbenchV2CreativeDelta(ctx, run, task, control, state, roadmap, spec, resolvedConfig)
	if cardErr != nil {
		if blockErr := s.blockNovelWorkbenchV2WithRecord(run, task.ID, novelWorkbenchV2BlockClassStructure, "creative_delta", input.Unit, fmt.Sprintf("创意增量未通过：%v", cardErr), &contract); blockErr != nil {
			return nil, blockErr
		}
		return map[string]interface{}{"projectId": run.ProjectID, "unit": input.Unit, "blocked": true, "reason": run.QualityBlockReason}, nil
	}
	card := spec.controlCard(delta)
	if cardValidationErr := validateNovelWorkbenchV2ControlCard(&card, control, roadmap, input.Unit); cardValidationErr != nil {
		return nil, fmt.Errorf("编译控制卡在提交前校验失败：%w", cardValidationErr)
	}
	if cardValidationErr := validateNovelWorkbenchV2EpisodeContractCard(contract, card); cardValidationErr != nil {
		return nil, fmt.Errorf("编译控制卡创作契约校验失败：%w", cardValidationErr)
	}
	if cardValidationErr := validateNovelWorkbenchV2FactContract(control, state, contract, &card); cardValidationErr != nil {
		return nil, fmt.Errorf("编译控制卡事实契约校验失败：%w", cardValidationErr)
	}
	compiledAudit := newNovelWorkbenchV2ControlCardAuditRecord(cardPrompt, input.Unit, 1, contract, novelWorkbenchV2ControlCardEvidenceNormalization{}, []novelWorkbenchV2ControlCardAuditValidation{
		{Stage: "compiled_episode_spec", Passed: true, Detail: "稳定 ID、事实契约和写回模板由系统编译。"},
		{Stage: "creative_delta", Passed: true, Detail: "模型仅提供本集戏剧节拍与因果表达。"},
		{Stage: "control_card", Passed: true},
		{Stage: "episode_contract", Passed: true},
		{Stage: "fact_contract", Passed: true},
	}, nil)
	compiledAudit.Outcome = "compiled"
	compiledAudit.Ruleset = "compiled-control-v3"
	if err := s.createNovelWorkbenchV2Artifact(run, input.Unit, "creative_delta", 1, delta, cardPrompt); err != nil {
		return nil, err
	}
	if err := s.createNovelWorkbenchV2Artifact(run, input.Unit, "control_card_audit", 1, compiledAudit, ""); err != nil {
		return nil, err
	}
	if err := s.createNovelWorkbenchV2Artifact(run, input.Unit, "control_card", 0, card, cardPrompt); err != nil {
		return nil, err
	}

	var accepted novelWorkbenchV2UnitOutput
	var acceptedReview novelWorkbenchV2ReviewReport
	var acceptedAttempt int
	var acceptedWriterPrompt string
	var previousRaw string
	var lastRepairPacket novelWorkbenchV2RepairPacket
	for attempt := 1; attempt <= novelWorkbenchV2MaxProseAttempts; attempt++ {
		pipeline := novelWorkbenchV2PipelineDraft
		stage := fmt.Sprintf("第 %d 单元：起草（第 %d/%d 轮）", input.Unit, attempt, novelWorkbenchV2MaxProseAttempts)
		if attempt > 1 {
			pipeline = novelWorkbenchV2PipelineRepair
			stage = fmt.Sprintf("第 %d 单元：定向返修（第 %d/%d 轮）", input.Unit, attempt-1, novelWorkbenchV2MaxProseAttempts-1)
		}
		if err := s.updateNovelWorkbenchV2Progress(run, task.ID, pipeline, stage, 28+(attempt-1)*26); err != nil {
			return nil, err
		}
		writerPrompt := buildNovelWorkbenchV2CompiledWriterPrompt(control, state, roadmap, spec, card)
		if attempt > 1 {
			writerPrompt = buildNovelWorkbenchV2CompiledRepairPrompt(control, state, roadmap, spec, card, previousRaw, lastRepairPacket)
		}
		generated, generateErr := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: writerPrompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: novelWorkbenchUnitTokenLimit(control.Brief.TargetUnitLength)})
		if generateErr != nil {
			return nil, generateErr
		}
		previousRaw = stringValue(generated["text"])
		var draft novelWorkbenchV2DraftContent
		validationErr := decodeNovelWorkbenchV2JSONObject(previousRaw, &draft)
		output := spec.materializeOutput(draft, card)
		if validationErr == nil {
			validationErr = validateNovelWorkbenchV2Unit(&output, control, state, card, input.Unit)
		}
		if validationErr == nil {
			validationErr = validateNovelWorkbenchV2EpisodeContractExecution(contract, output.Writeback)
		}
		if validationErr != nil {
			lastRepairPacket = newNovelWorkbenchV2RepairPacket("draft", attempt, validationErr, control, contract, &card, nil)
			if err := s.createNovelWorkbenchV2Artifact(run, input.Unit, "draft_rejected", attempt, map[string]any{"raw": previousRaw, "error": validationErr.Error(), "repairPacket": lastRepairPacket, "compiledWriteback": output.Writeback}, writerPrompt); err != nil {
				return nil, err
			}
			continue
		}

		if err := s.updateNovelWorkbenchV2Progress(run, task.ID, novelWorkbenchV2PipelineReview, fmt.Sprintf("第 %d 单元：独立审稿（第 %d/%d 轮）", input.Unit, attempt, novelWorkbenchV2MaxProseAttempts), 48+(attempt-1)*26); err != nil {
			return nil, err
		}
		reviewPrompt := buildNovelWorkbenchV2ReviewPromptWithContract(control, state, roadmap, contract, card, output, input.Unit)
		reviewGenerated, reviewErr := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: reviewPrompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: 5_000})
		if reviewErr != nil {
			return nil, reviewErr
		}
		reviewRaw := stringValue(reviewGenerated["text"])
		var review novelWorkbenchV2ReviewReport
		reviewValidationErr := decodeNovelWorkbenchV2JSONObject(reviewRaw, &review)
		discardedReviewReferenceIDs := []string{}
		if reviewValidationErr == nil {
			discardedReviewReferenceIDs = repairNovelWorkbenchV2ReviewReferences(&review, control)
			reviewValidationErr = validateNovelWorkbenchV2Review(&review, control, input.Unit)
		}
		hardErr := validateNovelWorkbenchV2Writeback(control, state, output.Writeback, input.Unit)
		if hardErr == nil {
			hardErr = validateNovelWorkbenchV2EpisodeContractExecution(contract, output.Writeback)
		}
		qualityErr := error(nil)
		if reviewValidationErr == nil {
			qualityErr = validateNovelWorkbenchV2Quality(review, input.Unit)
		}
		var repairPacket *novelWorkbenchV2RepairPacket
		if reviewValidationErr != nil || hardErr != nil || qualityErr != nil {
			repairErr := errors.New(strings.Join(nonEmptyStrings(errorText(reviewValidationErr), errorText(hardErr), errorText(qualityErr), novelWorkbenchV2ReviewRepairContext(review)), "\n"))
			packet := newNovelWorkbenchV2RepairPacket("review", attempt, repairErr, control, contract, &card, &review)
			repairPacket = &packet
			lastRepairPacket = packet
		}
		reviewRecord := map[string]any{"raw": reviewRaw, "review": review, "discardedInvalidReferenceIds": discardedReviewReferenceIDs, "reviewValidationError": errorText(reviewValidationErr), "hardValidationError": errorText(hardErr), "qualityError": errorText(qualityErr)}
		if repairPacket != nil {
			reviewRecord["repairPacket"] = *repairPacket
		}
		if err := s.createNovelWorkbenchV2Artifact(run, input.Unit, "review_report", attempt, reviewRecord, reviewPrompt); err != nil {
			return nil, err
		}
		if reviewValidationErr == nil && hardErr == nil && qualityErr == nil {
			accepted, acceptedReview, acceptedAttempt = output, review, attempt
			acceptedWriterPrompt = writerPrompt
			break
		}
	}
	if acceptedAttempt == 0 {
		reason := firstNonEmptyString(lastRepairPacket.Failure, "未得到可提交的正文。")
		if err := s.blockNovelWorkbenchV2WithRecord(run, task.ID, novelWorkbenchV2BlockClassNarrative, "review", input.Unit, fmt.Sprintf("第 %d 单元初稿加 %d 轮定向返修后仍未通过：%s", input.Unit, novelWorkbenchV2MaxProseAttempts-1, reason), &contract); err != nil {
			return nil, err
		}
		return map[string]interface{}{"projectId": run.ProjectID, "unit": input.Unit, "blocked": true, "reason": run.QualityBlockReason}, nil
	}

	if err := s.updateNovelWorkbenchV2Progress(run, task.ID, novelWorkbenchV2PipelineCommit, fmt.Sprintf("第 %d 单元：提交控制状态", input.Unit), 86); err != nil {
		return nil, err
	}
	nextState, stateErr := applyNovelWorkbenchV2Writeback(control, state, roadmap, card, input.Unit, novelWorkbenchUnitTitle(control.Brief.OutputMode, input.Unit, accepted.Title), accepted)
	if stateErr != nil {
		return nil, stateErr
	}
	if stateErr := validateNovelWorkbenchV2PostCommit(control, nextState, input.Unit); stateErr != nil {
		if err := s.blockNovelWorkbenchV2WithRecord(run, task.ID, novelWorkbenchV2BlockClassStructure, "post_commit", input.Unit, stateErr.Error(), &contract); err != nil {
			return nil, err
		}
		return map[string]interface{}{"projectId": run.ProjectID, "unit": input.Unit, "blocked": true, "reason": run.QualityBlockReason}, nil
	}
	title := novelWorkbenchUnitTitle(control.Brief.OutputMode, input.Unit, accepted.Title)
	control.Documents.WritingLog = append(control.Documents.WritingLog, novelWorkbenchV2WritingLog{Unit: input.Unit, Title: title, Summary: accepted.Summary, At: time.Now()})
	if len(control.Documents.WritingLog) > 64 {
		control.Documents.WritingLog = control.Documents.WritingLog[len(control.Documents.WritingLog)-64:]
	}
	controlJSON, err := json.Marshal(control)
	if err != nil {
		return nil, err
	}
	stateJSON, err := json.Marshal(nextState)
	if err != nil {
		return nil, err
	}
	run.ControlJSON = string(controlJSON)
	run.DynamicStateJSON = string(stateJSON)
	run.CompletedUnitCount = input.Unit
	run.CurrentUnit = input.Unit
	run.CurrentTaskID = ""
	run.LastError = ""
	run.QualityBlockReason = ""
	run.UpdatedAt = time.Now()
	completed := input.Unit >= run.TargetUnitCount
	if completed {
		run.Status = novelWorkbenchStatusCompleted
		run.Stage = "已完成"
		run.PipelineStage = novelWorkbenchV2PipelineCommit
	} else {
		prepareNovelWorkbenchContinuation(run, fmt.Sprintf("第 %d 单元已提交，等待第 %d 单元", input.Unit, input.Unit+1))
		run.PipelineStage = novelWorkbenchV2PipelinePrepare
	}
	commitRecord := map[string]any{"unit": input.Unit, "title": title, "attempt": acceptedAttempt, "summary": accepted.Summary, "review": acceptedReview, "committedAt": run.UpdatedAt}
	commitJSON, err := json.Marshal(commitRecord)
	if err != nil {
		return nil, err
	}
	unit := &model.ProjectUnit{ID: newID(), ProjectID: run.ProjectID, Kind: novelWorkbenchProjectUnitKind(control.Brief.OutputMode), Title: title, SourceText: strings.TrimSpace(accepted.Content), Status: model.ProjectUnitStatusReady, Position: input.Unit - 1, CreatedAt: run.UpdatedAt, UpdatedAt: run.UpdatedAt}
	acceptedJSON, err := json.Marshal(accepted)
	if err != nil {
		return nil, err
	}
	draftArtifact := model.NovelWorkbenchArtifact{ID: newID(), RunID: run.ID, ProjectID: run.ProjectID, Unit: input.Unit, Kind: "draft_accepted", Attempt: acceptedAttempt, Version: novelWorkbenchV2EngineVersion, ContentJSON: string(acceptedJSON), Prompt: acceptedWriterPrompt, CreatedAt: run.UpdatedAt, UpdatedAt: run.UpdatedAt}
	commitArtifact := model.NovelWorkbenchArtifact{ID: newID(), RunID: run.ID, ProjectID: run.ProjectID, Unit: input.Unit, Kind: "commit_record", Attempt: acceptedAttempt, Version: novelWorkbenchV2EngineVersion, ContentJSON: string(commitJSON), CreatedAt: run.UpdatedAt, UpdatedAt: run.UpdatedAt}
	if err := s.repo.CommitNovelWorkbenchUnit(run, unit, []model.NovelWorkbenchArtifact{draftArtifact, commitArtifact}); err != nil {
		return nil, err
	}
	if completed {
		return map[string]interface{}{"projectId": run.ProjectID, "unit": input.Unit, "title": title, "completed": true, "completedUnitCount": run.CompletedUnitCount}, nil
	}
	result := novelWorkbenchContinuationDirective(input.Unit+1, fmt.Sprintf("生成第 %d 单元", input.Unit+1))
	result["projectId"] = run.ProjectID
	result["unit"] = input.Unit
	result["title"] = title
	result["completed"] = false
	result["completedUnitCount"] = run.CompletedUnitCount
	return result, nil
}

func (s *Service) generateNovelWorkbenchV2ControlCard(ctx context.Context, run *model.NovelWorkbenchRun, task model.Task, control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, contract novelWorkbenchV2EpisodeContract, unit int, resolvedConfig providerConfig) (novelWorkbenchV2ControlCard, string, error) {
	prompt := buildNovelWorkbenchV2ControlCardPromptWithContract(control, state, roadmap, contract, unit, run.QualityBlockReason)
	var lastCard novelWorkbenchV2ControlCard
	var validationErr error
	for attempt := 1; attempt <= novelWorkbenchV2MaxDraftAttempts; attempt++ {
		generated, err := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: prompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: 4_000})
		if err != nil {
			return lastCard, prompt, err
		}
		raw := stringValue(generated["text"])
		// Each repair response is a complete replacement, not a patch. Decode
		// into a fresh value so omitted optional fields cannot leak from a
		// rejected earlier card into this candidate.
		candidate := novelWorkbenchV2ControlCard{}
		validationErr = decodeNovelWorkbenchV2JSONObject(raw, &candidate)
		validations := []novelWorkbenchV2ControlCardAuditValidation{novelWorkbenchV2ControlCardAuditValidationForError("json_decode", validationErr)}
		normalization := novelWorkbenchV2ControlCardEvidenceNormalization{}
		if validationErr == nil {
			normalization = normalizeNovelWorkbenchV2DecorativeEvidenceClaims(control, state, contract, &candidate)
			normalizationDetail := "未发现需要移除的冗余背景证据声明"
			if normalization.OutputEvidenceClaimCount < normalization.InputEvidenceClaimCount {
				normalizationDetail = fmt.Sprintf("移除了 %d 条未被本单元使用、且未推进证据等级的冗余背景证据声明", normalization.InputEvidenceClaimCount-normalization.OutputEvidenceClaimCount)
			}
			validations = append(validations, novelWorkbenchV2ControlCardAuditValidation{Stage: "evidence_scope_normalization", Passed: true, Detail: normalizationDetail})
		}
		lastCard = candidate
		if validationErr == nil {
			validationErr = validateNovelWorkbenchV2ControlCard(&candidate, control, roadmap, unit)
			validations = append(validations, novelWorkbenchV2ControlCardAuditValidationForError("control_card", validationErr))
		}
		if validationErr == nil {
			validationErr = validateNovelWorkbenchV2EpisodeContractCard(contract, candidate)
			validations = append(validations, novelWorkbenchV2ControlCardAuditValidationForError("episode_contract", validationErr))
		}
		if validationErr == nil {
			validationErr = validateNovelWorkbenchV2FactContract(control, state, contract, &candidate)
			validations = append(validations, novelWorkbenchV2ControlCardAuditValidationForError("fact_contract", validationErr))
		}
		audit := newNovelWorkbenchV2ControlCardAuditRecord(raw, unit, attempt, contract, normalization, validations, validationErr)
		if validationErr == nil {
			if err := s.createNovelWorkbenchV2Artifact(run, unit, "control_card_audit", attempt, audit, ""); err != nil {
				return lastCard, prompt, err
			}
			return candidate, prompt, nil
		}
		repairPacket := newNovelWorkbenchV2RepairPacket("control_card", attempt, validationErr, control, contract, &candidate, nil)
		if err := s.createNovelWorkbenchV2Artifact(run, unit, "control_card_rejected", attempt, map[string]any{"raw": raw, "error": validationErr.Error(), "contract": contract, "audit": audit, "repairPacket": repairPacket}, prompt); err != nil {
			return lastCard, prompt, err
		}
		if attempt < novelWorkbenchV2MaxDraftAttempts {
			if err := s.updateNovelWorkbenchV2Progress(run, task.ID, novelWorkbenchV2PipelineRepair, fmt.Sprintf("第 %d 单元：修复控制卡（第 %d/%d 轮）", unit, attempt, novelWorkbenchV2MaxDraftAttempts-1), 18+attempt*2); err != nil {
				return lastCard, prompt, err
			}
			prompt = buildNovelWorkbenchV2ControlCardRepairPromptWithContract(control, state, roadmap, contract, unit, raw, validationErr)
			packetJSON, _ := json.Marshal(repairPacket)
			prompt += "\n\n本次失败单：" + string(packetJSON)
		}
	}
	return lastCard, prompt, validationErr
}

func decodeNovelWorkbenchV2JSONObject(raw string, target any) error {
	return decodeNovelWorkbenchJSONObject(raw, target)
}

func validateNovelWorkbenchV2Bootstrap(output *novelWorkbenchV2BootstrapOutput, brief novelWorkbenchBrief) error {
	output.Title = strings.TrimSpace(output.Title)
	output.Logline = strings.TrimSpace(output.Logline)
	if output.Title == "" || output.Logline == "" {
		return errors.New("控制档案缺少作品标题或一句话卖点")
	}
	control := novelWorkbenchV2Control{EngineVersion: novelWorkbenchV2EngineVersion, Title: output.Title, Logline: output.Logline, Brief: brief, Documents: output.Documents}
	if err := validateNovelWorkbenchV2Control(&control, brief); err != nil {
		return err
	}
	_, err := compileNovelWorkbenchV2Plan(control)
	return err
}

func validateNovelWorkbenchV2Control(control *novelWorkbenchV2Control, brief novelWorkbenchBrief) error {
	control.Title = strings.TrimSpace(control.Title)
	control.Logline = strings.TrimSpace(control.Logline)
	if control.EngineVersion < novelWorkbenchV2EngineVersion {
		return errors.New("控制档案版本不是 V2")
	}
	if control.Title == "" || control.Logline == "" {
		return errors.New("控制档案缺少标题或一句话卖点")
	}
	docs := &control.Documents
	if strings.TrimSpace(docs.ProjectOverview.CorePromise) == "" || strings.TrimSpace(docs.ProjectOverview.CentralConflict) == "" || strings.TrimSpace(docs.ProjectOverview.EndingResolution) == "" || strings.TrimSpace(docs.ProjectOverview.AudiencePayoff) == "" {
		return errors.New("项目总览缺少核心承诺、核心冲突、结局或受众回报")
	}
	if strings.TrimSpace(docs.ThemeAndProposition.Theme) == "" || strings.TrimSpace(docs.ThemeAndProposition.Proposition) == "" || strings.TrimSpace(docs.ThemeAndProposition.Price) == "" {
		return errors.New("主题与命题档案不完整")
	}
	if len(cleanNovelWorkbenchV2Strings(docs.Worldbuilding.Rules)) == 0 || len(cleanNovelWorkbenchV2Strings(docs.Worldbuilding.Constraints)) == 0 {
		return errors.New("世界观缺少规则或边界")
	}
	if len(docs.CastBible) == 0 {
		return errors.New("角色卡不能为空")
	}
	known := newNovelWorkbenchV2KnownIDs()
	for index := range docs.CastBible {
		character := &docs.CastBible[index]
		character.ID = normalizeNovelWorkbenchV2ID(character.ID)
		character.Name = strings.TrimSpace(character.Name)
		character.Role = strings.TrimSpace(character.Role)
		character.Desire = strings.TrimSpace(character.Desire)
		character.Fear = strings.TrimSpace(character.Fear)
		character.Voice = strings.TrimSpace(character.Voice)
		if character.ID == "" || character.Name == "" || character.Role == "" || character.Desire == "" || character.Fear == "" || character.Voice == "" {
			return fmt.Errorf("第 %d 位角色缺少稳定 ID 或核心设定", index+1)
		}
		if character.InitialState == "" {
			character.InitialState = "未触发"
		}
		if err := known.add("角色", character.ID, known.characters); err != nil {
			return err
		}
	}
	for index := range docs.RelationshipMap {
		relationship := &docs.RelationshipMap[index]
		relationship.ID = normalizeNovelWorkbenchV2ID(relationship.ID)
		relationship.FromID = normalizeNovelWorkbenchV2ID(relationship.FromID)
		relationship.ToID = normalizeNovelWorkbenchV2ID(relationship.ToID)
		if relationship.ID == "" || relationship.FromID == "" || relationship.ToID == "" || strings.TrimSpace(relationship.Description) == "" {
			return fmt.Errorf("第 %d 条关系缺少 ID、双方角色或关系说明", index+1)
		}
		if _, ok := known.characters[relationship.FromID]; !ok {
			return fmt.Errorf("关系 %s 引用了不存在的角色 %s", relationship.ID, relationship.FromID)
		}
		if _, ok := known.characters[relationship.ToID]; !ok {
			return fmt.Errorf("关系 %s 引用了不存在的角色 %s", relationship.ID, relationship.ToID)
		}
		if relationship.InitialState == "" {
			relationship.InitialState = "未触发"
		}
		if err := known.add("关系", relationship.ID, known.relationships); err != nil {
			return err
		}
	}
	if len(docs.MainPlotlines) == 0 {
		return errors.New("主线账本不能为空")
	}
	for index := range docs.MainPlotlines {
		plotline := &docs.MainPlotlines[index]
		plotline.ID = normalizeNovelWorkbenchV2ID(plotline.ID)
		plotline.Title = strings.TrimSpace(plotline.Title)
		plotline.Goal = strings.TrimSpace(plotline.Goal)
		if plotline.ID == "" || plotline.Title == "" || plotline.Goal == "" || plotline.ResolutionByUnit < 1 || plotline.ResolutionByUnit > brief.TargetUnitCount {
			return fmt.Errorf("第 %d 条主线缺少稳定 ID、目标或有效收束集数", index+1)
		}
		if plotline.InitialState == "" {
			plotline.InitialState = "open"
		}
		if err := known.add("主线", plotline.ID, known.plotlines); err != nil {
			return err
		}
	}
	if brief.TargetUnitCount > 1 && (len(docs.ForeshadowLedger) == 0 || len(docs.ReaderPromiseLedger) == 0) {
		return errors.New("长线作品必须至少建立一项伏笔和一项读者承诺")
	}
	if err := validateNovelWorkbenchV2Ledger("伏笔", docs.ForeshadowLedger, brief.TargetUnitCount, known, known.foreshadows); err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2Ledger("读者承诺", docs.ReaderPromiseLedger, brief.TargetUnitCount, known, known.promises); err != nil {
		return err
	}
	if len(docs.ChapterRoadmap) == 0 {
		return errors.New("分集路线图不能为空")
	}
	sort.SliceStable(docs.ChapterRoadmap, func(left, right int) bool {
		return docs.ChapterRoadmap[left].StartUnit < docs.ChapterRoadmap[right].StartUnit
	})
	for index := range docs.ChapterRoadmap {
		roadmap := &docs.ChapterRoadmap[index]
		roadmap.ID = normalizeNovelWorkbenchV2ID(roadmap.ID)
		roadmap.Title = strings.TrimSpace(roadmap.Title)
		roadmap.Mission = strings.TrimSpace(roadmap.Mission)
		roadmap.Escalation = strings.TrimSpace(roadmap.Escalation)
		roadmap.KeyTurn = strings.TrimSpace(roadmap.KeyTurn)
		roadmap.ExitDebt = strings.TrimSpace(roadmap.ExitDebt)
		if roadmap.ID == "" || roadmap.Title == "" || roadmap.Mission == "" || roadmap.Escalation == "" || roadmap.KeyTurn == "" || roadmap.ExitDebt == "" {
			return fmt.Errorf("第 %d 段路线图缺少 ID、标题、任务、升级、转折或债务", index+1)
		}
		if roadmap.StartUnit < 1 || roadmap.EndUnit < roadmap.StartUnit || roadmap.EndUnit > brief.TargetUnitCount {
			return fmt.Errorf("路线图 %s 的范围无效", roadmap.ID)
		}
		if index == 0 && roadmap.StartUnit != 1 {
			return errors.New("第一段路线图必须从第 1 单元开始")
		}
		if index > 0 && roadmap.StartUnit != docs.ChapterRoadmap[index-1].EndUnit+1 {
			return errors.New("路线图必须连续覆盖，不能遗漏或重叠")
		}
		roadmap.PlannedIntroductions = normalizeNovelWorkbenchV2IDs(roadmap.PlannedIntroductions)
		roadmap.PlannedPayoffs = normalizeNovelWorkbenchV2IDs(roadmap.PlannedPayoffs)
		if err := known.add("路线图", roadmap.ID, known.roadmaps); err != nil {
			return err
		}
		if err := validateNovelWorkbenchV2References("路线图引入", roadmap.PlannedIntroductions, known); err != nil {
			return err
		}
		if err := validateNovelWorkbenchV2References("路线图回收", roadmap.PlannedPayoffs, known); err != nil {
			return err
		}
	}
	if docs.ChapterRoadmap[len(docs.ChapterRoadmap)-1].EndUnit != brief.TargetUnitCount {
		return fmt.Errorf("路线图必须覆盖至第 %d 单元", brief.TargetUnitCount)
	}
	docs.StyleGuide.NarrativeVoice = strings.TrimSpace(docs.StyleGuide.NarrativeVoice)
	docs.StyleGuide.PacingRules = cleanNovelWorkbenchV2Strings(docs.StyleGuide.PacingRules)
	docs.StyleGuide.ForbiddenDrift = cleanNovelWorkbenchV2Strings(docs.StyleGuide.ForbiddenDrift)
	if docs.StyleGuide.NarrativeVoice == "" || len(docs.StyleGuide.PacingRules) == 0 || len(docs.StyleGuide.ForbiddenDrift) == 0 {
		return errors.New("风格指南缺少叙事声音、节奏规则或禁忌")
	}
	return nil
}

type novelWorkbenchV2KnownIDs struct {
	all           map[string]struct{}
	characters    map[string]struct{}
	relationships map[string]struct{}
	plotlines     map[string]struct{}
	foreshadows   map[string]struct{}
	promises      map[string]struct{}
	roadmaps      map[string]struct{}
}

func newNovelWorkbenchV2KnownIDs() novelWorkbenchV2KnownIDs {
	return novelWorkbenchV2KnownIDs{all: map[string]struct{}{}, characters: map[string]struct{}{}, relationships: map[string]struct{}{}, plotlines: map[string]struct{}{}, foreshadows: map[string]struct{}{}, promises: map[string]struct{}{}, roadmaps: map[string]struct{}{}}
}

func (known novelWorkbenchV2KnownIDs) add(label string, id string, destination map[string]struct{}) error {
	if _, exists := known.all[id]; exists {
		return fmt.Errorf("%s ID %s 重复", label, id)
	}
	known.all[id] = struct{}{}
	destination[id] = struct{}{}
	return nil
}

func novelWorkbenchV2KnownIDsForControl(control novelWorkbenchV2Control) (novelWorkbenchV2KnownIDs, error) {
	known := newNovelWorkbenchV2KnownIDs()
	for _, item := range control.Documents.CastBible {
		if err := known.add("角色", item.ID, known.characters); err != nil {
			return known, err
		}
	}
	for _, item := range control.Documents.RelationshipMap {
		if err := known.add("关系", item.ID, known.relationships); err != nil {
			return known, err
		}
	}
	for _, item := range control.Documents.MainPlotlines {
		if err := known.add("主线", item.ID, known.plotlines); err != nil {
			return known, err
		}
	}
	for _, item := range control.Documents.ForeshadowLedger {
		if err := known.add("伏笔", item.ID, known.foreshadows); err != nil {
			return known, err
		}
	}
	for _, item := range control.Documents.ReaderPromiseLedger {
		if err := known.add("读者承诺", item.ID, known.promises); err != nil {
			return known, err
		}
	}
	for _, item := range control.Documents.ChapterRoadmap {
		if err := known.add("路线图", item.ID, known.roadmaps); err != nil {
			return known, err
		}
	}
	return known, nil
}

func validateNovelWorkbenchV2Ledger(label string, ledger []novelWorkbenchV2LedgerItem, target int, known novelWorkbenchV2KnownIDs, destination map[string]struct{}) error {
	for index := range ledger {
		item := &ledger[index]
		item.ID = normalizeNovelWorkbenchV2ID(item.ID)
		item.Description = strings.TrimSpace(item.Description)
		if item.ID == "" || item.Description == "" || item.IntroducedByUnit < 1 || item.IntroducedByUnit > target || item.PayoffByUnit <= item.IntroducedByUnit || item.PayoffByUnit > target {
			return fmt.Errorf("第 %d 条%s缺少稳定 ID、描述或有效引入/回收集数", index+1, label)
		}
		if err := known.add(label, item.ID, destination); err != nil {
			return err
		}
		item.OwnerIDs = normalizeNovelWorkbenchV2IDs(item.OwnerIDs)
		for _, ownerID := range item.OwnerIDs {
			if _, exists := known.characters[normalizeNovelWorkbenchV2ID(ownerID)]; !exists {
				return fmt.Errorf("%s %s 引用了不存在的角色 %s", label, item.ID, ownerID)
			}
		}
	}
	return nil
}

func validateNovelWorkbenchV2References(label string, refs []string, known novelWorkbenchV2KnownIDs) error {
	for _, raw := range refs {
		id := normalizeNovelWorkbenchV2ID(raw)
		if id == "" {
			return fmt.Errorf("%s包含空引用", label)
		}
		if _, exists := known.all[id]; !exists {
			return fmt.Errorf("%s引用了不存在的 ID %s", label, id)
		}
	}
	return nil
}

// repairNovelWorkbenchV2ReviewReferences only repairs optional audit pointers.
// A reviewer may describe a document field such as styleGuide as if it were a
// stable ID. The raw response remains in the audit artifact, but the canonical
// report must only retain references that can be resolved by the control core.
func repairNovelWorkbenchV2ReviewReferences(review *novelWorkbenchV2ReviewReport, control novelWorkbenchV2Control) []string {
	known, err := novelWorkbenchV2KnownIDsForControl(control)
	if err != nil {
		return nil
	}
	discarded := map[string]struct{}{}
	keepReference := func(raw string) (string, bool) {
		id := normalizeNovelWorkbenchV2ID(raw)
		if id == "" {
			return "", false
		}
		if _, exists := known.all[id]; !exists {
			discarded[id] = struct{}{}
			return "", false
		}
		return id, true
	}

	seen := map[string]struct{}{}
	retained := make([]string, 0, len(review.ReferenceIDs))
	for _, raw := range review.ReferenceIDs {
		if id, ok := keepReference(raw); ok {
			if _, exists := seen[id]; !exists {
				seen[id] = struct{}{}
				retained = append(retained, id)
			}
		}
	}
	review.ReferenceIDs = retained

	repairIssues := func(issues []novelWorkbenchV2ReviewIssue) {
		for index := range issues {
			if id, ok := keepReference(issues[index].ReferenceID); ok {
				issues[index].ReferenceID = id
			} else {
				issues[index].ReferenceID = ""
			}
		}
	}
	repairIssues(review.BlockingIssues)
	repairIssues(review.Warnings)

	result := make([]string, 0, len(discarded))
	for id := range discarded {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

func normalizeNovelWorkbenchV2ID(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func cleanNovelWorkbenchV2Strings(values []string) []string {
	cleaned := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		cleaned = append(cleaned, value)
	}
	return cleaned
}

func normalizeNovelWorkbenchV2IDs(values []string) []string {
	cleaned := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, raw := range values {
		id := normalizeNovelWorkbenchV2ID(raw)
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		cleaned = append(cleaned, id)
	}
	return cleaned
}

func initialNovelWorkbenchV2State(control novelWorkbenchV2Control) novelWorkbenchV2State {
	state := newNovelWorkbenchV2State()
	for _, character := range control.Documents.CastBible {
		state.CharacterStates[character.ID] = firstNonEmptyString(strings.TrimSpace(character.InitialState), "未触发")
		if locationID := novelWorkbenchV2ExtractLocationID(character.InitialState); locationID != "" {
			state.CharacterLocations[character.ID] = locationID
		}
	}
	for _, relationship := range control.Documents.RelationshipMap {
		state.RelationshipStates[relationship.ID] = firstNonEmptyString(strings.TrimSpace(relationship.InitialState), "未触发")
	}
	for _, plotline := range control.Documents.MainPlotlines {
		state.PlotlineStates[plotline.ID] = firstNonEmptyString(strings.TrimSpace(plotline.InitialState), "open")
	}
	for _, item := range control.Documents.ForeshadowLedger {
		state.ForeshadowStates[item.ID] = "planned"
		state.EvidenceLevels[item.ID] = "unseen"
	}
	for _, item := range control.Documents.ReaderPromiseLedger {
		state.PromiseStates[item.ID] = "planned"
		state.EvidenceLevels[item.ID] = "unseen"
	}
	state.OpenDebtIDs = novelWorkbenchV2OpenDebtIDs(control, state)
	return state
}

func novelWorkbenchV2ExtractLocationID(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	start := strings.Index(value, "loc_")
	if start < 0 {
		return ""
	}
	end := start
	for end < len(value) {
		character := value[end]
		if (character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || character == '_' {
			end++
			continue
		}
		break
	}
	if end == start+len("loc_") {
		return ""
	}
	return value[start:end]
}

func novelWorkbenchV2CurrentCharacterLocation(state novelWorkbenchV2State, characterID string) string {
	characterID = normalizeNovelWorkbenchV2ID(characterID)
	if value := normalizeNovelWorkbenchV2ID(state.CharacterLocations[characterID]); value != "" {
		return value
	}
	return novelWorkbenchV2ExtractLocationID(state.CharacterStates[characterID])
}

func novelWorkbenchV2KnownLocationIDs(control novelWorkbenchV2Control, state novelWorkbenchV2State) map[string]struct{} {
	known := map[string]struct{}{}
	for id := range novelWorkbenchV2LocationCatalog(control, state) {
		known[id] = struct{}{}
	}
	return known
}

// novelWorkbenchV2LocationCatalog keeps the durable location identifier apart
// from its human-readable name. A control card can therefore record a detail
// such as "祖祠外门" without turning that temporary sub-location into a new
// long-running worldbuilding entity.
func novelWorkbenchV2LocationCatalog(control novelWorkbenchV2Control, state novelWorkbenchV2State) map[string]string {
	catalog := map[string]string{}
	for _, raw := range control.Documents.Worldbuilding.Locations {
		id := novelWorkbenchV2ExtractLocationID(raw)
		if id == "" {
			id = normalizeNovelWorkbenchV2ID(raw)
		}
		if id == "" {
			continue
		}
		label := novelWorkbenchV2LocationLabel(raw)
		if label == "" {
			label = id
		}
		catalog[id] = label
	}
	for characterID := range state.CharacterStates {
		locationID := novelWorkbenchV2CurrentCharacterLocation(state, characterID)
		if locationID == "" {
			continue
		}
		if _, exists := catalog[locationID]; !exists {
			catalog[locationID] = locationID
		}
	}
	return catalog
}

func novelWorkbenchV2LocationLabel(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if id := novelWorkbenchV2ExtractLocationID(raw); id != "" {
		if index := strings.Index(strings.ToLower(raw), id); index >= 0 {
			raw = strings.TrimLeft(strings.TrimSpace(raw[index+len(id):]), "：: -—")
		}
	}
	if index := strings.IndexAny(raw, "，,。；;（("); index >= 0 {
		raw = raw[:index]
	}
	return strings.TrimSpace(raw)
}

func novelWorkbenchV2ComparableLocationText(raw string) string {
	label := novelWorkbenchV2LocationLabel(raw)
	var builder strings.Builder
	for _, character := range label {
		if unicode.IsLetter(character) || unicode.IsDigit(character) {
			builder.WriteRune(unicode.ToLower(character))
		}
	}
	return builder.String()
}

func novelWorkbenchV2LocationAliasScore(value string, anchor string) int {
	value = novelWorkbenchV2ComparableLocationText(value)
	anchor = novelWorkbenchV2ComparableLocationText(anchor)
	if value == "" || anchor == "" {
		return 0
	}
	if strings.Contains(value, anchor) {
		return len([]rune(anchor))
	}
	if strings.Contains(anchor, value) {
		return len([]rune(value))
	}
	anchorRunes := []rune(anchor)
	for size := len(anchorRunes); size >= 2; size-- {
		for start := 0; start+size <= len(anchorRunes); start++ {
			if strings.Contains(value, string(anchorRunes[start:start+size])) {
				return size
			}
		}
	}
	return 0
}

// novelWorkbenchV2CanonicalLocationID accepts a human-readable detail only
// when it maps to exactly one declared location. Stable-looking but unknown
// loc_ IDs remain errors instead of being guessed into another anchor.
func novelWorkbenchV2CanonicalLocationID(control novelWorkbenchV2Control, state novelWorkbenchV2State, raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", true
	}
	catalog := novelWorkbenchV2LocationCatalog(control, state)
	normalized := normalizeNovelWorkbenchV2ID(raw)
	if _, exists := catalog[normalized]; exists {
		return normalized, true
	}
	if stableID := novelWorkbenchV2ExtractLocationID(raw); stableID != "" {
		if _, exists := catalog[stableID]; exists {
			return stableID, true
		}
		return normalized, false
	}
	bestID := ""
	bestScore := 0
	ambiguous := false
	for id, label := range catalog {
		score := novelWorkbenchV2LocationAliasScore(raw, label)
		if score < 2 {
			continue
		}
		if score > bestScore {
			bestID = id
			bestScore = score
			ambiguous = false
			continue
		}
		if score == bestScore && id != bestID {
			ambiguous = true
		}
	}
	if bestID != "" && !ambiguous {
		return bestID, true
	}
	return normalized, false
}

func novelWorkbenchV2LocationAnchorList(control novelWorkbenchV2Control, state novelWorkbenchV2State) []string {
	catalog := novelWorkbenchV2LocationCatalog(control, state)
	ids := make([]string, 0, len(catalog))
	for id := range catalog {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	anchors := make([]string, 0, len(ids))
	for _, id := range ids {
		label := strings.TrimSpace(catalog[id])
		if label == "" || normalizeNovelWorkbenchV2ID(label) == id {
			anchors = append(anchors, id)
			continue
		}
		anchors = append(anchors, fmt.Sprintf("%s（%s）", id, label))
	}
	return anchors
}

func novelWorkbenchV2EvidenceLevelRank(level string) int {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "unseen":
		return 0
	case "lead":
		return 1
	case "corroborated":
		return 2
	case "proven":
		return 3
	default:
		return -1
	}
}

func novelWorkbenchV2EffectiveEvidenceLevel(control novelWorkbenchV2Control, state novelWorkbenchV2State, evidenceID string) string {
	evidenceID = normalizeNovelWorkbenchV2ID(evidenceID)
	if level := strings.ToLower(strings.TrimSpace(state.EvidenceLevels[evidenceID])); novelWorkbenchV2EvidenceLevelRank(level) >= 0 {
		return level
	}
	if state.ForeshadowStates[evidenceID] != "" && state.ForeshadowStates[evidenceID] != "planned" {
		return "lead"
	}
	if state.PromiseStates[evidenceID] != "" && state.PromiseStates[evidenceID] != "planned" {
		return "lead"
	}
	return "unseen"
}

func novelWorkbenchV2LedgerItemForID(control novelWorkbenchV2Control, id string) (novelWorkbenchV2LedgerItem, bool) {
	id = normalizeNovelWorkbenchV2ID(id)
	for _, item := range control.Documents.ForeshadowLedger {
		if item.ID == id {
			return item, true
		}
	}
	for _, item := range control.Documents.ReaderPromiseLedger {
		if item.ID == id {
			return item, true
		}
	}
	return novelWorkbenchV2LedgerItem{}, false
}

func novelWorkbenchV2CharacterKnowsFact(control novelWorkbenchV2Control, state novelWorkbenchV2State, characterID string, factID string) bool {
	characterID = normalizeNovelWorkbenchV2ID(characterID)
	factID = normalizeNovelWorkbenchV2ID(factID)
	for _, knownFactID := range state.CharacterKnowledge[characterID] {
		if normalizeNovelWorkbenchV2ID(knownFactID) == factID {
			return true
		}
	}
	item, found := novelWorkbenchV2LedgerItemForID(control, factID)
	if !found {
		return false
	}
	for _, ownerID := range item.OwnerIDs {
		if normalizeNovelWorkbenchV2ID(ownerID) != characterID {
			continue
		}
		if status, exists := state.ForeshadowStates[factID]; exists && status != "planned" {
			return true
		}
		if status, exists := state.PromiseStates[factID]; exists && status != "planned" {
			return true
		}
	}
	return false
}

// compileNovelWorkbenchV2Plan turns every immutable ledger deadline into an
// inspectable lifecycle schedule before prose generation starts. This catches
// impossible or overloaded plans during bootstrap, when they are still cheap
// to repair, instead of discovering them dozens of units later.
func compileNovelWorkbenchV2Plan(control novelWorkbenchV2Control) (novelWorkbenchV2PlanPreview, error) {
	byUnit := map[int]*novelWorkbenchV2PlanUnit{}
	preview := novelWorkbenchV2PlanPreview{Version: novelWorkbenchV2PlanVersion, TargetUnitCount: control.Brief.TargetUnitCount}
	unitPlan := func(unit int) (*novelWorkbenchV2PlanUnit, error) {
		if existing := byUnit[unit]; existing != nil {
			return existing, nil
		}
		roadmap, found := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, unit)
		if !found {
			return nil, fmt.Errorf("第 %d 单元没有可编译的路线图", unit)
		}
		plan := &novelWorkbenchV2PlanUnit{Unit: unit, RoadmapID: roadmap.ID, Introductions: []string{}, Payoffs: []string{}}
		byUnit[unit] = plan
		return plan, nil
	}
	plansAction := func(values []string, id string) bool {
		for _, value := range values {
			if normalizeNovelWorkbenchV2ID(value) == id {
				return true
			}
		}
		return false
	}
	schedule := func(label string, item novelWorkbenchV2LedgerItem) error {
		introduction, err := unitPlan(item.IntroducedByUnit)
		if err != nil {
			return err
		}
		if !plansAction(control.Documents.ChapterRoadmapForID(introduction.RoadmapID).PlannedIntroductions, item.ID) {
			return fmt.Errorf("%s %s 的第 %d 单元引入没有写入对应路线图", label, item.ID, item.IntroducedByUnit)
		}
		introduction.Introductions = append(introduction.Introductions, item.ID)

		payoff, err := unitPlan(item.PayoffByUnit)
		if err != nil {
			return err
		}
		if !plansAction(control.Documents.ChapterRoadmapForID(payoff.RoadmapID).PlannedPayoffs, item.ID) {
			return fmt.Errorf("%s %s 的第 %d 单元回收没有写入对应路线图", label, item.ID, item.PayoffByUnit)
		}
		payoff.Payoffs = append(payoff.Payoffs, item.ID)
		return nil
	}
	for _, item := range control.Documents.ForeshadowLedger {
		if err := schedule("伏笔", item); err != nil {
			return preview, err
		}
	}
	for _, item := range control.Documents.ReaderPromiseLedger {
		if err := schedule("读者承诺", item); err != nil {
			return preview, err
		}
	}
	units := make([]int, 0, len(byUnit))
	for unit := range byUnit {
		units = append(units, unit)
	}
	sort.Ints(units)
	for _, unit := range units {
		plan := byUnit[unit]
		sort.Strings(plan.Introductions)
		sort.Strings(plan.Payoffs)
		if len(plan.Introductions)+len(plan.Payoffs) > novelWorkbenchV2MaxLedgerActions {
			return preview, fmt.Errorf("第 %d 单元需要处理 %d 项账本动作，超过每单元 %d 项的创作容量", unit, len(plan.Introductions)+len(plan.Payoffs), novelWorkbenchV2MaxLedgerActions)
		}
		preview.Units = append(preview.Units, *plan)
	}
	return preview, nil
}

// ChapterRoadmapForID is intentionally a tiny lookup helper used by the plan
// compiler after validation has already established roadmap ID uniqueness.
func (documents novelWorkbenchV2Documents) ChapterRoadmapForID(id string) novelWorkbenchV2Roadmap {
	for _, roadmap := range documents.ChapterRoadmap {
		if roadmap.ID == id {
			return roadmap
		}
	}
	return novelWorkbenchV2Roadmap{}
}

func novelWorkbenchV2LedgerActionForItem(item novelWorkbenchV2LedgerItem, ledger string, deadline int) novelWorkbenchV2LedgerAction {
	owners := append([]string{}, item.OwnerIDs...)
	sort.Strings(owners)
	return novelWorkbenchV2LedgerAction{ID: item.ID, Ledger: ledger, Description: item.Description, OwnerIDs: owners, DeadlineUnit: deadline}
}

// compileNovelWorkbenchV2EpisodeContract derives the exact non-negotiable
// lifecycle actions for one unit. It never asks the language model to infer a
// due ID from an arbitrary position in the full canonical archive.
func compileNovelWorkbenchV2EpisodeContract(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, unit int) (novelWorkbenchV2EpisodeContract, error) {
	contract := novelWorkbenchV2EpisodeContract{
		Version:               novelWorkbenchV2ContractVersion,
		Unit:                  unit,
		RoadmapID:             roadmap.ID,
		RoadmapTitle:          roadmap.Title,
		RequiredIntroductions: []novelWorkbenchV2LedgerAction{},
		RequiredPayoffs:       []novelWorkbenchV2LedgerAction{},
		RelevantLedgerIDs:     []string{},
		RequiredCharacterIDs:  []string{},
		StateLocks:            []novelWorkbenchV2StateLock{},
		OpenDebtIDs:           []string{},
		PriorUnitBridge:       strings.TrimSpace(state.NextUnitBridge),
	}
	if contract.PriorUnitBridge != "" {
		contract.StateLocks = append(contract.StateLocks, novelWorkbenchV2StateLock{
			ID:    fmt.Sprintf("bridge_unit_%d", state.CompletedUnit),
			Kind:  "prior_unit_bridge",
			State: contract.PriorUnitBridge,
		})
	}
	relevant := map[string]struct{}{}
	characters := map[string]struct{}{}
	addActionOwners := func(action novelWorkbenchV2LedgerAction) {
		relevant[action.ID] = struct{}{}
		for _, ownerID := range action.OwnerIDs {
			characters[ownerID] = struct{}{}
		}
	}
	consider := func(item novelWorkbenchV2LedgerItem, ledger string, status string) {
		if status == "planned" && item.IntroducedByUnit == unit {
			action := novelWorkbenchV2LedgerActionForItem(item, ledger, item.IntroducedByUnit)
			contract.RequiredIntroductions = append(contract.RequiredIntroductions, action)
			addActionOwners(action)
		}
		if status != "paid" && item.PayoffByUnit == unit {
			action := novelWorkbenchV2LedgerActionForItem(item, ledger, item.PayoffByUnit)
			contract.RequiredPayoffs = append(contract.RequiredPayoffs, action)
			addActionOwners(action)
		}
		if status != "paid" && (status != "planned" || item.IntroducedByUnit <= roadmap.EndUnit || item.PayoffByUnit <= roadmap.EndUnit) {
			// Relevant ledger context belongs in the work package, but it must
			// not make every future owner a mandatory on-screen participant.
			// Only an action due in this unit creates a hard cast requirement.
			relevant[item.ID] = struct{}{}
		}
	}
	for _, item := range control.Documents.ForeshadowLedger {
		consider(item, "foreshadow", state.ForeshadowStates[item.ID])
	}
	for _, item := range control.Documents.ReaderPromiseLedger {
		consider(item, "reader_promise", state.PromiseStates[item.ID])
	}
	for id := range relevant {
		contract.RelevantLedgerIDs = append(contract.RelevantLedgerIDs, id)
	}
	for id := range characters {
		contract.RequiredCharacterIDs = append(contract.RequiredCharacterIDs, id)
		if value := strings.TrimSpace(state.CharacterStates[id]); value != "" {
			contract.StateLocks = append(contract.StateLocks, novelWorkbenchV2StateLock{ID: id, Kind: "character", State: value})
		}
	}
	for _, id := range state.OpenDebtIDs {
		if _, exists := relevant[normalizeNovelWorkbenchV2ID(id)]; exists {
			contract.OpenDebtIDs = append(contract.OpenDebtIDs, normalizeNovelWorkbenchV2ID(id))
		}
	}
	sort.Slice(contract.RequiredIntroductions, func(left, right int) bool {
		return contract.RequiredIntroductions[left].ID < contract.RequiredIntroductions[right].ID
	})
	sort.Slice(contract.RequiredPayoffs, func(left, right int) bool {
		return contract.RequiredPayoffs[left].ID < contract.RequiredPayoffs[right].ID
	})
	sort.Strings(contract.RelevantLedgerIDs)
	sort.Strings(contract.RequiredCharacterIDs)
	sort.Slice(contract.StateLocks, func(left, right int) bool { return contract.StateLocks[left].ID < contract.StateLocks[right].ID })
	sort.Strings(contract.OpenDebtIDs)
	return contract, nil
}

func validateNovelWorkbenchV2EpisodeContractCard(contract novelWorkbenchV2EpisodeContract, card novelWorkbenchV2ControlCard) error {
	introduce := novelWorkbenchV2IDSet(card.IntroduceIDs)
	payoff := novelWorkbenchV2IDSet(card.PayoffIDs)
	characters := novelWorkbenchV2IDSet(card.RequiredCharacterIDs)
	for _, action := range contract.RequiredIntroductions {
		if _, exists := introduce[action.ID]; !exists {
			return fmt.Errorf("本集创作契约要求引入 %s，但控制卡未列入 introduceIds", action.ID)
		}
	}
	for _, action := range contract.RequiredPayoffs {
		if _, exists := payoff[action.ID]; !exists {
			return fmt.Errorf("本集创作契约要求回收 %s，但控制卡未列入 payoffIds", action.ID)
		}
	}
	for _, characterID := range contract.RequiredCharacterIDs {
		if _, exists := characters[characterID]; !exists {
			return fmt.Errorf("本集创作契约要求角色 %s，但控制卡未列入 requiredCharacterIds", characterID)
		}
	}
	return nil
}

func novelWorkbenchV2FactContractLedgerIDs(card novelWorkbenchV2ControlCard, known novelWorkbenchV2KnownIDs) map[string]struct{} {
	ids := map[string]struct{}{}
	for _, group := range [][]string{card.ReversalAnchorIDs, card.IntroduceIDs, card.PayoffIDs} {
		for _, raw := range group {
			id := normalizeNovelWorkbenchV2ID(raw)
			if _, exists := known.foreshadows[id]; exists {
				ids[id] = struct{}{}
			}
			if _, exists := known.promises[id]; exists {
				ids[id] = struct{}{}
			}
		}
	}
	return ids
}

func novelWorkbenchV2FactContractKnowledgeLedgerIDs(card novelWorkbenchV2ControlCard, known novelWorkbenchV2KnownIDs) map[string]struct{} {
	ids := map[string]struct{}{}
	for _, access := range card.FactContract.KnowledgeAccess {
		for _, group := range [][]string{access.FactIDs, access.SourceIDs} {
			for _, raw := range group {
				id := normalizeNovelWorkbenchV2ID(raw)
				if _, exists := known.foreshadows[id]; exists {
					ids[id] = struct{}{}
				}
				if _, exists := known.promises[id]; exists {
					ids[id] = struct{}{}
				}
			}
		}
	}
	return ids
}

// normalizeNovelWorkbenchV2DecorativeEvidenceClaims removes a model habit
// that has no story effect: restating every open ledger item as an evidence
// claim even when the item is not used by this unit. A claim that could change
// state, is unknown, or is used for a character decision is left for strict
// validation below. Every decision is retained for the control-card audit so
// the normalizer is observable rather than a silent mutation.
func normalizeNovelWorkbenchV2DecorativeEvidenceClaims(control novelWorkbenchV2Control, state novelWorkbenchV2State, contract novelWorkbenchV2EpisodeContract, card *novelWorkbenchV2ControlCard) novelWorkbenchV2ControlCardEvidenceNormalization {
	normalization := novelWorkbenchV2ControlCardEvidenceNormalization{}
	if card == nil {
		return normalization
	}
	normalization.InputEvidenceClaimCount = len(card.FactContract.EvidenceClaims)
	normalization.OutputEvidenceClaimCount = normalization.InputEvidenceClaimCount
	if normalization.InputEvidenceClaimCount == 0 {
		return normalization
	}
	known, err := novelWorkbenchV2KnownIDsForControl(control)
	if err != nil {
		for _, claim := range card.FactContract.EvidenceClaims {
			normalization.EvidenceDecisions = append(normalization.EvidenceDecisions, novelWorkbenchV2ControlCardEvidenceAuditEntry{
				EvidenceID:     normalizeNovelWorkbenchV2ID(claim.EvidenceID),
				RequestedLevel: strings.ToLower(strings.TrimSpace(claim.Level)),
				Classification: "normalization_unavailable",
				Action:         "retained",
				Reason:         "控制档案 ID 索引不可用，保留给严格校验处理。",
			})
		}
		return normalization
	}
	anchored := novelWorkbenchV2FactContractLedgerIDs(*card, known)
	usedForKnowledge := novelWorkbenchV2FactContractKnowledgeLedgerIDs(*card, known)
	relevant := novelWorkbenchV2FactContractReferenceSet(contract.RelevantLedgerIDs)
	state = normalizeNovelWorkbenchV2State(state)
	filtered := make([]novelWorkbenchV2EvidenceClaim, 0, normalization.InputEvidenceClaimCount)
	for _, claim := range card.FactContract.EvidenceClaims {
		id := normalizeNovelWorkbenchV2ID(claim.EvidenceID)
		priorLevel := novelWorkbenchV2EffectiveEvidenceLevel(control, state, id)
		decision := novelWorkbenchV2ControlCardEvidenceAuditEntry{
			EvidenceID:      id,
			RequestedLevel:  strings.ToLower(strings.TrimSpace(claim.Level)),
			PriorLevel:      priorLevel,
			Action:          "retained",
			KnownLedger:     novelWorkbenchV2KnownLedgerID(known, id),
			RequiredAnchor:  novelWorkbenchV2IDInSet(anchored, id),
			UsedByKnowledge: novelWorkbenchV2IDInSet(usedForKnowledge, id),
			RelevantToUnit:  novelWorkbenchV2IDInSet(relevant, id),
		}
		switch {
		case id == "":
			decision.Classification = "missing_id"
			decision.Reason = "证据声明缺少稳定 ID，保留给严格校验拦截。"
		case !decision.KnownLedger:
			decision.Classification = "unknown_ledger"
			decision.Reason = "证据声明引用了控制档案中不存在的账本 ID，保留给严格校验拦截。"
		case decision.RequiredAnchor:
			decision.Classification = "required_anchor"
			decision.Reason = "该证据是反转、引入或回收锚点，必须保留并接受证据链校验。"
		case decision.UsedByKnowledge:
			decision.Classification = "knowledge_backed_context"
			decision.Reason = "本集 knowledgeAccess 实际使用该事实，必须保留并校验知情与证据等级。"
		case !decision.RelevantToUnit:
			decision.Classification = "out_of_scope"
			decision.Reason = "该证据不在冻结的 relevantLedgerIds 内，保留给严格校验拦截。"
		case novelWorkbenchV2EvidenceLevelRank(priorLevel) < 1:
			decision.Classification = "unestablished_context"
			decision.Reason = "该证据尚未在既有状态中成立，不能当作可静默忽略的背景信息。"
		case novelWorkbenchV2EvidenceLevelRank(decision.RequestedLevel) != novelWorkbenchV2EvidenceLevelRank(priorLevel):
			decision.Classification = "background_progression"
			decision.Reason = "该声明改变了证据等级，必须作为明确锚点或知情事实接受严格校验。"
		default:
			decision.Classification = "unused_stable_context"
			decision.Action = "removed"
			decision.Reason = "该证据已成立、属于本集相关背景、未被人物知情使用且未推进等级，移除以避免模型把账本上下文误写成行动锚点。"
			normalization.EvidenceDecisions = append(normalization.EvidenceDecisions, decision)
			continue
		}
		normalization.EvidenceDecisions = append(normalization.EvidenceDecisions, decision)
		filtered = append(filtered, claim)
	}
	normalization.OutputEvidenceClaimCount = len(filtered)
	if normalization.OutputEvidenceClaimCount != normalization.InputEvidenceClaimCount {
		card.FactContract.EvidenceClaims = filtered
	}
	return normalization
}

func novelWorkbenchV2KnownLedgerID(known novelWorkbenchV2KnownIDs, id string) bool {
	if _, exists := known.foreshadows[id]; exists {
		return true
	}
	_, exists := known.promises[id]
	return exists
}

func novelWorkbenchV2IDInSet(set map[string]struct{}, id string) bool {
	_, exists := set[id]
	return exists
}

func newNovelWorkbenchV2ControlCardAuditRecord(raw string, unit int, attempt int, contract novelWorkbenchV2EpisodeContract, normalization novelWorkbenchV2ControlCardEvidenceNormalization, validations []novelWorkbenchV2ControlCardAuditValidation, validationErr error) novelWorkbenchV2ControlCardAuditRecord {
	digest := sha256.Sum256([]byte(raw))
	outcome := "accepted"
	if validationErr != nil {
		outcome = "rejected"
	} else if normalization.OutputEvidenceClaimCount < normalization.InputEvidenceClaimCount {
		outcome = "accepted_with_normalization"
	}
	return novelWorkbenchV2ControlCardAuditRecord{
		SchemaVersion:            novelWorkbenchV2ControlCardAuditVersion,
		Unit:                     unit,
		Attempt:                  attempt,
		Outcome:                  outcome,
		Ruleset:                  "fact-contract-evidence-v1",
		RawResponseSHA256:        fmt.Sprintf("%x", digest),
		InputEvidenceClaimCount:  normalization.InputEvidenceClaimCount,
		OutputEvidenceClaimCount: normalization.OutputEvidenceClaimCount,
		Contract: novelWorkbenchV2ControlCardAuditContract{
			RoadmapID:               contract.RoadmapID,
			RequiredIntroductionIDs: novelWorkbenchV2LedgerActionIDs(contract.RequiredIntroductions),
			RequiredPayoffIDs:       novelWorkbenchV2LedgerActionIDs(contract.RequiredPayoffs),
			RelevantLedgerIDs:       append([]string(nil), contract.RelevantLedgerIDs...),
			RequiredCharacterIDs:    append([]string(nil), contract.RequiredCharacterIDs...),
			StateLocks:              append([]novelWorkbenchV2StateLock(nil), contract.StateLocks...),
			OpenDebtIDs:             append([]string(nil), contract.OpenDebtIDs...),
		},
		EvidenceDecisions: normalization.EvidenceDecisions,
		Validations:       validations,
		ValidationError:   errorText(validationErr),
	}
}

func novelWorkbenchV2LedgerActionIDs(actions []novelWorkbenchV2LedgerAction) []string {
	ids := make([]string, 0, len(actions))
	for _, action := range actions {
		if id := normalizeNovelWorkbenchV2ID(action.ID); id != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

func novelWorkbenchV2ControlCardAuditValidationForError(stage string, err error) novelWorkbenchV2ControlCardAuditValidation {
	if err == nil {
		return novelWorkbenchV2ControlCardAuditValidation{Stage: stage, Passed: true}
	}
	return novelWorkbenchV2ControlCardAuditValidation{Stage: stage, Passed: false, Detail: err.Error()}
}

func novelWorkbenchV2FactContractReferenceSet(values []string) map[string]struct{} {
	set := map[string]struct{}{}
	for _, raw := range values {
		if id := normalizeNovelWorkbenchV2ID(raw); id != "" {
			set[id] = struct{}{}
		}
	}
	return set
}

func novelWorkbenchV2FactContractHasAllKinds(links []novelWorkbenchV2EvidenceLink, required ...string) bool {
	present := map[string]struct{}{}
	for _, link := range links {
		present[novelWorkbenchV2CanonicalEvidenceLinkKind(link.Kind)] = struct{}{}
	}
	for _, kind := range required {
		if _, exists := present[kind]; !exists {
			return false
		}
	}
	return true
}

func novelWorkbenchV2EvidenceLinkKindCount(links []novelWorkbenchV2EvidenceLink) int {
	kinds := map[string]struct{}{}
	for _, link := range links {
		if kind := novelWorkbenchV2CanonicalEvidenceLinkKind(link.Kind); kind != "" {
			kinds[kind] = struct{}{}
		}
	}
	return len(kinds)
}

// novelWorkbenchV2CanonicalEvidenceLinkKind accepts a small set of common
// model synonyms while preserving a closed evidence-chain vocabulary. Unknown
// values still fail validation instead of silently becoming a new rule type.
func novelWorkbenchV2CanonicalEvidenceLinkKind(value string) string {
	kind := strings.ToLower(strings.TrimSpace(value))
	kind = strings.NewReplacer("-", "_", " ", "_").Replace(kind)
	switch kind {
	case "discovery", "discover", "recovery", "physical_recovery", "physicalrecovery", "collection", "seizure", "found", "finding", "retrieve", "retrieval", "发现", "取回", "搜获", "缴获":
		return "discovery"
	case "origin", "source", "provenance", "来源", "出处":
		return "origin"
	case "custody", "chain_of_custody", "chainofcustody", "handover", "hand_over", "transfer", "interception", "intercept", "possession", "preservation", "sealed", "交接", "保管", "封存", "截获":
		return "custody"
	case "verification", "verify", "validation", "authentication", "鉴定", "核验", "验证", "比对", "检验":
		return "verification"
	case "testimony", "witness", "statement", "deposition", "证词", "证言", "供述", "目击":
		return "testimony"
	default:
		return kind
	}
}

func validateNovelWorkbenchV2FactContract(control novelWorkbenchV2Control, state novelWorkbenchV2State, contract novelWorkbenchV2EpisodeContract, card *novelWorkbenchV2ControlCard) error {
	known, err := novelWorkbenchV2KnownIDsForControl(control)
	if err != nil {
		return err
	}
	state = normalizeNovelWorkbenchV2State(state)
	requiredCharacters := novelWorkbenchV2IDSet(card.RequiredCharacterIDs)
	knownLocations := novelWorkbenchV2KnownLocationIDs(control, state)
	placements := map[string]novelWorkbenchV2CharacterPlacement{}
	for index := range card.FactContract.CharacterPlacements {
		placement := &card.FactContract.CharacterPlacements[index]
		placement.CharacterID = normalizeNovelWorkbenchV2ID(placement.CharacterID)
		rawLocationID := strings.TrimSpace(placement.LocationID)
		if locationID, resolved := novelWorkbenchV2CanonicalLocationID(control, state, rawLocationID); resolved {
			placement.LocationID = locationID
			if placement.LocationDetail == "" && rawLocationID != "" && normalizeNovelWorkbenchV2ID(rawLocationID) != locationID {
				placement.LocationDetail = rawLocationID
			}
		} else {
			placement.LocationID = normalizeNovelWorkbenchV2ID(rawLocationID)
		}
		rawFromLocationID := strings.TrimSpace(placement.FromLocationID)
		if locationID, resolved := novelWorkbenchV2CanonicalLocationID(control, state, rawFromLocationID); resolved {
			placement.FromLocationID = locationID
		} else {
			placement.FromLocationID = normalizeNovelWorkbenchV2ID(rawFromLocationID)
		}
		placement.LocationDetail = strings.TrimSpace(placement.LocationDetail)
		placement.Presence = strings.ToLower(strings.TrimSpace(placement.Presence))
		placement.MovementCause = strings.TrimSpace(placement.MovementCause)
		if _, exists := known.characters[placement.CharacterID]; !exists {
			return fmt.Errorf("事实契约地点引用不存在的角色 %s", placement.CharacterID)
		}
		if _, required := requiredCharacters[placement.CharacterID]; !required {
			return fmt.Errorf("事实契约地点角色 %s 不在控制卡 requiredCharacterIds 中", placement.CharacterID)
		}
		if _, exists := placements[placement.CharacterID]; exists {
			return fmt.Errorf("事实契约重复声明角色 %s 的地点", placement.CharacterID)
		}
		switch placement.Presence {
		case "on_screen", "off_screen", "unknown":
		default:
			return fmt.Errorf("事实契约角色 %s 的 presence 必须为 on_screen、off_screen 或 unknown", placement.CharacterID)
		}
		if placement.Presence != "unknown" && placement.LocationID == "" {
			return fmt.Errorf("事实契约角色 %s 缺少地点", placement.CharacterID)
		}
		if placement.LocationID != "" {
			if _, exists := knownLocations[placement.LocationID]; !exists {
				return fmt.Errorf("事实契约角色 %s 使用未知地点 %s", placement.CharacterID, placement.LocationID)
			}
		}
		currentLocation := novelWorkbenchV2CurrentCharacterLocation(state, placement.CharacterID)
		if currentLocation != "" && placement.LocationID != "" && placement.LocationID != currentLocation {
			if placement.FromLocationID != currentLocation || len([]rune(placement.MovementCause)) < 8 {
				return fmt.Errorf("事实契约角色 %s 当前在 %s，变更到 %s 必须写明 fromLocationId 和可见移动原因", placement.CharacterID, currentLocation, placement.LocationID)
			}
		} else if placement.FromLocationID != "" || placement.MovementCause != "" {
			return fmt.Errorf("事实契约角色 %s 未变更地点时不能声明移动", placement.CharacterID)
		}
		placements[placement.CharacterID] = *placement
	}
	for characterID := range requiredCharacters {
		if _, exists := placements[characterID]; !exists {
			return fmt.Errorf("事实契约必须声明 requiredCharacterIds 中角色 %s 的在场或离场地点", characterID)
		}
	}

	knowledgeFacts := map[string]map[string]novelWorkbenchV2KnowledgeAccess{}
	for index := range card.FactContract.KnowledgeAccess {
		access := &card.FactContract.KnowledgeAccess[index]
		access.CharacterID = normalizeNovelWorkbenchV2ID(access.CharacterID)
		access.FactIDs = normalizeNovelWorkbenchV2IDs(access.FactIDs)
		access.SourceIDs = normalizeNovelWorkbenchV2IDs(access.SourceIDs)
		access.Source = strings.TrimSpace(access.Source)
		if _, exists := known.characters[access.CharacterID]; !exists {
			return fmt.Errorf("事实契约知情范围引用不存在的角色 %s", access.CharacterID)
		}
		if _, required := requiredCharacters[access.CharacterID]; !required {
			return fmt.Errorf("事实契约知情角色 %s 不在控制卡 requiredCharacterIds 中", access.CharacterID)
		}
		if len(access.FactIDs) == 0 {
			return fmt.Errorf("事实契约角色 %s 未列出可使用的事实 ID", access.CharacterID)
		}
		if access.AcquireInUnit && (len(access.SourceIDs) == 0 || len([]rune(access.Source)) < 8) {
			return fmt.Errorf("事实契约角色 %s 的本集知情必须有来源和 sourceIds", access.CharacterID)
		}
		for _, sourceID := range access.SourceIDs {
			if _, exists := known.all[sourceID]; !exists {
				return fmt.Errorf("事实契约知情来源引用不存在的 ID %s", sourceID)
			}
			availableNow := novelWorkbenchV2EffectiveEvidenceLevel(control, state, sourceID) != "unseen"
			introducedNow := false
			for _, introducedID := range card.IntroduceIDs {
				if normalizeNovelWorkbenchV2ID(introducedID) == sourceID {
					introducedNow = true
					break
				}
			}
			if access.AcquireInUnit && !availableNow && !introducedNow {
				return fmt.Errorf("事实契约角色 %s 不能从尚未可见的来源 %s 获知信息", access.CharacterID, sourceID)
			}
		}
		if knowledgeFacts[access.CharacterID] == nil {
			knowledgeFacts[access.CharacterID] = map[string]novelWorkbenchV2KnowledgeAccess{}
		}
		for _, factID := range access.FactIDs {
			if _, exists := known.foreshadows[factID]; !exists {
				if _, promise := known.promises[factID]; !promise {
					return fmt.Errorf("事实契约知情范围只能引用伏笔或读者承诺 ID，收到 %s", factID)
				}
			}
			if _, exists := knowledgeFacts[access.CharacterID][factID]; exists {
				return fmt.Errorf("事实契约重复声明角色 %s 对 %s 的知情范围", access.CharacterID, factID)
			}
			if !access.AcquireInUnit && !novelWorkbenchV2CharacterKnowsFact(control, state, access.CharacterID, factID) {
				return fmt.Errorf("事实契约角色 %s 尚未获知 %s，必须标注本集可见获得过程", access.CharacterID, factID)
			}
			knowledgeFacts[access.CharacterID][factID] = *access
		}
	}

	requiredEvidence := novelWorkbenchV2FactContractLedgerIDs(*card, known)
	knowledgeEvidence := novelWorkbenchV2FactContractKnowledgeLedgerIDs(*card, known)
	relevantEvidence := novelWorkbenchV2FactContractReferenceSet(contract.RelevantLedgerIDs)
	evidenceClaims := map[string]novelWorkbenchV2EvidenceClaim{}
	allowedLinkKinds := map[string]struct{}{"discovery": {}, "origin": {}, "custody": {}, "verification": {}, "testimony": {}}
	for index := range card.FactContract.EvidenceClaims {
		claim := &card.FactContract.EvidenceClaims[index]
		claim.EvidenceID = normalizeNovelWorkbenchV2ID(claim.EvidenceID)
		claim.Level = strings.ToLower(strings.TrimSpace(claim.Level))
		claim.AllowedConclusion = strings.TrimSpace(claim.AllowedConclusion)
		claim.ProhibitedConclusion = strings.TrimSpace(claim.ProhibitedConclusion)
		if _, exists := known.foreshadows[claim.EvidenceID]; !exists {
			if _, exists := known.promises[claim.EvidenceID]; !exists {
				return fmt.Errorf("事实契约证据引用不存在的账本 ID %s", claim.EvidenceID)
			}
		}
		if _, exists := evidenceClaims[claim.EvidenceID]; exists {
			return fmt.Errorf("事实契约重复声明证据 %s", claim.EvidenceID)
		}
		priorLevel := novelWorkbenchV2EffectiveEvidenceLevel(control, state, claim.EvidenceID)
		priorRank := novelWorkbenchV2EvidenceLevelRank(priorLevel)
		targetRank := novelWorkbenchV2EvidenceLevelRank(claim.Level)
		_, anchored := requiredEvidence[claim.EvidenceID]
		if !anchored {
			if _, used := knowledgeEvidence[claim.EvidenceID]; !used {
				return fmt.Errorf("事实契约证据 %s 必须是控制卡反转、引入或回收的账本锚点，或被本集 knowledgeAccess 实际使用", claim.EvidenceID)
			}
			if _, relevant := relevantEvidence[claim.EvidenceID]; !relevant {
				return fmt.Errorf("事实契约背景证据 %s 不在本集相关账本范围内", claim.EvidenceID)
			}
			if targetRank != priorRank {
				return fmt.Errorf("事实契约背景证据 %s 不能在未列为反转、引入或回收锚点时变更证据等级", claim.EvidenceID)
			}
		}
		if targetRank < 1 || targetRank < priorRank || targetRank > priorRank+1 {
			return fmt.Errorf("事实契约证据 %s 不能从 %s 跳到 %s", claim.EvidenceID, priorLevel, claim.Level)
		}
		if len([]rune(claim.AllowedConclusion)) < 8 || len([]rune(claim.ProhibitedConclusion)) < 8 || claim.AllowedConclusion == claim.ProhibitedConclusion {
			return fmt.Errorf("事实契约证据 %s 必须明确可得结论与禁止结论", claim.EvidenceID)
		}
		if len(claim.Links) == 0 {
			return fmt.Errorf("事实契约证据 %s 缺少可见证据链", claim.EvidenceID)
		}
		for linkIndex := range claim.Links {
			link := &claim.Links[linkIndex]
			link.Kind = novelWorkbenchV2CanonicalEvidenceLinkKind(link.Kind)
			link.Description = strings.TrimSpace(link.Description)
			link.ReferenceIDs = normalizeNovelWorkbenchV2IDs(link.ReferenceIDs)
			if _, exists := allowedLinkKinds[link.Kind]; !exists {
				return fmt.Errorf("事实契约证据 %s 使用无效链路类型 %s", claim.EvidenceID, link.Kind)
			}
			if len([]rune(link.Description)) < 8 || len(link.ReferenceIDs) == 0 {
				return fmt.Errorf("事实契约证据 %s 的 %s 链路必须有可见说明和稳定引用", claim.EvidenceID, link.Kind)
			}
			if err := validateNovelWorkbenchV2References("事实契约证据链", link.ReferenceIDs, known); err != nil {
				return err
			}
		}
		switch claim.Level {
		case "corroborated":
			if len(claim.Links) < 2 || novelWorkbenchV2EvidenceLinkKindCount(claim.Links) < 2 {
				return fmt.Errorf("事实契约证据 %s 升至 corroborated 至少需要两条不同类型的可见链路", claim.EvidenceID)
			}
		case "proven":
			if len(claim.Links) < 3 || !novelWorkbenchV2FactContractHasAllKinds(claim.Links, "origin", "custody", "verification") {
				return fmt.Errorf("事实契约证据 %s 升至 proven 必须具备来源、交接链和核验三类可见链路", claim.EvidenceID)
			}
		}
		evidenceClaims[claim.EvidenceID] = *claim
	}
	for evidenceID := range requiredEvidence {
		if _, exists := evidenceClaims[evidenceID]; !exists {
			return fmt.Errorf("事实契约缺少反转或账本锚点 %s 的证据上限", evidenceID)
		}
		knowledgeDeclared := false
		for _, facts := range knowledgeFacts {
			if _, exists := facts[evidenceID]; exists {
				knowledgeDeclared = true
				break
			}
		}
		if !knowledgeDeclared {
			return fmt.Errorf("事实契约必须声明谁可以使用账本锚点 %s", evidenceID)
		}
	}
	return nil
}

func validateNovelWorkbenchV2FactContractExecution(control novelWorkbenchV2Control, state novelWorkbenchV2State, card novelWorkbenchV2ControlCard, writeback novelWorkbenchV2Writeback) error {
	state = normalizeNovelWorkbenchV2State(state)
	placements := map[string]novelWorkbenchV2CharacterPlacement{}
	for _, placement := range card.FactContract.CharacterPlacements {
		placements[normalizeNovelWorkbenchV2ID(placement.CharacterID)] = placement
	}
	locationChanges := map[string]novelWorkbenchV2LocationChange{}
	for _, change := range writeback.LocationChanges {
		characterID := normalizeNovelWorkbenchV2ID(change.CharacterID)
		if characterID == "" || normalizeNovelWorkbenchV2ID(change.ToLocationID) == "" {
			return errors.New("地点写回缺少角色或目标地点")
		}
		if _, exists := locationChanges[characterID]; exists {
			return fmt.Errorf("地点写回重复修改角色 %s", characterID)
		}
		placement, exists := placements[characterID]
		if !exists || normalizeNovelWorkbenchV2ID(placement.LocationID) != normalizeNovelWorkbenchV2ID(change.ToLocationID) {
			return fmt.Errorf("地点写回 %s 未被事实契约授权", characterID)
		}
		if strings.TrimSpace(change.Note) == "" {
			return fmt.Errorf("地点写回 %s 缺少可见移动说明", characterID)
		}
		if current := novelWorkbenchV2CurrentCharacterLocation(state, characterID); current != normalizeNovelWorkbenchV2ID(change.FromLocationID) {
			return fmt.Errorf("地点写回角色 %s 的原地点应为 %s", characterID, current)
		} else if current == normalizeNovelWorkbenchV2ID(change.ToLocationID) {
			return fmt.Errorf("地点写回角色 %s 没有实际地点变化", characterID)
		}
		locationChanges[characterID] = change
	}
	for characterID, placement := range placements {
		current := novelWorkbenchV2CurrentCharacterLocation(state, characterID)
		if current != "" && normalizeNovelWorkbenchV2ID(placement.LocationID) != "" && current != normalizeNovelWorkbenchV2ID(placement.LocationID) {
			if _, exists := locationChanges[characterID]; !exists {
				return fmt.Errorf("事实契约角色 %s 从 %s 移动到 %s 但正文未写回地点变更", characterID, current, placement.LocationID)
			}
		}
	}

	requiredKnowledge := map[string]novelWorkbenchV2KnowledgeAccess{}
	for _, access := range card.FactContract.KnowledgeAccess {
		for _, factID := range access.FactIDs {
			if access.AcquireInUnit && !novelWorkbenchV2CharacterKnowsFact(control, state, access.CharacterID, factID) {
				requiredKnowledge[normalizeNovelWorkbenchV2ID(access.CharacterID)+"/"+normalizeNovelWorkbenchV2ID(factID)] = access
			}
		}
	}
	grants := map[string]novelWorkbenchV2KnowledgeGrant{}
	for _, grant := range writeback.KnowledgeGrants {
		characterID := normalizeNovelWorkbenchV2ID(grant.CharacterID)
		factIDs := normalizeNovelWorkbenchV2IDs(grant.FactIDs)
		if characterID == "" || len(factIDs) == 0 || strings.TrimSpace(grant.Note) == "" {
			return errors.New("知情写回缺少角色、事实或可见获得说明")
		}
		for _, factID := range factIDs {
			key := characterID + "/" + factID
			expected, required := requiredKnowledge[key]
			if !required {
				return fmt.Errorf("知情写回 %s 未被事实契约授权", key)
			}
			if _, exists := grants[key]; exists {
				return fmt.Errorf("知情写回重复记录 %s", key)
			}
			grantSources := novelWorkbenchV2FactContractReferenceSet(grant.SourceIDs)
			for _, sourceID := range expected.SourceIDs {
				if _, exists := grantSources[normalizeNovelWorkbenchV2ID(sourceID)]; !exists {
					return fmt.Errorf("知情写回 %s 未保留来源 %s", key, sourceID)
				}
			}
			grants[key] = grant
		}
	}
	for key := range requiredKnowledge {
		if _, exists := grants[key]; !exists {
			return fmt.Errorf("事实契约要求的知情获得 %s 未写回", key)
		}
	}

	claims := map[string]novelWorkbenchV2EvidenceClaim{}
	for _, claim := range card.FactContract.EvidenceClaims {
		claims[normalizeNovelWorkbenchV2ID(claim.EvidenceID)] = claim
	}
	updates := map[string]novelWorkbenchV2EvidenceUpdate{}
	for _, update := range writeback.EvidenceUpdates {
		id := normalizeNovelWorkbenchV2ID(update.EvidenceID)
		claim, exists := claims[id]
		if !exists {
			return fmt.Errorf("证据写回 %s 未被事实契约授权", id)
		}
		if _, exists := updates[id]; exists {
			return fmt.Errorf("证据写回重复记录 %s", id)
		}
		if strings.TrimSpace(update.Note) == "" {
			return fmt.Errorf("证据写回 %s 缺少可见推进说明", id)
		}
		from := strings.ToLower(strings.TrimSpace(update.From))
		to := strings.ToLower(strings.TrimSpace(update.To))
		if novelWorkbenchV2EvidenceLevelRank(to) <= novelWorkbenchV2EvidenceLevelRank(from) {
			return fmt.Errorf("证据写回 %s 必须实际提升证据等级", id)
		}
		current := novelWorkbenchV2EffectiveEvidenceLevel(control, state, id)
		if from != current || to != claim.Level {
			return fmt.Errorf("证据写回 %s 必须从 %s 变更到事实契约等级 %s", id, current, claim.Level)
		}
		updates[id] = update
	}
	for id, claim := range claims {
		if novelWorkbenchV2EvidenceLevelRank(claim.Level) > novelWorkbenchV2EvidenceLevelRank(novelWorkbenchV2EffectiveEvidenceLevel(control, state, id)) {
			if _, exists := updates[id]; !exists {
				return fmt.Errorf("事实契约证据 %s 升至 %s 但正文未写回", id, claim.Level)
			}
		}
	}
	return nil
}

func validateNovelWorkbenchV2EpisodeContractExecution(contract novelWorkbenchV2EpisodeContract, writeback novelWorkbenchV2Writeback) error {
	introduced := map[string]struct{}{}
	paid := map[string]struct{}{}
	for _, change := range append(append([]novelWorkbenchV2StateTransition{}, writeback.ForeshadowChanges...), writeback.PromiseChanges...) {
		id := normalizeNovelWorkbenchV2ID(change.ID)
		switch strings.ToLower(strings.TrimSpace(change.To)) {
		case "introduced":
			introduced[id] = struct{}{}
		case "paid":
			paid[id] = struct{}{}
		}
	}
	for _, action := range contract.RequiredIntroductions {
		if _, exists := introduced[action.ID]; !exists {
			return fmt.Errorf("本集创作契约要求写回引入 %s", action.ID)
		}
	}
	for _, action := range contract.RequiredPayoffs {
		if _, exists := paid[action.ID]; !exists {
			return fmt.Errorf("本集创作契约要求写回回收 %s", action.ID)
		}
	}
	return nil
}

func buildNovelWorkbenchV2EpisodeWorkPackage(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, contract novelWorkbenchV2EpisodeContract) novelWorkbenchV2EpisodeWorkPackage {
	scopedRoadmap := novelWorkbenchV2ScopedRoadmap(control, state, roadmap, contract)
	relevant := map[string]struct{}{}
	for _, id := range contract.RelevantLedgerIDs {
		relevant[id] = struct{}{}
	}
	ledger := make([]novelWorkbenchV2LedgerAction, 0, len(relevant))
	for _, item := range control.Documents.ForeshadowLedger {
		if _, exists := relevant[item.ID]; exists {
			ledger = append(ledger, novelWorkbenchV2LedgerActionForItem(item, "foreshadow", item.PayoffByUnit))
		}
	}
	for _, item := range control.Documents.ReaderPromiseLedger {
		if _, exists := relevant[item.ID]; exists {
			ledger = append(ledger, novelWorkbenchV2LedgerActionForItem(item, "reader_promise", item.PayoffByUnit))
		}
	}
	sort.Slice(ledger, func(left, right int) bool { return ledger[left].ID < ledger[right].ID })
	writingLog := append([]novelWorkbenchV2WritingLog{}, control.Documents.WritingLog...)
	if len(writingLog) > 3 {
		writingLog = writingLog[len(writingLog)-3:]
	}
	return novelWorkbenchV2EpisodeWorkPackage{
		ProjectOverview:  control.Documents.ProjectOverview,
		Theme:            control.Documents.ThemeAndProposition,
		WorldRules:       append([]string{}, control.Documents.Worldbuilding.Rules...),
		WorldConstraints: append([]string{}, control.Documents.Worldbuilding.Constraints...),
		StyleGuide:       control.Documents.StyleGuide,
		Roadmap:          scopedRoadmap,
		Contract:         contract,
		RelevantLedger:   ledger,
		CastBible:        append([]novelWorkbenchV2Character{}, control.Documents.CastBible...),
		RelationshipMap:  append([]novelWorkbenchV2Relationship{}, control.Documents.RelationshipMap...),
		MainPlotlines:    append([]novelWorkbenchV2Plotline{}, control.Documents.MainPlotlines...),
		DynamicState:     state,
		RecentWritingLog: writingLog,
	}
}

func novelWorkbenchV2EpisodeWorkPackageJSON(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, contract novelWorkbenchV2EpisodeContract) string {
	workPackage := buildNovelWorkbenchV2EpisodeWorkPackage(control, state, roadmap, contract)
	encoded, _ := json.Marshal(workPackage)
	return string(encoded)
}

func novelWorkbenchV2RoadmapForUnit(roadmaps []novelWorkbenchV2Roadmap, unit int) (novelWorkbenchV2Roadmap, bool) {
	for _, roadmap := range roadmaps {
		if unit >= roadmap.StartUnit && unit <= roadmap.EndUnit {
			return roadmap, true
		}
	}
	return novelWorkbenchV2Roadmap{}, false
}

func validateNovelWorkbenchV2Preflight(control novelWorkbenchV2Control, state novelWorkbenchV2State, unit int) error {
	if state.CompletedUnit != unit-1 {
		return fmt.Errorf("动态状态完成单元为 %d，不能生成第 %d 单元", state.CompletedUnit, unit)
	}
	for _, item := range control.Documents.ForeshadowLedger {
		status := state.ForeshadowStates[item.ID]
		if status == "planned" && unit > item.IntroducedByUnit {
			return fmt.Errorf("伏笔 %s 应在第 %d 单元前引入", item.ID, item.IntroducedByUnit)
		}
		if status != "paid" && unit > item.PayoffByUnit {
			return fmt.Errorf("伏笔 %s 已超过第 %d 单元回收期限", item.ID, item.PayoffByUnit)
		}
	}
	for _, item := range control.Documents.ReaderPromiseLedger {
		status := state.PromiseStates[item.ID]
		if status == "planned" && unit > item.IntroducedByUnit {
			return fmt.Errorf("读者承诺 %s 应在第 %d 单元前兑现为可见线索", item.ID, item.IntroducedByUnit)
		}
		if status != "paid" && unit > item.PayoffByUnit {
			return fmt.Errorf("读者承诺 %s 已超过第 %d 单元回收期限", item.ID, item.PayoffByUnit)
		}
	}
	return nil
}

func validateNovelWorkbenchV2ControlCard(card *novelWorkbenchV2ControlCard, control novelWorkbenchV2Control, roadmap novelWorkbenchV2Roadmap, unit int) error {
	if card.Unit != unit {
		return fmt.Errorf("控制卡单元必须为 %d", unit)
	}
	card.RoadmapID = normalizeNovelWorkbenchV2ID(card.RoadmapID)
	if card.RoadmapID != roadmap.ID {
		return fmt.Errorf("控制卡必须绑定路线图 %s", roadmap.ID)
	}
	card.Mission = strings.TrimSpace(card.Mission)
	card.OpeningHook = strings.TrimSpace(card.OpeningHook)
	card.CoreConflict = strings.TrimSpace(card.CoreConflict)
	card.Escalation = strings.TrimSpace(card.Escalation)
	card.Reversal = strings.TrimSpace(card.Reversal)
	card.ClosingHook = strings.TrimSpace(card.ClosingHook)
	card.NextDebt = strings.TrimSpace(card.NextDebt)
	if card.Mission == "" || card.CoreConflict == "" || card.NextDebt == "" {
		return errors.New("控制卡缺少任务、核心冲突或下一集债务")
	}
	if control.Brief.OutputMode == novelWorkbenchModeScreenplay && (card.OpeningHook == "" || card.Escalation == "" || card.Reversal == "" || card.ClosingHook == "") {
		return errors.New("短剧控制卡必须包含开场钩子、升级、反转和结尾钩子")
	}
	card.NarrativeBeats = cleanNovelWorkbenchV2Strings(card.NarrativeBeats)
	card.CausalSpine = cleanNovelWorkbenchV2Strings(card.CausalSpine)
	card.ReversalAnchorIDs = normalizeNovelWorkbenchV2IDs(card.ReversalAnchorIDs)
	card.RequiredCharacterIDs = normalizeNovelWorkbenchV2IDs(card.RequiredCharacterIDs)
	card.RequiredRelationshipIDs = normalizeNovelWorkbenchV2IDs(card.RequiredRelationshipIDs)
	card.IntroduceIDs = normalizeNovelWorkbenchV2IDs(card.IntroduceIDs)
	card.PayoffIDs = normalizeNovelWorkbenchV2IDs(card.PayoffIDs)
	if control.Brief.OutputMode == novelWorkbenchModeNovel && len(card.NarrativeBeats) < 3 {
		return errors.New("小说控制卡至少需要三个叙事节拍")
	}
	if len(card.CausalSpine) < 4 {
		return errors.New("控制卡必须提供至少四步的因果脊柱")
	}
	for index, link := range card.CausalSpine {
		if len([]rune(link)) < 8 {
			return fmt.Errorf("控制卡因果脊柱第 %d 步过短", index+1)
		}
	}
	if control.Brief.OutputMode == novelWorkbenchModeScreenplay && len(card.ReversalAnchorIDs) == 0 {
		return errors.New("短剧控制卡必须标注反转锚点")
	}
	known, err := novelWorkbenchV2KnownIDsForControl(control)
	if err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2References("控制卡角色", card.RequiredCharacterIDs, known); err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2References("控制卡关系", card.RequiredRelationshipIDs, known); err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2References("控制卡反转锚点", card.ReversalAnchorIDs, known); err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2LedgerReferences("控制卡引入", card.IntroduceIDs, known); err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2LedgerReferences("控制卡回收", card.PayoffIDs, known); err != nil {
		return err
	}
	for _, id := range card.RequiredCharacterIDs {
		if _, ok := known.characters[normalizeNovelWorkbenchV2ID(id)]; !ok {
			return fmt.Errorf("控制卡角色引用 %s 不是角色 ID", id)
		}
	}
	for _, id := range card.RequiredRelationshipIDs {
		if _, ok := known.relationships[normalizeNovelWorkbenchV2ID(id)]; !ok {
			return fmt.Errorf("控制卡关系引用 %s 不是关系 ID", id)
		}
	}
	return nil
}

func validateNovelWorkbenchV2LedgerReferences(label string, refs []string, known novelWorkbenchV2KnownIDs) error {
	seen := map[string]struct{}{}
	for _, raw := range refs {
		id := normalizeNovelWorkbenchV2ID(raw)
		if id == "" {
			return fmt.Errorf("%s包含空引用", label)
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("%s重复引用 %s", label, id)
		}
		seen[id] = struct{}{}
		if _, foreshadow := known.foreshadows[id]; !foreshadow {
			if _, promise := known.promises[id]; !promise {
				return fmt.Errorf("%s只能引用伏笔或读者承诺 ID，收到 %s", label, id)
			}
		}
	}
	return nil
}

func validateNovelWorkbenchV2ControlCardDeadlinePlan(control novelWorkbenchV2Control, state novelWorkbenchV2State, card novelWorkbenchV2ControlCard, unit int) error {
	roadmap, found := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, unit)
	if !found {
		return fmt.Errorf("第 %d 单元没有路线图", unit)
	}
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, unit)
	if err != nil {
		return err
	}
	return validateNovelWorkbenchV2EpisodeContractCard(contract, card)
}

func novelWorkbenchV2IDSet(values []string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		if id := normalizeNovelWorkbenchV2ID(value); id != "" {
			set[id] = struct{}{}
		}
	}
	return set
}

func validateNovelWorkbenchV2Unit(output *novelWorkbenchV2UnitOutput, control novelWorkbenchV2Control, state novelWorkbenchV2State, card novelWorkbenchV2ControlCard, unit int) error {
	if output.Unit != unit {
		return fmt.Errorf("正文单元编号必须为 %d", unit)
	}
	output.Title = strings.TrimSpace(output.Title)
	output.Content = strings.TrimSpace(output.Content)
	output.Summary = strings.TrimSpace(output.Summary)
	if output.Title == "" || output.Content == "" || output.Summary == "" {
		return errors.New("正文缺少标题、完整内容或摘要")
	}
	if strings.TrimSpace(output.Writeback.NextUnitBridge) == "" {
		return errors.New("正文缺少下一单元连续性接力")
	}
	normalizeNovelWorkbenchV2WritebackLocations(control, state, &output.Writeback)
	if err := validateNovelWorkbenchV2Writeback(control, state, output.Writeback, unit); err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2ControlCardExecution(card, output.Writeback); err != nil {
		return err
	}
	return validateNovelWorkbenchV2FactContractExecution(control, state, card, output.Writeback)
}

// normalizeNovelWorkbenchV2WritebackLocations applies the same conservative
// location resolution used for a control card before a draft is committed.
// It prevents a writer from accidentally breaking an approved card solely by
// writing a detailed natural-language sub-location in a writeback field.
func normalizeNovelWorkbenchV2WritebackLocations(control novelWorkbenchV2Control, state novelWorkbenchV2State, writeback *novelWorkbenchV2Writeback) {
	if writeback == nil {
		return
	}
	for index := range writeback.LocationChanges {
		change := &writeback.LocationChanges[index]
		change.CharacterID = normalizeNovelWorkbenchV2ID(change.CharacterID)
		if locationID, resolved := novelWorkbenchV2CanonicalLocationID(control, state, change.FromLocationID); resolved {
			change.FromLocationID = locationID
		} else {
			change.FromLocationID = normalizeNovelWorkbenchV2ID(change.FromLocationID)
		}
		if locationID, resolved := novelWorkbenchV2CanonicalLocationID(control, state, change.ToLocationID); resolved {
			change.ToLocationID = locationID
		} else {
			change.ToLocationID = normalizeNovelWorkbenchV2ID(change.ToLocationID)
		}
		change.Note = strings.TrimSpace(change.Note)
	}
}

func validateNovelWorkbenchV2ControlCardExecution(card novelWorkbenchV2ControlCard, writeback novelWorkbenchV2Writeback) error {
	introduced := map[string]struct{}{}
	for _, change := range append(append([]novelWorkbenchV2StateTransition{}, writeback.ForeshadowChanges...), writeback.PromiseChanges...) {
		if strings.EqualFold(strings.TrimSpace(change.To), "introduced") {
			introduced[normalizeNovelWorkbenchV2ID(change.ID)] = struct{}{}
		}
	}
	paid := map[string]struct{}{}
	for _, change := range append(append([]novelWorkbenchV2StateTransition{}, writeback.ForeshadowChanges...), writeback.PromiseChanges...) {
		if strings.EqualFold(strings.TrimSpace(change.To), "paid") {
			paid[normalizeNovelWorkbenchV2ID(change.ID)] = struct{}{}
		}
	}
	for _, raw := range card.IntroduceIDs {
		if _, exists := introduced[normalizeNovelWorkbenchV2ID(raw)]; !exists {
			return fmt.Errorf("控制卡要求引入 %s，但写回未标记 introduced", raw)
		}
	}
	for _, raw := range card.PayoffIDs {
		if _, exists := paid[normalizeNovelWorkbenchV2ID(raw)]; !exists {
			return fmt.Errorf("控制卡要求回收 %s，但写回未标记 paid", raw)
		}
	}
	return nil
}

func validateNovelWorkbenchV2Writeback(control novelWorkbenchV2Control, state novelWorkbenchV2State, writeback novelWorkbenchV2Writeback, unit int) error {
	known, err := novelWorkbenchV2KnownIDsForControl(control)
	if err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2NarrativeFacts(writeback.NarrativeFacts, state.NarrativeFacts, unit); err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2StateTransitions("角色", writeback.CharacterChanges, state.CharacterStates, known.characters, nil); err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2StateTransitions("关系", writeback.RelationshipChanges, state.RelationshipStates, known.relationships, nil); err != nil {
		return err
	}
	allowedPlotStates := map[string]struct{}{"open": {}, "advanced": {}, "resolved": {}}
	if err := validateNovelWorkbenchV2StateTransitions("主线", writeback.PlotlineChanges, state.PlotlineStates, known.plotlines, allowedPlotStates); err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2LedgerTransitions("伏笔", writeback.ForeshadowChanges, state.ForeshadowStates, state.ForeshadowStartedAt, known.foreshadows, unit); err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2LedgerTransitions("读者承诺", writeback.PromiseChanges, state.PromiseStates, state.PromiseStartedAt, known.promises, unit); err != nil {
		return err
	}
	return nil
}

func validateNovelWorkbenchV2NarrativeFacts(facts []novelWorkbenchV2NarrativeFact, existing map[string]novelWorkbenchV2NarrativeFact, unit int) error {
	seen := map[string]struct{}{}
	for _, fact := range facts {
		id := normalizeNovelWorkbenchV2ID(fact.ID)
		if id == "" || len([]rune(strings.TrimSpace(fact.Statement))) < 8 {
			return errors.New("编译叙事事实缺少稳定 ID 或明确陈述")
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("编译叙事事实重复记录 %s", id)
		}
		if _, exists := existing[id]; exists {
			return fmt.Errorf("编译叙事事实 %s 已存在，不能重复提交", id)
		}
		if fact.EstablishedUnit != unit {
			return fmt.Errorf("编译叙事事实 %s 必须在第 %d 单元提交", id, unit)
		}
		if strings.ToLower(strings.TrimSpace(fact.Status)) != "active" {
			return fmt.Errorf("编译叙事事实 %s 的状态必须为 active", id)
		}
		seen[id] = struct{}{}
	}
	return nil
}

func validateNovelWorkbenchV2StateTransitions(label string, changes []novelWorkbenchV2StateTransition, states map[string]string, known map[string]struct{}, allowed map[string]struct{}) error {
	seen := map[string]struct{}{}
	for _, change := range changes {
		id := normalizeNovelWorkbenchV2ID(change.ID)
		if id == "" || strings.TrimSpace(change.To) == "" {
			return fmt.Errorf("%s状态变更缺少 ID 或目标状态", label)
		}
		if _, exists := known[id]; !exists {
			return fmt.Errorf("%s状态变更引用不存在的 ID %s", label, id)
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("%s状态变更重复修改 %s", label, id)
		}
		seen[id] = struct{}{}
		if from := strings.TrimSpace(change.From); from != "" && states[id] != from {
			return fmt.Errorf("%s %s 的原状态应为 %s，实际为 %s", label, id, from, states[id])
		}
		if allowed != nil {
			if _, exists := allowed[strings.TrimSpace(change.To)]; !exists {
				return fmt.Errorf("%s %s 的目标状态 %s 无效", label, id, change.To)
			}
		}
	}
	return nil
}

func validateNovelWorkbenchV2LedgerTransitions(label string, changes []novelWorkbenchV2StateTransition, states map[string]string, startedAt map[string]int, known map[string]struct{}, unit int) error {
	seen := map[string]struct{}{}
	for _, change := range changes {
		id := normalizeNovelWorkbenchV2ID(change.ID)
		to := strings.ToLower(strings.TrimSpace(change.To))
		if id == "" || to == "" {
			return fmt.Errorf("%s状态变更缺少 ID 或目标状态", label)
		}
		if _, exists := known[id]; !exists {
			return fmt.Errorf("%s状态变更引用不存在的 ID %s", label, id)
		}
		if _, exists := seen[id]; exists {
			return fmt.Errorf("%s状态变更重复修改 %s", label, id)
		}
		seen[id] = struct{}{}
		current := strings.ToLower(strings.TrimSpace(states[id]))
		if from := strings.ToLower(strings.TrimSpace(change.From)); from != "" && current != from {
			return fmt.Errorf("%s %s 的原状态应为 %s，实际为 %s", label, id, from, current)
		}
		switch to {
		case "introduced":
			if current != "planned" {
				return fmt.Errorf("%s %s 只能从 planned 引入", label, id)
			}
		case "active":
			if current != "introduced" && current != "active" {
				return fmt.Errorf("%s %s 只能在引入后推进", label, id)
			}
		case "paid":
			if current != "introduced" && current != "active" {
				return fmt.Errorf("%s %s 未铺垫即回收", label, id)
			}
			if startedAt[id] >= unit {
				return fmt.Errorf("%s %s 不能在同一单元引入后立即回收", label, id)
			}
		default:
			return fmt.Errorf("%s %s 的目标状态 %s 无效", label, id, to)
		}
	}
	return nil
}

func validateNovelWorkbenchV2Review(review *novelWorkbenchV2ReviewReport, control novelWorkbenchV2Control, unit int) error {
	if review.Unit != unit {
		return fmt.Errorf("审稿报告单元必须为 %d", unit)
	}
	if review.Signals == nil {
		return errors.New("审稿报告缺少 12 项质量信号")
	}
	for _, signal := range novelWorkbenchV2QualitySignals {
		score, exists := review.Signals[signal]
		if !exists || score < 0 || score > 10 {
			return fmt.Errorf("审稿报告缺少或包含无效信号 %s", signal)
		}
	}
	review.ReferenceIDs = normalizeNovelWorkbenchV2IDs(review.ReferenceIDs)
	known, err := novelWorkbenchV2KnownIDsForControl(control)
	if err != nil {
		return err
	}
	if err := validateNovelWorkbenchV2References("审稿报告", review.ReferenceIDs, known); err != nil {
		return err
	}
	for _, issue := range append(append([]novelWorkbenchV2ReviewIssue{}, review.BlockingIssues...), review.Warnings...) {
		if referenceID := normalizeNovelWorkbenchV2ID(issue.ReferenceID); referenceID != "" {
			if _, exists := known.all[referenceID]; !exists {
				return fmt.Errorf("审稿问题引用了不存在的 ID %s", referenceID)
			}
		}
	}
	return nil
}

func validateNovelWorkbenchV2Quality(review novelWorkbenchV2ReviewReport, unit int) error {
	for _, issue := range review.BlockingIssues {
		if strings.EqualFold(strings.TrimSpace(issue.Severity), "blocker") || strings.EqualFold(strings.TrimSpace(issue.Severity), "fatal") {
			return fmt.Errorf("审稿拦截 [%s]：%s", firstNonEmptyString(strings.TrimSpace(issue.Code), "REVIEW_BLOCKER"), firstNonEmptyString(strings.TrimSpace(issue.Evidence), "独立审稿指出该项无法提交"))
		}
	}
	criticalMinimum := 6
	if unit <= 3 {
		criticalMinimum = 7
	}
	for _, signal := range []string{"storyLogic", "stateGuard", "readerPull", "titleHook", "continuity"} {
		if review.Signals[signal] < criticalMinimum {
			return fmt.Errorf("关键质量信号 %s 低于 %d 分", signal, criticalMinimum)
		}
	}
	if unit <= 3 {
		strongCount := 0
		for _, signal := range novelWorkbenchV2QualitySignals {
			if review.Signals[signal] >= 7 {
				strongCount++
			}
		}
		if strongCount < 8 {
			return errors.New("首发三单元门禁要求至少 8 项质量信号达到 7 分")
		}
	}
	if !review.OverallPass {
		return errors.New("独立审稿未通过，但未提供可执行 blocker 或量化质量原因")
	}
	return nil
}

func applyNovelWorkbenchV2Writeback(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, card novelWorkbenchV2ControlCard, unit int, title string, output novelWorkbenchV2UnitOutput) (novelWorkbenchV2State, error) {
	if err := validateNovelWorkbenchV2Writeback(control, state, output.Writeback, unit); err != nil {
		return state, err
	}
	state = normalizeNovelWorkbenchV2State(state)
	for _, placement := range card.FactContract.CharacterPlacements {
		characterID := normalizeNovelWorkbenchV2ID(placement.CharacterID)
		locationID := normalizeNovelWorkbenchV2ID(placement.LocationID)
		if characterID != "" && locationID != "" && strings.ToLower(strings.TrimSpace(placement.Presence)) != "unknown" {
			state.CharacterLocations[characterID] = locationID
		}
	}
	for _, change := range output.Writeback.CharacterChanges {
		state.CharacterStates[normalizeNovelWorkbenchV2ID(change.ID)] = strings.TrimSpace(change.To)
	}
	for _, change := range output.Writeback.LocationChanges {
		state.CharacterLocations[normalizeNovelWorkbenchV2ID(change.CharacterID)] = normalizeNovelWorkbenchV2ID(change.ToLocationID)
	}
	for _, grant := range output.Writeback.KnowledgeGrants {
		characterID := normalizeNovelWorkbenchV2ID(grant.CharacterID)
		knownFacts := novelWorkbenchV2FactContractReferenceSet(state.CharacterKnowledge[characterID])
		for _, factID := range normalizeNovelWorkbenchV2IDs(grant.FactIDs) {
			knownFacts[factID] = struct{}{}
		}
		values := make([]string, 0, len(knownFacts))
		for factID := range knownFacts {
			values = append(values, factID)
		}
		sort.Strings(values)
		state.CharacterKnowledge[characterID] = values
	}
	for _, update := range output.Writeback.EvidenceUpdates {
		state.EvidenceLevels[normalizeNovelWorkbenchV2ID(update.EvidenceID)] = strings.ToLower(strings.TrimSpace(update.To))
	}
	for _, change := range output.Writeback.RelationshipChanges {
		state.RelationshipStates[normalizeNovelWorkbenchV2ID(change.ID)] = strings.TrimSpace(change.To)
	}
	for _, change := range output.Writeback.PlotlineChanges {
		state.PlotlineStates[normalizeNovelWorkbenchV2ID(change.ID)] = strings.TrimSpace(change.To)
	}
	for _, change := range output.Writeback.ForeshadowChanges {
		id := normalizeNovelWorkbenchV2ID(change.ID)
		state.ForeshadowStates[id] = strings.ToLower(strings.TrimSpace(change.To))
		if state.ForeshadowStates[id] == "introduced" {
			state.ForeshadowStartedAt[id] = unit
		}
	}
	for _, change := range output.Writeback.PromiseChanges {
		id := normalizeNovelWorkbenchV2ID(change.ID)
		state.PromiseStates[id] = strings.ToLower(strings.TrimSpace(change.To))
		if state.PromiseStates[id] == "introduced" {
			state.PromiseStartedAt[id] = unit
		}
	}
	for _, fact := range output.Writeback.NarrativeFacts {
		id := normalizeNovelWorkbenchV2ID(fact.ID)
		fact.ID = id
		fact.Statement = strings.TrimSpace(fact.Statement)
		fact.Status = strings.ToLower(strings.TrimSpace(fact.Status))
		state.NarrativeFacts[id] = fact
	}
	state.CompletedUnit = unit
	state.CurrentRoadmapID = roadmap.ID
	state.CurrentRoadmapTitle = roadmap.Title
	state.LastUnitSummary = strings.TrimSpace(output.Summary)
	state.NextUnitBridge = strings.TrimSpace(output.Writeback.NextUnitBridge)
	state.OpenDebtIDs = novelWorkbenchV2OpenDebtIDs(control, state)
	state.AuditTrail = append(state.AuditTrail, novelWorkbenchAuditEntry{Unit: unit, Title: title, Summary: state.LastUnitSummary, At: time.Now()})
	if len(state.AuditTrail) > 32 {
		state.AuditTrail = state.AuditTrail[len(state.AuditTrail)-32:]
	}
	return state, nil
}

func validateNovelWorkbenchV2PostCommit(control novelWorkbenchV2Control, state novelWorkbenchV2State, unit int) error {
	endgameStart := (control.Brief.TargetUnitCount*4 + 4) / 5
	if endgameStart < 1 {
		endgameStart = 1
	}
	for _, item := range control.Documents.ForeshadowLedger {
		if unit >= item.PayoffByUnit && state.ForeshadowStates[item.ID] != "paid" {
			return fmt.Errorf("伏笔 %s 到期未回收", item.ID)
		}
	}
	for _, item := range control.Documents.ReaderPromiseLedger {
		if unit >= item.PayoffByUnit && state.PromiseStates[item.ID] != "paid" {
			return fmt.Errorf("读者承诺 %s 到期未兑现", item.ID)
		}
	}
	if unit >= endgameStart {
		for _, item := range control.Documents.MainPlotlines {
			if unit >= item.ResolutionByUnit && state.PlotlineStates[item.ID] != "resolved" {
				return fmt.Errorf("结局收束阶段主线 %s 尚未解决", item.ID)
			}
		}
	}
	if unit == control.Brief.TargetUnitCount {
		for _, item := range control.Documents.ForeshadowLedger {
			if state.ForeshadowStates[item.ID] != "paid" {
				return fmt.Errorf("完结时伏笔 %s 未回收", item.ID)
			}
		}
		for _, item := range control.Documents.ReaderPromiseLedger {
			if state.PromiseStates[item.ID] != "paid" {
				return fmt.Errorf("完结时读者承诺 %s 未兑现", item.ID)
			}
		}
		for _, item := range control.Documents.MainPlotlines {
			if state.PlotlineStates[item.ID] != "resolved" {
				return fmt.Errorf("完结时主线 %s 未收束", item.ID)
			}
		}
	}
	return nil
}

func novelWorkbenchV2OpenDebtIDs(control novelWorkbenchV2Control, state novelWorkbenchV2State) []string {
	open := make([]string, 0)
	for _, item := range control.Documents.ForeshadowLedger {
		if state.ForeshadowStates[item.ID] != "paid" {
			open = append(open, item.ID)
		}
	}
	for _, item := range control.Documents.ReaderPromiseLedger {
		if state.PromiseStates[item.ID] != "paid" {
			open = append(open, item.ID)
		}
	}
	for _, item := range control.Documents.MainPlotlines {
		if state.PlotlineStates[item.ID] != "resolved" {
			open = append(open, item.ID)
		}
	}
	sort.Strings(open)
	return open
}

func errorText(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func nonEmptyStrings(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			result = append(result, value)
		}
	}
	return result
}

func buildNovelWorkbenchV2BootstrapPrompt(brief novelWorkbenchBrief) string {
	briefJSON, _ := json.Marshal(brief)
	unitLabel := "集"
	modeInstruction := "最终正文将是可拍摄的竖屏短剧剧本，必须服务于开场钩子、冲突升级、反转和结尾钩子。"
	ledgerRequirement := "6. 长篇至少准备一条伏笔和一条读者承诺。styleGuide 要明确语言、节奏和禁止漂移方向。"
	ledgerSchema := `"foreshadowLedger":[{"id":"foreshadow_","description":"","introducedByUnit":1,"payoffByUnit":2,"ownerIds":["char_"]}],"readerPromiseLedger":[{"id":"promise_","description":"","introducedByUnit":1,"payoffByUnit":2,"ownerIds":["char_"]}]`
	if brief.OutputMode == novelWorkbenchModeNovel {
		unitLabel = "章"
		modeInstruction = "最终正文将是可连载阅读的小说章节，必须服务于人物、因果、场景推进和读者追读。"
	}
	if brief.TargetUnitCount <= 1 {
		ledgerRequirement = "6. 只有一个单元时，伏笔和读者承诺账本可为空；styleGuide 仍要明确语言、节奏和禁止漂移方向。"
		ledgerSchema = `"foreshadowLedger":[],"readerPromiseLedger":[]`
	}
	return fmt.Sprintf(`你是中文长线叙事的总控编辑。请先为作品建立完整、可执行、可审计的创作控制档案。%s

用户简报：%s

要求：
1. 所有内容使用简体中文，必须原创，不得模仿具体作品、作者或影视 IP。
2. 每个 id 必须是稳定的英文小写下划线标识，例如 char_shenning、foreshadow_seal；后续写作只能引用这些 id，不能临时改名或新造核心实体。
3. chapterRoadmap 采用连续区段，不必预写每一%s标题，但必须从第 1 %s 无缝覆盖到第 %d %s；每个区段都有任务、升级、关键转折和离场债务。
4. 为每条主线、伏笔、读者承诺设定不能超过目标总数的明确收束节点；最后 20%% 必须负责清账和结局。
5. introducedByUnit 与 payoffByUnit 是程序执行的最晚生命周期节点：每条账本项必须在覆盖该单元的路线图中分别列入 plannedIntroductions 与 plannedPayoffs；同一单元最多安排三项账本动作，避免后续创作过载。
%s

只输出一个合法 JSON 对象，不能使用 Markdown 或解释。结构如下：
{"title":"","logline":"","documents":{"projectOverview":{"corePromise":"","centralConflict":"","endingResolution":"","audiencePayoff":""},"themeAndProposition":{"theme":"","proposition":"","price":""},"worldbuilding":{"rules":[""],"locations":[""],"constraints":[""]},"castBible":[{"id":"char_","name":"","role":"","desire":"","fear":"","blindSpot":"","voice":"","arc":"","initialState":""}],"relationshipMap":[{"id":"rel_","fromId":"char_","toId":"char_","description":"","initialState":""}],"mainPlotlines":[{"id":"plot_","title":"","goal":"","initialState":"open","resolutionByUnit":1}],%s,"chapterRoadmap":[{"id":"arc_","title":"","startUnit":1,"endUnit":1,"mission":"","escalation":"","keyTurn":"","exitDebt":"","plannedIntroductions":[""],"plannedPayoffs":[""]}],"styleGuide":{"narrativeVoice":"","pacingRules":[""],"forbiddenDrift":[""]},"writingLog":[]}}`, modeInstruction, string(briefJSON), unitLabel, unitLabel, brief.TargetUnitCount, unitLabel, ledgerRequirement, ledgerSchema)
}

func buildNovelWorkbenchV2BootstrapRepairPrompt(brief novelWorkbenchBrief, raw string, validationErr error) string {
	packet := novelWorkbenchV2RepairPacket{SchemaVersion: novelWorkbenchV2CompiledControlVersion, Stage: "bootstrap", Attempt: 1, FailureClass: "structural", FailureCode: "VALIDATION_FAILED", Failure: errorText(validationErr), RequiredFix: []string{errorText(validationErr)}, Preserve: []string{"保留已有的原创冲突和人物动力。"}}
	return buildNovelWorkbenchV2BootstrapRepairPromptWithPacket(brief, raw, packet)
}

func buildNovelWorkbenchV2BootstrapRepairPromptWithPacket(brief novelWorkbenchBrief, raw string, packet novelWorkbenchV2RepairPacket) string {
	packetJSON, _ := json.Marshal(packet)
	return fmt.Sprintf(`把下面的创作控制档案修复成合法 JSON。不得删除已有的原创冲突和人物动力，只处理本次失败单中列出的校验问题。所有 id 必须保持唯一且可引用；路线图必须连续覆盖第 1 到第 %d 单元；伏笔和读者承诺必须有可执行的引入与回收期限。严格保持失败单的 preserve，不要为了通过校验而删掉核心冲突、人物动力或既有账本。只输出 JSON。

本次失败单：%s

原始输出：
%s`, brief.TargetUnitCount, string(packetJSON), raw)
}

func buildNovelWorkbenchV2ControlCardPrompt(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, unit int, previousQualityBlock string) string {
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, unit)
	if err != nil {
		contract = novelWorkbenchV2EpisodeContract{Version: novelWorkbenchV2ContractVersion, Unit: unit, RoadmapID: roadmap.ID, RoadmapTitle: roadmap.Title}
	}
	return buildNovelWorkbenchV2ControlCardPromptWithContract(control, state, roadmap, contract, unit, previousQualityBlock)
}

func buildNovelWorkbenchV2ControlCardPromptWithContract(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, contract novelWorkbenchV2EpisodeContract, unit int, previousQualityBlock string) string {
	workPackageJSON := novelWorkbenchV2EpisodeWorkPackageJSON(control, state, roadmap, contract)
	contractJSON, _ := json.Marshal(contract)
	modeInstruction := "短剧控制卡必须让开场钩子、升级、反转、结尾钩子形成一条因果链。"
	if control.Brief.OutputMode == novelWorkbenchModeNovel {
		modeInstruction = "小说控制卡必须给出至少三个有因果推进的叙事节拍。"
	}
	locationAnchors := strings.Join(novelWorkbenchV2LocationAnchorList(control, state), "、")
	if locationAnchors == "" {
		locationAnchors = "无；不得编造地点 ID"
	}
	modeInstruction = fmt.Sprintf("%s\n可用地点锚点（characterPlacements.locationId 只能从中选择）：%s。自然语言的具体方位，例如“祖祠外门”，只能写入 locationDetail，不能代替 locationId。", modeInstruction, locationAnchors)
	previousQualityBlock = strings.TrimSpace(previousQualityBlock)
	priorBlockInstruction := "本项目没有此前的质量拦截。"
	if previousQualityBlock != "" {
		priorBlockInstruction = fmt.Sprintf("上次尝试被质量拦截。新控制卡必须针对其 blocker 设计不同且完整的因果链，不能用新增秘密、未建档旧物或新的悬案硬补：%s", truncateRunes(previousQualityBlock, 3_000))
	}
	return fmt.Sprintf(`你是长线作品的单元策划编辑。为第 %d 单元生成一张严格遵守既定档案的控制卡。%s

本集创作契约（由系统确定，不能删改或忽略）：%s
本集工作包（仅含当前创作所需的已冻结事实）：%s
历史质量上下文：%s

	只能使用工作包中已有的稳定 ID。创作契约 requiredIntroductions 的每个 ID 必须出现在 introduceIds；requiredPayoffs 的每个 ID 必须出现在 payoffIds。它们都必须设计为正文中可见的动作、信息或关系变化，不能只在 writeback 中声明。除契约明确要求外，introduceIds 和 payoffIds 只列出本单元实际写入并更新的伏笔/承诺 ID；不要凭空回收未引入的线索。工作包与契约中的 relevantLedgerIds 只是可参考的开放线索索引，不是要求你逐条写入本集 evidenceClaims 的清单。
创作契约 requiredCharacterIds 仅列系统在本集必须完成的账本动作所属角色，必须包含在控制卡 requiredCharacterIds。控制卡还应列出本集实际需要行动、知情或地点约束的角色，但不要把只存在于远期账本上下文的人物全部抄入。
causalSpine 必须至少四步，按顺序写出：已被画面建立的前置事实、主角基于该事实的主动选择、对手因可见的自身利益或风险而不得不作出的反应、可被当场验证的阶段结果。每一步必须能被拍出来，且下一步只能由上一步触发。
reversalAnchorIds 必须列出反转所依赖的已有稳定 ID。不得为让反转成立而新增未建档的秘密、旧物、程序、身份、动机或长期悬案；普通道具可以出现，但不能承担新的未追踪谜团。
factContract 是写正文前的事实边界，必须完整输出：
	1. characterPlacements 必须对 requiredCharacterIds 的每一位角色各写一项；presence 只能是 on_screen、off_screen 或 unknown。locationId 必须使用上方可用地点锚点中的稳定 ID；如需“祖祠外门”等镜头细节，填入 locationDetail。若动态状态或 stateLocks 已含 loc_ 地点，locationId 必须保持一致；没有实际移动时，必须完全省略 fromLocationId 和 movementCause 两个键。只有真的在本集完成移动时，才同时写 fromLocationId 和至少一句可拍摄的 movementCause。
2. knowledgeAccess 只列本集需要用来做关键判断、指控、推理或行动的既有长线事实。factIds 和 sourceIds 只能用伏笔/读者承诺 ID；角色此前不知道该事实时，必须 acquireInUnit=true，并写出本集可见的获得来源。没有来源的“突然知道”禁止出现。
	3. evidenceClaims 必须覆盖所有属于伏笔/读者承诺的 reversalAnchorIds、introduceIds 和 payoffIds，且只写这些本集锚点。已经在前集成立的相关线索，只有当它确实列入本集 knowledgeAccess 供角色作关键判断时，才可额外写入 evidenceClaims，并且必须保持当前证据等级，不能借背景线索暗中升级。不要把所有 relevantLedgerIds 或开放债务逐条复制进 evidenceClaims。level 只能是 lead、corroborated、proven，且锚点每次最多升一级。links[].kind 只能是 discovery、origin、custody、verification、testimony：physical_recovery、recovery、发现或取回统一写 discovery；interception、transfer、交接或保管统一写 custody，禁止自造新枚举。lead 只能得出有限线索；corroborated 至少两条不同类型的链路；proven 必须同时有 origin、custody、verification 三类可见链路。allowedConclusion 与 prohibitedConclusion 必须明确，禁止把线索直接写成定罪或身份真相。

只输出 JSON：
{"unit":%d,"roadmapId":"%s","mission":"","openingHook":"","coreConflict":"","escalation":"","reversal":"","closingHook":"","nextDebt":"","narrativeBeats":[""],"causalSpine":[""],"reversalAnchorIds":[""],"requiredCharacterIds":[""],"requiredRelationshipIds":[""],"introduceIds":[""],"payoffIds":[""],"factContract":{"characterPlacements":[{"characterId":"char_","locationId":"loc_","locationDetail":"祖祠外门","presence":"on_screen"}],"knowledgeAccess":[{"characterId":"char_","factIds":["foreshadow_"],"source":"","sourceIds":["foreshadow_"],"acquireInUnit":false}],"evidenceClaims":[{"evidenceId":"foreshadow_","level":"lead","links":[{"kind":"discovery","description":"","referenceIds":["foreshadow_"]}],"allowedConclusion":"","prohibitedConclusion":""}]}}`,
		unit, modeInstruction, string(contractJSON), workPackageJSON, priorBlockInstruction, unit, roadmap.ID)
}

func buildNovelWorkbenchV2ControlCardRepairPrompt(control novelWorkbenchV2Control, roadmap novelWorkbenchV2Roadmap, unit int, raw string, validationErr error) string {
	contract := novelWorkbenchV2EpisodeContract{Version: novelWorkbenchV2ContractVersion, Unit: unit, RoadmapID: roadmap.ID, RoadmapTitle: roadmap.Title}
	return buildNovelWorkbenchV2ControlCardRepairPromptWithContract(control, newNovelWorkbenchV2State(), roadmap, contract, unit, raw, validationErr)
}

func buildNovelWorkbenchV2ControlCardRepairPromptWithContract(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, contract novelWorkbenchV2EpisodeContract, unit int, raw string, validationErr error) string {
	known, _ := novelWorkbenchV2KnownIDsForControl(control)
	knownIDs := make([]string, 0, len(known.all))
	for id := range known.all {
		knownIDs = append(knownIDs, id)
	}
	sort.Strings(knownIDs)
	locationAnchors := strings.Join(novelWorkbenchV2LocationAnchorList(control, state), "、")
	if locationAnchors == "" {
		locationAnchors = "无"
	}
	contractJSON, _ := json.Marshal(contract)
	stateJSON, _ := json.Marshal(normalizeNovelWorkbenchV2State(state))
	return fmt.Sprintf(`修复第 %d 单元控制卡为合法 JSON。必须绑定路线图 %s，只能引用以下已有 ID：%s。characterPlacements.locationId 只能使用这些地点锚点：%s；“祖祠外门”等自然语言方位写入 locationDetail，不能充当 locationId。本集创作契约为：%s。当前动态状态为：%s。contract.requiredIntroductions 必须全部列入 introduceIds，contract.requiredPayoffs 必须全部列入 payoffIds，contract.requiredCharacterIds 必须全部列入 requiredCharacterIds；只在远期账本中出现但本集没有到期动作的角色不应被强行列入。不得将未引入的伏笔/承诺写入 payoffIds。causalSpine 必须至少四步：前置事实、主角主动选择、对手有利益动机的反应、可见验证结果。reversalAnchorIds 必须列出反转使用的已有稳定 ID，不能用未建档秘密或新悬案补因果。relevantLedgerIds 只是本集可参考的开放线索，绝不是要逐条复制到 evidenceClaims。factContract 必须完整保留：每名 requiredCharacter 都有地点/在场声明；已锁定 loc_ 地点不得凭空改变。角色未移动时，必须从 JSON 中完全删除 fromLocationId 和 movementCause；只有确实变更地点时才能同时填写两者。越知必须以本集可见来源和 sourceIds 获得；evidenceClaims 只保留反转、引入、回收锚点。已成立的背景线索只有在 knowledgeAccess 中被本集角色实际使用时才可列入，且不得改变它的证据等级。每个账本锚点都要声明不越级的证据等级、可见链路、允许与禁止结论。links[].kind 只能是 discovery、origin、custody、verification、testimony；physical_recovery/recovery 写 discovery，interception/transfer 写 custody，禁止自造枚举。校验错误：%s

原始控制卡：
%s

	只输出 JSON。`, unit, roadmap.ID, strings.Join(knownIDs, ", "), locationAnchors, string(contractJSON), string(stateJSON), validationErr.Error(), raw)
}

func buildNovelWorkbenchV2WriterPrompt(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, card novelWorkbenchV2ControlCard, unit int) string {
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, unit)
	if err != nil {
		contract = novelWorkbenchV2EpisodeContract{Version: novelWorkbenchV2ContractVersion, Unit: unit, RoadmapID: roadmap.ID, RoadmapTitle: roadmap.Title}
	}
	return buildNovelWorkbenchV2WriterPromptWithContract(control, state, roadmap, contract, card, unit)
}

func buildNovelWorkbenchV2WriterPromptWithContract(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, contract novelWorkbenchV2EpisodeContract, card novelWorkbenchV2ControlCard, unit int) string {
	workPackageJSON := novelWorkbenchV2EpisodeWorkPackageJSON(control, state, roadmap, contract)
	contractJSON, _ := json.Marshal(contract)
	cardJSON, _ := json.Marshal(card)
	formatInstruction := "写成可拍摄的竖屏短剧剧本，包含清晰的场景、动作、对白和必要音效；不能把控制卡原样写成提纲。"
	if control.Brief.OutputMode == novelWorkbenchModeNovel {
		formatInstruction = "写成完整小说章节，包含场景、行动、对白、情绪和因果；不能写成提纲或复盘。"
	}
	stateLocks := novelWorkbenchV2RelevantStateLocks(state, card)
	return fmt.Sprintf(`你是这部作品的执行主笔。只写第 %d 单元，严格服从冻结控制档案、动态状态和控制卡。%s

本集创作契约（由系统确定，不得修改）：%s
本集工作包（已冻结的相关事实）：%s
本单元控制卡：%s
不可改写的当前事实：%s

执行要求：
1. 正文必须落实控制卡所列人物压力、核心冲突、节奏与尾钩；不允许改写已提交事实。
2. 不得引入没有稳定 ID 的新核心人物、关系、主线、伏笔或读者承诺。
3. 创作契约 requiredIntroductions 中每一项都必须在正文中形成可见线索，并在 writeback 对应为 introduced；requiredPayoffs 中每一项都必须在正文中形成可见兑现，并在 writeback 对应为 paid。控制卡中的其他 introduceIds/payoffIds 同样必须精确写回。伏笔/承诺不得同一单元引入并回收。
4. 用户希望本集约 %d 字、目标时长约 %d 秒，这只是节奏和篇幅参考，不设提交前的最低或最高字数。请用足够但不过度的篇幅完成控制卡的冲突、因果、兑现和尾钩：不得为凑字数重复动作或对白，也不得为压缩字数省略关键因果。审稿将结合场景数、信息密度和成片节奏判断是否适合本集。结尾要给出具体、因果性的下一集压力。
5. writeback 的 from 必须精确填写变更前状态；无变化可用空数组。主线状态只能是 open、advanced、resolved，账本状态只能是 introduced、active、paid。
6. “不可改写的当前事实”是本单元开头已经成立的事实。除非控制卡明确要求并在 writeback 中合法记录状态推进，正文不得将其提前推进、否定或改名；例如被收监或被囚不等于已经画押、认罪、交代秘密或死亡。
7. causalSpine 是本单元不可改变的因果骨架。正文必须以可见动作、台词或物证依次落实其每一环；不得让对手为推进剧情而无动机行动，也不得用新的秘密、旧物或未追踪谜团来填补其中任一环。
8. reversalAnchorIds 是反转可依赖的稳定锚点。普通道具可服务场面，但不得被升级成新的长期谜团、证据链或人物动机；任何持续到下一单元的谜团都必须绑定已有 introduceIds、payoffIds 或 reversalAnchorIds 中的稳定 ID。
9. factContract 是本集不可违反的场景真相：角色只能在其 characterPlacements 所列地点与在场状态中行动；没有写明可见移动就不能换地点。任何关键判断、指控或推理必须只使用该角色 knowledgeAccess 中已获知的 factIds；acquireInUnit=true 的信息必须先在正文中展示来源。每项 evidenceClaim 只能写到 allowedConclusion，严禁越过 prohibitedConclusion；例如 lead 只能证明线索存在，不能直接证明作者、收件人、犯罪责任或身份真相。
10. writeback 必须如实写出 factContract 导致的状态变化：发生地点移动时填 locationChanges；本集获得新知时填 knowledgeGrants；证据等级提升时填 evidenceUpdates。没有变化的数组留空，不能凭空写回。

只输出 JSON：
{"unit":%d,"title":"","content":"","summary":"","writeback":{"characterChanges":[{"id":"","from":"","to":"","note":""}],"locationChanges":[{"characterId":"char_","fromLocationId":"loc_","toLocationId":"loc_","note":""}],"knowledgeGrants":[{"characterId":"char_","factIds":["foreshadow_"],"sourceIds":["foreshadow_"],"note":""}],"evidenceUpdates":[{"evidenceId":"foreshadow_","from":"unseen","to":"lead","note":""}],"relationshipChanges":[{"id":"","from":"","to":"","note":""}],"plotlineChanges":[{"id":"","from":"","to":"advanced","note":""}],"foreshadowChanges":[{"id":"","from":"planned","to":"introduced","note":""}],"promiseChanges":[{"id":"","from":"planned","to":"introduced","note":""}],"nextUnitBridge":""}}`,
		unit, formatInstruction, string(contractJSON), workPackageJSON, string(cardJSON), stateLocks, control.Brief.TargetUnitLength, control.Brief.UnitDurationSeconds, unit)
}

func buildNovelWorkbenchV2ReviewPrompt(control novelWorkbenchV2Control, state novelWorkbenchV2State, card novelWorkbenchV2ControlCard, output novelWorkbenchV2UnitOutput, unit int) string {
	roadmap, _ := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, unit)
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, unit)
	if err != nil {
		contract = novelWorkbenchV2EpisodeContract{Version: novelWorkbenchV2ContractVersion, Unit: unit, RoadmapID: roadmap.ID, RoadmapTitle: roadmap.Title}
	}
	return buildNovelWorkbenchV2ReviewPromptWithContract(control, state, roadmap, contract, card, output, unit)
}

func buildNovelWorkbenchV2ReviewPromptWithContract(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, contract novelWorkbenchV2EpisodeContract, card novelWorkbenchV2ControlCard, output novelWorkbenchV2UnitOutput, unit int) string {
	workPackageJSON := novelWorkbenchV2EpisodeWorkPackageJSON(control, state, roadmap, contract)
	contractJSON, _ := json.Marshal(contract)
	cardJSON, _ := json.Marshal(card)
	persistenceJSON, _ := json.Marshal(compileNovelWorkbenchV2PersistenceContract(state, novelWorkbenchV2ScopedRoadmap(control, state, roadmap, contract), unit))
	outputJSON, _ := json.Marshal(output)
	knownIDs := novelWorkbenchV2StableIDList(control)
	contentLength := len([]rune(strings.TrimSpace(output.Content)))
	return fmt.Sprintf(`你是独立的中文商业叙事审稿编辑，不负责重写正文。审查第 %d 单元是否能够提交到不可逆的长线创作档案。

本集创作契约（由系统确定）：%s
本集工作包（已冻结的相关事实）：%s
本单元控制卡：%s
持久事实合同（由编译器确定）：%s
候选正文与写回：%s

可引用的稳定 ID：%s
referenceIds 与每个问题的 referenceId 只能使用上面清单中的稳定 ID。控制档案 JSON 的字段名（例如 styleGuide、worldbuilding、projectOverview）不是 ID，不能填入。若意见只涉及整体风格、世界规则或一般叙事问题，请在 evidence 和 repairAction 中说明，并将 referenceId 留空；没有稳定 ID 可引用时，referenceIds 使用空数组。

逐项以 0 到 10 分评分：antiAi（去模板感）、storyLogic（因果）、stateGuard（状态一致）、emotion（情绪）、blockbuster（爽点/戏剧性）、visiblePayoff（可见回报）、readerPull（追读）、titleHook（标题/钩子）、characterVoice（人物声线）、domainTranslation（类型表达）、novelty（新鲜感）、continuity（前后连续）。只有你认为可提交才 overallPass=true。blockingIssues 只放会阻止提交的问题，severity 使用 blocker 或 warning，引用已知 id 时填写 referenceId。
篇幅与节奏审查：用户目标约 %d 字、单集目标时长约 %d 秒，候选正文约 %d 字。没有固定的字数上下限，数字不能单独作为提交条件。必须结合控制卡要求、场景数、对白与动作密度、信息推进、情绪蓄力和结尾钩子判断本集能否承载目标时长与观看节奏。仅有轻微字数偏差时，以 UNIT_PACING_LENGTH_NOTE warning 记录，overallPass 仍可为 true。只有正文因明显注水、过度稀薄或过度压缩而无法完成当前单元的节奏和戏剧功能时，才可用 UNIT_PACING_LENGTH_MISMATCH blocker；evidence 必须指出具体表现，repairAction 必须说明需调整的场景、动作、对白或信息功能，不能只要求压缩或扩写到某个字数。
必须逐项核验控制卡 causalSpine：前置事实、主角选择、对手的自利反应、现场验证是否都已在正文中被可见地建立；任何关键动作若缺乏上一步的明确动机，视为 storyLogic blocker。必须逐项核验创作契约 requiredIntroductions 与 requiredPayoffs：不得只在 writeback 中伪造状态，正文必须给出可被读者识别的线索或兑现；缺失时为 blocker。任何新增长期谜团、证据、秘密或债务，若无法绑定控制卡 reversalAnchorIds、introduceIds 或 payoffIds 中的稳定 ID，视为 blocker，不得因其“增加悬念”放行。
必须逐项核验持久事实合同：requiredFacts 是本集唯一允许新增并跨集生效的结果，正文必须以可见行动兑现；activeFacts 与 frozenContinuity 必须保持连续。若正文声称合同未列出的长期权限、释放或拘押、地点转场、具体时间安排、物件交接、关系承诺或证据结论已经生效，必须给出 UNCOMPILED_PERSISTENT_FACT blocker；repairAction 只能要求删去该持久结论、改为当场未决，或收束为合同已列的 requiredFacts，绝不能要求补写或修改 writeback。frozenContinuity 含有角色受限、封锁或未解决行动压力时，正文若改变它，必须先写清可见触发、过程和后果。
候选中的 writeback 全部由编译器生成，不是主笔输出，也不是审稿人可要求补齐的字段。不得使用 ARCHIVAL_WRITEBACK_OMISSION，不得要求作者补写状态、ID、地点变更或账本迁移；只检查编译器已经给出的 writeback 是否与本集 requiredFacts、factContract 和账本动作相符，任何额外持久结果一律按 UNCOMPILED_PERSISTENT_FACT 审核正文。
必须逐项核验 factContract：角色不得在未写出移动的情况下离开已锁定地点；off_screen 角色不得被写成现场动作或明确声源。关键角色的判断、指控与行动是否只使用 knowledgeAccess 中已知或本集可见获得的信息；否则为 TEMPORAL_KNOWLEDGE_BREACH blocker。证据是否严格停在 evidenceClaims.allowedConclusion，且每一级都能在正文看见 links 所需的来源、保管/传递、核验或证词；把 lead 当作身份、作者、收件人或罪责证明，或跳过中间链路，均为 EVIDENCE_CHAIN_GAP blocker。

只输出 JSON：
{"unit":%d,"overallPass":false,"signals":{"antiAi":0,"storyLogic":0,"stateGuard":0,"emotion":0,"blockbuster":0,"visiblePayoff":0,"readerPull":0,"titleHook":0,"characterVoice":0,"domainTranslation":0,"novelty":0,"continuity":0},"blockingIssues":[{"code":"","severity":"blocker","referenceId":"","evidence":"","repairAction":""}],"warnings":[{"code":"","severity":"warning","referenceId":"","evidence":"","repairAction":""}],"referenceIds":[""],"verdict":""}`,
		unit, string(contractJSON), workPackageJSON, string(cardJSON), string(persistenceJSON), string(outputJSON), knownIDs, control.Brief.TargetUnitLength, control.Brief.UnitDurationSeconds, contentLength, unit)
}

func novelWorkbenchV2StableIDList(control novelWorkbenchV2Control) string {
	known, err := novelWorkbenchV2KnownIDsForControl(control)
	if err != nil {
		return ""
	}
	ids := make([]string, 0, len(known.all))
	for id := range known.all {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return strings.Join(ids, ", ")
}

func buildNovelWorkbenchV2RepairPrompt(control novelWorkbenchV2Control, state novelWorkbenchV2State, card novelWorkbenchV2ControlCard, unit int, raw string, repairContext string) string {
	roadmap, _ := novelWorkbenchV2RoadmapForUnit(control.Documents.ChapterRoadmap, unit)
	contract, err := compileNovelWorkbenchV2EpisodeContract(control, state, roadmap, unit)
	if err != nil {
		contract = novelWorkbenchV2EpisodeContract{Version: novelWorkbenchV2ContractVersion, Unit: unit, RoadmapID: roadmap.ID, RoadmapTitle: roadmap.Title}
	}
	return buildNovelWorkbenchV2RepairPromptWithContract(control, state, roadmap, contract, card, unit, raw, repairContext)
}

func buildNovelWorkbenchV2RepairPromptWithContract(control novelWorkbenchV2Control, state novelWorkbenchV2State, roadmap novelWorkbenchV2Roadmap, contract novelWorkbenchV2EpisodeContract, card novelWorkbenchV2ControlCard, unit int, raw string, repairContext string) string {
	workPackageJSON := novelWorkbenchV2EpisodeWorkPackageJSON(control, state, roadmap, contract)
	contractJSON, _ := json.Marshal(contract)
	cardJSON, _ := json.Marshal(card)
	stateLocks := novelWorkbenchV2RelevantStateLocks(state, card)
	return fmt.Sprintf(`重写第 %d 单元，使其能够通过创作控制系统。保留有价值的原创内容，但必须逐项修复下列问题，不能降低字数到提纲，也不得规避 writeback 的固定 ID 和状态迁移。

修复清单：%s
本集创作契约（由系统确定，不得修改）：%s
本集工作包（已冻结的相关事实）：%s
控制卡：%s
不可改写的当前事实：%s
上一稿：%s

硬性返修规则：
1. 所有 blocker 均必须逐项完成 repairAction；不要只复述审稿结论。
2. 字数不是硬性返修条件。仅当修复清单明确指出本集的节奏、时长承载或信息密度有问题时，才按 repairAction 调整场景、动作、对白和信息功能；不设最低或最高字数，不能为了凑目标或机械压缩而删掉因果链、兑现或尾钩。
3. 不可改写的当前事实在本单元开始时已成立；除非控制卡明确要求并在 writeback 中合法记录，禁止把角色、关系或证据状态提前推进。
4. 不得新增未建档核心人物或用未验证设定替换控制卡既定角色功能。
5. causalSpine 的四步因果必须全部在正文中实现。修复因果 blocker 时，先改写触发行为与可见动机，再写结果；严禁新增“某份旧物”“某个秘密”“有人早已安排”等未绑定稳定 ID 的解释性谜团。
6. reversalAnchorIds 之外的普通道具不能成为新的长期证据、秘密或债务。若当前稿已有此类新增谜团，删除它并改用控制卡已有锚点完成反转。
7. 创作契约 requiredIntroductions 与 requiredPayoffs 不得删除、改名或只在 writeback 中伪造；必须同时保留正文可见证据和正确状态写回。
8. 严格执行控制卡 factContract：不写未经记录的地点移动，不让角色使用其 knowledgeAccess 之外的事实；证据只能得出 allowedConclusion，且正文必须落实每条 links。发生的地点移动、新知获得、证据等级提升必须分别精确写入 locationChanges、knowledgeGrants、evidenceUpdates。

只输出与原任务一致的完整 JSON 正文对象。`, unit, repairContext, string(contractJSON), workPackageJSON, string(cardJSON), stateLocks, raw)
}

func novelWorkbenchV2RelevantStateLocks(state novelWorkbenchV2State, card novelWorkbenchV2ControlCard) string {
	lines := make([]string, 0, len(card.RequiredCharacterIDs)+len(card.RequiredRelationshipIDs))
	seen := map[string]struct{}{}
	appendLock := func(id string, value string) {
		id = normalizeNovelWorkbenchV2ID(id)
		value = strings.TrimSpace(value)
		if id == "" || value == "" {
			return
		}
		if _, exists := seen[id]; exists {
			return
		}
		seen[id] = struct{}{}
		lines = append(lines, fmt.Sprintf("- %s：%s", id, value))
	}
	for _, id := range card.RequiredCharacterIDs {
		appendLock(id, state.CharacterStates[normalizeNovelWorkbenchV2ID(id)])
	}
	for _, id := range card.RequiredRelationshipIDs {
		appendLock(id, state.RelationshipStates[normalizeNovelWorkbenchV2ID(id)])
	}
	if len(lines) == 0 {
		return "无额外状态锁；仍须遵守动态状态。"
	}
	return strings.Join(lines, "\n")
}

func novelWorkbenchV2ReviewRepairContext(review novelWorkbenchV2ReviewReport) string {
	lines := make([]string, 0, len(review.BlockingIssues)+1)
	for _, issue := range review.BlockingIssues {
		severity := strings.ToLower(strings.TrimSpace(issue.Severity))
		if severity == "" || severity == "blocker" || severity == "fatal" {
			lines = append(lines, fmt.Sprintf("blocker [%s]\n问题：%s\n修复动作：%s", strings.TrimSpace(issue.Code), strings.TrimSpace(issue.Evidence), strings.TrimSpace(issue.RepairAction)))
		}
	}
	if len(lines) > 0 {
		if verdict := strings.TrimSpace(review.Verdict); verdict != "" {
			lines = append(lines, "审稿结论："+verdict)
		}
	}
	return strings.Join(lines, "\n\n")
}

func (s *Service) RebuildNovelWorkbench(ctx context.Context, userID string, projectID string, req RebuildNovelWorkbenchRequest) (*StartNovelWorkbenchResult, error) {
	if len(req.Config) == 0 && strings.TrimSpace(req.LogicalModelID) == "" {
		return nil, BadAuthRequest("请先选择可用的文本模型")
	}
	run, err := s.novelWorkbenchRunForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	project, err := s.repo.ProjectForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	if run.Status == novelWorkbenchStatusArchived {
		return nil, BadAuthRequest("重建前快照不能再次重建")
	}
	if run.Status != novelWorkbenchStatusCompleted {
		if _, err := s.PauseNovelWorkbench(ctx, userID, projectID); err != nil {
			return nil, err
		}
		run, err = s.novelWorkbenchRunForUser(userID, projectID)
		if err != nil {
			return nil, err
		}
	}
	brief, err := novelWorkbenchBriefForRebuild(run, project)
	if err != nil {
		return nil, err
	}
	units, err := s.repo.ProjectUnits(projectID)
	if err != nil {
		return nil, err
	}
	if len(units) == 0 {
		return s.rebuildNovelWorkbenchInPlace(run, *project, brief, req)
	}
	return s.rebuildNovelWorkbenchAsNewProject(run, *project, units, brief, req)
}

func novelWorkbenchBriefForRebuild(run *model.NovelWorkbenchRun, project *model.Project) (novelWorkbenchBrief, error) {
	if run.EngineVersion >= novelWorkbenchV2EngineVersion {
		control, err := decodeNovelWorkbenchV2Control(run.ControlJSON)
		if err != nil {
			return novelWorkbenchBrief{}, err
		}
		control.Brief.ProjectName = firstNonEmptyString(strings.TrimSpace(control.Brief.ProjectName), project.Name)
		return control.Brief, nil
	}
	control, err := decodeNovelWorkbenchControl(run.ControlJSON)
	if err != nil {
		return novelWorkbenchBrief{}, err
	}
	control.Brief.ProjectName = firstNonEmptyString(strings.TrimSpace(control.Brief.ProjectName), project.Name)
	return control.Brief, nil
}

func (s *Service) rebuildNovelWorkbenchInPlace(run *model.NovelWorkbenchRun, project model.Project, brief novelWorkbenchBrief, req RebuildNovelWorkbenchRequest) (*StartNovelWorkbenchResult, error) {
	controlJSON, err := json.Marshal(newNovelWorkbenchV2Control(brief))
	if err != nil {
		return nil, err
	}
	stateJSON, err := json.Marshal(newNovelWorkbenchV2State())
	if err != nil {
		return nil, err
	}
	run.EngineVersion = novelWorkbenchV2EngineVersion
	run.OutputMode = brief.OutputMode
	run.Status = novelWorkbenchStatusQueued
	run.Stage = "等待重建创作控制档案"
	run.PipelineStage = novelWorkbenchV2PipelineBootstrap
	run.QualityPolicy = novelWorkbenchV2QualityPolicy
	run.QualityBlockReason = ""
	run.TargetUnitCount = brief.TargetUnitCount
	run.CompletedUnitCount = 0
	run.CurrentUnit = 0
	run.CurrentTaskID = ""
	run.ControlJSON = string(controlJSON)
	run.DynamicStateJSON = string(stateJSON)
	run.LastError = ""
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return nil, err
	}
	task, err := s.enqueueNovelWorkbenchTask(run.UserID, run.ProjectID, run.ID, novelWorkbenchPhaseBootstrap, 0, req.Config, req.LogicalModelID, "重建创作控制档案")
	if err != nil {
		return nil, err
	}
	run.CurrentTaskID = task.ID
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return nil, err
	}
	return &StartNovelWorkbenchResult{Project: project, Run: *run, Task: taskForOutput(*task)}, nil
}

func (s *Service) rebuildNovelWorkbenchAsNewProject(sourceRun *model.NovelWorkbenchRun, sourceProject model.Project, units []model.ProjectUnit, brief novelWorkbenchBrief, req RebuildNovelWorkbenchRequest) (*StartNovelWorkbenchResult, error) {
	name, err := s.nextNovelWorkbenchRebuildName(sourceRun.UserID, sourceProject.Name)
	if err != nil {
		return nil, err
	}
	projectType := "novel"
	if brief.OutputMode == novelWorkbenchModeScreenplay {
		projectType = "short-drama"
	}
	freshProject, err := s.CreateProject(sourceRun.UserID, CreateProjectRequest{Name: name, Type: projectType, AspectRatio: sourceProject.AspectRatio, SourceType: "novel-workbench", Description: sourceProject.Description})
	if err != nil {
		return nil, err
	}
	brief.ProjectName = freshProject.Name
	controlJSON, err := json.Marshal(newNovelWorkbenchV2Control(brief))
	if err != nil {
		return nil, err
	}
	stateJSON, err := json.Marshal(newNovelWorkbenchV2State())
	if err != nil {
		return nil, err
	}
	now := time.Now()
	freshRun := model.NovelWorkbenchRun{ID: newID(), UserID: sourceRun.UserID, ProjectID: freshProject.ID, OutputMode: brief.OutputMode, EngineVersion: novelWorkbenchV2EngineVersion, Status: novelWorkbenchStatusQueued, Stage: "等待重建创作控制档案", PipelineStage: novelWorkbenchV2PipelineBootstrap, QualityPolicy: novelWorkbenchV2QualityPolicy, TargetUnitCount: brief.TargetUnitCount, ControlJSON: string(controlJSON), DynamicStateJSON: string(stateJSON), CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateNovelWorkbenchRun(&freshRun); err != nil {
		return nil, err
	}
	snapshot := make([]map[string]any, 0, len(units))
	for _, unit := range units {
		snapshot = append(snapshot, map[string]any{"position": unit.Position + 1, "title": unit.Title, "summary": truncateRunes(strings.TrimSpace(unit.SourceText), 600)})
	}
	if err := s.createNovelWorkbenchV2Artifact(&freshRun, 0, "legacy_snapshot", 0, map[string]any{"sourceProjectId": sourceProject.ID, "units": snapshot}, ""); err != nil {
		return nil, err
	}
	task, err := s.enqueueNovelWorkbenchTask(sourceRun.UserID, freshProject.ID, freshRun.ID, novelWorkbenchPhaseBootstrap, 0, req.Config, req.LogicalModelID, "建立重建版创作控制档案")
	if err != nil {
		return nil, err
	}
	freshRun.CurrentTaskID = task.ID
	freshRun.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(&freshRun); err != nil {
		return nil, err
	}
	sourceProject.Status = model.ProjectStatusArchived
	sourceProject.UpdatedAt = time.Now()
	if err := s.repo.UpdateProject(&sourceProject); err != nil {
		return nil, err
	}
	sourceRun.Status = novelWorkbenchStatusArchived
	sourceRun.Stage = "已归档为重建前快照"
	sourceRun.PipelineStage = "archived"
	sourceRun.CurrentTaskID = ""
	sourceRun.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(sourceRun); err != nil {
		return nil, err
	}
	return &StartNovelWorkbenchResult{Project: freshProject, Run: freshRun, Task: taskForOutput(*task)}, nil
}

func (s *Service) nextNovelWorkbenchRebuildName(userID string, base string) (string, error) {
	base = truncateRunes(strings.TrimSpace(base), 210)
	if base == "" {
		base = "未命名创作"
	}
	for sequence := 1; sequence <= 99; sequence++ {
		suffix := "（重建版）"
		if sequence > 1 {
			suffix = fmt.Sprintf("（重建版 %d）", sequence)
		}
		candidate := base + suffix
		_, err := s.repo.ProjectForUser(userID, candidate)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return candidate, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", errors.New("无法生成唯一的重建项目名称")
}

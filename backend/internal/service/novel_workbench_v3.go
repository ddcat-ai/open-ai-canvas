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

	"infinite-canvas/backend/internal/model"
)

// V3 keeps a small frozen book map, seals one executable arc at a time, and
// derives all persistent state from that sealed package.
const (
	novelWorkbenchV3EngineVersion  = 3
	novelWorkbenchV3QualityPolicy  = "arc-sealed-v3"
	novelWorkbenchV3ArcPlanVersion = 1

	novelWorkbenchV3PipelineBootstrap = "bootstrap"
	novelWorkbenchV3PipelinePrepare   = "arc_prepare"
	novelWorkbenchV3PipelinePlan      = "arc_plan"
	novelWorkbenchV3PipelineArcReview = "arc_review"
	novelWorkbenchV3PipelineSeal      = "arc_seal"
	novelWorkbenchV3PipelineDraft     = "draft"
	novelWorkbenchV3PipelineReview    = "review"
	novelWorkbenchV3PipelineRepair    = "repair"
	novelWorkbenchV3PipelineCommit    = "commit"
	novelWorkbenchV3PipelineBlocked   = "quality_blocked"

	novelWorkbenchV3MaxBootstrapAttempts       = 2
	novelWorkbenchV3MaxArcPlanAttempts         = 2
	novelWorkbenchV3MaxReviewAttempts          = 2
	novelWorkbenchV3MaxLocalizedPatchAttempts  = 2
	novelWorkbenchV3MaxFullRewriteAttempts     = 1
	novelWorkbenchV3RecentSummaryLimit         = 6
	novelWorkbenchV3MaxCanonicalCharacterCount = 20
	novelWorkbenchV3MaxCanonicalFactCount      = 48
)

type novelWorkbenchV3Control struct {
	EngineVersion int                        `json:"engineVersion"`
	Title         string                     `json:"title"`
	Logline       string                     `json:"logline"`
	Brief         novelWorkbenchBrief        `json:"brief"`
	Bible         novelWorkbenchV3Bible      `json:"bible"`
	StoryMap      []novelWorkbenchV3StoryArc `json:"storyMap"`
	Style         novelWorkbenchV3StyleGuide `json:"style"`
}

type novelWorkbenchV3Bible struct {
	Premise       string                      `json:"premise"`
	EndingPromise string                      `json:"endingPromise"`
	Theme         string                      `json:"theme"`
	WorldRules    []string                    `json:"worldRules"`
	Characters    []novelWorkbenchV3Character `json:"characters"`
	Facts         []novelWorkbenchV3Fact      `json:"facts"`
}

type novelWorkbenchV3Character struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Role         string `json:"role"`
	Desire       string `json:"desire"`
	Fear         string `json:"fear"`
	Voice        string `json:"voice"`
	InitialState string `json:"initialState"`
}

// A fact is deliberately broader than evidence. A fact is only a durable
// truth, reader promise, or reader question. Observations that cannot support
// a unique conclusion stay in prose and must not be promoted into this ledger.
type novelWorkbenchV3Fact struct {
	ID               string   `json:"id"`
	Statement        string   `json:"statement"`
	Kind             string   `json:"kind"` // fact, promise, question
	IntroducedByUnit int      `json:"introducedByUnit"`
	ResolveByUnit    int      `json:"resolveByUnit"`
	OwnerIDs         []string `json:"ownerIds"`
}

type novelWorkbenchV3StoryArc struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	StartUnit    int    `json:"startUnit"`
	EndUnit      int    `json:"endUnit"`
	Mission      string `json:"mission"`
	TurningPoint string `json:"turningPoint"`
	ExitPromise  string `json:"exitPromise"`
}

type novelWorkbenchV3StyleGuide struct {
	NarrativeVoice string   `json:"narrativeVoice"`
	PacingRules    []string `json:"pacingRules"`
	ForbiddenDrift []string `json:"forbiddenDrift"`
}

type novelWorkbenchV3BootstrapOutput struct {
	Title    string                     `json:"title"`
	Logline  string                     `json:"logline"`
	Bible    novelWorkbenchV3Bible      `json:"bible"`
	StoryMap []novelWorkbenchV3StoryArc `json:"storyMap"`
	Style    novelWorkbenchV3StyleGuide `json:"style"`
}

type novelWorkbenchV3CharacterState struct {
	Status       string   `json:"status"`
	Location     string   `json:"location"`
	KnownFactIDs []string `json:"knownFactIds"`
}

type novelWorkbenchV3OpenQuestion struct {
	ID         string `json:"id"`
	Text       string `json:"text"`
	OpenedUnit int    `json:"openedUnit"`
}

type novelWorkbenchV3UnitSummary struct {
	Unit    int    `json:"unit"`
	Title   string `json:"title"`
	Summary string `json:"summary"`
}

type novelWorkbenchV3State struct {
	CompletedUnit   int                                       `json:"completedUnit"`
	CurrentArcID    string                                    `json:"currentArcId"`
	CurrentArc      *novelWorkbenchV3ArcPackage               `json:"currentArc,omitempty"`
	LastUnitSummary string                                    `json:"lastUnitSummary"`
	NextUnitBridge  string                                    `json:"nextUnitBridge"`
	CharacterStates map[string]novelWorkbenchV3CharacterState `json:"characterStates"`
	FactStates      map[string]string                         `json:"factStates"`
	OpenQuestions   []novelWorkbenchV3OpenQuestion            `json:"openQuestions"`
	RecentSummaries []novelWorkbenchV3UnitSummary             `json:"recentSummaries"`
}

func (state novelWorkbenchV3State) CurrentArcTitle() string {
	if state.CurrentArc != nil && strings.TrimSpace(state.CurrentArc.Title) != "" {
		return state.CurrentArc.Title
	}
	return strings.TrimSpace(state.CurrentArcID)
}

type novelWorkbenchV3ArcPackage struct {
	Version     int                             `json:"version"`
	ArcID       string                          `json:"arcId"`
	Title       string                          `json:"title"`
	StartUnit   int                             `json:"startUnit"`
	EndUnit     int                             `json:"endUnit"`
	EntryDigest string                          `json:"entryDigest"`
	ArcSummary  string                          `json:"arcSummary"`
	Packets     []novelWorkbenchV3EpisodePacket `json:"packets"`
	SealedAt    time.Time                       `json:"sealedAt"`
}

type novelWorkbenchV3ArcPlanOutput struct {
	EntryDigest string                          `json:"entryDigest"`
	ArcSummary  string                          `json:"arcSummary"`
	Packets     []novelWorkbenchV3EpisodePacket `json:"packets"`
}

// EpisodePacket is the only model-authored execution plan used at runtime.
// The writer cannot provide a free-form writeback: commit derives state from
// this packet after the prose is accepted.
type novelWorkbenchV3EpisodePacket struct {
	Unit                 int                               `json:"unit"`
	Title                string                            `json:"title"`
	EntryBridge          string                            `json:"entryBridge"`
	Goal                 string                            `json:"goal"`
	Pressure             string                            `json:"pressure"`
	Choice               string                            `json:"choice"`
	Turn                 string                            `json:"turn"`
	ExitDebt             string                            `json:"exitDebt"`
	CharacterIDs         []string                          `json:"characterIds"`
	FactActions          []novelWorkbenchV3FactAction      `json:"factActions"`
	CharacterChanges     []novelWorkbenchV3CharacterChange `json:"characterChanges"`
	KnowledgeGrants      []novelWorkbenchV3KnowledgeGrant  `json:"knowledgeGrants"`
	RequiredEvents       []string                          `json:"requiredEvents"`
	AllowedConclusion    string                            `json:"allowedConclusion"`
	ForbiddenConclusions []string                          `json:"forbiddenConclusions"`
}

type novelWorkbenchV3FactAction struct {
	FactID       string `json:"factId"`
	Action       string `json:"action"` // introduce, advance, resolve
	VisibleEvent string `json:"visibleEvent"`
}

type novelWorkbenchV3CharacterChange struct {
	CharacterID string `json:"characterId"`
	ToStatus    string `json:"toStatus"`
	ToLocation  string `json:"toLocation"`
	Reason      string `json:"reason"`
}

type novelWorkbenchV3KnowledgeGrant struct {
	CharacterID string   `json:"characterId"`
	FactIDs     []string `json:"factIds"`
	Reason      string   `json:"reason"`
}

type novelWorkbenchV3Draft struct {
	Unit    int    `json:"unit"`
	Title   string `json:"title"`
	Content string `json:"content"`
	Summary string `json:"summary"`
}

const (
	novelWorkbenchV3RecoveryInitial        = "initial"
	novelWorkbenchV3RecoveryLocalizedPatch = "localized_patch"
	novelWorkbenchV3RecoveryFullRewrite    = "full_rewrite"
	novelWorkbenchV3RecoveryPriorBlock     = "prior_block"
)

type novelWorkbenchV3TextReplacement struct {
	Original    string `json:"original"`
	Replacement string `json:"replacement"`
}

type novelWorkbenchV3LocalizedPatch struct {
	Unit         int                               `json:"unit"`
	Replacements []novelWorkbenchV3TextReplacement `json:"replacements"`
	Summary      string                            `json:"summary"`
}

type novelWorkbenchV3BoundaryContract struct {
	Unit                int                                       `json:"unit"`
	CurrentExitStates   map[string]novelWorkbenchV3CharacterState `json:"currentExitStates"`
	NextUnit            int                                       `json:"nextUnit,omitempty"`
	NextUnitEntryBridge string                                    `json:"nextUnitEntryBridge,omitempty"`
	Rule                string                                    `json:"rule"`
}

type novelWorkbenchV3ProseAttemptRecord struct {
	Version                  int                   `json:"version"`
	Unit                     int                   `json:"unit"`
	Attempt                  int                   `json:"attempt"`
	Strategy                 string                `json:"strategy"`
	SourceFailureFingerprint string                `json:"sourceFailureFingerprint,omitempty"`
	Draft                    novelWorkbenchV3Draft `json:"draft"`
	DraftSHA256              string                `json:"draftSha256"`
}

type novelWorkbenchV3ProseRecoveryRecord struct {
	Version                   int      `json:"version"`
	Unit                      int      `json:"unit"`
	Attempt                   int      `json:"attempt"`
	Strategy                  string   `json:"strategy"`
	SourceFailureFingerprint  string   `json:"sourceFailureFingerprint,omitempty"`
	Failure                   string   `json:"failure"`
	IssueCodes                []string `json:"issueCodes,omitempty"`
	RequiredActions           []string `json:"requiredActions,omitempty"`
	Invariants                []string `json:"invariants,omitempty"`
	RemainingLocalizedPatches int      `json:"remainingLocalizedPatches"`
	RemainingFullRewrites     int      `json:"remainingFullRewrites"`
}

type novelWorkbenchV3RenderReviewAttemptRecord struct {
	Version                  int                          `json:"version"`
	Unit                     int                          `json:"unit"`
	Attempt                  int                          `json:"attempt"`
	Strategy                 string                       `json:"strategy"`
	SourceFailureFingerprint string                       `json:"sourceFailureFingerprint,omitempty"`
	DraftSHA256              string                       `json:"draftSha256"`
	Review                   novelWorkbenchV3ReviewReport `json:"review"`
	Failure                  string                       `json:"failure,omitempty"`
	FailureFingerprint       string                       `json:"failureFingerprint,omitempty"`
}

type novelWorkbenchV3DraftRejectedRecord struct {
	Version                  int    `json:"version"`
	Unit                     int    `json:"unit"`
	Attempt                  int    `json:"attempt"`
	Strategy                 string `json:"strategy"`
	SourceFailureFingerprint string `json:"sourceFailureFingerprint,omitempty"`
	Raw                      string `json:"raw"`
	Error                    string `json:"error"`
	FailureFingerprint       string `json:"failureFingerprint"`
	Stage                    string `json:"stage"`
}

type novelWorkbenchV3ProseRecoveryHistory struct {
	LatestDraft            *novelWorkbenchV3Draft
	LastReview             novelWorkbenchV3ReviewReport
	LastFailure            string
	LastFailureFingerprint string
	LastSourceFingerprint  string
	LastStrategy           string
	LocalizedPatchAttempts int
	FullRewriteAttempts    int
	AttemptCount           int
}

type novelWorkbenchV3ReviewIssue struct {
	Code         string   `json:"code"`
	Unit         int      `json:"unit"`
	ReferenceIDs []string `json:"referenceIds"`
	Evidence     string   `json:"evidence"`
	RepairAction string   `json:"repairAction"`
}

type novelWorkbenchV3ReviewReport struct {
	Unit           int                           `json:"unit"`
	OverallPass    bool                          `json:"overallPass"`
	BlockingIssues []novelWorkbenchV3ReviewIssue `json:"blockingIssues"`
	Warnings       []novelWorkbenchV3ReviewIssue `json:"warnings"`
	Verdict        string                        `json:"verdict"`
}

type novelWorkbenchV3QualityBlockRecord struct {
	Class  string `json:"class"`
	Stage  string `json:"stage"`
	Unit   int    `json:"unit"`
	Reason string `json:"reason"`
}

func newNovelWorkbenchV3Control(brief novelWorkbenchBrief) novelWorkbenchV3Control {
	return novelWorkbenchV3Control{
		EngineVersion: novelWorkbenchV3EngineVersion,
		Brief:         brief,
		Style: novelWorkbenchV3StyleGuide{
			NarrativeVoice: strings.TrimSpace(brief.Tone),
		},
	}
}

func newNovelWorkbenchV3State() novelWorkbenchV3State {
	return novelWorkbenchV3State{
		CharacterStates: map[string]novelWorkbenchV3CharacterState{},
		FactStates:      map[string]string{},
		OpenQuestions:   []novelWorkbenchV3OpenQuestion{},
		RecentSummaries: []novelWorkbenchV3UnitSummary{},
	}
}

func decodeNovelWorkbenchV3Control(raw string) (novelWorkbenchV3Control, error) {
	var control novelWorkbenchV3Control
	if strings.TrimSpace(raw) == "" {
		return control, errors.New("弧级创作档案为空")
	}
	if err := json.Unmarshal([]byte(raw), &control); err != nil {
		return control, fmt.Errorf("弧级创作档案损坏：%w", err)
	}
	if control.EngineVersion == 0 {
		control.EngineVersion = novelWorkbenchV3EngineVersion
	}
	return control, nil
}

func decodeNovelWorkbenchV3State(raw string) (novelWorkbenchV3State, error) {
	if strings.TrimSpace(raw) == "" {
		return newNovelWorkbenchV3State(), nil
	}
	var state novelWorkbenchV3State
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return state, fmt.Errorf("弧级动态状态损坏：%w", err)
	}
	return normalizeNovelWorkbenchV3State(state), nil
}

func normalizeNovelWorkbenchV3State(state novelWorkbenchV3State) novelWorkbenchV3State {
	if state.CharacterStates == nil {
		state.CharacterStates = map[string]novelWorkbenchV3CharacterState{}
	}
	if state.FactStates == nil {
		state.FactStates = map[string]string{}
	}
	if state.OpenQuestions == nil {
		state.OpenQuestions = []novelWorkbenchV3OpenQuestion{}
	}
	if state.RecentSummaries == nil {
		state.RecentSummaries = []novelWorkbenchV3UnitSummary{}
	}
	return state
}

func normalizeNovelWorkbenchV3ID(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func cleanNovelWorkbenchV3Strings(values []string) []string {
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

func normalizeNovelWorkbenchV3IDs(values []string) []string {
	cleaned := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, raw := range values {
		id := normalizeNovelWorkbenchV3ID(raw)
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

func novelWorkbenchV3ControlReady(control novelWorkbenchV3Control) bool {
	return strings.TrimSpace(control.Title) != "" && strings.TrimSpace(control.Logline) != "" && len(control.Bible.Characters) > 0 && len(control.StoryMap) > 0
}

func novelWorkbenchV3ArcMaxSpan(target int) int {
	if target > 160 {
		return 16
	}
	return 12
}

func novelWorkbenchV3RecommendedArcCount(target int) int {
	span := 8
	if target > 160 {
		span = 12
	}
	if target < span {
		return 1
	}
	return (target + span - 1) / span
}

func novelWorkbenchV3ArcPlanTokenLimit(arc novelWorkbenchV3StoryArc) int {
	span := arc.EndUnit - arc.StartUnit + 1
	switch {
	case span <= 5:
		return 6_000
	case span <= 9:
		return 8_000
	default:
		return 12_000
	}
}

func novelWorkbenchV3InitialState(control novelWorkbenchV3Control) novelWorkbenchV3State {
	state := newNovelWorkbenchV3State()
	for _, character := range control.Bible.Characters {
		state.CharacterStates[character.ID] = novelWorkbenchV3CharacterState{
			Status:       firstNonEmptyString(strings.TrimSpace(character.InitialState), "未触发"),
			Location:     "未明确",
			KnownFactIDs: []string{},
		}
	}
	for _, fact := range control.Bible.Facts {
		status := "planned"
		if fact.Kind == "fact" && fact.IntroducedByUnit == 0 {
			status = "active"
		}
		state.FactStates[fact.ID] = status
	}
	return state
}

func (s *Service) updateNovelWorkbenchV3Progress(run *model.NovelWorkbenchRun, taskID string, pipeline string, stage string, progress int) error {
	run.PipelineStage = pipeline
	run.Stage = stage
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return err
	}
	return s.repo.UpdateTaskProgress(taskID, stage, progress)
}

func (s *Service) createNovelWorkbenchV3Artifact(run *model.NovelWorkbenchRun, unit int, kind string, attempt int, content any, prompt string) error {
	raw, err := json.Marshal(content)
	if err != nil {
		return err
	}
	now := time.Now()
	return s.repo.CreateNovelWorkbenchArtifact(&model.NovelWorkbenchArtifact{
		ID: newID(), RunID: run.ID, ProjectID: run.ProjectID, Unit: unit, Kind: kind, Attempt: attempt,
		Version: novelWorkbenchV3EngineVersion, ContentJSON: string(raw), Prompt: strings.TrimSpace(prompt), CreatedAt: now, UpdatedAt: now,
	})
}

func (s *Service) blockNovelWorkbenchV3(run *model.NovelWorkbenchRun, taskID string, class string, stage string, unit int, reason string) error {
	label := "弧级连续性校验"
	if strings.TrimSpace(class) == "narrative" {
		label = "正文/审稿质量"
	}
	reason = truncateRunes(strings.TrimSpace(reason), 4_000)
	if reason == "" {
		reason = "未提供具体原因"
	}
	run.Status = novelWorkbenchStatusFailed
	run.Stage = "质量拦截"
	run.PipelineStage = novelWorkbenchV3PipelineBlocked
	run.QualityBlockReason = label + "：" + reason
	run.LastError = run.QualityBlockReason
	run.CurrentTaskID = ""
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return err
	}
	if err := s.createNovelWorkbenchV3Artifact(run, unit, "quality_block", 0, novelWorkbenchV3QualityBlockRecord{Class: class, Stage: stage, Unit: unit, Reason: reason}, ""); err != nil {
		return err
	}
	return s.repo.UpdateTaskProgress(taskID, "质量拦截，已保留失败原因", 100)
}

func (s *Service) processNovelWorkbenchV3Task(ctx context.Context, task model.Task, run *model.NovelWorkbenchRun, input novelWorkbenchTaskInput, resolvedConfig providerConfig) (map[string]interface{}, error) {
	switch input.Phase {
	case novelWorkbenchPhaseBootstrap:
		return s.processNovelWorkbenchV3Bootstrap(ctx, task, run, input, resolvedConfig)
	case novelWorkbenchPhaseUnit:
		return s.processNovelWorkbenchV3Unit(ctx, task, run, input, resolvedConfig)
	default:
		return nil, fmt.Errorf("弧级创作系统不支持的任务阶段：%s", input.Phase)
	}
}

func (s *Service) processNovelWorkbenchV3Bootstrap(ctx context.Context, task model.Task, run *model.NovelWorkbenchRun, input novelWorkbenchTaskInput, resolvedConfig providerConfig) (map[string]interface{}, error) {
	control, err := decodeNovelWorkbenchV3Control(run.ControlJSON)
	if err != nil {
		return nil, err
	}
	if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelineBootstrap, "建立全书导航与正史", 24); err != nil {
		return nil, err
	}

	var output novelWorkbenchV3BootstrapOutput
	var raw string
	var validationErr error
	prompt := buildNovelWorkbenchV3BootstrapPrompt(control.Brief)
	for attempt := 1; attempt <= novelWorkbenchV3MaxBootstrapAttempts; attempt++ {
		generated, generateErr := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: prompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: novelWorkbenchBootstrapTokenLimit(control.Brief.TargetUnitCount)})
		if generateErr != nil {
			return nil, generateErr
		}
		raw = stringValue(generated["text"])
		candidate := novelWorkbenchV3BootstrapOutput{}
		validationErr = decodeNovelWorkbenchJSONObject(raw, &candidate)
		if validationErr == nil {
			validationErr = validateNovelWorkbenchV3Bootstrap(&candidate, control.Brief)
		}
		if validationErr == nil {
			output = candidate
			break
		}
		if err := s.createNovelWorkbenchV3Artifact(run, 0, "bootstrap_rejected", attempt, map[string]any{"raw": raw, "error": validationErr.Error()}, prompt); err != nil {
			return nil, err
		}
		if attempt < novelWorkbenchV3MaxBootstrapAttempts {
			if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelineBootstrap, "修复全书导航结构", 46); err != nil {
				return nil, err
			}
			prompt = buildNovelWorkbenchV3BootstrapRepairPrompt(control.Brief, raw, validationErr)
		}
	}
	if validationErr != nil {
		reason := fmt.Sprintf("全书导航初稿加 %d 轮结构修复后仍未通过：%s", novelWorkbenchV3MaxBootstrapAttempts-1, validationErr.Error())
		if err := s.blockNovelWorkbenchV3(run, task.ID, "structure", "bootstrap", 0, reason); err != nil {
			return nil, err
		}
		return map[string]interface{}{"projectId": run.ProjectID, "blocked": true, "reason": run.QualityBlockReason}, nil
	}

	control.EngineVersion = novelWorkbenchV3EngineVersion
	control.Title = output.Title
	control.Logline = output.Logline
	control.Bible = output.Bible
	control.StoryMap = output.StoryMap
	control.Style = output.Style
	if err := validateNovelWorkbenchV3Control(&control); err != nil {
		return nil, err
	}
	state := novelWorkbenchV3InitialState(control)
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
	run.QualityBlockReason = ""
	run.LastError = ""
	prepareNovelWorkbenchContinuation(run, "全书导航已冻结，等待封存首个故事弧")
	run.PipelineStage = novelWorkbenchV3PipelinePrepare
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return nil, err
	}
	if err := s.createNovelWorkbenchV3Artifact(run, 0, "book_canon", 1, control, prompt); err != nil {
		return nil, err
	}
	if err := s.repo.UpdateTaskProgress(task.ID, "全书导航已冻结", 90); err != nil {
		return nil, err
	}
	result := novelWorkbenchContinuationDirective(1, "封存第 1 个故事弧并生成第 1 单元")
	result["projectId"] = run.ProjectID
	result["title"] = control.Title
	result["logline"] = control.Logline
	result["arcCount"] = len(control.StoryMap)
	return result, nil
}

func validateNovelWorkbenchV3Bootstrap(output *novelWorkbenchV3BootstrapOutput, brief novelWorkbenchBrief) error {
	control := novelWorkbenchV3Control{
		EngineVersion: novelWorkbenchV3EngineVersion,
		Title:         strings.TrimSpace(output.Title),
		Logline:       strings.TrimSpace(output.Logline),
		Brief:         brief,
		Bible:         output.Bible,
		StoryMap:      output.StoryMap,
		Style:         output.Style,
	}
	if err := validateNovelWorkbenchV3Control(&control); err != nil {
		return err
	}
	output.Title = control.Title
	output.Logline = control.Logline
	output.Bible = control.Bible
	output.StoryMap = control.StoryMap
	output.Style = control.Style
	return nil
}

func validateNovelWorkbenchV3Control(control *novelWorkbenchV3Control) error {
	if control.EngineVersion < novelWorkbenchV3EngineVersion {
		return errors.New("创作档案版本不是弧级控制版本")
	}
	control.Title = strings.TrimSpace(control.Title)
	control.Logline = strings.TrimSpace(control.Logline)
	if control.Title == "" || control.Logline == "" {
		return errors.New("全书导航缺少标题或一句话卖点")
	}
	control.Bible.Premise = firstNonEmptyString(strings.TrimSpace(control.Bible.Premise), strings.TrimSpace(control.Brief.Premise))
	control.Bible.EndingPromise = strings.TrimSpace(control.Bible.EndingPromise)
	control.Bible.Theme = strings.TrimSpace(control.Bible.Theme)
	control.Bible.WorldRules = cleanNovelWorkbenchV3Strings(control.Bible.WorldRules)
	if control.Bible.Premise == "" || control.Bible.EndingPromise == "" || control.Bible.Theme == "" || len(control.Bible.WorldRules) == 0 {
		return errors.New("全书正史缺少前提、结局承诺、主题或世界规则")
	}

	if len(control.Bible.Characters) > novelWorkbenchV3MaxCanonicalCharacterCount {
		return fmt.Errorf("全书正史角色数不能超过 %d 位，避免运行时上下文膨胀", novelWorkbenchV3MaxCanonicalCharacterCount)
	}
	characters := map[string]struct{}{}
	for index := range control.Bible.Characters {
		character := &control.Bible.Characters[index]
		character.ID = normalizeNovelWorkbenchV3ID(character.ID)
		character.Name = strings.TrimSpace(character.Name)
		character.Role = strings.TrimSpace(character.Role)
		character.Desire = strings.TrimSpace(character.Desire)
		character.Fear = strings.TrimSpace(character.Fear)
		character.Voice = strings.TrimSpace(character.Voice)
		character.InitialState = firstNonEmptyString(strings.TrimSpace(character.InitialState), "未触发")
		if character.ID == "" || character.Name == "" || character.Role == "" || character.Desire == "" || character.Fear == "" || character.Voice == "" {
			return fmt.Errorf("第 %d 位角色缺少稳定 ID 或核心设定", index+1)
		}
		if _, exists := characters[character.ID]; exists {
			return fmt.Errorf("角色 ID 重复：%s", character.ID)
		}
		characters[character.ID] = struct{}{}
	}
	if len(characters) < 2 {
		return errors.New("全书正史至少需要两位核心角色")
	}

	if len(control.Bible.Facts) > novelWorkbenchV3MaxCanonicalFactCount {
		return fmt.Errorf("全书正史账本不能超过 %d 条，避免将每个可疑细节误记为长期事实", novelWorkbenchV3MaxCanonicalFactCount)
	}
	facts := map[string]struct{}{}
	for index := range control.Bible.Facts {
		fact := &control.Bible.Facts[index]
		fact.ID = normalizeNovelWorkbenchV3ID(fact.ID)
		fact.Statement = strings.TrimSpace(fact.Statement)
		fact.Kind = strings.ToLower(strings.TrimSpace(fact.Kind))
		fact.OwnerIDs = normalizeNovelWorkbenchV3IDs(fact.OwnerIDs)
		if fact.ID == "" || fact.Statement == "" {
			return fmt.Errorf("第 %d 条正史账本缺少 ID 或内容", index+1)
		}
		if fact.Kind != "fact" && fact.Kind != "promise" && fact.Kind != "question" {
			return fmt.Errorf("账本 %s 的类型必须是 fact、promise 或 question", fact.ID)
		}
		if _, exists := facts[fact.ID]; exists {
			return fmt.Errorf("账本 ID 重复：%s", fact.ID)
		}
		for _, ownerID := range fact.OwnerIDs {
			if _, exists := characters[ownerID]; !exists {
				return fmt.Errorf("账本 %s 引用了不存在的角色 %s", fact.ID, ownerID)
			}
		}
		if fact.IntroducedByUnit < 0 || fact.IntroducedByUnit > control.Brief.TargetUnitCount || fact.ResolveByUnit < 0 || fact.ResolveByUnit > control.Brief.TargetUnitCount {
			return fmt.Errorf("账本 %s 的单元期限越界", fact.ID)
		}
		if (fact.Kind == "promise" || fact.Kind == "question") && fact.IntroducedByUnit < 1 {
			return fmt.Errorf("账本 %s 必须指定引入单元", fact.ID)
		}
		if fact.ResolveByUnit > 0 && fact.ResolveByUnit <= fact.IntroducedByUnit {
			return fmt.Errorf("账本 %s 必须在引入后的单元回收", fact.ID)
		}
		if (fact.Kind == "promise" || fact.Kind == "question") && fact.ResolveByUnit == 0 {
			return fmt.Errorf("账本 %s 必须指定结局前的回收单元", fact.ID)
		}
		facts[fact.ID] = struct{}{}
	}
	if control.Brief.TargetUnitCount > 1 && len(facts) == 0 {
		return errors.New("长线作品至少需要一条可追踪的读者承诺、问题或正史账本")
	}

	style := &control.Style
	style.NarrativeVoice = firstNonEmptyString(strings.TrimSpace(style.NarrativeVoice), strings.TrimSpace(control.Brief.Tone), "克制、清晰、具体")
	style.PacingRules = cleanNovelWorkbenchV3Strings(style.PacingRules)
	style.ForbiddenDrift = cleanNovelWorkbenchV3Strings(style.ForbiddenDrift)
	if len(style.PacingRules) == 0 || len(style.ForbiddenDrift) == 0 {
		return errors.New("风格指南缺少节奏规则或禁止漂移项")
	}

	if len(control.StoryMap) == 0 {
		return errors.New("全书导航缺少故事弧")
	}
	sort.SliceStable(control.StoryMap, func(left, right int) bool {
		return control.StoryMap[left].StartUnit < control.StoryMap[right].StartUnit
	})
	next := 1
	arcIDs := map[string]struct{}{}
	maxSpan := novelWorkbenchV3ArcMaxSpan(control.Brief.TargetUnitCount)
	for index := range control.StoryMap {
		arc := &control.StoryMap[index]
		arc.ID = normalizeNovelWorkbenchV3ID(arc.ID)
		arc.Title = strings.TrimSpace(arc.Title)
		arc.Mission = strings.TrimSpace(arc.Mission)
		arc.TurningPoint = strings.TrimSpace(arc.TurningPoint)
		arc.ExitPromise = strings.TrimSpace(arc.ExitPromise)
		if arc.ID == "" || arc.Title == "" || arc.Mission == "" || arc.TurningPoint == "" || arc.ExitPromise == "" {
			return fmt.Errorf("第 %d 段故事弧缺少 ID、标题、任务、转折或离场承诺", index+1)
		}
		if _, exists := arcIDs[arc.ID]; exists {
			return fmt.Errorf("故事弧 ID 重复：%s", arc.ID)
		}
		if arc.StartUnit != next || arc.EndUnit < arc.StartUnit || arc.EndUnit > control.Brief.TargetUnitCount {
			return fmt.Errorf("故事弧 %s 没有连续覆盖第 %d 单元", arc.ID, next)
		}
		if span := arc.EndUnit - arc.StartUnit + 1; control.Brief.TargetUnitCount > maxSpan && span > maxSpan {
			return fmt.Errorf("故事弧 %s 覆盖 %d 个单元，超过弧级封存的 %d 单元上限", arc.ID, span, maxSpan)
		}
		arcIDs[arc.ID] = struct{}{}
		next = arc.EndUnit + 1
	}
	if next != control.Brief.TargetUnitCount+1 {
		return fmt.Errorf("全书导航未覆盖至第 %d 单元", control.Brief.TargetUnitCount)
	}
	return nil
}

func buildNovelWorkbenchV3BootstrapPrompt(brief novelWorkbenchBrief) string {
	briefJSON, _ := json.Marshal(brief)
	unitLabel := "集"
	modeRule := "每一集未来都会单独制作成可拍摄的竖屏短剧剧本。"
	if brief.OutputMode == novelWorkbenchModeNovel {
		unitLabel = "章"
		modeRule = "每一章未来都会写成可连续阅读的小说正文。"
	}
	return fmt.Sprintf(`你是中文长线叙事架构师。现在只建立“全书导航与正史”，不要预写逐%s分镜或逐%s正文。%s

用户简报：%s

设计原则：
1. 先冻结全书方向，再一次只封存一个 4-12 %s 的可执行故事弧；不能把每一集都塞进同一个巨型控制卡。
2. id 必须是稳定的小写英文下划线，例如 char_shen_zhaoning、promise_identity；后续内容只能引用现有 id。
3. facts 只记录可长期追踪的真相、读者承诺或读者问题。不能因为一个动作看似可疑，就把“隐藏动机”写成既成事实；未被证实的线索应该保持 question。
4. storyMap 必须从第 1 %s 连续覆盖到第 %d %s，每段不超过 %d %s，给出任务、转折和离场承诺；最后 20%% 必须留出结局回收空间。
5. promise 和 question 必须有 introducedByUnit 和 resolveByUnit，且回收发生在引入之后、作品结束之前。静态 fact 可以 introducedByUnit 为 0、resolveByUnit 为 0。
6. 输出原创简体中文，不得模仿具体作品、作者或影视 IP。

只输出一个合法 JSON 对象，不要 Markdown 或解释：
{"title":"","logline":"","bible":{"premise":"","endingPromise":"","theme":"","worldRules":[""],"characters":[{"id":"char_","name":"","role":"","desire":"","fear":"","voice":"","initialState":""}],"facts":[{"id":"promise_","statement":"","kind":"promise","introducedByUnit":1,"resolveByUnit":2,"ownerIds":["char_"]}]},"storyMap":[{"id":"arc_","title":"","startUnit":1,"endUnit":1,"mission":"","turningPoint":"","exitPromise":""}],"style":{"narrativeVoice":"","pacingRules":[""],"forbiddenDrift":[""]}}`,
		unitLabel, unitLabel, modeRule, string(briefJSON), unitLabel, unitLabel, brief.TargetUnitCount, unitLabel, novelWorkbenchV3ArcMaxSpan(brief.TargetUnitCount), unitLabel)
}

func buildNovelWorkbenchV3BootstrapRepairPrompt(brief novelWorkbenchBrief, raw string, validationErr error) string {
	return fmt.Sprintf(`把下面的全书导航修复成合法 JSON。只解决这份失败单指出的问题，保留已有的原创冲突、人物动力和结局方向。不要把故事改成逐集提纲；storyMap 必须连续覆盖第 1 到第 %d 单元，承诺和问题必须在结局前可回收。只输出 JSON。

本次失败单：%s

原始输出：
%s`, brief.TargetUnitCount, validationErr.Error(), raw)
}

func (s *Service) processNovelWorkbenchV3Unit(ctx context.Context, task model.Task, run *model.NovelWorkbenchRun, input novelWorkbenchTaskInput, resolvedConfig providerConfig) (map[string]interface{}, error) {
	// Existing V3 projects retain their sealed arcs, but subsequent work and
	// recovery use the current durable recovery policy.
	run.QualityPolicy = novelWorkbenchV3QualityPolicy
	expectedUnit := run.CompletedUnitCount + 1
	if input.Unit != expectedUnit || input.Unit < 1 || input.Unit > run.TargetUnitCount {
		return nil, fmt.Errorf("当前应生成第 %d 单元，收到第 %d 单元", expectedUnit, input.Unit)
	}
	control, err := decodeNovelWorkbenchV3Control(run.ControlJSON)
	if err != nil {
		return nil, err
	}
	if err := validateNovelWorkbenchV3Control(&control); err != nil {
		return nil, err
	}
	state, err := decodeNovelWorkbenchV3State(run.DynamicStateJSON)
	if err != nil {
		return nil, err
	}
	if err := validateNovelWorkbenchV3Preflight(control, state, input.Unit); err != nil {
		if blockErr := s.blockNovelWorkbenchV3(run, task.ID, "structure", "preflight", input.Unit, err.Error()); blockErr != nil {
			return nil, blockErr
		}
		return map[string]interface{}{"projectId": run.ProjectID, "unit": input.Unit, "blocked": true, "reason": run.QualityBlockReason}, nil
	}
	arc, found := novelWorkbenchV3StoryArcForUnit(control.StoryMap, input.Unit)
	if !found {
		return nil, fmt.Errorf("第 %d 单元没有可封存的故事弧", input.Unit)
	}

	packageForUnit, blocked, sealErr := s.ensureNovelWorkbenchV3ArcSealed(ctx, task, run, control, state, arc, input.Unit, resolvedConfig)
	if sealErr != nil {
		return nil, sealErr
	}
	if blocked {
		return map[string]interface{}{"projectId": run.ProjectID, "unit": input.Unit, "blocked": true, "reason": run.QualityBlockReason}, nil
	}
	state, err = decodeNovelWorkbenchV3State(run.DynamicStateJSON)
	if err != nil {
		return nil, err
	}
	packet, found := novelWorkbenchV3PacketForUnit(packageForUnit, input.Unit)
	if !found {
		reason := fmt.Sprintf("已封存故事弧 %s 缺少第 %d 单元执行包", packageForUnit.ArcID, input.Unit)
		if blockErr := s.blockNovelWorkbenchV3(run, task.ID, "structure", "sealed_arc", input.Unit, reason); blockErr != nil {
			return nil, blockErr
		}
		return map[string]interface{}{"projectId": run.ProjectID, "unit": input.Unit, "blocked": true, "reason": run.QualityBlockReason}, nil
	}

	accepted, review, writerPrompt, reviewPrompt, attempt, blocked, err := s.writeAndReviewNovelWorkbenchV3Unit(ctx, task, run, control, state, packageForUnit, packet, input.Unit, resolvedConfig)
	if err != nil {
		return nil, err
	}
	if blocked {
		return map[string]interface{}{"projectId": run.ProjectID, "unit": input.Unit, "blocked": true, "reason": run.QualityBlockReason}, nil
	}
	if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelineCommit, fmt.Sprintf("第 %d 单元：原子提交正文与状态", input.Unit), 90); err != nil {
		return nil, err
	}
	nextState, err := applyNovelWorkbenchV3Packet(control, state, packageForUnit, packet, accepted)
	if err != nil {
		return nil, err
	}
	if err := validateNovelWorkbenchV3PostCommit(control, nextState, input.Unit); err != nil {
		if blockErr := s.blockNovelWorkbenchV3(run, task.ID, "structure", "post_commit", input.Unit, err.Error()); blockErr != nil {
			return nil, blockErr
		}
		return map[string]interface{}{"projectId": run.ProjectID, "unit": input.Unit, "blocked": true, "reason": run.QualityBlockReason}, nil
	}

	stateJSON, err := json.Marshal(nextState)
	if err != nil {
		return nil, err
	}
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
		run.PipelineStage = novelWorkbenchV3PipelineCommit
	} else {
		prepareNovelWorkbenchContinuation(run, fmt.Sprintf("第 %d 单元已提交，等待第 %d 单元", input.Unit, input.Unit+1))
		run.PipelineStage = novelWorkbenchV3PipelinePrepare
	}
	title := novelWorkbenchUnitTitle(control.Brief.OutputMode, input.Unit, accepted.Title)
	commitRecord := map[string]any{
		"unit": input.Unit, "title": title, "attempt": attempt, "summary": accepted.Summary,
		"arcId": packageForUnit.ArcID, "packet": packet, "review": review, "committedAt": run.UpdatedAt,
	}
	draftJSON, err := json.Marshal(accepted)
	if err != nil {
		return nil, err
	}
	reviewJSON, err := json.Marshal(review)
	if err != nil {
		return nil, err
	}
	commitJSON, err := json.Marshal(commitRecord)
	if err != nil {
		return nil, err
	}
	content := strings.TrimSpace(accepted.Content)
	unit := &model.ProjectUnit{
		ID: newID(), ProjectID: run.ProjectID, Kind: novelWorkbenchProjectUnitKind(control.Brief.OutputMode), Title: title,
		SourceText: content, WordCount: model.ProjectUnitWordCount(content), Status: model.ProjectUnitStatusReady, Position: input.Unit - 1, CreatedAt: run.UpdatedAt, UpdatedAt: run.UpdatedAt,
	}
	artifacts := []model.NovelWorkbenchArtifact{
		{ID: newID(), RunID: run.ID, ProjectID: run.ProjectID, Unit: input.Unit, Kind: "draft_accepted", Attempt: attempt, Version: novelWorkbenchV3EngineVersion, ContentJSON: string(draftJSON), Prompt: writerPrompt, CreatedAt: run.UpdatedAt, UpdatedAt: run.UpdatedAt},
		{ID: newID(), RunID: run.ID, ProjectID: run.ProjectID, Unit: input.Unit, Kind: "render_review", Attempt: attempt, Version: novelWorkbenchV3EngineVersion, ContentJSON: string(reviewJSON), Prompt: reviewPrompt, CreatedAt: run.UpdatedAt, UpdatedAt: run.UpdatedAt},
		{ID: newID(), RunID: run.ID, ProjectID: run.ProjectID, Unit: input.Unit, Kind: "commit_record", Attempt: attempt, Version: novelWorkbenchV3EngineVersion, ContentJSON: string(commitJSON), CreatedAt: run.UpdatedAt, UpdatedAt: run.UpdatedAt},
	}
	if err := s.repo.CommitNovelWorkbenchUnit(run, unit, artifacts); err != nil {
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

func novelWorkbenchV3StoryArcForUnit(arcs []novelWorkbenchV3StoryArc, unit int) (novelWorkbenchV3StoryArc, bool) {
	for _, arc := range arcs {
		if unit >= arc.StartUnit && unit <= arc.EndUnit {
			return arc, true
		}
	}
	return novelWorkbenchV3StoryArc{}, false
}

func novelWorkbenchV3PacketForUnit(pkg novelWorkbenchV3ArcPackage, unit int) (novelWorkbenchV3EpisodePacket, bool) {
	for _, packet := range pkg.Packets {
		if packet.Unit == unit {
			return packet, true
		}
	}
	return novelWorkbenchV3EpisodePacket{}, false
}

func (s *Service) ensureNovelWorkbenchV3ArcSealed(ctx context.Context, task model.Task, run *model.NovelWorkbenchRun, control novelWorkbenchV3Control, state novelWorkbenchV3State, arc novelWorkbenchV3StoryArc, unit int, resolvedConfig providerConfig) (novelWorkbenchV3ArcPackage, bool, error) {
	if state.CurrentArc != nil && state.CurrentArc.ArcID == arc.ID && unit >= state.CurrentArc.StartUnit && unit <= state.CurrentArc.EndUnit {
		if err := validateNovelWorkbenchV3SealedArcShape(control, arc, *state.CurrentArc); err == nil {
			return *state.CurrentArc, false, nil
		}
	}
	if unit != arc.StartUnit {
		return novelWorkbenchV3ArcPackage{}, false, fmt.Errorf("第 %d 单元需要使用已封存故事弧 %s，不能在弧中途重新规划", unit, arc.ID)
	}
	if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelinePlan, fmt.Sprintf("封存故事弧：%s", arc.Title), 18); err != nil {
		return novelWorkbenchV3ArcPackage{}, false, err
	}

	var plan novelWorkbenchV3ArcPlanOutput
	var planRaw string
	var planPrompt string
	planAttempt := 0
	lastPlanFailure := ""
	var lastReview *novelWorkbenchV3ReviewReport
	for planAttempt < novelWorkbenchV3MaxArcPlanAttempts {
		planAttempt++
		if planAttempt == 1 {
			planPrompt = buildNovelWorkbenchV3ArcPlanPrompt(control, state, arc)
		} else {
			planPrompt = buildNovelWorkbenchV3ArcPlanRepairPrompt(control, state, arc, planRaw, lastPlanFailure, lastReview)
		}
		generated, err := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: planPrompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: novelWorkbenchV3ArcPlanTokenLimit(arc)})
		if err != nil {
			return novelWorkbenchV3ArcPackage{}, false, err
		}
		planRaw = stringValue(generated["text"])
		candidate := novelWorkbenchV3ArcPlanOutput{}
		validationErr := decodeNovelWorkbenchJSONObject(planRaw, &candidate)
		if validationErr == nil {
			validationErr = validateNovelWorkbenchV3ArcPlan(control, state, arc, &candidate)
		}
		if validationErr != nil {
			lastPlanFailure = validationErr.Error()
			if err := s.createNovelWorkbenchV3Artifact(run, unit, "arc_plan_rejected", planAttempt, map[string]any{"raw": planRaw, "error": lastPlanFailure, "stage": "deterministic_validation"}, planPrompt); err != nil {
				return novelWorkbenchV3ArcPackage{}, false, err
			}
			continue
		}
		plan = candidate
		pkg := novelWorkbenchV3ArcPackage{Version: novelWorkbenchV3ArcPlanVersion, ArcID: arc.ID, Title: arc.Title, StartUnit: arc.StartUnit, EndUnit: arc.EndUnit, EntryDigest: plan.EntryDigest, ArcSummary: plan.ArcSummary, Packets: plan.Packets}
		if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelineArcReview, fmt.Sprintf("审阅故事弧：%s", arc.Title), 34); err != nil {
			return novelWorkbenchV3ArcPackage{}, false, err
		}
		var review novelWorkbenchV3ReviewReport
		var reviewRaw string
		var reviewPrompt string
		var reviewErr error
		for reviewAttempt := 1; reviewAttempt <= novelWorkbenchV3MaxReviewAttempts; reviewAttempt++ {
			if reviewAttempt == 1 {
				reviewPrompt = buildNovelWorkbenchV3ArcReviewPrompt(control, state, arc, pkg)
			} else {
				reviewPrompt = buildNovelWorkbenchV3ArcReviewRepairPrompt(control, state, arc, pkg, reviewRaw, reviewErr)
			}
			reviewGenerated, generateErr := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: reviewPrompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: 5_000})
			if generateErr != nil {
				return novelWorkbenchV3ArcPackage{}, false, generateErr
			}
			reviewRaw = stringValue(reviewGenerated["text"])
			review = novelWorkbenchV3ReviewReport{}
			reviewErr = decodeNovelWorkbenchJSONObject(reviewRaw, &review)
			if reviewErr == nil {
				reviewErr = validateNovelWorkbenchV3ArcReview(review, control, arc)
			}
			if reviewErr == nil {
				break
			}
			if err := s.createNovelWorkbenchV3Artifact(run, unit, "arc_review_rejected", planAttempt, map[string]any{"raw": reviewRaw, "error": reviewErr.Error(), "reviewAttempt": reviewAttempt}, reviewPrompt); err != nil {
				return novelWorkbenchV3ArcPackage{}, false, err
			}
			if reviewAttempt < novelWorkbenchV3MaxReviewAttempts {
				if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelineArcReview, fmt.Sprintf("修复故事弧审稿报告（第 %d/%d 轮）", reviewAttempt, novelWorkbenchV3MaxReviewAttempts-1), 38); err != nil {
					return novelWorkbenchV3ArcPackage{}, false, err
				}
			}
		}
		if reviewErr != nil {
			reason := fmt.Sprintf("故事弧 %s 的独立审稿报告经过 %d 轮结构修复仍不可用：%s", arc.Title, novelWorkbenchV3MaxReviewAttempts, reviewErr.Error())
			if err := s.blockNovelWorkbenchV3(run, task.ID, "structure", "arc_review_protocol", unit, reason); err != nil {
				return novelWorkbenchV3ArcPackage{}, false, err
			}
			return novelWorkbenchV3ArcPackage{}, true, nil
		}
		if err := s.createNovelWorkbenchV3Artifact(run, unit, "arc_review", planAttempt, review, reviewPrompt); err != nil {
			return novelWorkbenchV3ArcPackage{}, false, err
		}
		if review.OverallPass && len(review.BlockingIssues) == 0 {
			pkg.SealedAt = time.Now()
			if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelineSeal, fmt.Sprintf("故事弧已封存：%s", arc.Title), 44); err != nil {
				return novelWorkbenchV3ArcPackage{}, false, err
			}
			state.CurrentArcID = arc.ID
			state.CurrentArc = &pkg
			stateJSON, err := json.Marshal(state)
			if err != nil {
				return novelWorkbenchV3ArcPackage{}, false, err
			}
			run.DynamicStateJSON = string(stateJSON)
			run.PipelineStage = novelWorkbenchV3PipelinePrepare
			run.Stage = fmt.Sprintf("故事弧已封存，准备第 %d 单元", unit)
			run.UpdatedAt = time.Now()
			if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
				return novelWorkbenchV3ArcPackage{}, false, err
			}
			if err := s.createNovelWorkbenchV3Artifact(run, unit, "arc_plan", planAttempt, pkg, planPrompt); err != nil {
				return novelWorkbenchV3ArcPackage{}, false, err
			}
			if err := s.createNovelWorkbenchV3Artifact(run, unit, "arc_seal", planAttempt, map[string]any{"arc": pkg, "review": review}, ""); err != nil {
				return novelWorkbenchV3ArcPackage{}, false, err
			}
			return pkg, false, nil
		}
		lastReview = &review
		lastPlanFailure = novelWorkbenchV3ReviewFailure(review)
		if err := s.createNovelWorkbenchV3Artifact(run, unit, "arc_plan_rejected", planAttempt, map[string]any{"raw": planRaw, "error": lastPlanFailure, "stage": "arc_review", "review": review}, planPrompt); err != nil {
			return novelWorkbenchV3ArcPackage{}, false, err
		}
	}
	reason := fmt.Sprintf("故事弧 %s 初稿加 %d 轮定向重编后仍未通过：%s", arc.Title, novelWorkbenchV3MaxArcPlanAttempts-1, firstNonEmptyString(lastPlanFailure, "未得到可封存的故事弧"))
	if err := s.blockNovelWorkbenchV3(run, task.ID, "structure", "arc_plan", unit, reason); err != nil {
		return novelWorkbenchV3ArcPackage{}, false, err
	}
	return novelWorkbenchV3ArcPackage{}, true, nil
}

func validateNovelWorkbenchV3Preflight(control novelWorkbenchV3Control, state novelWorkbenchV3State, nextUnit int) error {
	if state.CompletedUnit != nextUnit-1 {
		return fmt.Errorf("动态状态已完成第 %d 单元，不能直接生成第 %d 单元", state.CompletedUnit, nextUnit)
	}
	for _, fact := range control.Bible.Facts {
		status := state.FactStates[fact.ID]
		if status == "" {
			return fmt.Errorf("动态状态缺少账本 %s", fact.ID)
		}
		if fact.IntroducedByUnit > 0 && nextUnit > fact.IntroducedByUnit && status == "planned" {
			return fmt.Errorf("账本 %s 已错过第 %d 单元的最晚引入时间", fact.ID, fact.IntroducedByUnit)
		}
		if fact.ResolveByUnit > 0 && nextUnit > fact.ResolveByUnit && status != "resolved" {
			return fmt.Errorf("账本 %s 已错过第 %d 单元的最晚回收时间", fact.ID, fact.ResolveByUnit)
		}
	}
	return nil
}

func normalizeNovelWorkbenchV3Packet(packet *novelWorkbenchV3EpisodePacket) {
	if packet == nil {
		return
	}
	packet.Title = strings.TrimSpace(packet.Title)
	packet.EntryBridge = strings.TrimSpace(packet.EntryBridge)
	packet.Goal = strings.TrimSpace(packet.Goal)
	packet.Pressure = strings.TrimSpace(packet.Pressure)
	packet.Choice = strings.TrimSpace(packet.Choice)
	packet.Turn = strings.TrimSpace(packet.Turn)
	packet.ExitDebt = strings.TrimSpace(packet.ExitDebt)
	packet.CharacterIDs = normalizeNovelWorkbenchV3IDs(packet.CharacterIDs)
	packet.RequiredEvents = cleanNovelWorkbenchV3Strings(packet.RequiredEvents)
	packet.AllowedConclusion = strings.TrimSpace(packet.AllowedConclusion)
	packet.ForbiddenConclusions = cleanNovelWorkbenchV3Strings(packet.ForbiddenConclusions)
	for index := range packet.FactActions {
		packet.FactActions[index].FactID = normalizeNovelWorkbenchV3ID(packet.FactActions[index].FactID)
		packet.FactActions[index].Action = strings.ToLower(strings.TrimSpace(packet.FactActions[index].Action))
		packet.FactActions[index].VisibleEvent = strings.TrimSpace(packet.FactActions[index].VisibleEvent)
	}
	for index := range packet.CharacterChanges {
		change := &packet.CharacterChanges[index]
		change.CharacterID = normalizeNovelWorkbenchV3ID(change.CharacterID)
		change.ToStatus = strings.TrimSpace(change.ToStatus)
		change.ToLocation = strings.TrimSpace(change.ToLocation)
		change.Reason = strings.TrimSpace(change.Reason)
	}
	for index := range packet.KnowledgeGrants {
		grant := &packet.KnowledgeGrants[index]
		grant.CharacterID = normalizeNovelWorkbenchV3ID(grant.CharacterID)
		grant.FactIDs = normalizeNovelWorkbenchV3IDs(grant.FactIDs)
		grant.Reason = strings.TrimSpace(grant.Reason)
	}
}

func validateNovelWorkbenchV3ArcPlan(control novelWorkbenchV3Control, state novelWorkbenchV3State, arc novelWorkbenchV3StoryArc, output *novelWorkbenchV3ArcPlanOutput) error {
	if output == nil {
		return errors.New("故事弧计划为空")
	}
	output.EntryDigest = strings.TrimSpace(output.EntryDigest)
	output.ArcSummary = strings.TrimSpace(output.ArcSummary)
	if output.EntryDigest == "" || output.ArcSummary == "" {
		return errors.New("故事弧计划缺少入口摘要或弧线摘要")
	}
	expectedCount := arc.EndUnit - arc.StartUnit + 1
	if len(output.Packets) != expectedCount {
		return fmt.Errorf("故事弧 %s 需要 %d 个连续单元包，当前得到 %d 个", arc.ID, expectedCount, len(output.Packets))
	}
	sort.SliceStable(output.Packets, func(left, right int) bool { return output.Packets[left].Unit < output.Packets[right].Unit })
	projected := cloneNovelWorkbenchV3State(state)
	for index := range output.Packets {
		packet := &output.Packets[index]
		expectedUnit := arc.StartUnit + index
		normalizeNovelWorkbenchV3Packet(packet)
		if packet.Unit != expectedUnit {
			return fmt.Errorf("故事弧 %s 的第 %d 个单元包应为第 %d 单元", arc.ID, index+1, expectedUnit)
		}
		if err := validateNovelWorkbenchV3Packet(control, &projected, *packet, expectedUnit); err != nil {
			return err
		}
		if err := applyNovelWorkbenchV3PacketTransitions(control, &projected, *packet); err != nil {
			return err
		}
		if err := validateNovelWorkbenchV3Deadlines(control, projected, expectedUnit); err != nil {
			return err
		}
	}
	return nil
}

func validateNovelWorkbenchV3SealedArcShape(control novelWorkbenchV3Control, arc novelWorkbenchV3StoryArc, pkg novelWorkbenchV3ArcPackage) error {
	if pkg.Version != novelWorkbenchV3ArcPlanVersion || pkg.ArcID != arc.ID || pkg.StartUnit != arc.StartUnit || pkg.EndUnit != arc.EndUnit {
		return fmt.Errorf("已封存故事弧 %s 与全书导航不一致", arc.ID)
	}
	if strings.TrimSpace(pkg.EntryDigest) == "" || strings.TrimSpace(pkg.ArcSummary) == "" {
		return fmt.Errorf("已封存故事弧 %s 缺少摘要", arc.ID)
	}
	if len(pkg.Packets) != arc.EndUnit-arc.StartUnit+1 {
		return fmt.Errorf("已封存故事弧 %s 的单元包数量不完整", arc.ID)
	}
	characters := novelWorkbenchV3CharacterMap(control)
	facts := novelWorkbenchV3FactMap(control)
	for index, packet := range pkg.Packets {
		if packet.Unit != arc.StartUnit+index || strings.TrimSpace(packet.Title) == "" {
			return fmt.Errorf("已封存故事弧 %s 的第 %d 个单元包损坏", arc.ID, index+1)
		}
		for _, characterID := range packet.CharacterIDs {
			if _, exists := characters[characterID]; !exists {
				return fmt.Errorf("已封存故事弧 %s 引用了不存在的角色 %s", arc.ID, characterID)
			}
		}
		for _, action := range packet.FactActions {
			if _, exists := facts[action.FactID]; !exists {
				return fmt.Errorf("已封存故事弧 %s 引用了不存在的账本 %s", arc.ID, action.FactID)
			}
		}
	}
	return nil
}

func validateNovelWorkbenchV3Packet(control novelWorkbenchV3Control, state *novelWorkbenchV3State, packet novelWorkbenchV3EpisodePacket, expectedUnit int) error {
	if packet.Unit != expectedUnit {
		return fmt.Errorf("单元包编号必须为 %d", expectedUnit)
	}
	for label, value := range map[string]string{
		"标题": packet.Title, "入口接力": packet.EntryBridge, "目标": packet.Goal, "压力": packet.Pressure,
		"选择": packet.Choice, "转折": packet.Turn, "离场债务": packet.ExitDebt, "允许结论": packet.AllowedConclusion,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("第 %d 单元包缺少%s", expectedUnit, label)
		}
	}
	if len(packet.CharacterIDs) == 0 || len(packet.RequiredEvents) == 0 {
		return fmt.Errorf("第 %d 单元包缺少角色或必现事件", expectedUnit)
	}
	characters := novelWorkbenchV3CharacterMap(control)
	facts := novelWorkbenchV3FactMap(control)
	for _, characterID := range packet.CharacterIDs {
		if _, exists := characters[characterID]; !exists {
			return fmt.Errorf("第 %d 单元包引用了不存在的角色 %s", expectedUnit, characterID)
		}
	}
	actionIDs := map[string]struct{}{}
	projectedFactStates := map[string]string{}
	for id, status := range state.FactStates {
		projectedFactStates[id] = status
	}
	for _, action := range packet.FactActions {
		fact, exists := facts[action.FactID]
		if !exists {
			return fmt.Errorf("第 %d 单元包引用了不存在的账本 %s", expectedUnit, action.FactID)
		}
		if action.VisibleEvent == "" {
			return fmt.Errorf("第 %d 单元包的账本 %s 缺少可见事件", expectedUnit, action.FactID)
		}
		if _, exists := actionIDs[action.FactID]; exists {
			return fmt.Errorf("第 %d 单元包重复操作账本 %s", expectedUnit, action.FactID)
		}
		actionIDs[action.FactID] = struct{}{}
		status := projectedFactStates[action.FactID]
		switch action.Action {
		case "introduce":
			if status != "planned" {
				return fmt.Errorf("账本 %s 当前为 %s，不能再次引入", fact.ID, status)
			}
			projectedFactStates[action.FactID] = "seeded"
		case "advance":
			if status != "seeded" && status != "active" {
				return fmt.Errorf("账本 %s 未引入，不能推进", fact.ID)
			}
			projectedFactStates[action.FactID] = "active"
		case "resolve":
			if status != "seeded" && status != "active" {
				return fmt.Errorf("账本 %s 未被前序单元引入，不能回收", fact.ID)
			}
			projectedFactStates[action.FactID] = "resolved"
		default:
			return fmt.Errorf("账本 %s 的动作必须是 introduce、advance 或 resolve", fact.ID)
		}
	}
	changedCharacters := map[string]struct{}{}
	for _, change := range packet.CharacterChanges {
		if _, exists := characters[change.CharacterID]; !exists {
			return fmt.Errorf("第 %d 单元包修改了不存在的角色 %s", expectedUnit, change.CharacterID)
		}
		if _, exists := changedCharacters[change.CharacterID]; exists {
			return fmt.Errorf("第 %d 单元包重复修改角色 %s", expectedUnit, change.CharacterID)
		}
		if change.ToStatus == "" && change.ToLocation == "" {
			return fmt.Errorf("角色 %s 的状态变更没有目标状态或地点", change.CharacterID)
		}
		if change.Reason == "" {
			return fmt.Errorf("角色 %s 的状态变更缺少原因", change.CharacterID)
		}
		changedCharacters[change.CharacterID] = struct{}{}
	}
	for _, grant := range packet.KnowledgeGrants {
		if _, exists := characters[grant.CharacterID]; !exists {
			return fmt.Errorf("第 %d 单元包向不存在的角色 %s 授予知识", expectedUnit, grant.CharacterID)
		}
		if len(grant.FactIDs) == 0 || grant.Reason == "" {
			return fmt.Errorf("角色 %s 的知识授予缺少账本或来源", grant.CharacterID)
		}
		for _, factID := range grant.FactIDs {
			if _, exists := facts[factID]; !exists {
				return fmt.Errorf("角色 %s 获得了不存在的账本 %s", grant.CharacterID, factID)
			}
			if status := projectedFactStates[factID]; status == "planned" || status == "" {
				return fmt.Errorf("角色 %s 在账本 %s 可见前获得知识", grant.CharacterID, factID)
			}
		}
	}
	return nil
}

func novelWorkbenchV3CharacterMap(control novelWorkbenchV3Control) map[string]novelWorkbenchV3Character {
	result := make(map[string]novelWorkbenchV3Character, len(control.Bible.Characters))
	for _, character := range control.Bible.Characters {
		result[character.ID] = character
	}
	return result
}

func novelWorkbenchV3FactMap(control novelWorkbenchV3Control) map[string]novelWorkbenchV3Fact {
	result := make(map[string]novelWorkbenchV3Fact, len(control.Bible.Facts))
	for _, fact := range control.Bible.Facts {
		result[fact.ID] = fact
	}
	return result
}

func cloneNovelWorkbenchV3State(state novelWorkbenchV3State) novelWorkbenchV3State {
	clone := normalizeNovelWorkbenchV3State(state)
	clone.CharacterStates = make(map[string]novelWorkbenchV3CharacterState, len(state.CharacterStates))
	for id, character := range state.CharacterStates {
		character.KnownFactIDs = append([]string{}, character.KnownFactIDs...)
		clone.CharacterStates[id] = character
	}
	clone.FactStates = make(map[string]string, len(state.FactStates))
	for id, value := range state.FactStates {
		clone.FactStates[id] = value
	}
	clone.OpenQuestions = append([]novelWorkbenchV3OpenQuestion{}, state.OpenQuestions...)
	clone.RecentSummaries = append([]novelWorkbenchV3UnitSummary{}, state.RecentSummaries...)
	return clone
}

func applyNovelWorkbenchV3PacketTransitions(control novelWorkbenchV3Control, state *novelWorkbenchV3State, packet novelWorkbenchV3EpisodePacket) error {
	if state == nil {
		return errors.New("无法写入空动态状态")
	}
	facts := novelWorkbenchV3FactMap(control)
	for _, action := range packet.FactActions {
		switch action.Action {
		case "introduce":
			state.FactStates[action.FactID] = "seeded"
		case "advance":
			state.FactStates[action.FactID] = "active"
		case "resolve":
			state.FactStates[action.FactID] = "resolved"
		default:
			return fmt.Errorf("账本 %s 的动作无效", action.FactID)
		}
		fact := facts[action.FactID]
		if fact.Kind == "question" && action.Action == "introduce" {
			state.OpenQuestions = upsertNovelWorkbenchV3Question(state.OpenQuestions, novelWorkbenchV3OpenQuestion{ID: fact.ID, Text: fact.Statement, OpenedUnit: packet.Unit})
		}
		if fact.Kind == "question" && action.Action == "resolve" {
			state.OpenQuestions = removeNovelWorkbenchV3Question(state.OpenQuestions, fact.ID)
		}
	}
	for _, change := range packet.CharacterChanges {
		character := state.CharacterStates[change.CharacterID]
		if change.ToStatus != "" {
			character.Status = change.ToStatus
		}
		if change.ToLocation != "" {
			character.Location = change.ToLocation
		}
		state.CharacterStates[change.CharacterID] = character
	}
	for _, grant := range packet.KnowledgeGrants {
		character := state.CharacterStates[grant.CharacterID]
		character.KnownFactIDs = normalizeNovelWorkbenchV3IDs(append(character.KnownFactIDs, grant.FactIDs...))
		state.CharacterStates[grant.CharacterID] = character
	}
	return nil
}

func upsertNovelWorkbenchV3Question(questions []novelWorkbenchV3OpenQuestion, next novelWorkbenchV3OpenQuestion) []novelWorkbenchV3OpenQuestion {
	for index := range questions {
		if questions[index].ID == next.ID {
			return questions
		}
	}
	return append(questions, next)
}

func removeNovelWorkbenchV3Question(questions []novelWorkbenchV3OpenQuestion, id string) []novelWorkbenchV3OpenQuestion {
	result := questions[:0]
	for _, question := range questions {
		if question.ID != id {
			result = append(result, question)
		}
	}
	return result
}

func validateNovelWorkbenchV3Deadlines(control novelWorkbenchV3Control, state novelWorkbenchV3State, completedUnit int) error {
	if completedUnit >= control.Brief.TargetUnitCount {
		for _, fact := range control.Bible.Facts {
			if (fact.Kind == "promise" || fact.Kind == "question") && state.FactStates[fact.ID] != "resolved" {
				return fmt.Errorf("结局仍未收束读者%s：%s", map[string]string{"promise": "承诺", "question": "问题"}[fact.Kind], fact.ID)
			}
		}
	}
	for _, fact := range control.Bible.Facts {
		status := state.FactStates[fact.ID]
		if fact.IntroducedByUnit > 0 && completedUnit >= fact.IntroducedByUnit && status == "planned" {
			return fmt.Errorf("账本 %s 未在第 %d 单元前引入", fact.ID, fact.IntroducedByUnit)
		}
		if fact.ResolveByUnit > 0 && completedUnit >= fact.ResolveByUnit && status != "resolved" {
			return fmt.Errorf("账本 %s 未在第 %d 单元前回收", fact.ID, fact.ResolveByUnit)
		}
	}
	return nil
}

func applyNovelWorkbenchV3Packet(control novelWorkbenchV3Control, state novelWorkbenchV3State, pkg novelWorkbenchV3ArcPackage, packet novelWorkbenchV3EpisodePacket, draft novelWorkbenchV3Draft) (novelWorkbenchV3State, error) {
	next := cloneNovelWorkbenchV3State(state)
	if err := applyNovelWorkbenchV3PacketTransitions(control, &next, packet); err != nil {
		return next, err
	}
	next.CompletedUnit = packet.Unit
	next.LastUnitSummary = strings.TrimSpace(draft.Summary)
	next.NextUnitBridge = strings.TrimSpace(packet.ExitDebt)
	next.RecentSummaries = append(next.RecentSummaries, novelWorkbenchV3UnitSummary{Unit: packet.Unit, Title: novelWorkbenchUnitTitle(control.Brief.OutputMode, packet.Unit, draft.Title), Summary: next.LastUnitSummary})
	if len(next.RecentSummaries) > novelWorkbenchV3RecentSummaryLimit {
		next.RecentSummaries = next.RecentSummaries[len(next.RecentSummaries)-novelWorkbenchV3RecentSummaryLimit:]
	}
	next.CurrentArcID = pkg.ArcID
	if packet.Unit >= pkg.EndUnit {
		next.CurrentArc = nil
	}
	return next, nil
}

func validateNovelWorkbenchV3PostCommit(control novelWorkbenchV3Control, state novelWorkbenchV3State, unit int) error {
	if state.CompletedUnit != unit {
		return fmt.Errorf("提交状态完成单元为 %d，与当前单元 %d 不一致", state.CompletedUnit, unit)
	}
	return validateNovelWorkbenchV3Deadlines(control, state, unit)
}

func buildNovelWorkbenchV3ArcPlanPrompt(control novelWorkbenchV3Control, state novelWorkbenchV3State, arc novelWorkbenchV3StoryArc) string {
	briefJSON, _ := json.Marshal(control.Brief)
	arcJSON, _ := json.Marshal(arc)
	stateJSON, _ := json.Marshal(novelWorkbenchV3ArcPlanningState(control, state, arc))
	characterJSON, _ := json.Marshal(control.Bible.Characters)
	factJSON, _ := json.Marshal(novelWorkbenchV3RelevantFacts(control, state, arc))
	modeRule := "每个单元包都要写明开场钩子、可拍摄冲突、升级、反转、结尾钩子和下一集债务。"
	if control.Brief.OutputMode == novelWorkbenchModeNovel {
		modeRule = "每个单元包都要写明章节入口、人物目标、压力、选择、转折和下一章债务，不要写成分镜。"
	}
	return fmt.Sprintf(`你是长线作品的故事弧策划编辑。现在只能为当前故事弧制作一个可封存的执行包，不能改写全书正史，也不能为了通过审计凭空给角色追加动机、地点、关系或证据。

%s
用户简报：%s
全书结局承诺：%s
当前故事弧：%s
进入本弧前的冻结状态：%s
可用角色卡：%s
本弧相关账本：%s

规则：
1. 必须连续输出第 %d 至第 %d 单元，每单元只允许写本弧内能观察、能发生、能在正文中呈现的事件。
2. factActions 的 introduce/advance/resolve 只操作上述既有账本 ID。未证实的怀疑必须保持 question，不能将单一可疑动作写成唯一动机或既成真相。
3. characterChanges 只有出现确实可见的状态或地点改变时才填写；没有改变就留空，绝不能为了凑字段声明移动。
4. knowledgeGrants 只在人物从可见事件中实际得知某个已引入账本时填写；不得让角色知道读者才知道的内容。
5. requiredEvents 必须是可直接在正文中验证的事件，不能是“情绪到位”“动机成立”等抽象判断。
6. allowedConclusion 表示本集结束时读者最多可确认到哪里；forbiddenConclusions 必须写清本集不能越过的结论。每集都不要求证明隐藏动机，只有故事给出充分可见证据时才允许上升为事实。
7. 一次封存后正文只能执行这些包；请在本轮把相邻单元的因果接力安排清楚。
8. characterChanges 描述的是“当前单元切点已经成立”的事实；下一单元的 entryBridge 从下一单元开场才开始兑现。若角色本集要为下一集行动做准备，本集可以写即时意图、转向或走向出口，但不得把下一集的完整移动、交接或结果提前写成已经完成。

只输出合法 JSON：
{"entryDigest":"","arcSummary":"","packets":[{"unit":%d,"title":"","entryBridge":"","goal":"","pressure":"","choice":"","turn":"","exitDebt":"","characterIds":["char_"],"factActions":[{"factId":"","action":"introduce","visibleEvent":""}],"characterChanges":[{"characterId":"char_","toStatus":"","toLocation":"","reason":""}],"knowledgeGrants":[{"characterId":"char_","factIds":[""],"reason":""}],"requiredEvents":[""],"allowedConclusion":"","forbiddenConclusions":[""]}]}`,
		modeRule, string(briefJSON), control.Bible.EndingPromise, string(arcJSON), string(stateJSON), string(characterJSON), string(factJSON), arc.StartUnit, arc.EndUnit, arc.StartUnit)
}

func buildNovelWorkbenchV3ArcPlanRepairPrompt(control novelWorkbenchV3Control, state novelWorkbenchV3State, arc novelWorkbenchV3StoryArc, previousRaw string, failure string, review *novelWorkbenchV3ReviewReport) string {
	reviewJSON, _ := json.Marshal(review)
	return fmt.Sprintf(`你正在定向重编一个尚未封存的故事弧执行包。不要续写正文、不要输出补丁；重新输出完整 JSON。保留原有故事方向，只修复失败单指出的项目。

当前故事弧：%s
冻结状态：%s
失败单：%s
独立审稿报告：%s
上一版执行包：%s

重点：不能把可疑动作升级为唯一动机；不得让角色未经可见事件就获得知识；不得在没有变化时声明角色移动；所有账本动作必须使用已存在的 ID，并且回收必须先有引入。只输出完整 JSON。`,
		novelWorkbenchV3JSON(arc), novelWorkbenchV3JSON(novelWorkbenchV3ArcPlanningState(control, state, arc)), failure, string(reviewJSON), previousRaw)
}

func novelWorkbenchV3ArcPlanningState(control novelWorkbenchV3Control, state novelWorkbenchV3State, arc novelWorkbenchV3StoryArc) map[string]any {
	characters := map[string]novelWorkbenchV3CharacterState{}
	for id, item := range state.CharacterStates {
		characters[id] = item
	}
	return map[string]any{
		"completedUnit": state.CompletedUnit, "lastUnitSummary": state.LastUnitSummary, "nextUnitBridge": state.NextUnitBridge,
		"characterStates": characters, "factStates": state.FactStates, "openQuestions": state.OpenQuestions,
		"recentSummaries": state.RecentSummaries, "arcRange": []int{arc.StartUnit, arc.EndUnit}, "targetUnitCount": control.Brief.TargetUnitCount,
	}
}

func novelWorkbenchV3RelevantFacts(control novelWorkbenchV3Control, state novelWorkbenchV3State, arc novelWorkbenchV3StoryArc) []map[string]any {
	items := make([]map[string]any, 0, len(control.Bible.Facts))
	for _, fact := range control.Bible.Facts {
		if fact.IntroducedByUnit > 0 && fact.IntroducedByUnit > arc.EndUnit {
			continue
		}
		if fact.ResolveByUnit > 0 && fact.ResolveByUnit < arc.StartUnit && state.FactStates[fact.ID] == "resolved" {
			continue
		}
		items = append(items, map[string]any{"id": fact.ID, "statement": fact.Statement, "kind": fact.Kind, "status": state.FactStates[fact.ID], "introducedByUnit": fact.IntroducedByUnit, "resolveByUnit": fact.ResolveByUnit, "ownerIds": fact.OwnerIDs})
	}
	return items
}

func novelWorkbenchV3JSON(value any) string {
	raw, _ := json.Marshal(value)
	return string(raw)
}

func buildNovelWorkbenchV3ArcReviewPrompt(control novelWorkbenchV3Control, state novelWorkbenchV3State, arc novelWorkbenchV3StoryArc, pkg novelWorkbenchV3ArcPackage) string {
	return fmt.Sprintf(`你是独立的长线连续性审稿编辑。审阅“尚未封存”的故事弧执行包，只检查真正会破坏后续创作的硬问题。

全书正史：%s
进入本弧前状态：%s
当前故事弧：%s
候选执行包：%s

通过条件：单元连续、角色和账本 ID 存在、事件有因果接力、角色知识不越界、状态变化可执行、承诺在最后期限前有路径、弧尾仍有可执行出口。相邻单元的 entryBridge 属于下一单元；不要要求上一单元提前完成下一单元动作，但要阻止上一单元违背它自己的 characterChanges。

只能把以下情形列为 blockingIssues：
- ARC_CONTINUITY_GAP：相邻单元之间没有可执行接力；
- ARC_STATE_CONFLICT：与冻结角色状态、地点或世界规则矛盾；
- ARC_KNOWLEDGE_BREACH：人物知道没有可见来源的事实；
- ARC_UNRESOLVED_ENDING：最后阶段无法在剩余单元收束承诺或问题；
- ARC_IMPOSSIBLE_STAGING：关键事件依赖未存在的人物、物件或前提。

不要因为“动机还有其他解释”就拦截。此类内容应作为 warning，除非执行包把它错误写成唯一事实。不要以字数、文风或偏好作为本弧阻断理由。

只输出 JSON：
{"unit":%d,"overallPass":true,"blockingIssues":[{"code":"ARC_CONTINUITY_GAP","unit":%d,"referenceIds":[""],"evidence":"","repairAction":""}],"warnings":[{"code":"","unit":%d,"referenceIds":[""],"evidence":"","repairAction":""}],"verdict":""}`,
		novelWorkbenchV3JSON(control.Bible), novelWorkbenchV3JSON(novelWorkbenchV3ArcPlanningState(control, state, arc)), novelWorkbenchV3JSON(arc), novelWorkbenchV3JSON(pkg), arc.StartUnit, arc.StartUnit, arc.StartUnit)
}

func buildNovelWorkbenchV3ArcReviewRepairPrompt(control novelWorkbenchV3Control, state novelWorkbenchV3State, arc novelWorkbenchV3StoryArc, pkg novelWorkbenchV3ArcPackage, previousRaw string, validationErr error) string {
	return fmt.Sprintf(`你是独立的长线连续性审稿编辑。上一版审稿报告无法被系统读取或校验；不要要求主笔重写正文，也不要重新规划故事弧。请只重新输出针对同一封存候选的合法审稿 JSON。

报告结构失败原因：%s
上一版报告：%s

全书正史：%s
进入本弧前状态：%s
当前故事弧：%s
候选执行包：%s

blockingIssues 只能使用 ARC_CONTINUITY_GAP、ARC_STATE_CONFLICT、ARC_KNOWLEDGE_BREACH、ARC_UNRESOLVED_ENDING、ARC_IMPOSSIBLE_STAGING；如果不存在这些硬问题，请 overallPass=true 且 blockingIssues=[]。不要把可替代动机解释或文风偏好写成 blocker。只输出 JSON。`,
		validationErr.Error(), previousRaw, novelWorkbenchV3JSON(control.Bible), novelWorkbenchV3JSON(novelWorkbenchV3ArcPlanningState(control, state, arc)), novelWorkbenchV3JSON(arc), novelWorkbenchV3JSON(pkg))
}

func validateNovelWorkbenchV3ArcReview(report novelWorkbenchV3ReviewReport, control novelWorkbenchV3Control, arc novelWorkbenchV3StoryArc) error {
	if report.Unit != 0 && (report.Unit < arc.StartUnit || report.Unit > arc.EndUnit) {
		return fmt.Errorf("故事弧审稿报告单元 %d 不在当前故事弧内", report.Unit)
	}
	validCodes := map[string]struct{}{
		"ARC_CONTINUITY_GAP": {}, "ARC_STATE_CONFLICT": {}, "ARC_KNOWLEDGE_BREACH": {}, "ARC_UNRESOLVED_ENDING": {}, "ARC_IMPOSSIBLE_STAGING": {},
	}
	known := map[string]struct{}{}
	for id := range novelWorkbenchV3CharacterMap(control) {
		known[id] = struct{}{}
	}
	for id := range novelWorkbenchV3FactMap(control) {
		known[id] = struct{}{}
	}
	validate := func(issue novelWorkbenchV3ReviewIssue, blocking bool) error {
		issue.Code = strings.TrimSpace(issue.Code)
		if blocking {
			if _, exists := validCodes[issue.Code]; !exists {
				return fmt.Errorf("故事弧审稿使用了不支持的阻断代码 %s", issue.Code)
			}
			if issue.Unit < arc.StartUnit || issue.Unit > arc.EndUnit || strings.TrimSpace(issue.Evidence) == "" || strings.TrimSpace(issue.RepairAction) == "" {
				return errors.New("故事弧阻断问题缺少单元、证据或修复动作")
			}
		}
		for _, id := range normalizeNovelWorkbenchV3IDs(issue.ReferenceIDs) {
			if _, exists := known[id]; !exists {
				return fmt.Errorf("故事弧审稿引用了不存在的 ID %s", id)
			}
		}
		return nil
	}
	for _, issue := range report.BlockingIssues {
		if err := validate(issue, true); err != nil {
			return err
		}
	}
	for _, issue := range report.Warnings {
		if err := validate(issue, false); err != nil {
			return err
		}
	}
	if report.OverallPass && len(report.BlockingIssues) > 0 {
		return errors.New("故事弧审稿同时标记通过和阻断问题")
	}
	if !report.OverallPass && len(report.BlockingIssues) == 0 {
		return errors.New("故事弧审稿未通过时必须给出至少一条可执行的阻断问题")
	}
	return nil
}

func novelWorkbenchV3ReviewFailure(report novelWorkbenchV3ReviewReport) string {
	parts := make([]string, 0, len(report.BlockingIssues)+1)
	for _, issue := range report.BlockingIssues {
		parts = append(parts, fmt.Sprintf("[%s] 第 %d 单元：%s。修复：%s", issue.Code, issue.Unit, strings.TrimSpace(issue.Evidence), strings.TrimSpace(issue.RepairAction)))
	}
	if verdict := strings.TrimSpace(report.Verdict); verdict != "" {
		parts = append(parts, "审稿结论："+verdict)
	}
	return strings.Join(parts, "\n")
}

func novelWorkbenchV3FailureFingerprint(value string) string {
	value = strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(value)), " "))
	if value == "" {
		return ""
	}
	digest := sha256.Sum256([]byte(value))
	return fmt.Sprintf("%x", digest[:])
}

func novelWorkbenchV3ReviewFingerprint(report novelWorkbenchV3ReviewReport) string {
	parts := make([]string, 0, len(report.BlockingIssues))
	for _, issue := range report.BlockingIssues {
		references := normalizeNovelWorkbenchV3IDs(issue.ReferenceIDs)
		sort.Strings(references)
		// Evidence and repair wording are intentionally excluded. The review
		// model may paraphrase the same blocker on each pass; code + stable IDs
		// are the durable contract that determines whether a repair made progress.
		parts = append(parts, strings.Join([]string{
			strings.ToUpper(strings.TrimSpace(issue.Code)),
			strings.Join(references, ","),
		}, "|"))
	}
	sort.Strings(parts)
	return novelWorkbenchV3FailureFingerprint(strings.Join(parts, "\n"))
}

func novelWorkbenchV3DraftSHA256(draft novelWorkbenchV3Draft) string {
	raw, _ := json.Marshal(draft)
	digest := sha256.Sum256(raw)
	return fmt.Sprintf("%x", digest[:])
}

func novelWorkbenchV3ReviewIssueCodes(report novelWorkbenchV3ReviewReport) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(report.BlockingIssues))
	for _, issue := range report.BlockingIssues {
		code := strings.TrimSpace(issue.Code)
		if code == "" {
			continue
		}
		if _, exists := seen[code]; exists {
			continue
		}
		seen[code] = struct{}{}
		result = append(result, code)
	}
	sort.Strings(result)
	return result
}

func novelWorkbenchV3ReviewRepairActions(report novelWorkbenchV3ReviewReport) []string {
	result := make([]string, 0, len(report.BlockingIssues))
	for _, issue := range report.BlockingIssues {
		if action := strings.TrimSpace(issue.RepairAction); action != "" {
			result = append(result, action)
		}
	}
	return result
}

func novelWorkbenchV3BoundaryContractForPacket(control novelWorkbenchV3Control, state novelWorkbenchV3State, pkg novelWorkbenchV3ArcPackage, packet novelWorkbenchV3EpisodePacket) (novelWorkbenchV3BoundaryContract, error) {
	projected := cloneNovelWorkbenchV3State(state)
	if err := validateNovelWorkbenchV3Packet(control, &projected, packet, packet.Unit); err != nil {
		return novelWorkbenchV3BoundaryContract{}, err
	}
	if err := applyNovelWorkbenchV3PacketTransitions(control, &projected, packet); err != nil {
		return novelWorkbenchV3BoundaryContract{}, err
	}
	exitStates := map[string]novelWorkbenchV3CharacterState{}
	for _, change := range packet.CharacterChanges {
		if character, exists := projected.CharacterStates[change.CharacterID]; exists {
			exitStates[change.CharacterID] = character
		}
	}
	contract := novelWorkbenchV3BoundaryContract{
		Unit:              packet.Unit,
		CurrentExitStates: exitStates,
		Rule:              "当前单元的 currentExitStates 是唯一有效的切点状态；下一单元的 entryBridge 只从下一单元开始生效。当前单元可以建立即时意图、转向或走向出口，但不得把下一单元的完整行动提前写成已经完成，也不得违背本单元的退出状态。",
	}
	if nextPacket, exists := novelWorkbenchV3PacketForUnit(pkg, packet.Unit+1); exists {
		if err := validateNovelWorkbenchV3Packet(control, &projected, nextPacket, nextPacket.Unit); err != nil {
			return novelWorkbenchV3BoundaryContract{}, fmt.Errorf("第 %d 单元无法与第 %d 单元建立状态边界：%w", packet.Unit, nextPacket.Unit, err)
		}
		contract.NextUnit = nextPacket.Unit
		contract.NextUnitEntryBridge = strings.TrimSpace(nextPacket.EntryBridge)
	}
	return contract, nil
}

func novelWorkbenchV3BoundaryInvariants(contract novelWorkbenchV3BoundaryContract) []string {
	result := []string{contract.Rule}
	if len(contract.CurrentExitStates) > 0 {
		result = append(result, "本单元截止状态："+novelWorkbenchV3JSON(contract.CurrentExitStates))
	}
	if contract.NextUnit > 0 && contract.NextUnitEntryBridge != "" {
		result = append(result, fmt.Sprintf("第 %d 单元入口接力（只在下一单元兑现）：%s", contract.NextUnit, contract.NextUnitEntryBridge))
	}
	return result
}

func novelWorkbenchV3CanUseLocalizedPatch(report novelWorkbenchV3ReviewReport) bool {
	if len(report.BlockingIssues) == 0 {
		return false
	}
	for _, issue := range report.BlockingIssues {
		switch strings.TrimSpace(issue.Code) {
		case "STATE_CONTRADICTION", "REQUIRED_EVENT_MISSING", "EXIT_DEBT_MISSING":
		default:
			return false
		}
	}
	return true
}

func novelWorkbenchV3RecoveryStrategy(history novelWorkbenchV3ProseRecoveryHistory) (string, string) {
	if strings.TrimSpace(history.LastFailure) == "" {
		return novelWorkbenchV3RecoveryInitial, ""
	}
	if history.LastStrategy != novelWorkbenchV3RecoveryInitial && history.LastStrategy != novelWorkbenchV3RecoveryPriorBlock && history.LastStrategy != "" && history.LastSourceFingerprint != "" && history.LastSourceFingerprint == history.LastFailureFingerprint {
		return "", fmt.Sprintf("同一失败指纹在%s后再次出现，已停止盲目重试：%s", map[string]string{novelWorkbenchV3RecoveryLocalizedPatch: "局部修补", novelWorkbenchV3RecoveryFullRewrite: "全文重写"}[history.LastStrategy], history.LastFailure)
	}
	if novelWorkbenchV3CanUseLocalizedPatch(history.LastReview) && history.LatestDraft != nil && history.LocalizedPatchAttempts < novelWorkbenchV3MaxLocalizedPatchAttempts {
		return novelWorkbenchV3RecoveryLocalizedPatch, ""
	}
	if history.FullRewriteAttempts < novelWorkbenchV3MaxFullRewriteAttempts {
		return novelWorkbenchV3RecoveryFullRewrite, ""
	}
	return "", fmt.Sprintf("第 %d 单元已用尽局部修补（%d/%d）和全文重写（%d/%d）预算，仍未通过：%s", history.LastReview.Unit, history.LocalizedPatchAttempts, novelWorkbenchV3MaxLocalizedPatchAttempts, history.FullRewriteAttempts, novelWorkbenchV3MaxFullRewriteAttempts, history.LastFailure)
}

func novelWorkbenchV3RecoveryRecord(history novelWorkbenchV3ProseRecoveryHistory, strategy string, unit int, attempt int, boundary novelWorkbenchV3BoundaryContract) novelWorkbenchV3ProseRecoveryRecord {
	localized := history.LocalizedPatchAttempts
	fullRewrite := history.FullRewriteAttempts
	if strategy == novelWorkbenchV3RecoveryLocalizedPatch {
		localized++
	}
	if strategy == novelWorkbenchV3RecoveryFullRewrite {
		fullRewrite++
	}
	return novelWorkbenchV3ProseRecoveryRecord{
		Version: novelWorkbenchV3EngineVersion, Unit: unit, Attempt: attempt, Strategy: strategy,
		SourceFailureFingerprint: history.LastFailureFingerprint, Failure: history.LastFailure,
		IssueCodes: novelWorkbenchV3ReviewIssueCodes(history.LastReview), RequiredActions: novelWorkbenchV3ReviewRepairActions(history.LastReview),
		Invariants:                novelWorkbenchV3BoundaryInvariants(boundary),
		RemainingLocalizedPatches: novelWorkbenchV3MaxLocalizedPatchAttempts - localized,
		RemainingFullRewrites:     novelWorkbenchV3MaxFullRewriteAttempts - fullRewrite,
	}
}

func (s *Service) novelWorkbenchV3ProseRecoveryHistory(run *model.NovelWorkbenchRun, unit int) (novelWorkbenchV3ProseRecoveryHistory, error) {
	history := novelWorkbenchV3ProseRecoveryHistory{}
	artifacts, err := s.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		return history, err
	}
	sort.SliceStable(artifacts, func(left, right int) bool { return artifacts[left].CreatedAt.Before(artifacts[right].CreatedAt) })
	setFailure := func(strategy, sourceFingerprint, failure, fingerprint string, review novelWorkbenchV3ReviewReport) {
		if strings.TrimSpace(failure) == "" {
			return
		}
		history.LastStrategy = firstNonEmptyString(strategy, novelWorkbenchV3RecoveryPriorBlock)
		history.LastSourceFingerprint = strings.TrimSpace(sourceFingerprint)
		history.LastFailure = strings.TrimSpace(failure)
		history.LastFailureFingerprint = firstNonEmptyString(strings.TrimSpace(fingerprint), novelWorkbenchV3FailureFingerprint(failure))
		if review.Unit != 0 {
			history.LastReview = review
		}
	}
	for _, artifact := range artifacts {
		if artifact.Unit != unit {
			continue
		}
		switch artifact.Kind {
		case "prose_recovery":
			var record novelWorkbenchV3ProseRecoveryRecord
			if json.Unmarshal([]byte(artifact.ContentJSON), &record) == nil && record.Strategy != "" {
				history.AttemptCount = max(history.AttemptCount, record.Attempt)
				switch record.Strategy {
				case novelWorkbenchV3RecoveryLocalizedPatch:
					history.LocalizedPatchAttempts++
				case novelWorkbenchV3RecoveryFullRewrite:
					history.FullRewriteAttempts++
				}
			}
		case "prose_attempt":
			var record novelWorkbenchV3ProseAttemptRecord
			if json.Unmarshal([]byte(artifact.ContentJSON), &record) == nil && record.Strategy != "" && record.Draft.Unit == unit {
				draft := record.Draft
				history.LatestDraft = &draft
				history.AttemptCount = max(history.AttemptCount, record.Attempt)
			}
		case "render_review_attempt":
			var record novelWorkbenchV3RenderReviewAttemptRecord
			if json.Unmarshal([]byte(artifact.ContentJSON), &record) == nil && record.Strategy != "" {
				history.AttemptCount = max(history.AttemptCount, record.Attempt)
				setFailure(record.Strategy, record.SourceFailureFingerprint, record.Failure, record.FailureFingerprint, record.Review)
				continue
			}
			var priorBlock struct {
				Review  novelWorkbenchV3ReviewReport `json:"review"`
				Failure string                       `json:"failure"`
			}
			if json.Unmarshal([]byte(artifact.ContentJSON), &priorBlock) == nil {
				failure := strings.TrimSpace(priorBlock.Failure)
				if failure == "" && !priorBlock.Review.OverallPass && len(priorBlock.Review.BlockingIssues) > 0 {
					failure = novelWorkbenchV3ReviewFailure(priorBlock.Review)
				}
				setFailure(novelWorkbenchV3RecoveryPriorBlock, "", failure, "", priorBlock.Review)
			}
		case "draft_rejected":
			var record novelWorkbenchV3DraftRejectedRecord
			if json.Unmarshal([]byte(artifact.ContentJSON), &record) == nil && record.Strategy != "" {
				history.AttemptCount = max(history.AttemptCount, record.Attempt)
				setFailure(record.Strategy, record.SourceFailureFingerprint, record.Error, record.FailureFingerprint, novelWorkbenchV3ReviewReport{})
				continue
			}
			var priorBlock struct {
				Error string `json:"error"`
			}
			if json.Unmarshal([]byte(artifact.ContentJSON), &priorBlock) == nil {
				setFailure(novelWorkbenchV3RecoveryPriorBlock, "", priorBlock.Error, "", novelWorkbenchV3ReviewReport{})
			}
		}
	}
	return history, nil
}

func applyNovelWorkbenchV3LocalizedPatch(draft novelWorkbenchV3Draft, patch novelWorkbenchV3LocalizedPatch) (novelWorkbenchV3Draft, error) {
	if patch.Unit != draft.Unit {
		return novelWorkbenchV3Draft{}, fmt.Errorf("局部补丁单元必须为 %d", draft.Unit)
	}
	if len(patch.Replacements) == 0 || len(patch.Replacements) > 2 {
		return novelWorkbenchV3Draft{}, errors.New("局部补丁必须提供 1 至 2 处精确替换")
	}
	type replacementAt struct {
		original    string
		replacement string
		start       int
	}
	replacements := make([]replacementAt, 0, len(patch.Replacements))
	seen := map[string]struct{}{}
	for _, item := range patch.Replacements {
		original := strings.TrimSpace(item.Original)
		replacement := strings.TrimSpace(item.Replacement)
		if original == "" || replacement == "" || original == replacement {
			return novelWorkbenchV3Draft{}, errors.New("局部补丁的原文与替换文本必须非空且不同")
		}
		if _, exists := seen[original]; exists || strings.Count(draft.Content, original) != 1 {
			return novelWorkbenchV3Draft{}, errors.New("局部补丁原文必须在候选正文中唯一且精确出现一次")
		}
		seen[original] = struct{}{}
		replacements = append(replacements, replacementAt{original: original, replacement: replacement, start: strings.Index(draft.Content, original)})
	}
	sort.SliceStable(replacements, func(left, right int) bool { return replacements[left].start < replacements[right].start })
	cursor := 0
	var content strings.Builder
	for _, item := range replacements {
		if item.start < cursor {
			return novelWorkbenchV3Draft{}, errors.New("局部补丁的替换范围不能重叠")
		}
		content.WriteString(draft.Content[cursor:item.start])
		content.WriteString(item.replacement)
		cursor = item.start + len(item.original)
	}
	content.WriteString(draft.Content[cursor:])
	patched := novelWorkbenchV3Draft{Unit: draft.Unit, Title: draft.Title, Content: content.String(), Summary: strings.TrimSpace(patch.Summary)}
	if patched.Summary == "" {
		return novelWorkbenchV3Draft{}, errors.New("局部补丁必须给出更新后的正文摘要")
	}
	if err := validateNovelWorkbenchV3Draft(patched, draft.Unit); err != nil {
		return novelWorkbenchV3Draft{}, err
	}
	return patched, nil
}

func (s *Service) writeAndReviewNovelWorkbenchV3Unit(ctx context.Context, task model.Task, run *model.NovelWorkbenchRun, control novelWorkbenchV3Control, state novelWorkbenchV3State, pkg novelWorkbenchV3ArcPackage, packet novelWorkbenchV3EpisodePacket, unit int, resolvedConfig providerConfig) (novelWorkbenchV3Draft, novelWorkbenchV3ReviewReport, string, string, int, bool, error) {
	boundary, boundaryErr := novelWorkbenchV3BoundaryContractForPacket(control, state, pkg, packet)
	if boundaryErr != nil {
		reason := fmt.Sprintf("第 %d 单元无法编译状态边界：%s", unit, boundaryErr.Error())
		if err := s.blockNovelWorkbenchV3(run, task.ID, "structure", "boundary_contract", unit, reason); err != nil {
			return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
		}
		return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, true, nil
	}
	history, err := s.novelWorkbenchV3ProseRecoveryHistory(run, unit)
	if err != nil {
		return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
	}
	var writerPrompt string
	var reviewPrompt string
	for safety := 0; safety < 1+novelWorkbenchV3MaxLocalizedPatchAttempts+novelWorkbenchV3MaxFullRewriteAttempts; safety++ {
		strategy, stopReason := novelWorkbenchV3RecoveryStrategy(history)
		if strategy == "" {
			if err := s.blockNovelWorkbenchV3(run, task.ID, "narrative", "recovery_circuit", unit, stopReason); err != nil {
				return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
			}
			return dereferenceNovelWorkbenchV3Draft(history.LatestDraft), history.LastReview, writerPrompt, reviewPrompt, 0, true, nil
		}
		attempt := history.AttemptCount + 1
		var recovery novelWorkbenchV3ProseRecoveryRecord
		switch strategy {
		case novelWorkbenchV3RecoveryInitial:
			writerPrompt = buildNovelWorkbenchV3WriterPrompt(control, state, pkg, packet, boundary, run.QualityBlockReason)
			if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelineDraft, fmt.Sprintf("第 %d 单元：正文起草", unit), 52); err != nil {
				return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
			}
		case novelWorkbenchV3RecoveryLocalizedPatch:
			recovery = novelWorkbenchV3RecoveryRecord(history, strategy, unit, attempt, boundary)
			writerPrompt = buildNovelWorkbenchV3LocalizedPatchPrompt(control, state, pkg, packet, boundary, *history.LatestDraft, recovery, history.LastReview)
			if err := s.createNovelWorkbenchV3Artifact(run, unit, "prose_recovery", attempt, recovery, writerPrompt); err != nil {
				return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
			}
			if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelineRepair, fmt.Sprintf("第 %d 单元：局部定向修补（第 %d/%d 次）", unit, history.LocalizedPatchAttempts+1, novelWorkbenchV3MaxLocalizedPatchAttempts), 58); err != nil {
				return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
			}
		case novelWorkbenchV3RecoveryFullRewrite:
			recovery = novelWorkbenchV3RecoveryRecord(history, strategy, unit, attempt, boundary)
			writerPrompt = buildNovelWorkbenchV3WriterRepairPrompt(control, state, pkg, packet, boundary, history.LatestDraft, recovery, history.LastReview)
			if err := s.createNovelWorkbenchV3Artifact(run, unit, "prose_recovery", attempt, recovery, writerPrompt); err != nil {
				return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
			}
			if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelineRepair, fmt.Sprintf("第 %d 单元：定向全文重写（第 %d/%d 次）", unit, history.FullRewriteAttempts+1, novelWorkbenchV3MaxFullRewriteAttempts), 58); err != nil {
				return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
			}
		default:
			return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, fmt.Errorf("未知正文恢复策略 %s", strategy)
		}

		generated, generateErr := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: writerPrompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: novelWorkbenchUnitTokenLimit(control.Brief.TargetUnitLength)})
		if generateErr != nil {
			return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, generateErr
		}
		raw := stringValue(generated["text"])
		draft := novelWorkbenchV3Draft{}
		var validationErr error
		if strategy == novelWorkbenchV3RecoveryLocalizedPatch {
			patch := novelWorkbenchV3LocalizedPatch{}
			validationErr = decodeNovelWorkbenchJSONObject(raw, &patch)
			if validationErr == nil {
				draft, validationErr = applyNovelWorkbenchV3LocalizedPatch(*history.LatestDraft, patch)
			}
		} else {
			validationErr = decodeNovelWorkbenchJSONObject(raw, &draft)
			if validationErr == nil {
				validationErr = validateNovelWorkbenchV3Draft(draft, unit)
			}
		}
		if validationErr != nil {
			failure := validationErr.Error()
			failureFingerprint := novelWorkbenchV3FailureFingerprint(failure)
			rejected := novelWorkbenchV3DraftRejectedRecord{Version: novelWorkbenchV3EngineVersion, Unit: unit, Attempt: attempt, Strategy: strategy, SourceFailureFingerprint: history.LastFailureFingerprint, Raw: raw, Error: failure, FailureFingerprint: failureFingerprint, Stage: "writer_protocol"}
			if err := s.createNovelWorkbenchV3Artifact(run, unit, "draft_rejected", attempt, rejected, writerPrompt); err != nil {
				return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
			}
			history.AttemptCount = attempt
			history.LastStrategy = strategy
			history.LastSourceFingerprint = history.LastFailureFingerprint
			history.LastFailure = failure
			history.LastFailureFingerprint = failureFingerprint
			if strategy == novelWorkbenchV3RecoveryLocalizedPatch {
				history.LocalizedPatchAttempts++
			}
			if strategy == novelWorkbenchV3RecoveryFullRewrite {
				history.FullRewriteAttempts++
			}
			continue
		}
		if err := s.createNovelWorkbenchV3Artifact(run, unit, "prose_attempt", attempt, novelWorkbenchV3ProseAttemptRecord{Version: novelWorkbenchV3EngineVersion, Unit: unit, Attempt: attempt, Strategy: strategy, SourceFailureFingerprint: history.LastFailureFingerprint, Draft: draft, DraftSHA256: novelWorkbenchV3DraftSHA256(draft)}, writerPrompt); err != nil {
			return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
		}
		history.AttemptCount = attempt
		history.LatestDraft = &draft
		if strategy == novelWorkbenchV3RecoveryLocalizedPatch {
			history.LocalizedPatchAttempts++
		}
		if strategy == novelWorkbenchV3RecoveryFullRewrite {
			history.FullRewriteAttempts++
		}

		review, currentReviewPrompt, reviewBlocked, reviewErr := s.reviewNovelWorkbenchV3Draft(ctx, task, run, control, state, pkg, packet, boundary, draft, unit, attempt, resolvedConfig)
		reviewPrompt = currentReviewPrompt
		if reviewErr != nil {
			return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, reviewErr
		}
		if reviewBlocked {
			return draft, history.LastReview, writerPrompt, reviewPrompt, 0, true, nil
		}
		if review.OverallPass && len(review.BlockingIssues) == 0 {
			record := novelWorkbenchV3RenderReviewAttemptRecord{Version: novelWorkbenchV3EngineVersion, Unit: unit, Attempt: attempt, Strategy: strategy, SourceFailureFingerprint: history.LastFailureFingerprint, DraftSHA256: novelWorkbenchV3DraftSHA256(draft), Review: review}
			if err := s.createNovelWorkbenchV3Artifact(run, unit, "render_review_attempt", attempt, record, reviewPrompt); err != nil {
				return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
			}
			return draft, review, writerPrompt, reviewPrompt, attempt, false, nil
		}
		failure := novelWorkbenchV3ReviewFailure(review)
		failureFingerprint := novelWorkbenchV3ReviewFingerprint(review)
		record := novelWorkbenchV3RenderReviewAttemptRecord{Version: novelWorkbenchV3EngineVersion, Unit: unit, Attempt: attempt, Strategy: strategy, SourceFailureFingerprint: history.LastFailureFingerprint, DraftSHA256: novelWorkbenchV3DraftSHA256(draft), Review: review, Failure: failure, FailureFingerprint: failureFingerprint}
		if err := s.createNovelWorkbenchV3Artifact(run, unit, "render_review_attempt", attempt, record, reviewPrompt); err != nil {
			return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
		}
		history.LastReview = review
		history.LastStrategy = strategy
		history.LastSourceFingerprint = record.SourceFailureFingerprint
		history.LastFailure = failure
		history.LastFailureFingerprint = failureFingerprint
	}
	reason := fmt.Sprintf("第 %d 单元达到受控恢复上限，未得到可提交的正文", unit)
	if err := s.blockNovelWorkbenchV3(run, task.ID, "narrative", "recovery_budget", unit, reason); err != nil {
		return novelWorkbenchV3Draft{}, novelWorkbenchV3ReviewReport{}, "", "", 0, false, err
	}
	return dereferenceNovelWorkbenchV3Draft(history.LatestDraft), history.LastReview, writerPrompt, reviewPrompt, 0, true, nil
}

func dereferenceNovelWorkbenchV3Draft(draft *novelWorkbenchV3Draft) novelWorkbenchV3Draft {
	if draft == nil {
		return novelWorkbenchV3Draft{}
	}
	return *draft
}

func (s *Service) reviewNovelWorkbenchV3Draft(ctx context.Context, task model.Task, run *model.NovelWorkbenchRun, control novelWorkbenchV3Control, state novelWorkbenchV3State, pkg novelWorkbenchV3ArcPackage, packet novelWorkbenchV3EpisodePacket, boundary novelWorkbenchV3BoundaryContract, draft novelWorkbenchV3Draft, unit int, attempt int, resolvedConfig providerConfig) (novelWorkbenchV3ReviewReport, string, bool, error) {
	if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelineReview, fmt.Sprintf("第 %d 单元：独立审稿", unit), 70); err != nil {
		return novelWorkbenchV3ReviewReport{}, "", false, err
	}
	var review novelWorkbenchV3ReviewReport
	var reviewRaw string
	var reviewErr error
	var reviewPrompt string
	for reviewAttempt := 1; reviewAttempt <= novelWorkbenchV3MaxReviewAttempts; reviewAttempt++ {
		if reviewAttempt == 1 {
			reviewPrompt = buildNovelWorkbenchV3RenderReviewPrompt(control, state, pkg, packet, boundary, draft)
		} else {
			reviewPrompt = buildNovelWorkbenchV3RenderReviewRepairPrompt(control, state, pkg, packet, boundary, draft, reviewRaw, reviewErr)
		}
		generated, generateErr := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: reviewPrompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: 4_000})
		if generateErr != nil {
			return novelWorkbenchV3ReviewReport{}, "", false, generateErr
		}
		reviewRaw = stringValue(generated["text"])
		review = novelWorkbenchV3ReviewReport{}
		reviewErr = decodeNovelWorkbenchJSONObject(reviewRaw, &review)
		if reviewErr == nil {
			reviewErr = validateNovelWorkbenchV3RenderReview(review, control, packet, unit)
		}
		if reviewErr == nil {
			return review, reviewPrompt, false, nil
		}
		if err := s.createNovelWorkbenchV3Artifact(run, unit, "render_review_rejected", attempt, map[string]any{"raw": reviewRaw, "error": reviewErr.Error(), "reviewAttempt": reviewAttempt}, reviewPrompt); err != nil {
			return novelWorkbenchV3ReviewReport{}, "", false, err
		}
		if reviewAttempt < novelWorkbenchV3MaxReviewAttempts {
			if err := s.updateNovelWorkbenchV3Progress(run, task.ID, novelWorkbenchV3PipelineReview, fmt.Sprintf("第 %d 单元：修复审稿报告（第 %d/%d 轮）", unit, reviewAttempt, novelWorkbenchV3MaxReviewAttempts-1), 74); err != nil {
				return novelWorkbenchV3ReviewReport{}, "", false, err
			}
		}
	}
	reason := fmt.Sprintf("第 %d 单元的独立审稿报告经过 %d 轮结构修复仍不可用：%s", unit, novelWorkbenchV3MaxReviewAttempts, reviewErr.Error())
	if err := s.blockNovelWorkbenchV3(run, task.ID, "narrative", "render_review_protocol", unit, reason); err != nil {
		return novelWorkbenchV3ReviewReport{}, "", false, err
	}
	return novelWorkbenchV3ReviewReport{}, reviewPrompt, true, nil
}

func validateNovelWorkbenchV3Draft(draft novelWorkbenchV3Draft, unit int) error {
	if draft.Unit != unit {
		return fmt.Errorf("正文单元编号必须为 %d", unit)
	}
	draft.Title = strings.TrimSpace(draft.Title)
	draft.Content = strings.TrimSpace(draft.Content)
	draft.Summary = strings.TrimSpace(draft.Summary)
	if draft.Title == "" || draft.Content == "" || draft.Summary == "" {
		return errors.New("正文缺少标题、内容或摘要")
	}
	return nil
}

func buildNovelWorkbenchV3WriterPrompt(control novelWorkbenchV3Control, state novelWorkbenchV3State, pkg novelWorkbenchV3ArcPackage, packet novelWorkbenchV3EpisodePacket, boundary novelWorkbenchV3BoundaryContract, recoveryReason string) string {
	formatRule := "写成可拍摄的竖屏短剧剧本，可使用场景、动作、对白、必要音效；结尾必须具体呈现 ExitDebt，不能只喊口号。"
	if control.Brief.OutputMode == novelWorkbenchModeNovel {
		formatRule = "写成可连续阅读的小说章节，有具体场景、人物行动、有效对白、情绪和因果；不得写成提纲、分镜或舞台说明。"
	}
	recoveryInstruction := ""
	if recoveryReason = strings.TrimSpace(recoveryReason); recoveryReason != "" {
		recoveryInstruction = "\n这是同一封存单元恢复创作。上一轮未提交的具体失败单如下；只在不改变执行包的前提下修复它：\n" + recoveryReason + "\n"
	}
	return fmt.Sprintf(`你是中文长线作品的执行主笔。只写当前单元正文，严格执行已封存执行包；不能新增持续性设定、角色知识、地点移动或账本结论。所有持久状态由系统提交，正文不要输出 writeback。

%s
全书正史（只可遵守，不可修改）：%s
风格指南：%s
当前封存故事弧：%s
进入本单元前状态：%s
当前单元执行包：%s
当前单元/下一单元边界契约：%s

写作要求：
1. requiredEvents 的每一项必须在正文中以具体行为、对白或可观察结果实际出现。
2. allowedConclusion 是读者本集可确认的上限；forbiddenConclusions 禁止越过。可疑行为只能呈现为可疑，不能硬写成唯一隐藏动机。
3. 保持角色声线。短剧必须有开场抓力、压力升级、转折和结尾债务；小说必须形成可阅读章节推进。
4. 目标篇幅约 %d 字，但篇幅只是节奏提醒，不是硬性拦截条件。优先保证完整可读与当前单元的因果闭环。
5. 严格按边界契约截断本集：本集退出状态必须成立；下一单元入口动作只允许作为本集的即时意图、转向或出口前动作，不能写成已完成。
%s

只输出合法 JSON：{"unit":%d,"title":"","content":"","summary":""}`,
		formatRule, novelWorkbenchV3JSON(control.Bible), novelWorkbenchV3JSON(control.Style), novelWorkbenchV3JSON(pkg), novelWorkbenchV3JSON(novelWorkbenchV3WriterState(state, packet)), novelWorkbenchV3JSON(packet), novelWorkbenchV3JSON(boundary), control.Brief.TargetUnitLength, recoveryInstruction, packet.Unit)
}

func novelWorkbenchV3WriterState(state novelWorkbenchV3State, packet novelWorkbenchV3EpisodePacket) map[string]any {
	characters := map[string]novelWorkbenchV3CharacterState{}
	for _, id := range packet.CharacterIDs {
		if character, exists := state.CharacterStates[id]; exists {
			characters[id] = character
		}
	}
	return map[string]any{
		"lastUnitSummary": state.LastUnitSummary, "nextUnitBridge": state.NextUnitBridge, "characterStates": characters,
		"factStates": state.FactStates, "openQuestions": state.OpenQuestions, "recentSummaries": state.RecentSummaries,
	}
}

func buildNovelWorkbenchV3WriterRepairPrompt(control novelWorkbenchV3Control, state novelWorkbenchV3State, pkg novelWorkbenchV3ArcPackage, packet novelWorkbenchV3EpisodePacket, boundary novelWorkbenchV3BoundaryContract, previous *novelWorkbenchV3Draft, recovery novelWorkbenchV3ProseRecoveryRecord, review novelWorkbenchV3ReviewReport) string {
	previousDraft := "此前没有可复用的候选正文；请从封存执行包重新起草。"
	if previous != nil {
		previousDraft = novelWorkbenchV3JSON(*previous)
	}
	return fmt.Sprintf(`你是中文长线作品的执行主笔。现在执行一次受控的全文重写，不要输出补丁、解释或 writeback。已封存执行包、状态边界和允许结论都不能改动；只修复失败单所列硬问题，其他已正确的情节保持不倒退。

封存执行包：%s
进入本单元前状态：%s
本集/下一集边界契约：%s
本次受控修复单：%s
独立审稿报告：%s
上一版候选正文：%s

边界硬规则：本集必须在 currentExitStates 截断。nextUnitEntryBridge 由下一集开场兑现；本集可写角色立即决定跟随、转向偏门或开始离场准备，但不能把下一集的离开、交接或结果提前写成已经发生。

只输出合法 JSON：{"unit":%d,"title":"","content":"","summary":""}`,
		novelWorkbenchV3JSON(packet), novelWorkbenchV3JSON(novelWorkbenchV3WriterState(state, packet)), novelWorkbenchV3JSON(boundary), novelWorkbenchV3JSON(recovery), novelWorkbenchV3JSON(review), previousDraft, packet.Unit)
}

func buildNovelWorkbenchV3LocalizedPatchPrompt(control novelWorkbenchV3Control, state novelWorkbenchV3State, pkg novelWorkbenchV3ArcPackage, packet novelWorkbenchV3EpisodePacket, boundary novelWorkbenchV3BoundaryContract, draft novelWorkbenchV3Draft, recovery novelWorkbenchV3ProseRecoveryRecord, review novelWorkbenchV3ReviewReport) string {
	return fmt.Sprintf(`你是中文长线作品的局部修订编辑。不要重写全文，不要改动标题、封存执行包、状态账本或无关段落。只对候选正文做 1 至 2 处精确文本替换，以修复本次失败单；每个 original 必须逐字摘自候选正文且只出现一次，replacement 必须给出替换后的完整段落或句组。

封存执行包：%s
进入本单元前状态：%s
本集/下一集边界契约：%s
本次受控修复单：%s
独立审稿报告：%s
候选正文：%s

边界硬规则：currentExitStates 是本集最终状态，nextUnitEntryBridge 只在下一集开始发生。不要因下一集要发生的动作而让本集人物提前完成跨越本集状态的行动。

只输出合法 JSON：{"unit":%d,"replacements":[{"original":"","replacement":""}],"summary":""}`,
		novelWorkbenchV3JSON(packet), novelWorkbenchV3JSON(novelWorkbenchV3WriterState(state, packet)), novelWorkbenchV3JSON(boundary), novelWorkbenchV3JSON(recovery), novelWorkbenchV3JSON(review), novelWorkbenchV3JSON(draft), packet.Unit)
}

func buildNovelWorkbenchV3RenderReviewPrompt(control novelWorkbenchV3Control, state novelWorkbenchV3State, pkg novelWorkbenchV3ArcPackage, packet novelWorkbenchV3EpisodePacket, boundary novelWorkbenchV3BoundaryContract, draft novelWorkbenchV3Draft) string {
	modeRule := "短剧须有具体开场抓力、冲突升级、转折和可执行的下一集债务。"
	if control.Brief.OutputMode == novelWorkbenchModeNovel {
		modeRule = "小说须是可连续阅读的章节叙事，不能退化为提纲或分镜。"
	}
	return fmt.Sprintf(`你是独立的中文商业叙事审稿编辑。你不能替主笔扩写设定，只根据冻结状态、封存执行包和正文做验收。

%s
冻结正史：%s
进入本单元前状态：%s
封存故事弧：%s
当前执行包：%s
本集/下一集边界契约：%s
候选正文：%s

只有以下问题可以放入 blockingIssues：
- REQUIRED_EVENT_MISSING：执行包 requiredEvents 有具体事件未在正文可见呈现；
- STATE_CONTRADICTION：正文和冻结状态或执行包的明确状态改变冲突；
- KNOWLEDGE_BREACH：角色知道未获准、未在正文中可见取得的事实；
- CONCLUSION_OVERCLAIM：正文越过 allowedConclusion 或触及 forbiddenConclusions；
- EXIT_DEBT_MISSING：短剧/章节没有实际形成封存的离场债务；
- FORMAT_UNREADABLE：小说写成提纲/分镜，或短剧失去可拍摄叙事结构。

边界验收规则：currentExitStates 是本集切点的唯一状态依据；nextUnitEntryBridge 明确属于下一单元，不能因为本集尚未实际完成下一集动作而拦截。反过来，若正文把下一集动作提前写成已完成、或违背 currentExitStates，才构成 STATE_CONTRADICTION。

字数、风格偏好、可替代动机解释、轻微节奏不均只能写 warnings，不能单独拦截。每个 blocker 必须引用正文中的具体片段或明确缺失的 requiredEvent，并给出可执行修复动作。不要凭空引用不存在的 ID。

只输出 JSON：
{"unit":%d,"overallPass":true,"blockingIssues":[{"code":"REQUIRED_EVENT_MISSING","unit":%d,"referenceIds":[""],"evidence":"","repairAction":""}],"warnings":[{"code":"PACING","unit":%d,"referenceIds":[""],"evidence":"","repairAction":""}],"verdict":""}`,
		modeRule, novelWorkbenchV3JSON(control.Bible), novelWorkbenchV3JSON(novelWorkbenchV3WriterState(state, packet)), novelWorkbenchV3JSON(pkg), novelWorkbenchV3JSON(packet), novelWorkbenchV3JSON(boundary), novelWorkbenchV3JSON(draft), packet.Unit, packet.Unit, packet.Unit)
}

func buildNovelWorkbenchV3RenderReviewRepairPrompt(control novelWorkbenchV3Control, state novelWorkbenchV3State, pkg novelWorkbenchV3ArcPackage, packet novelWorkbenchV3EpisodePacket, boundary novelWorkbenchV3BoundaryContract, draft novelWorkbenchV3Draft, previousRaw string, validationErr error) string {
	return fmt.Sprintf(`你是独立的中文商业叙事审稿编辑。上一版审稿报告无法被系统读取或校验；不要让主笔重写正文，也不要改动封存执行包。请只重新输出对同一正文的合法审稿 JSON。

报告结构失败原因：%s
上一版报告：%s

冻结正史：%s
进入本单元前状态：%s
封存故事弧：%s
当前执行包：%s
本集/下一集边界契约：%s
候选正文：%s

blockingIssues 只能使用 REQUIRED_EVENT_MISSING、STATE_CONTRADICTION、KNOWLEDGE_BREACH、CONCLUSION_OVERCLAIM、EXIT_DEBT_MISSING、FORMAT_UNREADABLE。字数、风格偏好、可替代动机解释和轻微节奏问题只能放 warnings。currentExitStates 约束本集，nextUnitEntryBridge 只约束下一集；不得混淆两者。若没有硬问题，overallPass=true 且 blockingIssues=[]。每条 blocker 都要给出正文证据和具体修复动作。只输出 JSON。`,
		validationErr.Error(), previousRaw, novelWorkbenchV3JSON(control.Bible), novelWorkbenchV3JSON(novelWorkbenchV3WriterState(state, packet)), novelWorkbenchV3JSON(pkg), novelWorkbenchV3JSON(packet), novelWorkbenchV3JSON(boundary), novelWorkbenchV3JSON(draft))
}

func validateNovelWorkbenchV3RenderReview(report novelWorkbenchV3ReviewReport, control novelWorkbenchV3Control, packet novelWorkbenchV3EpisodePacket, unit int) error {
	if report.Unit != unit {
		return fmt.Errorf("正文审稿报告单元必须为 %d", unit)
	}
	validCodes := map[string]struct{}{
		"REQUIRED_EVENT_MISSING": {}, "STATE_CONTRADICTION": {}, "KNOWLEDGE_BREACH": {}, "CONCLUSION_OVERCLAIM": {}, "EXIT_DEBT_MISSING": {}, "FORMAT_UNREADABLE": {},
	}
	known := map[string]struct{}{}
	for id := range novelWorkbenchV3CharacterMap(control) {
		known[id] = struct{}{}
	}
	for id := range novelWorkbenchV3FactMap(control) {
		known[id] = struct{}{}
	}
	for _, issue := range report.BlockingIssues {
		if _, exists := validCodes[strings.TrimSpace(issue.Code)]; !exists {
			return fmt.Errorf("正文审稿使用了不支持的阻断代码 %s", issue.Code)
		}
		if issue.Unit != unit || strings.TrimSpace(issue.Evidence) == "" || strings.TrimSpace(issue.RepairAction) == "" {
			return errors.New("正文阻断问题缺少单元、正文证据或修复动作")
		}
		for _, id := range normalizeNovelWorkbenchV3IDs(issue.ReferenceIDs) {
			if _, exists := known[id]; !exists {
				return fmt.Errorf("正文审稿引用了不存在的 ID %s", id)
			}
		}
	}
	for _, issue := range report.Warnings {
		if issue.Unit != 0 && issue.Unit != unit {
			return fmt.Errorf("正文警告引用了错误单元 %d", issue.Unit)
		}
		for _, id := range normalizeNovelWorkbenchV3IDs(issue.ReferenceIDs) {
			if _, exists := known[id]; !exists {
				return fmt.Errorf("正文审稿警告引用了不存在的 ID %s", id)
			}
		}
	}
	if report.OverallPass && len(report.BlockingIssues) > 0 {
		return errors.New("正文审稿同时标记通过和阻断问题")
	}
	if !report.OverallPass && len(report.BlockingIssues) == 0 {
		return errors.New("正文审稿未通过时必须给出至少一条带正文证据的阻断问题")
	}
	return nil
}

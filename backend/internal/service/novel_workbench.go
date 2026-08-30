package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	novelWorkbenchTaskType = "novel_workbench"

	novelWorkbenchModeNovel      = "novel"
	novelWorkbenchModeScreenplay = "screenplay"

	novelWorkbenchStatusQueued    = "queued"
	novelWorkbenchStatusRunning   = "running"
	novelWorkbenchStatusPaused    = "paused"
	novelWorkbenchStatusCompleted = "completed"
	novelWorkbenchStatusFailed    = "failed"

	novelWorkbenchPhaseBootstrap = "bootstrap"
	novelWorkbenchPhaseUnit      = "unit"

	novelWorkbenchGenreSelectionLimit    = 3
	novelWorkbenchAudienceSelectionLimit = 2
)

// StartNovelWorkbenchRequest 是小说工作台的创作简报。它不把 80 集写死：
// targetUnitCount 可以是章节或集数，outputMode 决定最终正文的表现形式。
type StartNovelWorkbenchRequest struct {
	ProjectName         string         `json:"projectName"`
	Premise             string         `json:"premise"`
	OutputMode          string         `json:"outputMode"`
	Genre               []string       `json:"genre"`
	Audience            []string       `json:"audience"`
	TargetUnitCount     int            `json:"targetUnitCount"`
	TargetUnitLength    int            `json:"targetUnitLength"`
	UnitDurationSeconds int            `json:"unitDurationSeconds"`
	Tone                string         `json:"tone"`
	EndingDirection     string         `json:"endingDirection"`
	StructurePreference string         `json:"structurePreference"`
	CustomRequirements  string         `json:"customRequirements"`
	AspectRatio         string         `json:"aspectRatio"`
	Config              map[string]any `json:"config"`
	LogicalModelID      string         `json:"logicalModelId"`
}

type ResumeNovelWorkbenchRequest struct {
	Config         map[string]any `json:"config"`
	LogicalModelID string         `json:"logicalModelId"`
}

type NovelWorkbenchRunSummary struct {
	Run        model.NovelWorkbenchRun `json:"run"`
	Project    model.Project           `json:"project"`
	Title      string                  `json:"title"`
	Logline    string                  `json:"logline"`
	CurrentArc string                  `json:"currentArc"`
}

type NovelWorkbenchRunDetail struct {
	Run          model.NovelWorkbenchRun        `json:"run"`
	Project      model.Project                  `json:"project"`
	Control      any                            `json:"control"`
	DynamicState any                            `json:"dynamicState"`
	Artifacts    []model.NovelWorkbenchArtifact `json:"artifacts"`
}

type StartNovelWorkbenchResult struct {
	Project model.Project           `json:"project"`
	Run     model.NovelWorkbenchRun `json:"run"`
	Task    *model.Task             `json:"task"`
}

type novelWorkbenchBrief struct {
	ProjectName         string `json:"projectName"`
	Premise             string `json:"premise"`
	OutputMode          string `json:"outputMode"`
	Genre               string `json:"genre"`
	Audience            string `json:"audience"`
	TargetUnitCount     int    `json:"targetUnitCount"`
	TargetUnitLength    int    `json:"targetUnitLength"`
	UnitDurationSeconds int    `json:"unitDurationSeconds"`
	Tone                string `json:"tone"`
	EndingDirection     string `json:"endingDirection"`
	StructurePreference string `json:"structurePreference"`
	CustomRequirements  string `json:"customRequirements"`
}

// novelWorkbenchArc 只定义一段创作弧线，而不是预写每一集的流水账。
// 每个实际单元的细化控制卡会在执行前结合最新状态生成。
type novelWorkbenchArc struct {
	Index       int      `json:"index"`
	Title       string   `json:"title"`
	StartUnit   int      `json:"startUnit"`
	EndUnit     int      `json:"endUnit"`
	Mission     string   `json:"mission"`
	Escalation  string   `json:"escalation"`
	KeyConflict string   `json:"keyConflict"`
	Turn        string   `json:"turn"`
	ExitDebt    string   `json:"exitDebt"`
	Characters  []string `json:"characters"`
}

type novelWorkbenchControl struct {
	Version    int                 `json:"version"`
	Title      string              `json:"title"`
	Logline    string              `json:"logline"`
	Brief      novelWorkbenchBrief `json:"brief"`
	StoryBible map[string]any      `json:"storyBible"`
	Arcs       []novelWorkbenchArc `json:"arcs"`
}

type novelWorkbenchAuditEntry struct {
	Unit    int       `json:"unit"`
	Title   string    `json:"title"`
	Summary string    `json:"summary"`
	At      time.Time `json:"at"`
}

type novelWorkbenchState struct {
	CompletedUnit      int                        `json:"completedUnit"`
	CurrentArc         string                     `json:"currentArc"`
	LastUnitSummary    string                     `json:"lastUnitSummary"`
	CharacterStates    []string                   `json:"characterStates"`
	RelationshipStates []string                   `json:"relationshipStates"`
	PlotlineStates     []string                   `json:"plotlineStates"`
	ForeshadowStates   []string                   `json:"foreshadowStates"`
	OpenDebts          []string                   `json:"openDebts"`
	NextUnitBridge     string                     `json:"nextUnitBridge"`
	AuditTrail         []novelWorkbenchAuditEntry `json:"auditTrail"`
}

type novelWorkbenchBootstrapOutput struct {
	Title      string              `json:"title"`
	Logline    string              `json:"logline"`
	StoryBible map[string]any      `json:"storyBible"`
	Arcs       []novelWorkbenchArc `json:"arcs"`
}

type novelWorkbenchWriteback struct {
	CharacterStates    []string `json:"characterStates"`
	RelationshipStates []string `json:"relationshipStates"`
	PlotlineStates     []string `json:"plotlineStates"`
	ForeshadowStates   []string `json:"foreshadowStates"`
	OpenDebts          []string `json:"openDebts"`
	NextUnitBridge     string   `json:"nextUnitBridge"`
	QualityNotes       []string `json:"qualityNotes"`
}

type novelWorkbenchUnitOutput struct {
	Unit      int                     `json:"unit"`
	Title     string                  `json:"title"`
	Content   string                  `json:"content"`
	Summary   string                  `json:"summary"`
	Writeback novelWorkbenchWriteback `json:"writeback"`
}

type novelWorkbenchTaskInput struct {
	Mode   string         `json:"mode"`
	Config providerConfig `json:"config"`
	RunID  string         `json:"runId"`
	Phase  string         `json:"phase"`
	Unit   int            `json:"unit"`
}

func (s *Service) StartNovelWorkbench(userID string, req StartNovelWorkbenchRequest) (*StartNovelWorkbenchResult, error) {
	brief, err := normalizeNovelWorkbenchBrief(req)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	if len(req.Config) == 0 && strings.TrimSpace(req.LogicalModelID) == "" {
		return nil, BadAuthRequest("请先选择可用的文本模型")
	}

	projectType := "novel"
	if brief.OutputMode == novelWorkbenchModeScreenplay {
		projectType = "short-drama"
	}
	project, err := s.CreateProject(userID, CreateProjectRequest{
		Name:        brief.ProjectName,
		Type:        projectType,
		AspectRatio: firstNonEmptyString(strings.TrimSpace(req.AspectRatio), "9:16"),
		SourceType:  "novel-workbench",
		Description: brief.Premise,
	})
	if err != nil {
		return nil, err
	}

	controlJSON, err := json.Marshal(newNovelWorkbenchV2Control(brief))
	if err != nil {
		return nil, err
	}
	stateJSON, err := json.Marshal(newNovelWorkbenchV2State())
	if err != nil {
		return nil, err
	}
	now := time.Now()
	run := model.NovelWorkbenchRun{
		ID: newID(), UserID: userID, ProjectID: project.ID, OutputMode: brief.OutputMode,
		EngineVersion: novelWorkbenchV2EngineVersion, Status: novelWorkbenchStatusQueued, Stage: "等待建立创作控制档案",
		PipelineStage: novelWorkbenchV2PipelineBootstrap, QualityPolicy: novelWorkbenchV2QualityPolicy,
		TargetUnitCount: brief.TargetUnitCount, ControlJSON: string(controlJSON), DynamicStateJSON: string(stateJSON),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateNovelWorkbenchRun(&run); err != nil {
		_ = s.DeleteProject(userID, project.ID)
		return nil, err
	}

	task, err := s.enqueueNovelWorkbenchTask(userID, project.ID, run.ID, novelWorkbenchPhaseBootstrap, 0, req.Config, req.LogicalModelID, "建立小说工作台总控档案")
	if err != nil {
		_ = s.DeleteProject(userID, project.ID)
		return nil, err
	}
	run.CurrentTaskID = task.ID
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(&run); err != nil {
		return nil, err
	}
	return &StartNovelWorkbenchResult{Project: project, Run: run, Task: taskForOutput(*task)}, nil
}

func (s *Service) ListNovelWorkbenchRuns(userID string) ([]NovelWorkbenchRunSummary, error) {
	runs, err := s.repo.NovelWorkbenchRuns(userID)
	if err != nil {
		return nil, err
	}
	result := make([]NovelWorkbenchRunSummary, 0, len(runs))
	for _, run := range runs {
		project, projectErr := s.repo.ProjectForUser(userID, run.ProjectID)
		if projectErr != nil {
			return nil, projectErr
		}
		title, logline, currentArc := project.Name, "", ""
		if run.EngineVersion >= novelWorkbenchV2EngineVersion {
			control, controlErr := decodeNovelWorkbenchV2Control(run.ControlJSON)
			state, stateErr := decodeNovelWorkbenchV2State(run.DynamicStateJSON)
			if controlErr == nil {
				title = firstNonEmptyString(control.Title, project.Name)
				logline = control.Logline
			}
			if stateErr == nil {
				currentArc = state.CurrentRoadmapTitle
			}
		} else {
			control, _ := decodeNovelWorkbenchControl(run.ControlJSON)
			state, _ := decodeNovelWorkbenchState(run.DynamicStateJSON)
			title = firstNonEmptyString(control.Title, project.Name)
			logline = control.Logline
			currentArc = state.CurrentArc
		}
		result = append(result, NovelWorkbenchRunSummary{
			Run: run, Project: *project, Title: title, Logline: logline, CurrentArc: currentArc,
		})
	}
	return result, nil
}

func (s *Service) NovelWorkbenchRunDetail(userID string, projectID string) (*NovelWorkbenchRunDetail, error) {
	project, err := s.repo.ProjectForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	run, err := s.repo.NovelWorkbenchRun(projectID)
	if err != nil {
		return nil, err
	}
	if run.UserID != userID {
		return nil, gorm.ErrRecordNotFound
	}
	artifacts, err := s.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		return nil, err
	}
	if run.EngineVersion >= novelWorkbenchV2EngineVersion {
		control, controlErr := decodeNovelWorkbenchV2Control(run.ControlJSON)
		if controlErr != nil {
			return nil, controlErr
		}
		state, stateErr := decodeNovelWorkbenchV2State(run.DynamicStateJSON)
		if stateErr != nil {
			return nil, stateErr
		}
		return &NovelWorkbenchRunDetail{Run: *run, Project: *project, Control: control, DynamicState: state, Artifacts: artifacts}, nil
	}
	control, err := decodeNovelWorkbenchControl(run.ControlJSON)
	if err != nil {
		return nil, err
	}
	state, err := decodeNovelWorkbenchState(run.DynamicStateJSON)
	if err != nil {
		return nil, err
	}
	return &NovelWorkbenchRunDetail{Run: *run, Project: *project, Control: control, DynamicState: state, Artifacts: artifacts}, nil
}

func (s *Service) PauseNovelWorkbench(ctx context.Context, userID string, projectID string) (*model.NovelWorkbenchRun, error) {
	run, err := s.novelWorkbenchRunForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	if run.Status == novelWorkbenchStatusCompleted {
		return nil, BadAuthRequest("这部作品已经完成，不需要暂停")
	}
	if run.Status == novelWorkbenchStatusArchived {
		return nil, BadAuthRequest("重建前快照不可恢复创作")
	}
	if taskID := strings.TrimSpace(run.CurrentTaskID); taskID != "" {
		task, taskErr := s.repo.TaskForUser(userID, taskID)
		if taskErr == nil && (task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning) {
			if _, cancelErr := s.CancelTask(ctx, userID, taskID); cancelErr != nil {
				return nil, cancelErr
			}
		}
	}
	run.Status = novelWorkbenchStatusPaused
	run.Stage = "已暂停"
	run.CurrentTaskID = ""
	run.LastError = ""
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return nil, err
	}
	return run, nil
}

func (s *Service) ResumeNovelWorkbench(userID string, projectID string, req ResumeNovelWorkbenchRequest) (*model.NovelWorkbenchRun, *model.Task, error) {
	if len(req.Config) == 0 && strings.TrimSpace(req.LogicalModelID) == "" {
		return nil, nil, BadAuthRequest("请先选择可用的文本模型")
	}
	run, err := s.novelWorkbenchRunForUser(userID, projectID)
	if err != nil {
		return nil, nil, err
	}
	if run.Status == novelWorkbenchStatusCompleted {
		return nil, nil, BadAuthRequest("这部作品已经完成")
	}
	if run.Status == novelWorkbenchStatusArchived {
		return nil, nil, BadAuthRequest("重建前快照不可恢复创作")
	}
	if currentID := strings.TrimSpace(run.CurrentTaskID); currentID != "" {
		if task, taskErr := s.repo.TaskForUser(userID, currentID); taskErr == nil && (task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning) {
			return nil, nil, BadAuthRequest("当前已有进行中的创作任务")
		}
	}
	needsBootstrap := false
	if run.EngineVersion >= novelWorkbenchV2EngineVersion {
		control, controlErr := decodeNovelWorkbenchV2Control(run.ControlJSON)
		if controlErr != nil {
			return nil, nil, controlErr
		}
		needsBootstrap = !novelWorkbenchV2ControlReady(control)
	} else {
		control, controlErr := decodeNovelWorkbenchControl(run.ControlJSON)
		if controlErr != nil {
			return nil, nil, controlErr
		}
		needsBootstrap = strings.TrimSpace(control.Title) == "" || len(control.Arcs) == 0
	}
	phase := novelWorkbenchPhaseUnit
	unit := run.CompletedUnitCount + 1
	label := fmt.Sprintf("继续生成第 %d 单元", unit)
	if needsBootstrap {
		phase = novelWorkbenchPhaseBootstrap
		unit = 0
		label = "重新建立创作控制档案"
	}
	if phase == novelWorkbenchPhaseUnit && unit > run.TargetUnitCount {
		run.Status = novelWorkbenchStatusCompleted
		run.Stage = "已完成"
		run.CurrentTaskID = ""
		run.UpdatedAt = time.Now()
		if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
			return nil, nil, err
		}
		return run, nil, nil
	}

	run.Status = novelWorkbenchStatusQueued
	run.Stage = label
	if phase == novelWorkbenchPhaseBootstrap && run.EngineVersion >= novelWorkbenchV2EngineVersion {
		run.PipelineStage = novelWorkbenchV2PipelineBootstrap
	} else if run.EngineVersion >= novelWorkbenchV2EngineVersion {
		run.PipelineStage = novelWorkbenchV2PipelinePrepare
	}
	run.CurrentTaskID = ""
	run.LastError = ""
	run.QualityBlockReason = ""
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return nil, nil, err
	}
	task, err := s.enqueueNovelWorkbenchTask(userID, projectID, run.ID, phase, unit, req.Config, req.LogicalModelID, label)
	if err != nil {
		run.Status = novelWorkbenchStatusFailed
		run.Stage = "等待恢复"
		run.LastError = truncateRunes(err.Error(), 2_000)
		run.UpdatedAt = time.Now()
		_ = s.repo.UpdateNovelWorkbenchRun(run)
		return nil, nil, err
	}
	run.CurrentTaskID = task.ID
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return nil, nil, err
	}
	return run, taskForOutput(*task), nil
}

func (s *Service) processNovelWorkbenchTask(ctx context.Context, task model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	input, config, err := parseNovelWorkbenchTaskInput(task.InputJSON)
	if err != nil {
		return nil, nil, err
	}
	if !providerConfigReady(input.Config) {
		return nil, nil, errors.New("请先配置可用的文本模型")
	}
	run, err := s.repo.NovelWorkbenchRun(task.ProjectID)
	if err != nil {
		return nil, nil, err
	}
	if run.UserID != task.UserID || run.ID != input.RunID {
		return nil, nil, errors.New("小说工作台任务与项目状态不匹配")
	}
	if run.Status == novelWorkbenchStatusPaused {
		return nil, nil, errors.New("小说工作台已暂停")
	}
	if run.Status == novelWorkbenchStatusCompleted {
		return map[string]interface{}{"projectId": run.ProjectID, "status": run.Status}, nil, nil
	}

	resolvedConfig, err := s.resolveProviderConfig(input.Config)
	if err != nil {
		return nil, nil, err
	}
	ctx = withProtocolRegistry(ctx, s.protocolRegistry())
	ctx = withProviderOutboundPolicy(ctx, resolvedConfig)

	run.Status = novelWorkbenchStatusRunning
	run.CurrentTaskID = task.ID
	run.LastError = ""
	run.Stage = novelWorkbenchStage(input.Phase, input.Unit, run.OutputMode)
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return nil, nil, err
	}

	var result map[string]interface{}
	if run.EngineVersion >= novelWorkbenchV2EngineVersion {
		result, err = s.processNovelWorkbenchV2Task(ctx, task, run, input, config, resolvedConfig)
		if err != nil {
			s.markNovelWorkbenchFailure(run, task, err)
			return nil, nil, err
		}
		return result, nil, nil
	}
	switch input.Phase {
	case novelWorkbenchPhaseBootstrap:
		result, err = s.processNovelWorkbenchBootstrap(ctx, task, run, input, config, resolvedConfig)
	case novelWorkbenchPhaseUnit:
		result, err = s.processNovelWorkbenchUnit(ctx, task, run, input, config, resolvedConfig)
	default:
		err = fmt.Errorf("小说工作台不支持的任务阶段：%s", input.Phase)
	}
	if err != nil {
		s.markNovelWorkbenchFailure(run, task, err)
		return nil, nil, err
	}
	return result, nil, nil
}

func (s *Service) processNovelWorkbenchBootstrap(ctx context.Context, task model.Task, run *model.NovelWorkbenchRun, input novelWorkbenchTaskInput, config map[string]any, resolvedConfig providerConfig) (map[string]interface{}, error) {
	control, err := decodeNovelWorkbenchControl(run.ControlJSON)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateTaskProgress(task.ID, "构建创作总控档案", 45); err != nil {
		return nil, err
	}
	prompt := buildNovelWorkbenchBootstrapPrompt(control.Brief)
	generated, err := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: prompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: novelWorkbenchBootstrapTokenLimit(control.Brief.TargetUnitCount)})
	if err != nil {
		return nil, err
	}
	output, parseErr := decodeNovelWorkbenchBootstrap(stringValue(generated["text"]))
	if parseErr == nil {
		parseErr = validateNovelWorkbenchBootstrap(&output, control.Brief)
	}
	if parseErr != nil {
		if err := s.repo.UpdateTaskProgress(task.ID, "修复总控档案结构", 64); err != nil {
			return nil, err
		}
		repaired, repairErr := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: buildNovelWorkbenchBootstrapRepairPrompt(control.Brief, stringValue(generated["text"]), parseErr), Config: resolvedConfig, StreamText: true, MaxOutputTokens: novelWorkbenchBootstrapTokenLimit(control.Brief.TargetUnitCount)})
		if repairErr != nil {
			return nil, fmt.Errorf("总控档案结构修复失败：%w", repairErr)
		}
		output, parseErr = decodeNovelWorkbenchBootstrap(stringValue(repaired["text"]))
		if parseErr == nil {
			parseErr = validateNovelWorkbenchBootstrap(&output, control.Brief)
		}
		if parseErr != nil {
			return nil, fmt.Errorf("总控档案结构修复后仍不可用：%w", parseErr)
		}
	}

	control.Version = 1
	control.Title = output.Title
	control.Logline = output.Logline
	control.StoryBible = output.StoryBible
	control.Arcs = output.Arcs
	controlJSON, err := json.Marshal(control)
	if err != nil {
		return nil, err
	}
	stateJSON, err := json.Marshal(novelWorkbenchState{})
	if err != nil {
		return nil, err
	}
	run.ControlJSON = string(controlJSON)
	run.DynamicStateJSON = string(stateJSON)
	run.CompletedUnitCount = 0
	run.CurrentUnit = 0
	prepareNovelWorkbenchContinuation(run, "总控档案完成，等待第 1 单元")
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return nil, err
	}
	if err := s.repo.UpdateTaskProgress(task.ID, "保存总控档案", 82); err != nil {
		return nil, err
	}
	result := novelWorkbenchContinuationDirective(1, "生成第 1 单元")
	result["projectId"] = run.ProjectID
	result["title"] = control.Title
	result["logline"] = control.Logline
	result["arcCount"] = len(control.Arcs)
	result["status"] = run.Status
	return result, nil
}

func (s *Service) processNovelWorkbenchUnit(ctx context.Context, task model.Task, run *model.NovelWorkbenchRun, input novelWorkbenchTaskInput, config map[string]any, resolvedConfig providerConfig) (map[string]interface{}, error) {
	expectedUnit := run.CompletedUnitCount + 1
	if input.Unit != expectedUnit || input.Unit < 1 || input.Unit > run.TargetUnitCount {
		return nil, fmt.Errorf("当前应生成第 %d 单元，收到第 %d 单元", expectedUnit, input.Unit)
	}
	control, err := decodeNovelWorkbenchControl(run.ControlJSON)
	if err != nil {
		return nil, err
	}
	state, err := decodeNovelWorkbenchState(run.DynamicStateJSON)
	if err != nil {
		return nil, err
	}
	arc, ok := novelWorkbenchArcForUnit(control.Arcs, input.Unit)
	if !ok {
		return nil, fmt.Errorf("第 %d 单元没有可执行的分部弧线", input.Unit)
	}
	if err := s.repo.UpdateTaskProgress(task.ID, fmt.Sprintf("第 %d 单元：生成详细控制卡", input.Unit), 46); err != nil {
		return nil, err
	}
	prompt := buildNovelWorkbenchUnitPrompt(control, state, arc, input.Unit)
	generated, err := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: prompt, Config: resolvedConfig, StreamText: true, MaxOutputTokens: novelWorkbenchUnitTokenLimit(control.Brief.TargetUnitLength)})
	if err != nil {
		return nil, err
	}
	output, parseErr := decodeNovelWorkbenchUnit(stringValue(generated["text"]))
	if parseErr == nil {
		parseErr = validateNovelWorkbenchUnit(&output, control.Brief, input.Unit)
	}
	if parseErr != nil {
		if err := s.repo.UpdateTaskProgress(task.ID, fmt.Sprintf("第 %d 单元：修复正文结构", input.Unit), 68); err != nil {
			return nil, err
		}
		repaired, repairErr := runTextTask(ctx, canvasGenerationInput{Mode: "text", Prompt: buildNovelWorkbenchUnitRepairPrompt(control.Brief, input.Unit, stringValue(generated["text"]), parseErr), Config: resolvedConfig, StreamText: true, MaxOutputTokens: novelWorkbenchUnitTokenLimit(control.Brief.TargetUnitLength)})
		if repairErr != nil {
			return nil, fmt.Errorf("第 %d 单元修复失败：%w", input.Unit, repairErr)
		}
		output, parseErr = decodeNovelWorkbenchUnit(stringValue(repaired["text"]))
		if parseErr == nil {
			parseErr = validateNovelWorkbenchUnit(&output, control.Brief, input.Unit)
		}
		if parseErr != nil {
			return nil, fmt.Errorf("第 %d 单元修复后仍不可用：%w", input.Unit, parseErr)
		}
	}
	if err := s.repo.UpdateTaskProgress(task.ID, fmt.Sprintf("第 %d 单元：连续性验收并写回", input.Unit), 82); err != nil {
		return nil, err
	}
	title := novelWorkbenchUnitTitle(control.Brief.OutputMode, input.Unit, output.Title)
	if _, err := s.upsertNovelWorkbenchUnit(run.ProjectID, input.Unit-1, control.Brief.OutputMode, title, strings.TrimSpace(output.Content)); err != nil {
		return nil, err
	}
	state = applyNovelWorkbenchWriteback(state, arc, input.Unit, title, output)
	stateJSON, err := json.Marshal(state)
	if err != nil {
		return nil, err
	}
	run.DynamicStateJSON = string(stateJSON)
	run.CompletedUnitCount = input.Unit
	run.CurrentUnit = input.Unit
	run.LastError = ""
	run.CurrentTaskID = ""
	run.UpdatedAt = time.Now()
	if input.Unit >= run.TargetUnitCount {
		run.Status = novelWorkbenchStatusCompleted
		run.Stage = "已完成"
		if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
			return nil, err
		}
		return map[string]interface{}{
			"projectId": run.ProjectID, "unit": input.Unit, "title": title,
			"completed": true, "completedUnitCount": run.CompletedUnitCount,
		}, nil
	}

	prepareNovelWorkbenchContinuation(run, fmt.Sprintf("第 %d 单元已写回，等待第 %d 单元", input.Unit, input.Unit+1))
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		return nil, err
	}
	result := novelWorkbenchContinuationDirective(input.Unit+1, fmt.Sprintf("生成第 %d 单元", input.Unit+1))
	result["projectId"] = run.ProjectID
	result["unit"] = input.Unit
	result["title"] = title
	result["completed"] = false
	result["completedUnitCount"] = run.CompletedUnitCount
	return result, nil
}

func (s *Service) enqueueNovelWorkbenchTask(userID string, projectID string, runID string, phase string, unit int, config map[string]any, logicalModelID string, label string) (*model.Task, error) {
	input := map[string]any{
		"mode": "text", "config": config, "runId": runID, "phase": phase, "unit": unit,
	}
	return s.CreateTask(userID, CreateTaskRequest{
		ProjectID: projectID, Type: novelWorkbenchTaskType, Operation: "novel-workbench", Prompt: label,
		Provider: "novel-workbench", Model: strings.TrimSpace(stringValue(config["model"])), LogicalModelID: logicalModelID, Input: input,
	})
}

func prepareNovelWorkbenchContinuation(run *model.NovelWorkbenchRun, stage string) {
	run.Status = novelWorkbenchStatusQueued
	run.Stage = stage
	run.CurrentTaskID = ""
	run.UpdatedAt = time.Now()
}

func novelWorkbenchContinuationDirective(unit int, label string) map[string]interface{} {
	return map[string]interface{}{
		"nextPhase": novelWorkbenchPhaseUnit,
		"nextUnit":  unit,
		"nextLabel": label,
	}
}

// scheduleNovelWorkbenchContinuation 在当前任务已经落为成功后再排入下一单元。
// 这样一部长篇作品始终只占用一个活动任务名额，不会被自身的续写任务卡住。
func (s *Service) scheduleNovelWorkbenchContinuation(task model.Task, protectedInput string, result map[string]interface{}) error {
	phase := strings.TrimSpace(stringValue(result["nextPhase"]))
	if phase == "" {
		return nil
	}
	if phase != novelWorkbenchPhaseUnit {
		return fmt.Errorf("小说工作台的续写阶段无效：%s", phase)
	}
	unit := intValue(result["nextUnit"])
	if unit < 1 {
		return errors.New("小说工作台续写缺少有效单元编号")
	}
	label := strings.TrimSpace(stringValue(result["nextLabel"]))
	if label == "" {
		label = fmt.Sprintf("生成第 %d 单元", unit)
	}

	rawInput, err := s.decryptTaskInputJSON(protectedInput)
	if err != nil {
		s.markNovelWorkbenchContinuationFailure(task.ProjectID, err)
		return err
	}
	input, config, err := parseNovelWorkbenchTaskInput(rawInput)
	if err != nil {
		s.markNovelWorkbenchContinuationFailure(task.ProjectID, err)
		return err
	}
	run, err := s.repo.NovelWorkbenchRun(task.ProjectID)
	if err != nil {
		return err
	}
	if run.UserID != task.UserID || run.ID != input.RunID {
		return errors.New("小说工作台续写任务与运行记录不匹配")
	}
	if run.Status == novelWorkbenchStatusPaused || run.Status == novelWorkbenchStatusCompleted {
		return nil
	}
	if strings.TrimSpace(run.CurrentTaskID) != "" {
		return nil
	}
	if run.CompletedUnitCount+1 != unit || unit > run.TargetUnitCount {
		err := fmt.Errorf("小说工作台续写单元不连续：当前完成 %d，准备生成 %d", run.CompletedUnitCount, unit)
		s.markNovelWorkbenchContinuationFailure(task.ProjectID, err)
		return err
	}

	nextTask, err := s.enqueueNovelWorkbenchTask(task.UserID, task.ProjectID, run.ID, phase, unit, config, task.LogicalModelID, label)
	if err != nil {
		s.markNovelWorkbenchContinuationFailure(task.ProjectID, err)
		return err
	}
	run.Status = novelWorkbenchStatusQueued
	run.CurrentTaskID = nextTask.ID
	run.Stage = fmt.Sprintf("正在排队第 %d 单元", unit)
	run.LastError = ""
	run.UpdatedAt = time.Now()
	if err := s.repo.UpdateNovelWorkbenchRun(run); err != nil {
		s.markNovelWorkbenchContinuationFailure(task.ProjectID, err)
		return err
	}
	return nil
}

func (s *Service) markNovelWorkbenchContinuationFailure(projectID string, cause error) {
	run, err := s.repo.NovelWorkbenchRun(projectID)
	if err != nil || run.Status == novelWorkbenchStatusPaused || run.Status == novelWorkbenchStatusCompleted {
		return
	}
	run.Status = novelWorkbenchStatusFailed
	run.Stage = "等待恢复"
	run.CurrentTaskID = ""
	run.LastError = truncateRunes(cause.Error(), 2_000)
	run.UpdatedAt = time.Now()
	_ = s.repo.UpdateNovelWorkbenchRun(run)
}

func (s *Service) upsertNovelWorkbenchUnit(projectID string, position int, outputMode string, title string, content string) (*model.ProjectUnit, error) {
	unit, err := s.repo.ProjectUnitAtPosition(projectID, position)
	if err == nil {
		unit.Kind = novelWorkbenchProjectUnitKind(outputMode)
		unit.Title = title
		unit.SourceText = content
		unit.Status = model.ProjectUnitStatusReady
		unit.UpdatedAt = time.Now()
		if err := s.repo.UpdateProjectUnit(unit); err != nil {
			return nil, err
		}
		if err := s.repo.BumpProjectRevision(projectID); err != nil {
			return nil, err
		}
		return unit, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	now := time.Now()
	created := &model.ProjectUnit{
		ID: newID(), ProjectID: projectID, Kind: novelWorkbenchProjectUnitKind(outputMode), Title: title,
		SourceText: content, Status: model.ProjectUnitStatusReady, Position: position, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateProjectUnit(created); err != nil {
		return nil, err
	}
	if err := s.repo.BumpProjectRevision(projectID); err != nil {
		return nil, err
	}
	return created, nil
}

func (s *Service) novelWorkbenchRunForUser(userID string, projectID string) (*model.NovelWorkbenchRun, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return nil, err
	}
	run, err := s.repo.NovelWorkbenchRun(projectID)
	if err != nil {
		return nil, err
	}
	if run.UserID != userID {
		return nil, gorm.ErrRecordNotFound
	}
	return run, nil
}

func (s *Service) markNovelWorkbenchFailure(run *model.NovelWorkbenchRun, task model.Task, cause error) {
	latest, latestErr := s.repo.NovelWorkbenchRun(run.ProjectID)
	if latestErr == nil && latest.Status == novelWorkbenchStatusPaused {
		return
	}
	if latestTask, taskErr := s.repo.Task(task.ID); taskErr == nil && latestTask.Status == model.TaskStatusCancelled {
		run.Status = novelWorkbenchStatusPaused
		run.Stage = "已暂停"
		run.LastError = ""
	} else {
		run.Status = novelWorkbenchStatusFailed
		run.Stage = "等待恢复"
		run.LastError = truncateRunes(cause.Error(), 2_000)
	}
	run.CurrentTaskID = ""
	run.UpdatedAt = time.Now()
	_ = s.repo.UpdateNovelWorkbenchRun(run)
}

func normalizeNovelWorkbenchBrief(req StartNovelWorkbenchRequest) (novelWorkbenchBrief, error) {
	mode := strings.TrimSpace(req.OutputMode)
	if mode == "" {
		mode = novelWorkbenchModeScreenplay
	}
	if mode != novelWorkbenchModeNovel && mode != novelWorkbenchModeScreenplay {
		return novelWorkbenchBrief{}, errors.New("创作模式仅支持小说正文或短剧剧本")
	}
	premise := strings.TrimSpace(req.Premise)
	if premise == "" {
		return novelWorkbenchBrief{}, errors.New("请先写下故事起点")
	}
	name := strings.TrimSpace(req.ProjectName)
	if name == "" {
		name = truncateRunes(premise, 24)
	}
	if name == "" {
		name = "未命名创作"
	}
	count := req.TargetUnitCount
	if count == 0 {
		count = 12
	}
	if count < 1 || count > 500 {
		return novelWorkbenchBrief{}, errors.New("目标单元数量需在 1 到 500 之间")
	}
	length := req.TargetUnitLength
	if length == 0 {
		length = 900
	}
	if length < 200 || length > 12_000 {
		return novelWorkbenchBrief{}, errors.New("单元目标字数需在 200 到 12000 之间")
	}
	duration := req.UnitDurationSeconds
	if mode == novelWorkbenchModeScreenplay && duration == 0 {
		duration = 90
	}
	if duration < 0 || duration > 1_800 {
		return novelWorkbenchBrief{}, errors.New("单元时长需在 0 到 1800 秒之间")
	}
	genre, err := normalizeNovelWorkbenchChoices(req.Genre, novelWorkbenchGenreSelectionLimit, "题材")
	if err != nil {
		return novelWorkbenchBrief{}, err
	}
	audience, err := normalizeNovelWorkbenchChoices(req.Audience, novelWorkbenchAudienceSelectionLimit, "受众")
	if err != nil {
		return novelWorkbenchBrief{}, err
	}
	return novelWorkbenchBrief{
		ProjectName: name, Premise: premise, OutputMode: mode,
		Genre: genre, Audience: audience,
		TargetUnitCount: count, TargetUnitLength: length, UnitDurationSeconds: duration,
		Tone: strings.TrimSpace(req.Tone), EndingDirection: strings.TrimSpace(req.EndingDirection),
		StructurePreference: strings.TrimSpace(req.StructurePreference), CustomRequirements: strings.TrimSpace(req.CustomRequirements),
	}, nil
}

func normalizeNovelWorkbenchChoices(values []string, limit int, label string) (string, error) {
	seen := make(map[string]struct{}, len(values))
	choices := make([]string, 0, len(values))
	for _, raw := range values {
		for _, value := range strings.FieldsFunc(raw, func(r rune) bool {
			return r == '、' || r == ',' || r == '，' || r == ';' || r == '；' || r == '\n' || r == '\r'
		}) {
			value = strings.TrimSpace(value)
			if value == "" {
				continue
			}
			if _, exists := seen[value]; exists {
				continue
			}
			seen[value] = struct{}{}
			choices = append(choices, value)
		}
	}
	if len(choices) > limit {
		return "", fmt.Errorf("%s最多选择 %d 项", label, limit)
	}
	return strings.Join(choices, "、"), nil
}

func parseNovelWorkbenchTaskInput(raw string) (novelWorkbenchTaskInput, map[string]any, error) {
	var input novelWorkbenchTaskInput
	if strings.TrimSpace(raw) == "" {
		return input, nil, errors.New("小说工作台任务缺少输入")
	}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		return input, nil, fmt.Errorf("小说工作台任务输入解析失败：%w", err)
	}
	var generic map[string]any
	if err := json.Unmarshal([]byte(raw), &generic); err != nil {
		return input, nil, err
	}
	config, _ := generic["config"].(map[string]any)
	if strings.TrimSpace(input.RunID) == "" || strings.TrimSpace(input.Phase) == "" || len(config) == 0 {
		return input, nil, errors.New("小说工作台任务输入不完整")
	}
	return input, config, nil
}

func decodeNovelWorkbenchControl(raw string) (novelWorkbenchControl, error) {
	var control novelWorkbenchControl
	if strings.TrimSpace(raw) == "" {
		return control, errors.New("小说工作台总控档案为空")
	}
	if err := json.Unmarshal([]byte(raw), &control); err != nil {
		return control, fmt.Errorf("小说工作台总控档案损坏：%w", err)
	}
	return control, nil
}

func decodeNovelWorkbenchState(raw string) (novelWorkbenchState, error) {
	var state novelWorkbenchState
	if strings.TrimSpace(raw) == "" {
		return state, nil
	}
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return state, fmt.Errorf("小说工作台动态状态损坏：%w", err)
	}
	return state, nil
}

func decodeNovelWorkbenchBootstrap(text string) (novelWorkbenchBootstrapOutput, error) {
	var output novelWorkbenchBootstrapOutput
	if err := decodeNovelWorkbenchJSONObject(text, &output); err != nil {
		return output, err
	}
	return output, nil
}

func decodeNovelWorkbenchUnit(text string) (novelWorkbenchUnitOutput, error) {
	var output novelWorkbenchUnitOutput
	if err := decodeNovelWorkbenchJSONObject(text, &output); err != nil {
		return output, err
	}
	return output, nil
}

func decodeNovelWorkbenchJSONObject(text string, target any) error {
	cleaned := strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(text, "```json", ""), "```", ""))
	start := strings.Index(cleaned, "{")
	if start < 0 {
		return errors.New("模型没有返回 JSON 对象")
	}
	inString := false
	escaped := false
	depth := 0
	end := -1
	for index, runeValue := range cleaned[start:] {
		if inString {
			if escaped {
				escaped = false
				continue
			}
			if runeValue == '\\' {
				escaped = true
				continue
			}
			if runeValue == '"' {
				inString = false
			}
			continue
		}
		switch runeValue {
		case '"':
			inString = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				end = start + index + 1
			}
		}
		if end >= 0 {
			break
		}
	}
	if end < 0 {
		return errors.New("模型返回的 JSON 没有闭合")
	}
	if err := json.Unmarshal([]byte(cleaned[start:end]), target); err != nil {
		return fmt.Errorf("模型返回的 JSON 无法解析：%w", err)
	}
	return nil
}

func validateNovelWorkbenchBootstrap(output *novelWorkbenchBootstrapOutput, brief novelWorkbenchBrief) error {
	output.Title = strings.TrimSpace(output.Title)
	output.Logline = strings.TrimSpace(output.Logline)
	if output.Title == "" || output.Logline == "" {
		return errors.New("总控档案缺少作品标题或一句话卖点")
	}
	if len(output.StoryBible) == 0 {
		return errors.New("总控档案缺少故事圣经")
	}
	if len(output.Arcs) < 2 {
		return errors.New("总控档案至少需要两段可执行的分部弧线")
	}
	sort.SliceStable(output.Arcs, func(left, right int) bool { return output.Arcs[left].StartUnit < output.Arcs[right].StartUnit })
	for index := range output.Arcs {
		arc := &output.Arcs[index]
		arc.Index = index + 1
		arc.Title = strings.TrimSpace(arc.Title)
		arc.Mission = strings.TrimSpace(arc.Mission)
		arc.KeyConflict = strings.TrimSpace(arc.KeyConflict)
		arc.ExitDebt = strings.TrimSpace(arc.ExitDebt)
		if arc.Title == "" || arc.Mission == "" || arc.KeyConflict == "" || arc.ExitDebt == "" {
			return fmt.Errorf("第 %d 段分部弧线缺少标题、任务、核心冲突或离场债务", index+1)
		}
		if arc.StartUnit < 1 || arc.EndUnit < arc.StartUnit || arc.EndUnit > brief.TargetUnitCount {
			return fmt.Errorf("第 %d 段分部弧线的单元范围无效", index+1)
		}
		if index == 0 && arc.StartUnit != 1 {
			return errors.New("第一段分部弧线必须从第 1 单元开始")
		}
		if index > 0 && arc.StartUnit != output.Arcs[index-1].EndUnit+1 {
			return errors.New("分部弧线的范围必须连续覆盖，不能遗漏或重叠")
		}
	}
	if output.Arcs[len(output.Arcs)-1].EndUnit != brief.TargetUnitCount {
		return fmt.Errorf("最后一段分部弧线必须覆盖到第 %d 单元", brief.TargetUnitCount)
	}
	return nil
}

func validateNovelWorkbenchUnit(output *novelWorkbenchUnitOutput, brief novelWorkbenchBrief, expectedUnit int) error {
	if output.Unit != expectedUnit {
		return fmt.Errorf("正文单元编号必须为 %d", expectedUnit)
	}
	output.Title = strings.TrimSpace(output.Title)
	output.Content = strings.TrimSpace(output.Content)
	output.Summary = strings.TrimSpace(output.Summary)
	if output.Title == "" || output.Content == "" || output.Summary == "" {
		return errors.New("正文缺少标题、完整内容或单元摘要")
	}
	minimum := brief.TargetUnitLength / 2
	if minimum < 180 {
		minimum = 180
	}
	if len([]rune(output.Content)) < minimum {
		return fmt.Errorf("正文过短，至少应达到约 %d 字", minimum)
	}
	if strings.TrimSpace(output.Writeback.NextUnitBridge) == "" {
		return errors.New("正文缺少下一单元的连续性接力")
	}
	return nil
}

func novelWorkbenchArcForUnit(arcs []novelWorkbenchArc, unit int) (novelWorkbenchArc, bool) {
	for _, arc := range arcs {
		if unit >= arc.StartUnit && unit <= arc.EndUnit {
			return arc, true
		}
	}
	return novelWorkbenchArc{}, false
}

func applyNovelWorkbenchWriteback(state novelWorkbenchState, arc novelWorkbenchArc, unit int, title string, output novelWorkbenchUnitOutput) novelWorkbenchState {
	state.CompletedUnit = unit
	state.CurrentArc = arc.Title
	state.LastUnitSummary = output.Summary
	state.CharacterStates = keepOrReplaceNovelWorkbenchState(state.CharacterStates, output.Writeback.CharacterStates)
	state.RelationshipStates = keepOrReplaceNovelWorkbenchState(state.RelationshipStates, output.Writeback.RelationshipStates)
	state.PlotlineStates = keepOrReplaceNovelWorkbenchState(state.PlotlineStates, output.Writeback.PlotlineStates)
	state.ForeshadowStates = keepOrReplaceNovelWorkbenchState(state.ForeshadowStates, output.Writeback.ForeshadowStates)
	state.OpenDebts = keepOrReplaceNovelWorkbenchState(state.OpenDebts, output.Writeback.OpenDebts)
	state.NextUnitBridge = strings.TrimSpace(output.Writeback.NextUnitBridge)
	state.AuditTrail = append(state.AuditTrail, novelWorkbenchAuditEntry{Unit: unit, Title: title, Summary: output.Summary, At: time.Now()})
	if len(state.AuditTrail) > 16 {
		state.AuditTrail = state.AuditTrail[len(state.AuditTrail)-16:]
	}
	return state
}

func keepOrReplaceNovelWorkbenchState(previous []string, next []string) []string {
	cleaned := make([]string, 0, len(next))
	for _, item := range next {
		if value := strings.TrimSpace(item); value != "" {
			cleaned = append(cleaned, value)
		}
	}
	if len(cleaned) == 0 {
		return previous
	}
	return cleaned
}

func novelWorkbenchProjectUnitKind(mode string) model.ProjectUnitKind {
	if mode == novelWorkbenchModeScreenplay {
		return model.ProjectUnitKindEpisode
	}
	return model.ProjectUnitKindChapter
}

func novelWorkbenchUnitTitle(mode string, unit int, title string) string {
	title = strings.TrimSpace(title)
	prefix := fmt.Sprintf("第%02d章", unit)
	if mode == novelWorkbenchModeScreenplay {
		prefix = fmt.Sprintf("第%02d集", unit)
	}
	if title == "" {
		return prefix
	}
	if strings.HasPrefix(title, "第") && (strings.Contains(title, "章") || strings.Contains(title, "集")) {
		return title
	}
	return prefix + "｜" + title
}

func novelWorkbenchStage(phase string, unit int, mode string) string {
	if phase == novelWorkbenchPhaseBootstrap {
		return "正在建立总控档案"
	}
	label := "章"
	if mode == novelWorkbenchModeScreenplay {
		label = "集"
	}
	return fmt.Sprintf("正在生成第 %d %s", unit, label)
}

func novelWorkbenchBootstrapTokenLimit(targetUnits int) int {
	// 这里只输出分部弧线而非逐单元路线，规模增长不会线性吞掉上下文窗口。
	if targetUnits <= 24 {
		return 8_000
	}
	if targetUnits <= 100 {
		return 12_000
	}
	return 16_000
}

func novelWorkbenchUnitTokenLimit(targetLength int) int {
	limit := targetLength + 1_200
	if limit < 2_200 {
		limit = 2_200
	}
	if limit > 9_000 {
		limit = 9_000
	}
	return limit
}

func recommendedNovelWorkbenchArcCount(targetUnits int) int {
	switch {
	case targetUnits <= 4:
		return 2
	case targetUnits <= 16:
		return 3
	case targetUnits <= 40:
		return 4
	case targetUnits <= 80:
		return 5
	case targetUnits <= 160:
		return 6
	default:
		return 8
	}
}

func buildNovelWorkbenchBootstrapPrompt(brief novelWorkbenchBrief) string {
	modeInstruction := "输出可拍摄的短剧剧本。"
	unitLabel := "集"
	if brief.OutputMode == novelWorkbenchModeNovel {
		modeInstruction = "输出可连载阅读的小说正文。"
		unitLabel = "章"
	}
	briefJSON, _ := json.Marshal(brief)
	return fmt.Sprintf(`你是中文长篇创作总监，正在建立一部作品的“总控档案”。%s

核心原则：先建立可持续执行的故事真相，再进入逐%s写作；所有输出使用简体中文；不得模仿任何具体作品或作者。目标不是列出空泛的逐%s标题，而是让之后每个单元都能依据人物、伏笔、债务和分部目标写出完整正文。

用户创作简报：
%s

请完成：
1. 故事圣经 storyBible：必须包含核心承诺、世界与规则、主角与核心角色（欲望/恐惧/缺口/关系压力/说话特征）、主线与副线、关键伏笔、主题代价、风格边界与禁忌。
2. 生成约 %d 段“分部弧线” arcs（可因作品需要上下微调一段）：每段只说明范围、核心任务、升级、冲突、关键转折和离场债务；范围必须从第 1 %s 连续覆盖至第 %d %s。不要生成逐%s的标题清单、不要把每个单元写成同一种钩子。
3. 标题与一句话卖点必须明确、具有独特冲突。

只输出一个合法 JSON 对象，不能使用 Markdown 代码块，也不要附加解释：
{"title":"","logline":"","storyBible":{"corePromise":"","worldRules":[],"characters":[{"name":"","role":"","desire":"","fear":"","blindSpot":"","relationshipPressure":"","voice":"","arc":""}],"plotlines":[],"foreshadows":[],"themeCost":"","styleGuide":"","forbiddenDrift":[]},"arcs":[{"index":1,"title":"","startUnit":1,"endUnit":1,"mission":"","escalation":"","keyConflict":"","turn":"","exitDebt":"","characters":[]}]}`,
		modeInstruction, unitLabel, unitLabel, string(briefJSON), recommendedNovelWorkbenchArcCount(brief.TargetUnitCount), unitLabel, brief.TargetUnitCount, unitLabel, unitLabel)
}

func buildNovelWorkbenchBootstrapRepairPrompt(brief novelWorkbenchBrief, raw string, validationErr error) string {
	return fmt.Sprintf(`把下面的总控档案修复为一个合法 JSON 对象。不要重新解释创作思路，不要加入逐单元流水账；必须保留有价值的原创信息。分部弧线必须连续覆盖第 1 到第 %d 单元，且每段都有标题、任务、核心冲突和离场债务。

校验问题：%s

原始输出：
%s

只输出 JSON。`, brief.TargetUnitCount, validationErr.Error(), raw)
}

func buildNovelWorkbenchUnitPrompt(control novelWorkbenchControl, state novelWorkbenchState, arc novelWorkbenchArc, unit int) string {
	unitLabel := "第 %d 集"
	formatInstruction := "写成可拍摄的短剧剧本：用场景编号/场景信息、人物动作、对白、必要的旁白或音效；单集结尾必须形成因果钩子，不得只留口号。"
	if control.Brief.OutputMode == novelWorkbenchModeNovel {
		unitLabel = "第 %d 章"
		formatInstruction = "写成完整小说章节：有场景推进、人物行动、有效对白、情绪和因果，不得写成提纲或剧情摘要。"
	}
	briefJSON, _ := json.Marshal(control.Brief)
	bibleJSON, _ := json.Marshal(control.StoryBible)
	arcJSON, _ := json.Marshal(arc)
	stateJSON, _ := json.Marshal(state)
	return fmt.Sprintf(`你是这部作品的执行主笔。现在只写 %s，但必须从总控档案和最新动态状态中取材；不要自行改写既定角色关系、世界规则和已发生事实。

创作模式：%s
总控简报：%s
故事圣经：%s
当前分部弧线：%s
最新动态状态：%s

执行顺序（仅在内部完成，不要解释过程）：
1. 为本单元生成详细控制卡：本单元任务、回收或埋设、人物压力、场景推进和尾钩。
2. 完成正文。%s 正文字数目标约 %d 字；禁止用简介、提纲、复盘或“下集预告”代替正文。
3. 自检人物是否有行为动机、关系变化是否有桥梁、伏笔是否真实改变压力、结尾是否承接已有线索。
4. 写回下一单元所需的连续性状态。

只输出一个合法 JSON 对象，不能用 Markdown 代码块或解释：
{"unit":%d,"title":"","content":"完整正文","summary":"本单元发生了什么及其因果后果","writeback":{"characterStates":[],"relationshipStates":[],"plotlineStates":[],"foreshadowStates":[],"openDebts":[],"nextUnitBridge":"下一单元必须承接的具体压力","qualityNotes":[]}}`,
		fmt.Sprintf(unitLabel, unit), control.Brief.OutputMode, string(briefJSON), string(bibleJSON), string(arcJSON), string(stateJSON), formatInstruction, control.Brief.TargetUnitLength, unit)
}

func buildNovelWorkbenchUnitRepairPrompt(brief novelWorkbenchBrief, unit int, raw string, validationErr error) string {
	return fmt.Sprintf(`将下面第 %d 单元的输出修复为合法 JSON。必须保留完整正文，不能缩写成大纲；正文应约 %d 字，并保留下一单元具体可执行的连续性接力。

校验问题：%s

原始输出：
%s

只输出 JSON，结构为：{"unit":%d,"title":"","content":"","summary":"","writeback":{"characterStates":[],"relationshipStates":[],"plotlineStates":[],"foreshadowStates":[],"openDebts":[],"nextUnitBridge":"","qualityNotes":[]}}`, unit, brief.TargetUnitLength, validationErr.Error(), raw, unit)
}

package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	novelWorkbenchStatusArchived  = "archived"

	novelWorkbenchPhaseBootstrap = "bootstrap"
	novelWorkbenchPhaseUnit      = "unit"

	novelWorkbenchGenreSelectionLimit    = 3
	novelWorkbenchAudienceSelectionLimit = 2
)

// StartNovelWorkbenchRequest 是小说工作台的创作简报。targetUnitCount 可以是章节或集数，
// outputMode 决定最终正文的表现形式。
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

	controlJSON, err := json.Marshal(newNovelWorkbenchV3Control(brief))
	if err != nil {
		return nil, err
	}
	stateJSON, err := json.Marshal(newNovelWorkbenchV3State())
	if err != nil {
		return nil, err
	}
	now := time.Now()
	run := model.NovelWorkbenchRun{
		ID: newID(), UserID: userID, ProjectID: project.ID, OutputMode: brief.OutputMode,
		EngineVersion: novelWorkbenchV3EngineVersion, Status: novelWorkbenchStatusQueued, Stage: "等待建立弧级创作档案",
		PipelineStage: novelWorkbenchV3PipelineBootstrap, QualityPolicy: novelWorkbenchV3QualityPolicy,
		TargetUnitCount: brief.TargetUnitCount, ControlJSON: string(controlJSON), DynamicStateJSON: string(stateJSON),
		CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateNovelWorkbenchRun(&run); err != nil {
		_ = s.DeleteProject(userID, project.ID)
		return nil, err
	}

	task, err := s.enqueueNovelWorkbenchTask(userID, project.ID, run.ID, novelWorkbenchPhaseBootstrap, 0, req.Config, req.LogicalModelID, "建立弧级创作档案")
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

// ListNovelWorkbenchRuns deliberately exposes only V3 runs. Historical rows
// remain intact in the database, but cannot enter the active workbench again.
func (s *Service) ListNovelWorkbenchRuns(userID string) ([]NovelWorkbenchRunSummary, error) {
	runs, err := s.repo.NovelWorkbenchRuns(userID)
	if err != nil {
		return nil, err
	}
	result := make([]NovelWorkbenchRunSummary, 0, len(runs))
	for _, run := range runs {
		if run.EngineVersion != novelWorkbenchV3EngineVersion {
			continue
		}
		project, projectErr := s.repo.ProjectForUser(userID, run.ProjectID)
		if projectErr != nil {
			return nil, projectErr
		}
		title, logline, currentArc := project.Name, "", ""
		control, controlErr := decodeNovelWorkbenchV3Control(run.ControlJSON)
		state, stateErr := decodeNovelWorkbenchV3State(run.DynamicStateJSON)
		if controlErr == nil {
			title = firstNonEmptyString(control.Title, project.Name)
			logline = control.Logline
		}
		if stateErr == nil {
			currentArc = state.CurrentArcTitle()
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
	if run.EngineVersion != novelWorkbenchV3EngineVersion {
		return nil, BadAuthRequest("小说工作台仅保留 V3 弧级创作项目")
	}
	artifacts, err := s.repo.NovelWorkbenchArtifacts(run.ID)
	if err != nil {
		return nil, err
	}
	control, err := decodeNovelWorkbenchV3Control(run.ControlJSON)
	if err != nil {
		return nil, err
	}
	state, err := decodeNovelWorkbenchV3State(run.DynamicStateJSON)
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
	if run.EngineVersion != novelWorkbenchV3EngineVersion {
		return nil, BadAuthRequest("小说工作台仅保留 V3 弧级创作项目")
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
	if run.EngineVersion != novelWorkbenchV3EngineVersion {
		return nil, nil, BadAuthRequest("小说工作台仅保留 V3 弧级创作项目")
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
	control, controlErr := decodeNovelWorkbenchV3Control(run.ControlJSON)
	if controlErr != nil {
		return nil, nil, controlErr
	}
	needsBootstrap := !novelWorkbenchV3ControlReady(control)
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
	if phase == novelWorkbenchPhaseBootstrap {
		run.PipelineStage = novelWorkbenchV3PipelineBootstrap
	} else {
		run.PipelineStage = novelWorkbenchV3PipelinePrepare
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
	input, _, err := parseNovelWorkbenchTaskInput(task.InputJSON)
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
	if run.EngineVersion != novelWorkbenchV3EngineVersion {
		return nil, nil, errors.New("小说工作台仅保留 V3 弧级创作项目")
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

	result, err := s.processNovelWorkbenchV3Task(ctx, task, run, input, resolvedConfig)
	if err != nil {
		s.markNovelWorkbenchFailure(run, task, err)
		return nil, nil, err
	}
	return result, nil, nil
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

// scheduleNovelWorkbenchContinuation runs only after the current task is
// marked successful, so a long work occupies at most one active task slot.
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
	if run.EngineVersion != novelWorkbenchV3EngineVersion {
		return errors.New("小说工作台仅保留 V3 弧级创作项目")
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

// decodeNovelWorkbenchJSONObject accepts a JSON object surrounded by model
// commentary or a fenced JSON block, while keeping the accepted payload strict.
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
		return "正在建立弧级创作档案"
	}
	label := "章"
	if mode == novelWorkbenchModeScreenplay {
		label = "集"
	}
	return fmt.Sprintf("正在生成第 %d %s", unit, label)
}

func novelWorkbenchBootstrapTokenLimit(targetUnits int) int {
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

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

// RebuildNovelWorkbenchRequest reuses the selected text-model configuration
// when a V3 workspace needs a clean arc-sealed run.
type RebuildNovelWorkbenchRequest struct {
	Config         map[string]any `json:"config"`
	LogicalModelID string         `json:"logicalModelId"`
}

// RebuildNovelWorkbench only accepts an arc-sealed V3 run. Older engines are
// intentionally not reinterpreted after their runtime and UI have been
// removed; this keeps the active workbench on one deterministic model.
func (s *Service) RebuildNovelWorkbench(ctx context.Context, userID string, projectID string, req RebuildNovelWorkbenchRequest) (*StartNovelWorkbenchResult, error) {
	if len(req.Config) == 0 && strings.TrimSpace(req.LogicalModelID) == "" {
		return nil, BadAuthRequest("请先选择可用的文本模型")
	}
	run, err := s.novelWorkbenchRunForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	if run.EngineVersion != novelWorkbenchV3EngineVersion {
		return nil, BadAuthRequest("小说工作台仅保留 V3 弧级创作项目")
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
	brief, err := novelWorkbenchV3BriefForRebuild(run, project)
	if err != nil {
		return nil, err
	}
	units, err := s.repo.ProjectUnits(projectID)
	if err != nil {
		return nil, err
	}
	if len(units) == 0 {
		return s.rebuildNovelWorkbenchV3InPlace(run, *project, brief, req)
	}
	return s.rebuildNovelWorkbenchV3AsNewProject(run, *project, units, brief, req)
}

func novelWorkbenchV3BriefForRebuild(run *model.NovelWorkbenchRun, project *model.Project) (novelWorkbenchBrief, error) {
	control, err := decodeNovelWorkbenchV3Control(run.ControlJSON)
	if err != nil {
		return novelWorkbenchBrief{}, err
	}
	control.Brief.ProjectName = firstNonEmptyString(strings.TrimSpace(control.Brief.ProjectName), project.Name)
	return control.Brief, nil
}

func (s *Service) rebuildNovelWorkbenchV3InPlace(run *model.NovelWorkbenchRun, project model.Project, brief novelWorkbenchBrief, req RebuildNovelWorkbenchRequest) (*StartNovelWorkbenchResult, error) {
	controlJSON, err := json.Marshal(newNovelWorkbenchV3Control(brief))
	if err != nil {
		return nil, err
	}
	stateJSON, err := json.Marshal(newNovelWorkbenchV3State())
	if err != nil {
		return nil, err
	}
	run.OutputMode = brief.OutputMode
	run.Status = novelWorkbenchStatusQueued
	run.Stage = "等待重建弧级创作档案"
	run.PipelineStage = novelWorkbenchV3PipelineBootstrap
	run.QualityPolicy = novelWorkbenchV3QualityPolicy
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
	task, err := s.enqueueNovelWorkbenchTask(run.UserID, run.ProjectID, run.ID, novelWorkbenchPhaseBootstrap, 0, req.Config, req.LogicalModelID, "重建弧级创作档案")
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

func (s *Service) rebuildNovelWorkbenchV3AsNewProject(sourceRun *model.NovelWorkbenchRun, sourceProject model.Project, units []model.ProjectUnit, brief novelWorkbenchBrief, req RebuildNovelWorkbenchRequest) (*StartNovelWorkbenchResult, error) {
	name, err := s.nextNovelWorkbenchV3RebuildName(sourceRun.UserID, sourceProject.Name)
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
	controlJSON, err := json.Marshal(newNovelWorkbenchV3Control(brief))
	if err != nil {
		return nil, err
	}
	stateJSON, err := json.Marshal(newNovelWorkbenchV3State())
	if err != nil {
		return nil, err
	}
	now := time.Now()
	freshRun := model.NovelWorkbenchRun{ID: newID(), UserID: sourceRun.UserID, ProjectID: freshProject.ID, OutputMode: brief.OutputMode, EngineVersion: novelWorkbenchV3EngineVersion, Status: novelWorkbenchStatusQueued, Stage: "等待重建弧级创作档案", PipelineStage: novelWorkbenchV3PipelineBootstrap, QualityPolicy: novelWorkbenchV3QualityPolicy, TargetUnitCount: brief.TargetUnitCount, ControlJSON: string(controlJSON), DynamicStateJSON: string(stateJSON), CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateNovelWorkbenchRun(&freshRun); err != nil {
		return nil, err
	}
	snapshot := make([]map[string]any, 0, len(units))
	for _, unit := range units {
		snapshot = append(snapshot, map[string]any{"position": unit.Position + 1, "title": unit.Title, "summary": truncateRunes(strings.TrimSpace(unit.SourceText), 600)})
	}
	if err := s.createNovelWorkbenchV3Artifact(&freshRun, 0, "source_snapshot", 0, map[string]any{"sourceProjectId": sourceProject.ID, "units": snapshot}, ""); err != nil {
		return nil, err
	}
	task, err := s.enqueueNovelWorkbenchTask(sourceRun.UserID, freshProject.ID, freshRun.ID, novelWorkbenchPhaseBootstrap, 0, req.Config, req.LogicalModelID, "建立重建版弧级创作档案")
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

func (s *Service) nextNovelWorkbenchV3RebuildName(userID string, base string) (string, error) {
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

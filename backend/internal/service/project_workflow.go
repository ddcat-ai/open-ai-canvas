package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const builtinShortDramaWorkflowKey = "short-drama-production"
const builtinShortDramaWorkflowVersion = 2

type workflowStepDefinition struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

var builtinShortDramaSteps = []workflowStepDefinition{
	{Key: "story", Name: "剧情与章节"},
	{Key: "assets", Name: "资产拆分"},
	{Key: "storyboard", Name: "分镜脚本"},
	{Key: "previz", Name: "黑白动作预演"},
	{Key: "video", Name: "视频生成"},
	{Key: "delivery", Name: "交付与打包"},
}

type ProjectWorkflowDetail struct {
	Instance model.WorkflowInstance       `json:"instance"`
	Steps    []model.WorkflowStepInstance `json:"steps"`
}

type UpdateWorkflowStepRequest struct {
	Status     string `json:"status"`
	OutputJSON string `json:"outputJson"`
	Error      string `json:"error"`
}

type RegisterTaskOutputRequest struct {
	TaskID         string `json:"taskId"`
	CanvasID       string `json:"canvasId"`
	UnitID         string `json:"unitId"`
	ShotID         string `json:"shotId"`
	ArtifactType   string `json:"artifactType"`
	AssetVersionID string `json:"assetVersionId"`
	ResourceID     string `json:"resourceId"`
	MediaType      string `json:"mediaType"`
	Role           string `json:"role"`
	MetadataJSON   string `json:"metadataJson"`
	OutputJSON     string `json:"outputJson"`
}

func (s *Service) EnsureBuiltinProjectWorkflowTemplate() error {
	if _, err := s.repo.WorkflowTemplateVersion(builtinShortDramaWorkflowKey, builtinShortDramaWorkflowVersion); err == nil {
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	definition, err := json.Marshal(map[string]any{"scope": []string{"project", "unit"}, "steps": builtinShortDramaSteps})
	if err != nil {
		return err
	}
	template := model.WorkflowTemplateVersion{ID: newID(), TemplateKey: builtinShortDramaWorkflowKey, Name: "短剧分镜工作流", Version: builtinShortDramaWorkflowVersion, DefinitionJSON: string(definition), CreatedAt: time.Now()}
	return s.repo.CreateWorkflowTemplateVersion(&template)
}

func (s *Service) createProjectWorkflow(projectID string, unitID string, scope string) (ProjectWorkflowDetail, error) {
	template, err := s.repo.WorkflowTemplateVersion(builtinShortDramaWorkflowKey, builtinShortDramaWorkflowVersion)
	if err != nil {
		return ProjectWorkflowDetail{}, err
	}
	if existing, existingErr := s.repo.WorkflowInstanceForScope(projectID, unitID, template.ID); existingErr == nil {
		steps, stepsErr := s.repo.WorkflowSteps(existing.ID)
		return ProjectWorkflowDetail{Instance: *existing, Steps: steps}, stepsErr
	} else if !errors.Is(existingErr, gorm.ErrRecordNotFound) {
		return ProjectWorkflowDetail{}, existingErr
	}
	now := time.Now()
	instance := model.WorkflowInstance{ID: newID(), ProjectID: projectID, UnitID: unitID, TemplateVersionID: template.ID, Scope: scope, Status: model.WorkflowStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	steps := make([]model.WorkflowStepInstance, 0, len(builtinShortDramaSteps))
	for index, definition := range builtinShortDramaSteps {
		status := model.WorkflowStepStatusPending
		if index == 0 {
			status = model.WorkflowStepStatusReady
		}
		steps = append(steps, model.WorkflowStepInstance{ID: newID(), WorkflowInstanceID: instance.ID, StepKey: definition.Key, Name: definition.Name, Position: index, Status: status, InputJSON: "{}", OutputJSON: "{}", CreatedAt: now, UpdatedAt: now})
	}
	if err := s.repo.CreateWorkflowInstance(&instance, steps); err != nil {
		return ProjectWorkflowDetail{}, err
	}
	if err := s.repo.BumpProjectRevision(projectID); err != nil {
		return ProjectWorkflowDetail{}, err
	}
	return ProjectWorkflowDetail{Instance: instance, Steps: steps}, nil
}

func (s *Service) ProjectWorkflows(projectID string) ([]ProjectWorkflowDetail, error) {
	instances, err := s.repo.ProjectWorkflowInstances(projectID)
	if err != nil {
		return nil, err
	}
	result := make([]ProjectWorkflowDetail, 0, len(instances))
	for _, instance := range instances {
		steps, stepsErr := s.repo.WorkflowSteps(instance.ID)
		if stepsErr != nil {
			return nil, stepsErr
		}
		result = append(result, ProjectWorkflowDetail{Instance: instance, Steps: steps})
	}
	return result, nil
}

func (s *Service) CreateUnitWorkflow(userID string, projectID string, unitID string) (ProjectWorkflowDetail, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return ProjectWorkflowDetail{}, err
	}
	if _, err := s.repo.ProjectUnit(projectID, unitID); err != nil {
		return ProjectWorkflowDetail{}, err
	}
	return s.createProjectWorkflow(projectID, unitID, "unit")
}

func (s *Service) UpdateWorkflowStep(userID string, projectID string, stepID string, req UpdateWorkflowStepRequest) (model.WorkflowStepInstance, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return model.WorkflowStepInstance{}, err
	}
	step, err := s.repo.WorkflowStepForProject(projectID, stepID)
	if err != nil {
		return model.WorkflowStepInstance{}, err
	}
	status := model.WorkflowStepStatus(strings.TrimSpace(req.Status))
	if !validWorkflowStepStatus(status) {
		return model.WorkflowStepInstance{}, BadAuthRequest("不支持的工作流步骤状态")
	}
	if !canTransitionWorkflowStep(step.Status, status) {
		return model.WorkflowStepInstance{}, BadAuthRequest("当前工作流步骤不能直接切换到目标状态")
	}
	now := time.Now()
	step.Status = status
	step.OutputJSON = req.OutputJSON
	if strings.TrimSpace(step.OutputJSON) == "" {
		step.OutputJSON = "{}"
	}
	step.Error = strings.TrimSpace(req.Error)
	if status == model.WorkflowStepStatusRunning && step.StartedAt == nil {
		step.StartedAt = &now
	}
	if status == model.WorkflowStepStatusCompleted || status == model.WorkflowStepStatusSkipped {
		step.CompletedAt = &now
	} else {
		step.CompletedAt = nil
	}
	step.UpdatedAt = now
	instance, err := s.repo.WorkflowInstance(step.WorkflowInstanceID)
	if err != nil {
		return model.WorkflowStepInstance{}, err
	}
	if status == model.WorkflowStepStatusCompleted {
		if err := s.validateWorkflowStepCompletion(projectID, instance, step); err != nil {
			return model.WorkflowStepInstance{}, err
		}
	}
	instance.Status = model.WorkflowStatusActive
	instance.Revision++
	instance.UpdatedAt = now
	var next *model.WorkflowStepInstance
	if status == model.WorkflowStepStatusCompleted || status == model.WorkflowStepStatusSkipped {
		next, err = s.repo.NextWorkflowStep(step.WorkflowInstanceID, step.Position)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			next = nil
			instance.Status = model.WorkflowStatusCompleted
		} else if err != nil {
			return model.WorkflowStepInstance{}, err
		} else if next.Status == model.WorkflowStepStatusPending {
			next.Status = model.WorkflowStepStatusReady
			next.UpdatedAt = now
		}
	} else if status == model.WorkflowStepStatusFailed {
		instance.Status = model.WorkflowStatusFailed
	}
	if err := s.repo.UpdateWorkflowProgress(step, next, instance, projectID); err != nil {
		return model.WorkflowStepInstance{}, err
	}
	return *step, nil
}

func (s *Service) RegisterTaskOutput(userID string, projectID string, stepID string, req RegisterTaskOutputRequest) (model.WorkflowStepInstance, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return model.WorkflowStepInstance{}, err
	}
	task, err := s.repo.TaskForUser(userID, strings.TrimSpace(req.TaskID))
	if err != nil {
		return model.WorkflowStepInstance{}, err
	}
	canvasID := strings.TrimSpace(req.CanvasID)
	if task.ProjectID != projectID {
		canvas, canvasErr := s.repo.CanvasProjectForUser(userID, task.ProjectID)
		if canvasErr != nil || canvas.ProjectID != projectID {
			return model.WorkflowStepInstance{}, BadAuthRequest("任务不属于当前项目")
		}
		if canvasID != "" && canvasID != canvas.ID {
			return model.WorkflowStepInstance{}, BadAuthRequest("任务画布与产物画布不一致")
		}
		canvasID = canvas.ID
	}
	if canvasID != "" {
		canvas, canvasErr := s.repo.CanvasProjectForUser(userID, canvasID)
		if canvasErr != nil || canvas.ProjectID != projectID {
			return model.WorkflowStepInstance{}, BadAuthRequest("画布不属于当前项目")
		}
	}
	if task.Status != model.TaskStatusSucceeded {
		return model.WorkflowStepInstance{}, BadAuthRequest("只有成功任务才能登记产物")
	}
	step, err := s.repo.WorkflowStepForProject(projectID, stepID)
	if err != nil {
		return model.WorkflowStepInstance{}, err
	}
	if step.Status == model.WorkflowStepStatusFailed {
		return model.WorkflowStepInstance{}, BadAuthRequest("失败步骤不能登记成功产物")
	}
	unitID := strings.TrimSpace(req.UnitID)
	shotID := strings.TrimSpace(req.ShotID)
	var shot *model.Shot
	if shotID != "" {
		shot, err = s.repo.ShotForProject(projectID, shotID)
		if err != nil {
			return model.WorkflowStepInstance{}, err
		}
		if unitID == "" {
			unitID = shot.UnitID
		} else if unitID != shot.UnitID {
			return model.WorkflowStepInstance{}, BadAuthRequest("镜头不属于指定章节")
		}
	} else if unitID != "" {
		if _, err := s.repo.ProjectUnit(projectID, unitID); err != nil {
			return model.WorkflowStepInstance{}, err
		}
	}
	if versionID := strings.TrimSpace(req.AssetVersionID); versionID != "" {
		if _, err := s.repo.AssetVersionForProject(projectID, versionID); err != nil {
			return model.WorkflowStepInstance{}, err
		}
	}
	if resourceID := strings.TrimSpace(req.ResourceID); resourceID != "" {
		if _, err := s.repo.ResourceForUser(userID, resourceID); err != nil {
			return model.WorkflowStepInstance{}, err
		}
	}
	metadata := strings.TrimSpace(req.MetadataJSON)
	if metadata == "" {
		metadata = "{}"
	}
	if !json.Valid([]byte(metadata)) {
		return model.WorkflowStepInstance{}, BadAuthRequest("产物元数据必须是有效 JSON")
	}
	now := time.Now()
	step.Status = model.WorkflowStepStatusCompleted
	step.OutputJSON = strings.TrimSpace(req.OutputJSON)
	if step.OutputJSON == "" {
		step.OutputJSON = task.ResultJSON
	}
	if strings.TrimSpace(step.OutputJSON) == "" {
		step.OutputJSON = "{}"
	}
	step.Error = ""
	step.CompletedAt = &now
	step.UpdatedAt = now
	instance, err := s.repo.WorkflowInstance(step.WorkflowInstanceID)
	if err != nil {
		return model.WorkflowStepInstance{}, err
	}
	instance.Revision++
	instance.Status = model.WorkflowStatusActive
	instance.UpdatedAt = now
	next, nextErr := s.repo.NextWorkflowStep(step.WorkflowInstanceID, step.Position)
	if errors.Is(nextErr, gorm.ErrRecordNotFound) {
		instance.Status = model.WorkflowStatusCompleted
		next = nil
	} else if nextErr != nil {
		return model.WorkflowStepInstance{}, nextErr
	} else if next.Status == model.WorkflowStepStatusPending {
		next.Status = model.WorkflowStepStatusReady
		next.UpdatedAt = now
	}
	var representation *model.AssetRepresentation
	if strings.TrimSpace(req.AssetVersionID) != "" {
		role := strings.TrimSpace(req.Role)
		if role == "" {
			role = "output"
		}
		if !validShotAssetRole(role) {
			return model.WorkflowStepInstance{}, BadAuthRequest("不支持的产物用途")
		}
		representation = &model.AssetRepresentation{ID: newID(), TaskID: task.ID, AssetVersionID: strings.TrimSpace(req.AssetVersionID), ResourceID: strings.TrimSpace(req.ResourceID), MediaType: strings.TrimSpace(req.MediaType), Role: role, MetadataJSON: metadata, CreatedAt: now}
	}
	link := &model.WorkflowStepTask{ID: newID(), WorkflowStepID: step.ID, TaskID: task.ID, CreatedAt: now}
	artifactType := strings.TrimSpace(req.ArtifactType)
	if artifactType == "" && shotID != "" && strings.TrimSpace(req.ResourceID) != "" {
		artifactType = workflowArtifactType(step.StepKey)
	}
	productionLink := &model.ProductionTaskLink{ID: newID(), TaskID: task.ID, ProjectID: projectID, CanvasID: canvasID, UnitID: unitID, ShotID: shotID, WorkflowStepID: step.ID, ArtifactType: artifactType, CreatedAt: now, UpdatedAt: now}
	var artifact *model.ShotArtifact
	if shot != nil && strings.TrimSpace(req.ResourceID) != "" && artifactType != "" {
		artifact = &model.ShotArtifact{ID: newID(), ProjectID: projectID, UnitID: shot.UnitID, ShotID: shot.ID, RevisionID: shot.CurrentRevisionID, TaskID: task.ID, Type: artifactType, ResourceID: strings.TrimSpace(req.ResourceID), Status: "ready", Selected: true, MetadataJSON: metadata, CreatedAt: now, UpdatedAt: now}
	}
	// 单镜产物成功只代表该镜头完成，不能提前放行整个章节阶段。
	if shot != nil {
		step.Status = model.WorkflowStepStatusRunning
		step.CompletedAt = nil
		instance.Status = model.WorkflowStatusActive
		next = nil
	}
	if err := s.repo.RegisterWorkflowTaskOutput(step, next, instance, projectID, link, representation, productionLink, artifact); err != nil {
		return model.WorkflowStepInstance{}, err
	}
	return *step, nil
}

func (s *Service) validateWorkflowStepCompletion(projectID string, instance *model.WorkflowInstance, step *model.WorkflowStepInstance) error {
	if instance == nil || strings.TrimSpace(instance.UnitID) == "" {
		return nil
	}
	unit, err := s.repo.ProjectUnit(projectID, instance.UnitID)
	if err != nil {
		return err
	}
	switch step.StepKey {
	case "story":
		if strings.TrimSpace(unit.SourceText) == "" {
			return BadAuthRequest("章节正文为空，不能完成剧情阶段")
		}
	case "assets":
		candidates, candidateErr := s.repo.ProjectAssetCandidates(projectID)
		if candidateErr != nil {
			return candidateErr
		}
		for _, candidate := range candidates {
			if candidate.UnitID == instance.UnitID && candidate.Status == "pending_confirmation" {
				return BadAuthRequest("仍有待确认资产，不能完成资产拆分阶段")
			}
		}
	case "storyboard", "previz", "video", "delivery":
		shots, shotErr := s.repo.ProjectShots(projectID)
		if shotErr != nil {
			return shotErr
		}
		unitShots := make([]model.Shot, 0, len(shots))
		for _, shot := range shots {
			if shot.UnitID == instance.UnitID {
				unitShots = append(unitShots, shot)
			}
		}
		if len(unitShots) == 0 {
			return BadAuthRequest("当前章节还没有分镜，不能完成本阶段")
		}
		if step.StepKey == "storyboard" {
			for _, shot := range unitShots {
				if strings.TrimSpace(shot.CurrentRevisionID) == "" {
					return BadAuthRequest("存在没有分镜版本的镜头，不能完成分镜阶段")
				}
			}
			return nil
		}
		artifactType := "action_board"
		if step.StepKey == "video" || step.StepKey == "delivery" {
			artifactType = "video"
		}
		artifacts, artifactErr := s.repo.ProjectShotArtifacts(projectID)
		if artifactErr != nil {
			return artifactErr
		}
		readyShots := make(map[string]struct{}, len(unitShots))
		for _, artifact := range artifacts {
			if artifact.UnitID == instance.UnitID && artifact.Type == artifactType && artifact.Selected && artifact.Status == "ready" {
				readyShots[artifact.ShotID] = struct{}{}
			}
		}
		if len(readyShots) != len(unitShots) {
			if artifactType == "action_board" {
				return BadAuthRequest("仍有镜头缺少已通过的动作预演，不能完成本阶段")
			}
			return BadAuthRequest("仍有镜头缺少可交付视频，不能完成本阶段")
		}
	}
	return nil
}

func workflowArtifactType(stepKey string) string {
	switch strings.TrimSpace(stepKey) {
	case "storyboard":
		return "storyboard"
	case "previz":
		return "action_board"
	case "video":
		return "video"
	case "delivery":
		return "delivery"
	default:
		return ""
	}
}

func (s *Service) RegisterTaskOutputFromTask(task model.Task) error {
	if strings.TrimSpace(task.ProjectID) == "" || task.Status != model.TaskStatusSucceeded {
		return nil
	}
	if strings.TrimSpace(task.InputJSON) == "" {
		return nil
	}
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return err
	}
	var input struct {
		WorkflowStepID  string         `json:"workflowStepId"`
		DomainProjectID string         `json:"domainProjectId"`
		CanvasID        string         `json:"canvasId"`
		UnitID          string         `json:"unitId"`
		ShotID          string         `json:"shotId"`
		ArtifactType    string         `json:"artifactType"`
		AssetVersionID  string         `json:"assetVersionId"`
		ResourceID      string         `json:"resourceId"`
		MediaType       string         `json:"mediaType"`
		Role            string         `json:"role"`
		Metadata        map[string]any `json:"metadata"`
	}
	if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
		return err
	}
	if input.Metadata != nil {
		if input.WorkflowStepID == "" {
			input.WorkflowStepID, _ = input.Metadata["workflowStepId"].(string)
		}
		if input.DomainProjectID == "" {
			input.DomainProjectID, _ = input.Metadata["domainProjectId"].(string)
		}
		if input.AssetVersionID == "" {
			input.AssetVersionID, _ = input.Metadata["assetVersionId"].(string)
		}
		if input.CanvasID == "" {
			input.CanvasID, _ = input.Metadata["canvasId"].(string)
		}
		if input.UnitID == "" {
			input.UnitID, _ = input.Metadata["unitId"].(string)
		}
		if input.ShotID == "" {
			input.ShotID, _ = input.Metadata["shotId"].(string)
		}
		if input.ArtifactType == "" {
			input.ArtifactType, _ = input.Metadata["artifactType"].(string)
		}
		if input.ResourceID == "" {
			input.ResourceID, _ = input.Metadata["resourceId"].(string)
		}
		if input.MediaType == "" {
			input.MediaType, _ = input.Metadata["mediaType"].(string)
		}
		if input.Role == "" {
			input.Role, _ = input.Metadata["role"].(string)
		}
	}
	if strings.TrimSpace(input.WorkflowStepID) == "" {
		return nil
	}
	projectID := strings.TrimSpace(input.DomainProjectID)
	if projectID == "" {
		if _, projectErr := s.repo.ProjectForUser(task.UserID, task.ProjectID); projectErr == nil {
			projectID = task.ProjectID
		}
	}
	if projectID == "" {
		return errors.New("任务未提供短剧项目 ID，无法登记产物")
	}
	_, err = s.RegisterTaskOutput(task.UserID, projectID, input.WorkflowStepID, RegisterTaskOutputRequest{TaskID: task.ID, CanvasID: input.CanvasID, UnitID: input.UnitID, ShotID: input.ShotID, ArtifactType: input.ArtifactType, AssetVersionID: input.AssetVersionID, ResourceID: input.ResourceID, MediaType: input.MediaType, Role: input.Role, OutputJSON: task.ResultJSON})
	return err
}

func validWorkflowStepStatus(status model.WorkflowStepStatus) bool {
	switch status {
	case model.WorkflowStepStatusPending, model.WorkflowStepStatusReady, model.WorkflowStepStatusRunning, model.WorkflowStepStatusReview, model.WorkflowStepStatusCompleted, model.WorkflowStepStatusFailed, model.WorkflowStepStatusSkipped:
		return true
	default:
		return false
	}
}

func canTransitionWorkflowStep(current model.WorkflowStepStatus, next model.WorkflowStepStatus) bool {
	if current == next {
		return true
	}
	allowed := map[model.WorkflowStepStatus]map[model.WorkflowStepStatus]bool{
		model.WorkflowStepStatusPending:   {model.WorkflowStepStatusReady: true, model.WorkflowStepStatusSkipped: true},
		model.WorkflowStepStatusReady:     {model.WorkflowStepStatusRunning: true, model.WorkflowStepStatusSkipped: true},
		model.WorkflowStepStatusRunning:   {model.WorkflowStepStatusReview: true, model.WorkflowStepStatusCompleted: true, model.WorkflowStepStatusFailed: true},
		model.WorkflowStepStatusReview:    {model.WorkflowStepStatusRunning: true, model.WorkflowStepStatusCompleted: true, model.WorkflowStepStatusFailed: true},
		model.WorkflowStepStatusFailed:    {model.WorkflowStepStatusReady: true, model.WorkflowStepStatusRunning: true},
		model.WorkflowStepStatusCompleted: {model.WorkflowStepStatusRunning: true},
		model.WorkflowStepStatusSkipped:   {model.WorkflowStepStatusReady: true},
	}
	return allowed[current][next]
}

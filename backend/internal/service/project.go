package service

import (
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type CreateProjectRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	AspectRatio string `json:"aspectRatio"`
	SourceType  string `json:"sourceType"`
	Description string `json:"description"`
}

type UpdateProjectRequest struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	AspectRatio string `json:"aspectRatio"`
	SourceType  string `json:"sourceType"`
	Description string `json:"description"`
	Status      string `json:"status"`
}

type CreateProjectUnitRequest struct {
	Kind       string `json:"kind"`
	Title      string `json:"title"`
	SourceText string `json:"sourceText"`
	Position   int    `json:"position"`
}

type LinkCanvasUnitRequest struct {
	CanvasID string `json:"canvasId"`
	UnitID   string `json:"unitId"`
	Role     string `json:"role"`
}

type ProjectSummary struct {
	Project            model.Project `json:"project"`
	CanvasCount        int           `json:"canvasCount"`
	UnitCount          int           `json:"unitCount"`
	CompletedUnitCount int           `json:"completedUnitCount"`
}

type ProjectDetail struct {
	Project         model.Project                 `json:"project"`
	Units           []model.ProjectUnit           `json:"units"`
	Canvases        []model.CanvasProject         `json:"canvases"`
	Assets          []ProjectAssetSummary         `json:"assets"`
	Workflows       []ProjectWorkflowDetail       `json:"workflows"`
	Shots           []model.Shot                  `json:"shots"`
	ShotReferences  []model.ShotAssetReference    `json:"shotReferences"`
	AssetCandidates []model.ProjectAssetCandidate `json:"assetCandidates"`
}

func (s *Service) ListProjects(userID string) ([]ProjectSummary, error) {
	projects, err := s.repo.Projects(userID)
	if err != nil {
		return nil, err
	}
	result := make([]ProjectSummary, 0, len(projects))
	for _, project := range projects {
		units, unitsErr := s.repo.ProjectUnits(project.ID)
		if unitsErr != nil {
			return nil, unitsErr
		}
		canvases, canvasesErr := s.repo.ProjectCanvasSummaries(userID, project.ID)
		if canvasesErr != nil {
			return nil, canvasesErr
		}
		completed := 0
		for _, unit := range units {
			if unit.Status == model.ProjectUnitStatusCompleted {
				completed++
			}
		}
		result = append(result, ProjectSummary{Project: project, CanvasCount: len(canvases), UnitCount: len(units), CompletedUnitCount: completed})
	}
	return result, nil
}

func (s *Service) ProjectDetail(userID string, id string) (ProjectDetail, error) {
	project, err := s.repo.ProjectForUser(userID, id)
	if err != nil {
		return ProjectDetail{}, err
	}
	units, err := s.repo.ProjectUnits(project.ID)
	if err != nil {
		return ProjectDetail{}, err
	}
	canvases, err := s.repo.ProjectCanvasSummaries(userID, project.ID)
	if err != nil {
		return ProjectDetail{}, err
	}
	assets, err := s.ProjectAssets(userID, project.ID)
	if err != nil {
		return ProjectDetail{}, err
	}
	workflows, err := s.ProjectWorkflows(project.ID)
	if err != nil {
		return ProjectDetail{}, err
	}
	shots, err := s.repo.ProjectShots(project.ID)
	if err != nil {
		return ProjectDetail{}, err
	}
	shotReferences, err := s.repo.ProjectShotAssetReferences(project.ID)
	if err != nil {
		return ProjectDetail{}, err
	}
	candidates, err := s.repo.ProjectAssetCandidates(project.ID)
	if err != nil {
		return ProjectDetail{}, err
	}
	return ProjectDetail{Project: *project, Units: units, Canvases: canvases, Assets: assets, Workflows: workflows, Shots: shots, ShotReferences: shotReferences, AssetCandidates: candidates}, nil
}

func (s *Service) CreateProject(userID string, req CreateProjectRequest) (model.Project, error) {
	if err := s.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		return model.Project{}, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return model.Project{}, BadAuthRequest("项目名称不能为空")
	}
	projectType := strings.TrimSpace(req.Type)
	if projectType == "" {
		projectType = "short-drama"
	}
	aspectRatio := strings.TrimSpace(req.AspectRatio)
	if aspectRatio == "" {
		aspectRatio = "9:16"
	}
	sourceType := strings.TrimSpace(req.SourceType)
	if sourceType == "" {
		sourceType = "blank"
	}
	now := time.Now()
	project := model.Project{ID: newID(), UserID: userID, Name: name, Type: projectType, AspectRatio: aspectRatio, SourceType: sourceType, Description: strings.TrimSpace(req.Description), Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateProject(&project); err != nil {
		return model.Project{}, err
	}
	if _, err := s.createProjectWorkflow(project.ID, "", "project"); err != nil {
		_ = s.repo.DeleteProject(userID, project.ID)
		return model.Project{}, err
	}
	project.Revision++
	project.UpdatedAt = time.Now()
	return project, nil
}

func (s *Service) UpdateProject(userID string, id string, req UpdateProjectRequest) (model.Project, error) {
	project, err := s.repo.ProjectForUser(userID, id)
	if err != nil {
		return model.Project{}, err
	}
	if name := strings.TrimSpace(req.Name); name != "" {
		project.Name = name
	}
	if value := strings.TrimSpace(req.Type); value != "" {
		project.Type = value
	}
	if value := strings.TrimSpace(req.AspectRatio); value != "" {
		project.AspectRatio = value
	}
	if value := strings.TrimSpace(req.SourceType); value != "" {
		project.SourceType = value
	}
	if req.Description != "" {
		project.Description = strings.TrimSpace(req.Description)
	}
	if status := model.ProjectStatus(strings.TrimSpace(req.Status)); status != "" {
		if status != model.ProjectStatusActive && status != model.ProjectStatusArchived {
			return model.Project{}, BadAuthRequest("不支持的项目状态")
		}
		project.Status = status
	}
	project.Revision++
	project.UpdatedAt = time.Now()
	if err := s.repo.UpdateProject(project); err != nil {
		return model.Project{}, err
	}
	return *project, nil
}

func (s *Service) DeleteProject(userID string, id string) error {
	if _, err := s.repo.ProjectForUser(userID, id); err != nil {
		return err
	}
	return s.repo.DeleteProject(userID, id)
}

func (s *Service) CreateProjectUnit(userID string, projectID string, req CreateProjectUnitRequest) (model.ProjectUnit, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return model.ProjectUnit{}, err
	}
	kind := model.ProjectUnitKind(strings.TrimSpace(req.Kind))
	if kind == "" {
		kind = model.ProjectUnitKindChapter
	}
	if kind != model.ProjectUnitKindChapter && kind != model.ProjectUnitKindEpisode {
		return model.ProjectUnit{}, BadAuthRequest("不支持的项目单元类型")
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		return model.ProjectUnit{}, BadAuthRequest("章节标题不能为空")
	}
	position := req.Position
	if position < 0 {
		position = 0
	}
	now := time.Now()
	unit := model.ProjectUnit{ID: newID(), ProjectID: projectID, Kind: kind, Title: title, SourceText: req.SourceText, Status: model.ProjectUnitStatusDraft, Position: position, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateProjectUnit(&unit); err != nil {
		return model.ProjectUnit{}, err
	}
	if err := s.repo.BumpProjectRevision(projectID); err != nil {
		return model.ProjectUnit{}, err
	}
	return unit, nil
}

func (s *Service) LinkCanvasUnit(userID string, projectID string, req LinkCanvasUnitRequest) (model.CanvasUnitLink, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return model.CanvasUnitLink{}, err
	}
	canvasID := strings.TrimSpace(req.CanvasID)
	unitID := strings.TrimSpace(req.UnitID)
	if canvasID == "" || unitID == "" {
		return model.CanvasUnitLink{}, BadAuthRequest("画布和章节不能为空")
	}
	if _, err := s.repo.CanvasProjectForUser(userID, canvasID); err != nil {
		return model.CanvasUnitLink{}, err
	}
	if _, err := s.repo.ProjectUnit(projectID, unitID); err != nil {
		return model.CanvasUnitLink{}, err
	}
	if err := s.repo.AssignCanvasToProject(userID, canvasID, projectID); err != nil {
		return model.CanvasUnitLink{}, err
	}
	role := strings.TrimSpace(req.Role)
	if role == "" {
		role = "storyboard"
	}
	now := time.Now()
	link := model.CanvasUnitLink{ID: newID(), ProjectID: projectID, CanvasID: canvasID, UnitID: unitID, Role: role, CreatedAt: now}
	if err := s.repo.UpsertCanvasUnitLink(&link); err != nil {
		return model.CanvasUnitLink{}, err
	}
	if err := s.repo.BumpProjectRevision(projectID); err != nil {
		return model.CanvasUnitLink{}, err
	}
	return link, nil
}

func IsProjectNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}

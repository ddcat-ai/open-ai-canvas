package service

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

type CreateProjectShotRequest struct {
	ID          string `json:"id"`
	UnitID      string `json:"unitId"`
	Title       string `json:"title"`
	Description string `json:"description"`
	Position    int    `json:"position"`
	DurationMs  int64  `json:"durationMs"`
	Status      string `json:"status"`
}

type LinkShotAssetRequest struct {
	AssetVersionID string `json:"assetVersionId"`
	Role           string `json:"role"`
}

type AssetCandidateInput struct {
	UnitID   string         `json:"unitId"`
	ShotID   string         `json:"shotId"`
	Name     string         `json:"name"`
	Category string         `json:"category"`
	Details  map[string]any `json:"details"`
}

type CreateAssetCandidatesRequest struct {
	Candidates []AssetCandidateInput `json:"candidates"`
}

func (s *Service) CreateProjectShot(userID string, projectID string, req CreateProjectShotRequest) (model.Shot, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return model.Shot{}, err
	}
	unitID := strings.TrimSpace(req.UnitID)
	if unitID != "" {
		if _, err := s.repo.ProjectUnit(projectID, unitID); err != nil {
			return model.Shot{}, err
		}
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		return model.Shot{}, BadAuthRequest("镜头标题不能为空")
	}
	if req.Position < 0 || req.DurationMs < 0 {
		return model.Shot{}, BadAuthRequest("镜头顺序和时长不能为负数")
	}
	now := time.Now()
	shotID := strings.TrimSpace(req.ID)
	create := shotID == ""
	status := strings.TrimSpace(req.Status)
	if create {
		shotID = newID()
		if status == "" {
			status = "draft"
		}
	} else {
		existing, err := s.repo.ShotForProject(projectID, shotID)
		if err != nil {
			return model.Shot{}, err
		}
		if status == "" {
			status = existing.Status
		}
		now = existing.CreatedAt
	}
	if !validShotStatus(status) {
		return model.Shot{}, BadAuthRequest("不支持的镜头状态")
	}
	shot := model.Shot{ID: shotID, ProjectID: projectID, UnitID: unitID, Title: title, Description: strings.TrimSpace(req.Description), Position: req.Position, DurationMs: req.DurationMs, Status: status, CreatedAt: now, UpdatedAt: time.Now()}
	if err := s.repo.SaveShot(&shot, create); err != nil {
		return model.Shot{}, err
	}
	if err := s.repo.BumpProjectRevision(projectID); err != nil {
		return model.Shot{}, err
	}
	return shot, nil
}

func validShotStatus(status string) bool {
	switch status {
	case "draft", "ready", "running", "review", "completed", "failed":
		return true
	default:
		return false
	}
}

func (s *Service) LinkShotAsset(userID string, projectID string, shotID string, req LinkShotAssetRequest) (model.ShotAssetReference, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return model.ShotAssetReference{}, err
	}
	if _, err := s.repo.ShotForProject(projectID, shotID); err != nil {
		return model.ShotAssetReference{}, err
	}
	versionID := strings.TrimSpace(req.AssetVersionID)
	if _, err := s.repo.AssetVersionForProject(projectID, versionID); err != nil {
		return model.ShotAssetReference{}, err
	}
	role := strings.TrimSpace(req.Role)
	if !validShotAssetRole(role) {
		return model.ShotAssetReference{}, BadAuthRequest("不支持的镜头素材用途")
	}
	reference := model.ShotAssetReference{ID: newID(), ShotID: shotID, AssetVersionID: versionID, Role: role, Status: "linked", CreatedAt: time.Now()}
	if err := s.repo.UpsertShotAssetReference(&reference); err != nil {
		return model.ShotAssetReference{}, err
	}
	if err := s.repo.BumpProjectRevision(projectID); err != nil {
		return model.ShotAssetReference{}, err
	}
	return reference, nil
}

func (s *Service) CreateProjectAssetCandidates(userID string, projectID string, req CreateAssetCandidatesRequest) ([]model.ProjectAssetCandidate, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return nil, err
	}
	if len(req.Candidates) == 0 || len(req.Candidates) > 100 {
		return nil, BadAuthRequest("资产候选数量必须在 1 到 100 之间")
	}
	now := time.Now()
	candidates := make([]model.ProjectAssetCandidate, 0, len(req.Candidates))
	for _, input := range req.Candidates {
		name := strings.TrimSpace(input.Name)
		category := model.AssetCategory(strings.TrimSpace(input.Category))
		if name == "" || !validAssetCategory(category) {
			return nil, BadAuthRequest("资产候选名称或分类无效")
		}
		if input.UnitID != "" {
			if _, err := s.repo.ProjectUnit(projectID, input.UnitID); err != nil {
				return nil, err
			}
		}
		if input.ShotID != "" {
			if _, err := s.repo.ShotForProject(projectID, input.ShotID); err != nil {
				return nil, err
			}
		}
		detailsJSON, err := marshalProjectDetails(input.Details)
		if err != nil {
			return nil, BadAuthRequest("资产候选详情格式无效")
		}
		candidates = append(candidates, model.ProjectAssetCandidate{ID: newID(), ProjectID: projectID, UnitID: strings.TrimSpace(input.UnitID), ShotID: strings.TrimSpace(input.ShotID), Name: name, Category: category, Status: "pending_confirmation", DetailsJSON: detailsJSON, CreatedAt: now, UpdatedAt: now})
	}
	if err := s.repo.CreateProjectAssetCandidates(candidates); err != nil {
		return nil, err
	}
	if err := s.repo.BumpProjectRevision(projectID); err != nil {
		return nil, err
	}
	return candidates, nil
}

func validShotAssetRole(role string) bool {
	switch role {
	case "reference", "start_frame", "end_frame", "keyframe", "storyboard", "output":
		return true
	default:
		return false
	}
}

func marshalProjectDetails(value map[string]any) (string, error) {
	if value == nil {
		return "{}", nil
	}
	encoded, err := json.Marshal(value)
	return string(encoded), err
}

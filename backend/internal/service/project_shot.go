package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

type CreateProjectShotRequest struct {
	ID          string            `json:"id"`
	UnitID      string            `json:"unitId"`
	Title       string            `json:"title"`
	Description string            `json:"description"`
	Position    int               `json:"position"`
	DurationMs  int64             `json:"durationMs"`
	Status      string            `json:"status"`
	Revision    ShotRevisionInput `json:"revision"`
}

type ShotRevisionInput struct {
	PlotDescription string           `json:"plotDescription"`
	Action          string           `json:"action"`
	Dialogue        string           `json:"dialogue"`
	ShotSize        string           `json:"shotSize"`
	CameraAngle     string           `json:"cameraAngle"`
	CameraMovement  string           `json:"cameraMovement"`
	DurationMs      int64            `json:"durationMs"`
	ImagePrompt     string           `json:"imagePrompt"`
	VideoPrompt     string           `json:"videoPrompt"`
	NegativePrompt  string           `json:"negativePrompt"`
	ContinuityNotes string           `json:"continuityNotes"`
	ActionBeats     []map[string]any `json:"actionBeats"`
}

type ReplaceProjectUnitShotsRequest struct {
	Shots           []ReplaceProjectUnitShotInput `json:"shots"`
	ExpectedShotIDs []string                      `json:"expectedShotIds"`
}

type ReplaceProjectUnitShotInput struct {
	CreateProjectShotRequest
	AssetVersionIDs []string `json:"assetVersionIds"`
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
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
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
		if unitID == "" {
			unitID = existing.UnitID
		}
		if status == "" {
			status = existing.Status
		}
		now = existing.CreatedAt
	}
	if !validShotStatus(status) {
		return model.Shot{}, BadAuthRequest("不支持的镜头状态")
	}
	updatedAt := time.Now()
	description := strings.TrimSpace(req.Description)
	revision, err := newShotRevision(userID, shotID, req.Revision, description, req.DurationMs, updatedAt)
	if err != nil {
		return model.Shot{}, err
	}
	shot := model.Shot{ID: shotID, ProjectID: projectID, UnitID: unitID, CurrentRevisionID: revision.ID, Title: title, Description: revision.PlotDescription, Position: req.Position, DurationMs: revision.DurationMs, Status: status, CreatedAt: now, UpdatedAt: updatedAt}
	if err := s.repo.SaveShotWithRevision(&shot, &revision, create); err != nil {
		return model.Shot{}, err
	}
	return shot, nil
}

func (s *Service) ReplaceProjectUnitShots(userID string, projectID string, unitID string, req ReplaceProjectUnitShotsRequest) ([]model.Shot, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return nil, err
	}
	unitID = strings.TrimSpace(unitID)
	if _, err := s.repo.ProjectUnit(projectID, unitID); err != nil {
		return nil, err
	}
	if len(req.Shots) == 0 || len(req.Shots) > 200 {
		return nil, BadAuthRequest("章节分镜数量必须在 1 到 200 之间")
	}
	now := time.Now()
	shots := make([]model.Shot, 0, len(req.Shots))
	revisions := make([]model.ShotRevision, 0, len(req.Shots))
	references := make([]model.ShotAssetReference, 0)
	for position, input := range req.Shots {
		title := strings.TrimSpace(input.Title)
		description := strings.TrimSpace(input.Description)
		if title == "" || description == "" || input.DurationMs < 0 {
			return nil, BadAuthRequest("分镜标题、描述或时长无效")
		}
		shotID := newID()
		revision, err := newShotRevision(userID, shotID, input.Revision, description, input.DurationMs, now)
		if err != nil {
			return nil, err
		}
		revision.Version = 1
		shots = append(shots, model.Shot{ID: shotID, ProjectID: projectID, UnitID: unitID, CurrentRevisionID: revision.ID, Title: title, Description: revision.PlotDescription, Position: position, DurationMs: revision.DurationMs, Status: "draft", CreatedAt: now, UpdatedAt: now})
		revisions = append(revisions, revision)
		seenVersions := make(map[string]bool, len(input.AssetVersionIDs))
		for _, rawVersionID := range input.AssetVersionIDs {
			versionID := strings.TrimSpace(rawVersionID)
			if versionID == "" || seenVersions[versionID] {
				continue
			}
			if len(seenVersions) >= 6 {
				return nil, BadAuthRequest("单个分镜最多引用 6 个资产版本")
			}
			if _, err := s.repo.AssetVersionForProject(projectID, versionID); err != nil {
				return nil, err
			}
			seenVersions[versionID] = true
			references = append(references, model.ShotAssetReference{ID: newID(), ShotID: shotID, AssetVersionID: versionID, Role: "reference", Status: "linked", CreatedAt: now})
		}
	}
	// 章节级重生成是一个整体写操作，旧镜头与引用必须和新镜头在同一事务中替换。
	if err := s.repo.ReplaceProjectUnitShots(projectID, unitID, shots, revisions, references, req.ExpectedShotIDs); err != nil {
		if errors.Is(err, repository.ErrProjectUnitShotsChanged) {
			return nil, BadAuthRequest("本章分镜已发生变化，请刷新后重新确认")
		}
		return nil, err
	}
	return shots, nil
}

func (s *Service) CreateShotRevision(userID string, projectID string, shotID string, input ShotRevisionInput) (model.Shot, model.ShotRevision, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return model.Shot{}, model.ShotRevision{}, err
	}
	shot, err := s.repo.ShotForProject(projectID, strings.TrimSpace(shotID))
	if err != nil {
		return model.Shot{}, model.ShotRevision{}, err
	}
	now := time.Now()
	revision, err := newShotRevision(userID, shot.ID, input, shot.Description, shot.DurationMs, now)
	if err != nil {
		return model.Shot{}, model.ShotRevision{}, err
	}
	shot.Description = revision.PlotDescription
	shot.DurationMs = revision.DurationMs
	shot.Status = "draft"
	shot.UpdatedAt = now
	if err := s.repo.SaveShotWithRevision(shot, &revision, false); err != nil {
		return model.Shot{}, model.ShotRevision{}, err
	}
	return *shot, revision, nil
}

func (s *Service) DeleteProjectShot(userID string, projectID string, shotID string) error {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return err
	}
	shotID = strings.TrimSpace(shotID)
	if shotID == "" {
		return BadAuthRequest("镜头不能为空")
	}
	if _, err := s.repo.ShotForProject(projectID, shotID); err != nil {
		return err
	}
	return s.repo.DeleteProjectShot(projectID, shotID, time.Now())
}

func newShotRevision(userID string, shotID string, input ShotRevisionInput, fallbackDescription string, fallbackDuration int64, now time.Time) (model.ShotRevision, error) {
	plotDescription := strings.TrimSpace(input.PlotDescription)
	if plotDescription == "" {
		plotDescription = strings.TrimSpace(fallbackDescription)
	}
	if plotDescription == "" {
		return model.ShotRevision{}, BadAuthRequest("镜头画面描述不能为空")
	}
	durationMs := input.DurationMs
	if durationMs == 0 {
		durationMs = fallbackDuration
	}
	if durationMs < 0 {
		return model.ShotRevision{}, BadAuthRequest("镜头时长不能为负数")
	}
	actionBeatsJSON := "[]"
	if input.ActionBeats != nil {
		encoded, err := json.Marshal(input.ActionBeats)
		if err != nil {
			return model.ShotRevision{}, BadAuthRequest("动作节拍格式无效")
		}
		actionBeatsJSON = string(encoded)
	}
	return model.ShotRevision{
		ID: newID(), ShotID: shotID, PlotDescription: plotDescription, Action: strings.TrimSpace(input.Action), Dialogue: strings.TrimSpace(input.Dialogue),
		ShotSize: strings.TrimSpace(input.ShotSize), CameraAngle: strings.TrimSpace(input.CameraAngle), CameraMovement: strings.TrimSpace(input.CameraMovement), DurationMs: durationMs,
		ImagePrompt: strings.TrimSpace(input.ImagePrompt), VideoPrompt: strings.TrimSpace(input.VideoPrompt), NegativePrompt: strings.TrimSpace(input.NegativePrompt),
		ContinuityNotes: strings.TrimSpace(input.ContinuityNotes), ActionBeatsJSON: actionBeatsJSON, CreatedBy: userID, CreatedAt: now,
	}, nil
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
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
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
	now := time.Now()
	reference := model.ShotAssetReference{ID: newID(), ShotID: shotID, AssetVersionID: versionID, Role: role, Status: "linked", CreatedAt: now}
	if err := s.repo.UpsertShotAssetReferenceAndInvalidate(projectID, &reference, now); err != nil {
		return model.ShotAssetReference{}, err
	}
	return reference, nil
}

func (s *Service) UnlinkShotAsset(userID string, projectID string, shotID string, referenceID string) error {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
		return err
	}
	if _, err := s.repo.ShotForProject(projectID, shotID); err != nil {
		return err
	}
	referenceID = strings.TrimSpace(referenceID)
	if referenceID == "" {
		return BadAuthRequest("镜头资产引用不能为空")
	}
	deleted, err := s.repo.DeleteShotAssetReferenceAndInvalidate(projectID, shotID, referenceID, time.Now())
	if err != nil {
		return err
	}
	if !deleted {
		return NotFound("镜头资产引用不存在")
	}
	return nil
}

func (s *Service) CreateProjectAssetCandidates(userID string, projectID string, req CreateAssetCandidatesRequest) ([]model.ProjectAssetCandidate, error) {
	if _, err := s.activeProjectForUser(userID, projectID); err != nil {
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
		if category == model.AssetCategoryCharacter {
			if err := validateCharacterCandidateDetails(input.Details); err != nil {
				return nil, err
			}
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

func validateCharacterCandidateDetails(details map[string]any) error {
	text := func(key string) string {
		value, _ := details[key].(string)
		return strings.TrimSpace(value)
	}
	descriptiveCount := 0
	for _, key := range []string{"appearance", "clothing", "physique", "personality", "consistencyPrompt", "multiViewPrompt"} {
		if text(key) != "" {
			descriptiveCount++
		}
	}
	if text("role") == "" || descriptiveCount < 3 || text("voiceLanguage") == "" || text("voiceAge") == "" || text("voiceTimbre") == "" {
		return BadAuthRequest("角色候选必须包含剧情定位、稳定设定和声音画像")
	}
	return nil
}

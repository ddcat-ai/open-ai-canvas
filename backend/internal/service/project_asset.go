package service

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

type LinkProjectAssetRequest struct {
	AssetID  string `json:"assetId"`
	Category string `json:"category"`
}

type CreateAssetVersionRequest struct {
	Prompt         string `json:"prompt"`
	DefinitionJSON string `json:"definitionJson"`
	Note           string `json:"note"`
}

type ProjectAssetSummary struct {
	ID               string                   `json:"id"`
	Title            string                   `json:"title"`
	MediaType        string                   `json:"mediaType"`
	Category         model.AssetCategory      `json:"category"`
	Status           model.AssetVersionStatus `json:"status"`
	PrimaryVersionID string                   `json:"primaryVersionId,omitempty"`
	VersionCount     int                      `json:"versionCount"`
	Usages           []string                 `json:"usages"`
	UpdatedAt        time.Time                `json:"updatedAt"`
}

type ProjectAssetFilter struct {
	Category  string
	MediaType string
	Status    string
	Usage     string
}

type ConfirmProjectAssetCandidateRequest struct {
	AssetID string `json:"assetId"`
}

func (s *Service) FilterProjectAssets(userID string, projectID string, filter ProjectAssetFilter) ([]ProjectAssetSummary, error) {
	assets, err := s.ProjectAssets(userID, projectID)
	if err != nil {
		return nil, err
	}
	result := make([]ProjectAssetSummary, 0, len(assets))
	for _, asset := range assets {
		if filter.Category != "" && string(asset.Category) != filter.Category {
			continue
		}
		if filter.MediaType != "" && asset.MediaType != filter.MediaType {
			continue
		}
		if filter.Status != "" && string(asset.Status) != filter.Status {
			continue
		}
		if filter.Usage != "" && !containsString(asset.Usages, filter.Usage) {
			continue
		}
		result = append(result, asset)
	}
	return result, nil
}

func (s *Service) ProjectAssets(userID string, projectID string) ([]ProjectAssetSummary, error) {
	assets, err := s.repo.ProjectAssets(userID, projectID)
	if err != nil {
		return nil, err
	}
	result := make([]ProjectAssetSummary, 0, len(assets))
	for _, asset := range assets {
		versions, versionErr := s.repo.AssetVersions(asset.ID)
		if versionErr != nil {
			return nil, versionErr
		}
		usages, usageErr := s.repo.ProjectAssetUsageRoles(projectID, asset.ID)
		if usageErr != nil {
			return nil, usageErr
		}
		result = append(result, ProjectAssetSummary{ID: asset.ID, Title: asset.Title, MediaType: asset.Kind, Category: asset.Category, Status: asset.Status, PrimaryVersionID: asset.PrimaryVersionID, VersionCount: len(versions), Usages: usages, UpdatedAt: asset.UpdatedAt})
	}
	return result, nil
}

func (s *Service) LinkProjectAsset(userID string, projectID string, req LinkProjectAssetRequest) (ProjectAssetSummary, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return ProjectAssetSummary{}, err
	}
	assetID := strings.TrimSpace(req.AssetID)
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	category := model.AssetCategory(strings.TrimSpace(req.Category))
	if category == "" {
		category = asset.Category
	}
	if !validAssetCategory(category) {
		return ProjectAssetSummary{}, BadAuthRequest("不支持的资产业务分类")
	}
	now := time.Now()
	asset.Category = category
	if asset.Status == "" {
		asset.Status = model.AssetVersionStatusConfirmed
	}
	versions, err := s.repo.AssetVersions(asset.ID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	if len(versions) == 0 {
		version := model.AssetVersion{ID: newID(), AssetID: asset.ID, Version: 1, Status: asset.Status, DefinitionJSON: "{}", CreatedAt: now, UpdatedAt: now}
		if err := s.repo.CreateAssetVersion(&version); err != nil {
			return ProjectAssetSummary{}, err
		}
		asset.PrimaryVersionID = version.ID
		versions = append(versions, version)
	}
	asset.UpdatedAt = now
	if err := s.repo.UpdateAssetDomain(asset); err != nil {
		return ProjectAssetSummary{}, err
	}
	link := model.ProjectAssetLink{ID: newID(), ProjectID: projectID, AssetID: asset.ID, CreatedAt: now}
	if err := s.repo.UpsertProjectAssetLink(&link); err != nil {
		return ProjectAssetSummary{}, err
	}
	if err := s.repo.BumpProjectRevision(projectID); err != nil {
		return ProjectAssetSummary{}, err
	}
	return ProjectAssetSummary{ID: asset.ID, Title: asset.Title, MediaType: asset.Kind, Category: asset.Category, Status: asset.Status, PrimaryVersionID: asset.PrimaryVersionID, VersionCount: len(versions), Usages: []string{}, UpdatedAt: asset.UpdatedAt}, nil
}

func (s *Service) UnlinkProjectAsset(userID string, projectID string, assetID string) error {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return err
	}
	if _, err := s.repo.AssetForUser(userID, assetID); err != nil {
		return err
	}
	references, err := s.repo.ProjectAssetShotReferenceCount(projectID, assetID)
	if err != nil {
		return err
	}
	if references > 0 {
		return BadAuthRequest("素材仍被项目镜头引用，请先解除镜头用途")
	}
	if err := s.repo.DeleteProjectAssetLink(projectID, assetID); err != nil {
		return err
	}
	return s.repo.BumpProjectRevision(projectID)
}

func (s *Service) CreateProjectAssetVersion(userID string, projectID string, assetID string, req CreateAssetVersionRequest) (model.AssetVersion, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return model.AssetVersion{}, err
	}
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		return model.AssetVersion{}, err
	}
	linked, err := s.repo.ProjectAssetLinked(projectID, assetID)
	if err != nil {
		return model.AssetVersion{}, err
	}
	if !linked {
		return model.AssetVersion{}, BadAuthRequest("素材尚未加入当前项目")
	}
	versions, err := s.repo.AssetVersions(assetID)
	if err != nil {
		return model.AssetVersion{}, err
	}
	nextVersion := 1
	if len(versions) > 0 {
		nextVersion = versions[0].Version + 1
	}
	definition := strings.TrimSpace(req.DefinitionJSON)
	if definition == "" {
		definition = "{}"
	}
	if !json.Valid([]byte(definition)) {
		return model.AssetVersion{}, BadAuthRequest("资产版本设定必须是有效 JSON")
	}
	now := time.Now()
	version := model.AssetVersion{ID: newID(), AssetID: assetID, Version: nextVersion, Status: model.AssetVersionStatusDraft, DefinitionJSON: definition, Prompt: strings.TrimSpace(req.Prompt), Note: strings.TrimSpace(req.Note), CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateAssetVersion(&version); err != nil {
		return model.AssetVersion{}, err
	}
	asset.PrimaryVersionID = version.ID
	asset.Status = model.AssetVersionStatusDraft
	asset.UpdatedAt = now
	if err := s.repo.UpdateAssetDomain(asset); err != nil {
		return model.AssetVersion{}, err
	}
	if err := s.repo.BumpProjectRevision(projectID); err != nil {
		return model.AssetVersion{}, err
	}
	return version, nil
}

func (s *Service) ConfirmProjectAssetCandidate(userID string, projectID string, candidateID string, req ConfirmProjectAssetCandidateRequest) (ProjectAssetSummary, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return ProjectAssetSummary{}, err
	}
	candidate, err := s.repo.ProjectAssetCandidate(projectID, candidateID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	if candidate.Status != "pending_confirmation" {
		return ProjectAssetSummary{}, BadAuthRequest("资产候选已处理")
	}
	now := time.Now()
	assetID := strings.TrimSpace(req.AssetID)
	createAsset := assetID == ""
	var asset model.Asset
	var version model.AssetVersion
	if createAsset {
		assetID = newID()
		versionID := newID()
		payload, marshalErr := json.Marshal(map[string]any{
			"id": assetID, "kind": "text", "category": candidate.Category, "status": model.AssetVersionStatusConfirmed,
			"primaryVersionId": versionID, "title": candidate.Name, "tags": []string{}, "data": map[string]string{"content": ""},
			"createdAt": now.Format(time.RFC3339Nano), "updatedAt": now.Format(time.RFC3339Nano),
		})
		if marshalErr != nil {
			return ProjectAssetSummary{}, marshalErr
		}
		asset = model.Asset{ID: assetID, UserID: userID, Kind: "text", Category: candidate.Category, Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: versionID, Title: candidate.Name, PayloadJSON: string(payload), CreatedAt: now, UpdatedAt: now}
		version = model.AssetVersion{ID: versionID, AssetID: assetID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: candidate.DetailsJSON, CreatedAt: now, UpdatedAt: now}
	} else {
		existing, assetErr := s.repo.AssetForUser(userID, assetID)
		if assetErr != nil {
			return ProjectAssetSummary{}, assetErr
		}
		asset = *existing
	}
	candidate.Status = "confirmed"
	candidate.ResolvedAssetID = assetID
	candidate.UpdatedAt = now
	link := model.ProjectAssetLink{ID: newID(), ProjectID: projectID, AssetID: assetID, CreatedAt: now}
	if err := s.repo.ConfirmProjectAssetCandidate(candidate, &asset, &version, &link, createAsset); err != nil {
		return ProjectAssetSummary{}, err
	}
	versions, err := s.repo.AssetVersions(assetID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	usages, err := s.repo.ProjectAssetUsageRoles(projectID, assetID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	return ProjectAssetSummary{ID: asset.ID, Title: asset.Title, MediaType: asset.Kind, Category: asset.Category, Status: asset.Status, PrimaryVersionID: asset.PrimaryVersionID, VersionCount: len(versions), Usages: usages, UpdatedAt: asset.UpdatedAt}, nil
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func validAssetCategory(category model.AssetCategory) bool {
	switch category {
	case model.AssetCategoryCharacter, model.AssetCategoryEnvironment, model.AssetCategoryWardrobe, model.AssetCategoryProp, model.AssetCategoryWeapon, model.AssetCategoryStyle, model.AssetCategoryOther:
		return true
	default:
		return false
	}
}

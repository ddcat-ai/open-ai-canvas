package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type AssetsSyncRequest struct {
	Assets []json.RawMessage `json:"assets"`
}

type CanvasProjectsSyncRequest struct {
	Projects []json.RawMessage `json:"projects"`
}

type UserDataSummary struct {
	ID        string    `json:"id"`
	Kind      string    `json:"kind,omitempty"`
	Category  string    `json:"category,omitempty"`
	Status    string    `json:"status,omitempty"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (s *Service) UserAssetSummaries(userID string) ([]UserDataSummary, error) {
	assets, err := s.repo.AssetSummaries(userID)
	if err != nil {
		return nil, err
	}
	result := make([]UserDataSummary, 0, len(assets))
	for _, asset := range assets {
		result = append(result, UserDataSummary{ID: asset.ID, Kind: asset.Kind, Category: string(asset.Category), Status: string(asset.Status), Title: asset.Title, CreatedAt: asset.CreatedAt, UpdatedAt: asset.UpdatedAt})
	}
	return result, nil
}

func (s *Service) UserAsset(userID string, id string) (json.RawMessage, error) {
	asset, err := s.repo.AssetForUser(userID, id)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(asset.PayloadJSON), nil
}

func (s *Service) UpsertUserAsset(userID string, raw json.RawMessage) (UserDataSummary, error) {
	asset, err := assetFromJSON(userID, raw)
	if err != nil {
		return UserDataSummary{}, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return UserDataSummary{}, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	existing, existingErr := s.repo.AssetForUser(userID, asset.ID)
	if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
		return UserDataSummary{}, existingErr
	}
	existingBytes := int64(0)
	if existing != nil {
		existingBytes = int64(len([]byte(existing.PayloadJSON)))
	}
	usage, err := s.repo.UserStorageUsage(userID)
	if err != nil {
		return UserDataSummary{}, err
	}
	if err := validateStructuredStorageQuotaWithPolicy(usage, "asset", errors.Is(existingErr, gorm.ErrRecordNotFound), int64(len(raw))-existingBytes, policy.Resource); err != nil {
		return UserDataSummary{}, err
	}
	if err := s.repo.UpsertAsset(&asset); err != nil {
		return UserDataSummary{}, err
	}
	if existingErr != nil {
		s.recordActivity(userID, "asset", 1)
	}
	return UserDataSummary{ID: asset.ID, Kind: asset.Kind, Category: string(asset.Category), Status: string(asset.Status), Title: asset.Title, CreatedAt: asset.CreatedAt, UpdatedAt: asset.UpdatedAt}, nil
}

func (s *Service) DeleteUserAsset(userID string, id string) error {
	if _, err := s.repo.AssetForUser(userID, id); err != nil {
		return err
	}
	references, err := s.repo.AssetReferenceCount(id)
	if err != nil {
		return err
	}
	if references > 0 {
		return BadAuthRequest("素材仍被项目或镜头引用，请先解除引用")
	}
	return s.repo.DeleteAsset(userID, id)
}

func (s *Service) UserAssets(userID string) ([]json.RawMessage, error) {
	assets, err := s.repo.Assets(userID)
	if err != nil {
		return nil, err
	}
	result := make([]json.RawMessage, 0, len(assets))
	for _, asset := range assets {
		if strings.TrimSpace(asset.PayloadJSON) != "" {
			result = append(result, json.RawMessage(asset.PayloadJSON))
		}
	}
	return result, nil
}

func (s *Service) ReplaceUserAssets(userID string, req AssetsSyncRequest) ([]json.RawMessage, error) {
	assets := make([]model.Asset, 0, len(req.Assets))
	var totalBytes int64
	for _, raw := range req.Assets {
		item, err := assetFromJSON(userID, raw)
		if err != nil {
			return nil, err
		}
		assets = append(assets, item)
		totalBytes += int64(len(raw))
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	usage, err := s.repo.UserStorageUsage(userID)
	if err != nil {
		return nil, err
	}
	if err := validateStructuredReplacementQuotaWithPolicy(usage, "asset", len(assets), totalBytes, policy.Resource); err != nil {
		return nil, err
	}
	if err := s.repo.ReplaceAssets(userID, assets); err != nil {
		return nil, err
	}
	if len(assets) > 0 {
		s.recordActivity(userID, "asset", len(assets))
	}
	return s.UserAssets(userID)
}

func (s *Service) UserCanvasProjects(userID string) ([]json.RawMessage, error) {
	projects, err := s.repo.CanvasProjects(userID)
	if err != nil {
		return nil, err
	}
	result := make([]json.RawMessage, 0, len(projects))
	for _, project := range projects {
		if strings.TrimSpace(project.PayloadJSON) != "" {
			result = append(result, json.RawMessage(project.PayloadJSON))
		}
	}
	return result, nil
}

func (s *Service) UserCanvasProjectSummaries(userID string) ([]UserDataSummary, error) {
	projects, err := s.repo.CanvasProjectSummaries(userID)
	if err != nil {
		return nil, err
	}
	result := make([]UserDataSummary, 0, len(projects))
	for _, project := range projects {
		result = append(result, UserDataSummary{ID: project.ID, Title: project.Title, CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt})
	}
	return result, nil
}

func (s *Service) UserCanvasProject(userID string, id string) (json.RawMessage, error) {
	project, err := s.repo.CanvasProjectForUser(userID, id)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(project.PayloadJSON), nil
}

func (s *Service) UpsertUserCanvasProject(userID string, raw json.RawMessage) (UserDataSummary, error) {
	project, err := canvasProjectFromJSON(userID, raw)
	if err != nil {
		return UserDataSummary{}, err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return UserDataSummary{}, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	existing, existingErr := s.repo.CanvasProjectForUser(userID, project.ID)
	if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
		return UserDataSummary{}, existingErr
	}
	existingBytes := int64(0)
	if existing != nil {
		existingBytes = int64(len([]byte(existing.PayloadJSON)))
	}
	usage, err := s.repo.UserStorageUsage(userID)
	if err != nil {
		return UserDataSummary{}, err
	}
	if err := validateStructuredStorageQuotaWithPolicy(usage, "canvas", errors.Is(existingErr, gorm.ErrRecordNotFound), int64(len(raw))-existingBytes, policy.Resource); err != nil {
		return UserDataSummary{}, err
	}
	if err := s.repo.UpsertCanvasProject(&project); err != nil {
		return UserDataSummary{}, err
	}
	if existingErr != nil || existing.PayloadJSON != project.PayloadJSON || existing.Title != project.Title {
		s.recordActivity(userID, "canvas", 1)
	}
	return UserDataSummary{ID: project.ID, Title: project.Title, CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt}, nil
}

func (s *Service) DeleteUserCanvasProject(userID string, id string) error {
	if err := s.repo.DeleteCanvasShare(userID, id); err != nil {
		return err
	}
	return s.repo.DeleteCanvasProject(userID, id)
}

func (s *Service) ReplaceUserCanvasProjects(userID string, req CanvasProjectsSyncRequest) ([]json.RawMessage, error) {
	projects := make([]model.CanvasProject, 0, len(req.Projects))
	var totalBytes int64
	for _, raw := range req.Projects {
		item, err := canvasProjectFromJSON(userID, raw)
		if err != nil {
			return nil, err
		}
		projects = append(projects, item)
		totalBytes += int64(len(raw))
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	usage, err := s.repo.UserStorageUsage(userID)
	if err != nil {
		return nil, err
	}
	if err := validateStructuredReplacementQuotaWithPolicy(usage, "canvas", len(projects), totalBytes, policy.Resource); err != nil {
		return nil, err
	}
	if err := s.repo.ReplaceCanvasProjects(userID, projects); err != nil {
		return nil, err
	}
	if len(projects) > 0 {
		s.recordActivity(userID, "canvas", 1)
	}
	return s.UserCanvasProjects(userID)
}

func assetFromJSON(userID string, raw json.RawMessage) (model.Asset, error) {
	if err := validateSyncedPayload(raw, "素材"); err != nil {
		return model.Asset{}, err
	}
	var payload struct {
		ID               string `json:"id"`
		Kind             string `json:"kind"`
		Category         string `json:"category"`
		Status           string `json:"status"`
		PrimaryVersionID string `json:"primaryVersionId"`
		Title            string `json:"title"`
		CreatedAt        string `json:"createdAt"`
		UpdatedAt        string `json:"updatedAt"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return model.Asset{}, BadAuthRequest("素材数据格式错误")
	}
	now := time.Now()
	createdAt := parseClientTime(payload.CreatedAt, now)
	updatedAt := parseClientTime(payload.UpdatedAt, createdAt)
	id := strings.TrimSpace(payload.ID)
	if id == "" {
		id = newID()
	}
	category := model.AssetCategory(strings.TrimSpace(payload.Category))
	if category == "" {
		category = model.AssetCategoryOther
	}
	status := model.AssetVersionStatus(strings.TrimSpace(payload.Status))
	if status == "" {
		status = model.AssetVersionStatusConfirmed
	}
	return model.Asset{
		ID:               id,
		UserID:           userID,
		Kind:             strings.TrimSpace(payload.Kind),
		Category:         category,
		Status:           status,
		PrimaryVersionID: strings.TrimSpace(payload.PrimaryVersionID),
		Title:            strings.TrimSpace(payload.Title),
		PayloadJSON:      string(raw),
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}, nil
}

func canvasProjectFromJSON(userID string, raw json.RawMessage) (model.CanvasProject, error) {
	if err := validateSyncedPayload(raw, "画布"); err != nil {
		return model.CanvasProject{}, err
	}
	var payload struct {
		ID        string `json:"id"`
		Title     string `json:"title"`
		ProjectID string `json:"projectId"`
		CreatedAt string `json:"createdAt"`
		UpdatedAt string `json:"updatedAt"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return model.CanvasProject{}, BadAuthRequest("画布数据格式错误")
	}
	now := time.Now()
	createdAt := parseClientTime(payload.CreatedAt, now)
	updatedAt := parseClientTime(payload.UpdatedAt, createdAt)
	id := strings.TrimSpace(payload.ID)
	if id == "" {
		id = newID()
	}
	return model.CanvasProject{
		ID:          id,
		UserID:      userID,
		ProjectID:   strings.TrimSpace(payload.ProjectID),
		Title:       strings.TrimSpace(payload.Title),
		PayloadJSON: string(raw),
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	}, nil
}

func validateSyncedPayload(raw json.RawMessage, label string) error {
	if len(raw) > 4<<20 {
		return BadAuthRequest(label + "数据超过 4MB，请先把媒体文件保存到资源存储")
	}
	var payload interface{}
	if err := json.Unmarshal(raw, &payload); err == nil && containsInlineMediaDataURL(payload) {
		return BadAuthRequest(label + "数据包含内嵌媒体，请先上传到资源存储")
	}
	return nil
}

// 同步数据只禁止作为字段值存在的媒体 Data URL；提示词和上游错误文案可能合法提到相同字符串。
func containsInlineMediaDataURL(value interface{}) bool {
	switch item := value.(type) {
	case string:
		text := strings.ToLower(strings.TrimSpace(item))
		return strings.HasPrefix(text, "data:image/") || strings.HasPrefix(text, "data:video/") || strings.HasPrefix(text, "data:audio/")
	case []interface{}:
		for _, child := range item {
			if containsInlineMediaDataURL(child) {
				return true
			}
		}
	case map[string]interface{}:
		for _, child := range item {
			if containsInlineMediaDataURL(child) {
				return true
			}
		}
	}
	return false
}

func parseClientTime(value string, fallback time.Time) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed
	}
	return fallback
}

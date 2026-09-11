package canvas

import (
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/kernel"
	"strings"
	"time"
	"unicode/utf8"

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
	FolderID  string    `json:"folderId,omitempty"`
	Kind      string    `json:"kind,omitempty"`
	Category  string    `json:"category,omitempty"`
	Status    string    `json:"status,omitempty"`
	Title     string    `json:"title"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type UserDataSnapshot struct {
	Assets   []json.RawMessage `json:"assets"`
	Projects []json.RawMessage `json:"projects"`
}

func (s *Service) UserDataSnapshot(userID string) (UserDataSnapshot, error) {
	assets, err := s.UserAssets(userID)
	if err != nil {
		return UserDataSnapshot{}, err
	}
	projects, err := s.UserCanvasProjects(userID)
	if err != nil {
		return UserDataSnapshot{}, err
	}
	return UserDataSnapshot{Assets: assets, Projects: projects}, nil
}

func (s *Service) UserAssetSummaries(userID string) ([]UserDataSummary, error) {
	assets, err := s.repo.AssetSummaries(userID)
	if err != nil {
		return nil, err
	}
	result := make([]UserDataSummary, 0, len(assets))
	for _, asset := range assets {
		result = append(result, UserDataSummary{ID: asset.ID, FolderID: asset.FolderID, Kind: asset.Kind, Category: string(asset.Category), Status: string(asset.Status), Title: asset.Title, CreatedAt: asset.CreatedAt, UpdatedAt: asset.UpdatedAt})
	}
	return result, nil
}

func (s *Service) UserAsset(userID string, id string) (json.RawMessage, error) {
	asset, err := s.repo.AssetForUser(userID, id)
	if err != nil {
		return nil, err
	}
	return ClientAssetPayload(*asset), nil
}

func (s *Service) UpsertUserAsset(userID string, raw json.RawMessage) (UserDataSummary, error) {
	asset, err := AssetFromJSON(userID, raw)
	if err != nil {
		return UserDataSummary{}, err
	}
	err = s.host.WithStorageLock(func() error {
		if asset.FolderID != "" {
			if _, err := s.repo.AssetFolderForUser(userID, asset.FolderID); err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return kernel.BadAuthRequest("素材分类不存在")
				}
				return err
			}
		}
		existing, existingErr := s.repo.AssetForUser(userID, asset.ID)
		if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
			return existingErr
		}
		if existing != nil && existing.PayloadJSON != asset.PayloadJSON {
			if err := s.ValidateAssetCanvasReferences(userID, asset); err != nil {
				return err
			}
		}
		existingBytes := int64(0)
		if existing != nil {
			existingBytes = int64(len([]byte(existing.PayloadJSON)))
		}
		if err := s.host.StructuredQuota(userID, "asset", errors.Is(existingErr, gorm.ErrRecordNotFound), int64(len(raw))-existingBytes); err != nil {
			return err
		}
		if err := s.repo.UpsertAsset(&asset); err != nil {
			return err
		}
		if existingErr != nil {
			s.host.RecordActivity(userID, "asset", 1)
		}
		return nil
	})
	if err != nil {
		return UserDataSummary{}, err
	}
	return UserDataSummary{ID: asset.ID, FolderID: asset.FolderID, Kind: asset.Kind, Category: string(asset.Category), Status: string(asset.Status), Title: asset.Title, CreatedAt: asset.CreatedAt, UpdatedAt: asset.UpdatedAt}, nil
}

func (s *Service) DeleteUserAsset(userID string, id string) error {
	return s.host.WithStorageLock(func() error {
		return s.host.DeleteUserAssetWithResources(userID, id)
	})
}

func (s *Service) UserAssets(userID string) ([]json.RawMessage, error) {
	assets, err := s.repo.Assets(userID)
	if err != nil {
		return nil, err
	}
	result := make([]json.RawMessage, 0, len(assets))
	for _, asset := range assets {
		if payload := ClientAssetPayload(asset); len(payload) > 0 {
			result = append(result, payload)
		}
	}
	return result, nil
}

func (s *Service) ReplaceUserAssets(userID string, req AssetsSyncRequest) ([]json.RawMessage, error) {
	assets := make([]model.Asset, 0, len(req.Assets))
	var totalBytes int64
	for _, raw := range req.Assets {
		item, err := AssetFromJSON(userID, raw)
		if err != nil {
			return nil, err
		}
		assets = append(assets, item)
		totalBytes += int64(len(raw))
	}
	err := s.host.WithStorageLock(func() error {
		if err := s.ValidateAssetReplacementCanvasReferences(userID, assets); err != nil {
			return err
		}
		if err := s.host.StructuredReplacementQuota(userID, "asset", len(assets), totalBytes); err != nil {
			return err
		}
		if err := s.repo.ReplaceAssets(userID, assets); err != nil {
			return err
		}
		if len(assets) > 0 {
			s.host.RecordActivity(userID, "asset", len(assets))
		}
		return nil
	})
	if err != nil {
		return nil, err
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
	err = s.host.WithStorageLock(func() error {
		if err := s.ValidateCanvasMediaAssets(userID, raw); err != nil {
			return err
		}
		existing, existingErr := s.repo.CanvasProjectForUser(userID, project.ID)
		if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
			return existingErr
		}
		existingBytes := int64(0)
		if existing != nil {
			existingBytes = int64(len([]byte(existing.PayloadJSON)))
		}
		if err := s.host.StructuredQuota(userID, "canvas", errors.Is(existingErr, gorm.ErrRecordNotFound), int64(len(raw))-existingBytes); err != nil {
			return err
		}
		if err := s.repo.UpsertCanvasProject(&project); err != nil {
			return err
		}
		if existingErr != nil || existing.PayloadJSON != project.PayloadJSON || existing.Title != project.Title {
			s.host.RecordActivity(userID, "canvas", 1)
		}
		return nil
	})
	if err != nil {
		return UserDataSummary{}, err
	}
	return UserDataSummary{ID: project.ID, Title: project.Title, CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt}, nil
}

func (s *Service) DeleteUserCanvasProject(userID string, id string) error {
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
	err := s.host.WithStorageLock(func() error {
		for _, raw := range req.Projects {
			if err := s.ValidateCanvasMediaAssets(userID, raw); err != nil {
				return err
			}
		}
		if err := s.host.StructuredReplacementQuota(userID, "canvas", len(projects), totalBytes); err != nil {
			return err
		}
		if err := s.repo.ReplaceCanvasProjects(userID, projects); err != nil {
			return err
		}
		if len(projects) > 0 {
			s.host.RecordActivity(userID, "canvas", 1)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.UserCanvasProjects(userID)
}

func AssetFromJSON(userID string, raw json.RawMessage) (model.Asset, error) {
	if err := ValidateSyncedPayload(raw, "素材"); err != nil {
		return model.Asset{}, err
	}
	var payload struct {
		ID               string `json:"id"`
		FolderID         string `json:"folderId"`
		Kind             string `json:"kind"`
		Category         string `json:"category"`
		Status           string `json:"status"`
		PrimaryVersionID string `json:"primaryVersionId"`
		Title            string `json:"title"`
		CreatedAt        string `json:"createdAt"`
		UpdatedAt        string `json:"updatedAt"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return model.Asset{}, kernel.BadAuthRequest("素材数据格式错误")
	}
	now := time.Now()
	createdAt := parseClientTime(payload.CreatedAt, now)
	updatedAt := parseClientTime(payload.UpdatedAt, createdAt)
	id := strings.TrimSpace(payload.ID)
	if id == "" {
		id = kernel.NewID()
	}
	if utf8.RuneCountInString(id) > model.AssetIDMaxLength {
		return model.Asset{}, kernel.BadAuthRequest("素材 ID 不能超过 80 个字符")
	}
	primaryVersionID := strings.TrimSpace(payload.PrimaryVersionID)
	if utf8.RuneCountInString(primaryVersionID) > 36 {
		return model.Asset{}, kernel.BadAuthRequest("素材主版本 ID 不能超过 36 个字符")
	}
	if err := validateUserAssetDocument(raw); err != nil {
		return model.Asset{}, err
	}
	category := model.NormalizeAssetCategory(model.AssetCategory(payload.Category), payload.Kind)
	status := model.AssetVersionStatus(strings.TrimSpace(payload.Status))
	if status == "" {
		status = model.AssetVersionStatusConfirmed
	}
	return model.Asset{
		ID:               id,
		UserID:           userID,
		FolderID:         strings.TrimSpace(payload.FolderID),
		Kind:             strings.TrimSpace(payload.Kind),
		Category:         category,
		Status:           status,
		PrimaryVersionID: primaryVersionID,
		Title:            strings.TrimSpace(payload.Title),
		PayloadJSON:      string(raw),
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}, nil
}

func canvasProjectFromJSON(userID string, raw json.RawMessage) (model.CanvasProject, error) {
	if err := ValidateSyncedPayload(raw, "画布"); err != nil {
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
		return model.CanvasProject{}, kernel.BadAuthRequest("画布数据格式错误")
	}
	now := time.Now()
	createdAt := parseClientTime(payload.CreatedAt, now)
	updatedAt := parseClientTime(payload.UpdatedAt, createdAt)
	id := strings.TrimSpace(payload.ID)
	if id == "" {
		id = kernel.NewID()
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

func ValidateSyncedPayload(raw json.RawMessage, label string) error {
	if len(raw) > 4<<20 {
		return kernel.BadAuthRequest(label + "数据超过 4MB，请先把媒体文件保存到资源存储")
	}
	var payload interface{}
	if err := json.Unmarshal(raw, &payload); err == nil && ContainsInlineMediaDataURL(payload) {
		return kernel.BadAuthRequest(label + "数据包含内嵌媒体，请先上传到资源存储")
	}
	return nil
}

// 同步数据只禁止作为字段值存在的媒体 Data URL；提示词和上游错误文案可能合法提到相同字符串。
func ContainsInlineMediaDataURL(value interface{}) bool {
	switch item := value.(type) {
	case string:
		text := strings.ToLower(strings.TrimSpace(item))
		return strings.HasPrefix(text, "data:image/") || strings.HasPrefix(text, "data:video/") || strings.HasPrefix(text, "data:audio/")
	case []interface{}:
		for _, child := range item {
			if ContainsInlineMediaDataURL(child) {
				return true
			}
		}
	case map[string]interface{}:
		for _, child := range item {
			if ContainsInlineMediaDataURL(child) {
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

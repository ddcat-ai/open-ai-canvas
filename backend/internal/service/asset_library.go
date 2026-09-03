package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

type UserAssetPage struct {
	Assets         []json.RawMessage `json:"assets"`
	KindCounts     map[string]int64  `json:"kindCounts"`
	CategoryCounts map[string]int64  `json:"categoryCounts"`
	FolderCounts   map[string]int64  `json:"folderCounts"`
	Page           int               `json:"page"`
	PageSize       int               `json:"pageSize"`
	Total          int64             `json:"total"`
	HasMore        bool              `json:"hasMore"`
}

type UserAssetPageFilter struct {
	Kind          string
	Category      string
	FolderID      *string
	Uncategorized bool
	Status        string
	Query         string
}

type CreateAssetFolderRequest struct {
	Name string `json:"name"`
}

type UpdateAssetFolderRequest struct {
	Name string `json:"name"`
}

type MoveUserAssetsRequest struct {
	AssetIDs []string `json:"assetIds"`
	FolderID string   `json:"folderId"`
}

func (s *Service) UserAssetsPage(userID string, page int, pageSize int, filter UserAssetPageFilter) (UserAssetPage, error) {
	page, pageSize = normalizeProjectPage(page, pageSize, 120)
	repoFilter := repository.UserAssetPageFilter{
		Kind: filter.Kind, Category: filter.Category, FolderID: filter.FolderID,
		Uncategorized: filter.Uncategorized, Status: filter.Status, Query: filter.Query,
	}
	assets, total, err := s.repo.UserAssetsPage(userID, page, pageSize, repoFilter)
	if err != nil {
		return UserAssetPage{}, err
	}
	rawAssets := make([]json.RawMessage, 0, len(assets))
	for _, asset := range assets {
		if strings.TrimSpace(asset.PayloadJSON) != "" {
			rawAssets = append(rawAssets, json.RawMessage(asset.PayloadJSON))
		}
	}
	kindRows, categoryRows, folderRows, err := s.repo.UserAssetFacets(userID, filter.Status)
	if err != nil {
		return UserAssetPage{}, err
	}
	return UserAssetPage{
		Assets: rawAssets, KindCounts: assetFacetMap(kindRows), CategoryCounts: assetFacetMap(categoryRows), FolderCounts: assetFacetMap(folderRows),
		Page: page, PageSize: pageSize, Total: total, HasMore: int64(page*pageSize) < total,
	}, nil
}

func assetFacetMap(rows []repository.UserAssetFacetRow) map[string]int64 {
	result := make(map[string]int64, len(rows))
	for _, row := range rows {
		result[row.Key] = row.Count
	}
	return result
}

func (s *Service) AssetFolders(userID string) ([]model.AssetFolder, error) {
	return s.repo.AssetFolders(userID)
}

func (s *Service) CreateAssetFolder(userID string, req CreateAssetFolderRequest) (model.AssetFolder, error) {
	name, nameKey, err := normalizeAssetFolderName(req.Name)
	if err != nil {
		return model.AssetFolder{}, err
	}
	exists, err := s.repo.AssetFolderNameExists(userID, nameKey, "")
	if err != nil {
		return model.AssetFolder{}, err
	}
	if exists {
		return model.AssetFolder{}, BadAuthRequest("已存在同名素材分类")
	}
	position, err := s.repo.NextAssetFolderPosition(userID)
	if err != nil {
		return model.AssetFolder{}, err
	}
	now := time.Now().UTC()
	folder := model.AssetFolder{ID: newID(), UserID: userID, Name: name, NameKey: nameKey, Position: position, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateAssetFolder(&folder); err != nil {
		return model.AssetFolder{}, err
	}
	return folder, nil
}

func (s *Service) UpdateAssetFolder(userID string, folderID string, req UpdateAssetFolderRequest) (model.AssetFolder, error) {
	folder, err := s.repo.AssetFolderForUser(userID, strings.TrimSpace(folderID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return model.AssetFolder{}, BadAuthRequest("素材分类不存在")
		}
		return model.AssetFolder{}, err
	}
	name, nameKey, err := normalizeAssetFolderName(req.Name)
	if err != nil {
		return model.AssetFolder{}, err
	}
	exists, err := s.repo.AssetFolderNameExists(userID, nameKey, folder.ID)
	if err != nil {
		return model.AssetFolder{}, err
	}
	if exists {
		return model.AssetFolder{}, BadAuthRequest("已存在同名素材分类")
	}
	folder.Name = name
	folder.NameKey = nameKey
	folder.UpdatedAt = time.Now().UTC()
	if err := s.repo.UpdateAssetFolder(folder); err != nil {
		return model.AssetFolder{}, err
	}
	return *folder, nil
}

func (s *Service) DeleteAssetFolder(userID string, folderID string) error {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	err := s.repo.DeleteAssetFolder(userID, strings.TrimSpace(folderID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return BadAuthRequest("素材分类不存在")
	}
	return err
}

func (s *Service) MoveUserAssetsToFolder(userID string, req MoveUserAssetsRequest) error {
	ids := uniqueNonemptyStrings(req.AssetIDs)
	if len(ids) == 0 {
		return BadAuthRequest("请选择要移动的素材")
	}
	if len(ids) > 200 {
		return BadAuthRequest("一次最多移动 200 个素材")
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	folderID := strings.TrimSpace(req.FolderID)
	if folderID != "" {
		if _, err := s.repo.AssetFolderForUser(userID, folderID); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return BadAuthRequest("目标素材分类不存在")
			}
			return err
		}
	}
	if err := s.repo.MoveUserAssetsToFolder(userID, ids, folderID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return BadAuthRequest("部分素材不存在或不属于当前用户")
		}
		return err
	}
	return nil
}

func normalizeAssetFolderName(value string) (string, string, error) {
	name := strings.TrimSpace(value)
	if name == "" {
		return "", "", BadAuthRequest("请输入素材分类名称")
	}
	if utf8.RuneCountInString(name) > 40 {
		return "", "", BadAuthRequest("素材分类名称不能超过 40 个字符")
	}
	return name, strings.ToLower(name), nil
}

func uniqueNonemptyStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

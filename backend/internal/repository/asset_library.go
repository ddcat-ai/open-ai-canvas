package repository

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type UserAssetPageFilter struct {
	Kind          string
	Category      string
	FolderID      *string
	Uncategorized bool
	Status        string
	Query         string
}

type UserAssetFacetRow struct {
	Key   string
	Count int64
}

func (r *Repository) UserAssetsPage(userID string, page int, pageSize int, filter UserAssetPageFilter) ([]model.Asset, int64, error) {
	var assets []model.Asset
	var total int64
	query := userAssetFilteredQuery(r.db.Model(&model.Asset{}).Where("user_id = ?", userID), filter, true)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("updated_at desc, id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&assets).Error
	return assets, total, err
}

func (r *Repository) UserAssetFacets(userID string, status string) ([]UserAssetFacetRow, []UserAssetFacetRow, []UserAssetFacetRow, error) {
	base := func() *gorm.DB {
		return userAssetFilteredQuery(r.db.Model(&model.Asset{}).Where("user_id = ?", userID), UserAssetPageFilter{Status: status}, false)
	}
	var kindRows []UserAssetFacetRow
	if err := base().Select("kind AS key, COUNT(*) AS count").Group("kind").Scan(&kindRows).Error; err != nil {
		return nil, nil, nil, err
	}
	var categoryRows []UserAssetFacetRow
	if err := base().Select("category AS key, COUNT(*) AS count").Group("category").Scan(&categoryRows).Error; err != nil {
		return nil, nil, nil, err
	}
	var folderRows []UserAssetFacetRow
	if err := base().Select("folder_id AS key, COUNT(*) AS count").Group("folder_id").Scan(&folderRows).Error; err != nil {
		return nil, nil, nil, err
	}
	return kindRows, categoryRows, folderRows, nil
}

func userAssetFilteredQuery(query *gorm.DB, filter UserAssetPageFilter, includeSearch bool) *gorm.DB {
	if value := strings.TrimSpace(filter.Kind); value != "" {
		query = query.Where("kind = ?", value)
	}
	if value := strings.TrimSpace(filter.Category); value != "" {
		query = query.Where("category = ?", value)
	}
	if filter.Uncategorized {
		query = query.Where("folder_id = ''")
	} else if filter.FolderID != nil {
		query = query.Where("folder_id = ?", strings.TrimSpace(*filter.FolderID))
	}
	switch strings.TrimSpace(filter.Status) {
	case "active":
		query = query.Where("status <> ?", model.AssetVersionStatusArchived)
	case "archived":
		query = query.Where("status = ?", model.AssetVersionStatusArchived)
	case "":
	default:
		query = query.Where("status = ?", strings.TrimSpace(filter.Status))
	}
	if includeSearch {
		if value := strings.ToLower(strings.TrimSpace(filter.Query)); value != "" {
			pattern := "%" + value + "%"
			query = query.Where("LOWER(title) LIKE ? OR LOWER(payload_json) LIKE ?", pattern, pattern)
		}
	}
	return query
}

func (r *Repository) AssetFolders(userID string) ([]model.AssetFolder, error) {
	var folders []model.AssetFolder
	err := r.db.Where("user_id = ?", userID).Order("position asc, created_at asc").Find(&folders).Error
	return folders, err
}

func (r *Repository) AssetFolderForUser(userID string, folderID string) (*model.AssetFolder, error) {
	var folder model.AssetFolder
	if err := r.db.First(&folder, "id = ? AND user_id = ?", folderID, userID).Error; err != nil {
		return nil, err
	}
	return &folder, nil
}

func (r *Repository) AssetFolderNameExists(userID string, nameKey string, excludeID string) (bool, error) {
	query := r.db.Model(&model.AssetFolder{}).Where("user_id = ? AND name_key = ?", userID, nameKey)
	if excludeID != "" {
		query = query.Where("id <> ?", excludeID)
	}
	var count int64
	err := query.Count(&count).Error
	return count > 0, err
}

func (r *Repository) NextAssetFolderPosition(userID string) (int, error) {
	var row struct{ Maximum int }
	err := r.db.Model(&model.AssetFolder{}).Select("COALESCE(MAX(position), -1) AS maximum").Where("user_id = ?", userID).Scan(&row).Error
	return row.Maximum + 1, err
}

func (r *Repository) CreateAssetFolder(folder *model.AssetFolder) error {
	return r.db.Create(folder).Error
}

func (r *Repository) UpdateAssetFolder(folder *model.AssetFolder) error {
	result := r.db.Model(&model.AssetFolder{}).Where("id = ? AND user_id = ?", folder.ID, folder.UserID).Updates(map[string]any{
		"name": folder.Name, "name_key": folder.NameKey, "updated_at": folder.UpdatedAt,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) MoveUserAssetsToFolder(userID string, assetIDs []string, folderID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return moveUserAssetsToFolder(tx, userID, assetIDs, folderID)
	})
}

func (r *Repository) DeleteAssetFolder(userID string, folderID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var folder model.AssetFolder
		if err := tx.First(&folder, "id = ? AND user_id = ?", folderID, userID).Error; err != nil {
			return err
		}
		var assets []model.Asset
		if err := tx.Where("user_id = ? AND folder_id = ?", userID, folderID).Find(&assets).Error; err != nil {
			return err
		}
		ids := make([]string, len(assets))
		for index := range assets {
			ids[index] = assets[index].ID
		}
		if err := moveUserAssetsToFolder(tx, userID, ids, ""); err != nil {
			return err
		}
		result := tx.Delete(&model.AssetFolder{}, "id = ? AND user_id = ?", folderID, userID)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

func moveUserAssetsToFolder(tx *gorm.DB, userID string, assetIDs []string, folderID string) error {
	if len(assetIDs) == 0 {
		return nil
	}
	var assets []model.Asset
	if err := tx.Where("user_id = ? AND id IN ?", userID, assetIDs).Find(&assets).Error; err != nil {
		return err
	}
	if len(assets) != len(assetIDs) {
		return gorm.ErrRecordNotFound
	}
	now := time.Now().UTC()
	for index := range assets {
		payloadJSON, err := assetPayloadWithFolder(assets[index].PayloadJSON, folderID, now)
		if err != nil {
			return err
		}
		if err := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ?", assets[index].ID, userID).Updates(map[string]any{
			"folder_id": folderID, "payload_json": payloadJSON, "updated_at": now,
		}).Error; err != nil {
			return err
		}
	}
	return nil
}

func assetPayloadWithFolder(payloadJSON string, folderID string, updatedAt time.Time) (string, error) {
	var payload map[string]any
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		return "", err
	}
	if folderID == "" {
		delete(payload, "folderId")
	} else {
		payload["folderId"] = folderID
	}
	payload["updatedAt"] = updatedAt.Format(time.RFC3339Nano)
	encoded, err := json.Marshal(payload)
	return string(encoded), err
}

func IsAssetFolderNotFound(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound)
}

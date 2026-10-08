package repository

import (
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *Repository) ProjectCharacterAsset(userID string, projectID string, assetID string) (*model.Asset, error) {
	var asset model.Asset
	err := r.db.Table("assets").Select("assets.*").
		Joins("JOIN project_asset_links ON project_asset_links.asset_id = assets.id").
		Where("assets.id = ? AND assets.user_id = ? AND assets.category = ? AND project_asset_links.project_id = ?", assetID, userID, model.AssetCategoryCharacter, projectID).
		First(&asset).Error
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func (r *Repository) UserCharacterAsset(userID string, assetID string) (*model.Asset, error) {
	var asset model.Asset
	err := r.db.Where("id = ? AND user_id = ? AND category = ? AND kind = ?", assetID, userID, model.AssetCategoryCharacter, "entity").First(&asset).Error
	if err != nil {
		return nil, err
	}
	return &asset, nil
}

func (r *Repository) characterAssetQuery(userID string, query string) *gorm.DB {
	db := r.db.Model(&model.Asset{}).Where("user_id = ? AND category = ? AND kind = ? AND status <> ?", userID, model.AssetCategoryCharacter, "entity", model.AssetVersionStatusArchived)
	if query = strings.TrimSpace(query); query != "" {
		pattern := "%" + strings.ToLower(query) + "%"
		db = db.Where("LOWER(title) LIKE ? OR LOWER(payload_json) LIKE ?", pattern, pattern)
	}
	return db
}

func (r *Repository) UserCharacterAssetsPage(userID string, query string, page int, pageSize int) ([]model.Asset, int64, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 48 {
		pageSize = 12
	}
	var total int64
	if err := r.characterAssetQuery(userID, query).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var assets []model.Asset
	err := r.characterAssetQuery(userID, query).Order("updated_at desc, id desc").Offset((page - 1) * pageSize).Limit(pageSize).Find(&assets).Error
	return assets, total, err
}

func (r *Repository) UserCharacterAssetsByIDs(userID string, ids []string) ([]model.Asset, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	if len(ids) > 80 {
		ids = ids[:80]
	}
	var assets []model.Asset
	err := r.db.Where("user_id = ? AND category = ? AND kind = ? AND id IN ?", userID, model.AssetCategoryCharacter, "entity", ids).Find(&assets).Error
	return assets, err
}

func (r *Repository) AssetVersion(id string) (*model.AssetVersion, error) {
	var version model.AssetVersion
	if err := r.db.First(&version, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &version, nil
}

func (r *Repository) AssetRepresentations(assetVersionID string) ([]model.AssetRepresentation, error) {
	var representations []model.AssetRepresentation
	err := r.db.Where("asset_version_id = ?", assetVersionID).Order("role asc, created_at asc").Find(&representations).Error
	return representations, err
}

func (r *Repository) AssetRepresentationsForTask(taskID string) ([]model.AssetRepresentation, error) {
	var representations []model.AssetRepresentation
	err := r.db.Where("task_id = ?", taskID).Order("role asc, created_at asc").Find(&representations).Error
	return representations, err
}

func (r *Repository) UnboundCharacterTurnaroundTasks(userID string, projectID string) ([]model.Task, error) {
	var tasks []model.Task
	err := r.db.Where("user_id = ? AND project_id = ? AND status = ? AND type = ?", userID, projectID, model.TaskStatusSucceeded, "canvas_image").
		Where("input_json LIKE ?", "%character_turnaround%").
		Where("NOT EXISTS (SELECT 1 FROM asset_representations WHERE asset_representations.task_id = tasks.id)").
		Order("created_at asc").Limit(100).Find(&tasks).Error
	return tasks, err
}

func (r *Repository) CharacterVoiceBinding(assetVersionID string) (*model.CharacterVoiceBinding, error) {
	var binding model.CharacterVoiceBinding
	if err := r.db.First(&binding, "asset_version_id = ?", assetVersionID).Error; err != nil {
		return nil, err
	}
	return &binding, nil
}

func (r *Repository) VoiceProfileForUser(userID string, id string) (*model.VoiceProfile, error) {
	var profile model.VoiceProfile
	if err := r.db.First(&profile, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &profile, nil
}

func (r *Repository) VoiceProfiles(userID string) ([]model.VoiceProfile, error) {
	var profiles []model.VoiceProfile
	err := r.db.Where("user_id = ? AND status = ?", userID, "active").Order("created_at asc").Find(&profiles).Error
	return profiles, err
}

func (r *Repository) EnsureVoiceProfiles(profiles []model.VoiceProfile) error {
	if len(profiles) == 0 {
		return nil
	}
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "provider"}, {Name: "voice_key"}},
		DoNothing: true,
	}).Create(&profiles).Error
}

func (r *Repository) CreateVoiceProfile(profile *model.VoiceProfile) error {
	return r.db.Create(profile).Error
}

// RenameVoiceProfile 只改用户上传样本声音的显示名；内置音色的名称由系统维护。
func (r *Repository) RenameVoiceProfile(userID, id, name string) error {
	return r.db.Model(&model.VoiceProfile{}).
		Where("id = ? AND user_id = ? AND provider = ?", id, userID, "user_upload").
		Updates(map[string]any{"name": name, "updated_at": time.Now()}).Error
}

func (r *Repository) VoiceProfileBySampleResource(userID string, resourceID string) (*model.VoiceProfile, error) {
	var profile model.VoiceProfile
	if err := r.db.First(&profile, "user_id = ? AND sample_resource_id = ? AND status = ?", userID, resourceID, "active").Error; err != nil {
		return nil, err
	}
	return &profile, nil
}

func (r *Repository) CreateUserCharacter(asset *model.Asset, version *model.AssetVersion, representations []model.AssetRepresentation, voice *model.CharacterVoiceBinding) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(asset).Error; err != nil {
			return err
		}
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if len(representations) > 0 {
			if err := tx.Create(&representations).Error; err != nil {
				return err
			}
		}
		if voice != nil {
			if err := tx.Create(voice).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// CreateProjectCharacter 将角色身份、首版本和项目关联放入同一事务。
func (r *Repository) CreateProjectCharacter(projectID string, asset *model.Asset, version *model.AssetVersion, link *model.ProjectAssetLink) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(asset).Error; err != nil {
			return err
		}
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		if err := tx.Create(link).Error; err != nil {
			return err
		}
		return tx.Model(&model.Project{}).Where("id = ?", projectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": asset.UpdatedAt}).Error
	})
}

// SaveCharacterVersion 通过不可变版本替换角色当前状态，旧镜头仍可继续引用历史版本。
func (r *Repository) SaveCharacterVersion(projectID string, asset *model.Asset, version *model.AssetVersion, representations []model.AssetRepresentation, voice *model.CharacterVoiceBinding) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := saveCharacterVersion(tx, asset, version, representations, voice); err != nil {
			return err
		}
		projectIDs := []string{}
		if projectID != "" {
			projectIDs = append(projectIDs, projectID)
		} else if err := tx.Model(&model.ProjectAssetLink{}).Where("asset_id = ?", asset.ID).Distinct("project_id").Pluck("project_id", &projectIDs).Error; err != nil {
			return err
		}
		for _, linkedProjectID := range projectIDs {
			if err := tx.Model(&model.Project{}).Where("id = ?", linkedProjectID).
				Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": time.Now()}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// ConfirmProjectCharacterCandidate 保证角色归并版本与候选确认同时生效，失败时不会留下孤立版本。
func (r *Repository) ConfirmProjectCharacterCandidate(candidate *model.ProjectAssetCandidate, asset *model.Asset, version *model.AssetVersion, representations []model.AssetRepresentation, voice *model.CharacterVoiceBinding) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := saveCharacterVersion(tx, asset, version, representations, voice); err != nil {
			return err
		}
		result := tx.Model(&model.ProjectAssetCandidate{}).
			Where("id = ? AND project_id = ? AND status = ?", candidate.ID, candidate.ProjectID, "pending_confirmation").
			Updates(map[string]any{"status": candidate.Status, "resolved_asset_id": candidate.ResolvedAssetID, "updated_at": candidate.UpdatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrInvalidData
		}
		return tx.Model(&model.Project{}).Where("id = ?", candidate.ProjectID).
			Updates(map[string]any{"revision": gorm.Expr("revision + 1"), "updated_at": candidate.UpdatedAt}).Error
	})
}

func saveCharacterVersion(tx *gorm.DB, asset *model.Asset, version *model.AssetVersion, representations []model.AssetRepresentation, voice *model.CharacterVoiceBinding) error {
	if err := tx.Create(version).Error; err != nil {
		return err
	}
	if len(representations) > 0 {
		if err := tx.Create(&representations).Error; err != nil {
			return err
		}
	}
	if voice != nil {
		if err := tx.Create(voice).Error; err != nil {
			return err
		}
	}
	result := tx.Model(&model.Asset{}).Where("id = ? AND user_id = ?", asset.ID, asset.UserID).Updates(map[string]any{
		"kind": asset.Kind, "category": asset.Category, "status": asset.Status, "primary_version_id": asset.PrimaryVersionID,
		"title": asset.Title, "payload_json": asset.PayloadJSON, "updated_at": asset.UpdatedAt,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

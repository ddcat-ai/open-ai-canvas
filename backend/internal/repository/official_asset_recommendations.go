package repository

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"strings"
	"yingce/backend/internal/model"
)

var ErrOfficialResourceReferenced = errors.New("resource is referenced by official assets")

// OfficialRecommendationResourceIDs returns resources retained by pending or
// published character snapshots. Malformed snapshots must fail closed.
func (r *Repository) OfficialRecommendationResourceIDs() (map[string]struct{}, error) {
	var recommendations []model.OfficialAssetRecommendation
	if err := r.db.Where("status IN ? AND snapshot_json <> ?", []model.OfficialAssetRecommendationStatus{model.OfficialAssetRecommendationPending, model.OfficialAssetRecommendationChangesRequested}, "").Find(&recommendations).Error; err != nil {
		return nil, err
	}
	var official []model.OfficialAsset
	if err := r.db.Where("deleted_at IS NULL").Find(&official).Error; err != nil {
		return nil, err
	}
	result := map[string]struct{}{}
	add := func(raw string) error {
		if strings.TrimSpace(raw) == "" {
			return nil
		}
		var snapshot struct {
			Representations []struct {
				ResourceID string `json:"resourceId"`
			} `json:"representations"`
			Images []struct {
				ResourceID string `json:"resourceId"`
			} `json:"images"`
			Voice *struct {
				Profile struct {
					SampleResourceID string `json:"sampleResourceId"`
				} `json:"profile"`
			} `json:"voice"`
		}
		if err := json.Unmarshal([]byte(raw), &snapshot); err != nil {
			return err
		}
		for _, image := range snapshot.Images {
			if image.ResourceID != "" {
				result[image.ResourceID] = struct{}{}
			}
		}
		for _, representation := range snapshot.Representations {
			if representation.ResourceID != "" {
				result[representation.ResourceID] = struct{}{}
			}
		}
		if snapshot.Voice != nil && snapshot.Voice.Profile.SampleResourceID != "" {
			result[snapshot.Voice.Profile.SampleResourceID] = struct{}{}
		}
		return nil
	}
	for _, item := range recommendations {
		if err := add(item.SnapshotJSON); err != nil {
			return nil, err
		}
	}
	for _, item := range official {
		if item.ResourceID != "" {
			result[item.ResourceID] = struct{}{}
		}
		if err := add(item.CharacterSnapshotJSON); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func (r *Repository) CreateOfficialAssetRecommendation(v *model.OfficialAssetRecommendation) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var asset model.Asset
		query := tx.Where("id = ? AND user_id = ?", v.AssetID, v.SubmitterID)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE"})
		}
		if err := query.First(&asset).Error; err != nil {
			return err
		}
		return tx.Create(v).Error
	})
}
func (r *Repository) OfficialAssetRecommendationByID(id string) (*model.OfficialAssetRecommendation, error) {
	var v model.OfficialAssetRecommendation
	if err := r.db.First(&v, "id = ?", strings.TrimSpace(id)).Error; err != nil {
		return nil, err
	}
	return &v, nil
}
func (r *Repository) UserOfficialAssetRecommendation(assetID, userID string) (*model.OfficialAssetRecommendation, error) {
	var v model.OfficialAssetRecommendation
	if err := r.db.Where("asset_id = ? AND submitter_id = ? AND status IN ?", assetID, userID, []model.OfficialAssetRecommendationStatus{model.OfficialAssetRecommendationPending, model.OfficialAssetRecommendationApproved, model.OfficialAssetRecommendationChangesRequested}).Order("created_at desc").First(&v).Error; err != nil {
		return nil, err
	}
	return &v, nil
}
func (r *Repository) OfficialAssetRecommendationsPage(status string, page, size int) ([]model.OfficialAssetRecommendation, int64, error) {
	var rows []model.OfficialAssetRecommendation
	var total int64
	q := r.db.Model(&model.OfficialAssetRecommendation{})
	if status != "" && status != "all" {
		q = q.Where("status = ?", status)
	}
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := q.Order("created_at desc, id desc").Offset((page - 1) * size).Limit(size).Find(&rows).Error
	return rows, total, err
}
func (r *Repository) UpdateOfficialAssetRecommendation(id string, fields map[string]any) error {
	return r.db.Model(&model.OfficialAssetRecommendation{}).Where("id = ?", id).Updates(fields).Error
}

func (r *Repository) ApproveOfficialAssetRecommendation(id string, official *model.OfficialAsset, fields map[string]any) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(official).Error; err != nil {
			return err
		}
		result := tx.Model(&model.OfficialAssetRecommendation{}).
			Where("id = ? AND status IN ?", id, []model.OfficialAssetRecommendationStatus{model.OfficialAssetRecommendationPending, model.OfficialAssetRecommendationChangesRequested}).
			Updates(fields)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

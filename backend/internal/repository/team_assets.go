package repository

import (
	"errors"
	"time"

	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func (r *Repository) TeamAssetPublicationByKey(teamID, key string) (*model.TeamAssetPublication, error) {
	var row model.TeamAssetPublication
	err := r.db.Where("team_id = ? AND idempotency_key = ?", teamID, key).Take(&row).Error
	return &row, err
}

func (r *Repository) TeamAssetPublicationBatch(teamID, key string) (*model.TeamAssetPublication, error) {
	var row model.TeamAssetPublication
	err := r.db.Where("team_id = ? AND batch_key = ?", teamID, key).Take(&row).Error
	return &row, err
}

func (r *Repository) TeamAssetPublication(teamID, publicationID string) (*model.TeamAssetPublication, error) {
	var row model.TeamAssetPublication
	err := r.db.Where("team_id = ? AND id = ?", teamID, publicationID).Take(&row).Error
	return &row, err
}

func (r *Repository) PublishedAssetForSource(teamID, actorID, sourceID string) (*model.Asset, error) {
	var asset model.Asset
	err := r.db.Model(&model.Asset{}).Joins("JOIN team_asset_publications p ON p.asset_id = assets.id").
		Where("assets.user_id = ? AND p.team_id = ? AND p.published_by = ? AND p.source_asset_id = ? AND p.status = ?", model.TeamContentKey(teamID), teamID, actorID, sourceID, model.TeamAssetReady).
		Order("p.created_at DESC, p.id DESC").Take(&asset).Error
	return &asset, err
}

func (r *Repository) FailTeamAssetPublication(id, message string) error {
	return r.db.Model(&model.TeamAssetPublication{}).Where("id = ? AND status = ?", id, model.TeamAssetPending).
		Updates(map[string]any{"status": model.TeamAssetFailed, "error": message, "source_resource_id": nil, "reserved_bytes": 0, "updated_at": time.Now()}).Error
}

func (r *Repository) ExpiredTeamAssetPublications(teamID string, now time.Time) ([]model.TeamAssetPublication, error) {
	rows := []model.TeamAssetPublication{}
	err := r.db.Where("team_id = ? AND status = ? AND expires_at <= ?", teamID, model.TeamAssetPending, now).Order("expires_at, id").Limit(32).Find(&rows).Error
	return rows, err
}

func (r *Repository) ExpiredTeamAssetPublicationTeams(now time.Time, limit int) ([]string, error) {
	teams := []string{}
	err := r.db.Model(&model.TeamAssetPublication{}).Distinct("team_id").Where("status = ? AND expires_at <= ?", model.TeamAssetPending, now).Order("team_id").Limit(limit).Pluck("team_id", &teams).Error
	return teams, err
}

func (r *Repository) LockPersonalAssetForTeamPublication(userID, assetID string) (*model.Asset, error) {
	var row model.Asset
	err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).Where("user_id = ? AND id = ?", userID, assetID).Take(&row).Error
	return &row, err
}

func (r *Repository) BeginTeamAssetPublication(row *model.TeamAssetPublication) error {
	return r.db.Omit("SourceResource").Create(row).Error
}

func (r *Repository) CompleteTeamAssetPublication(id string, asset *model.Asset, versionID string) error {
	updated := r.db.Model(&model.TeamAssetPublication{}).Where("id = ? AND status = ? AND expires_at > ?", id, model.TeamAssetPending, time.Now()).Updates(map[string]any{"asset_id": asset.ID, "version_id": versionID, "status": model.TeamAssetReady, "source_resource_id": nil, "reserved_bytes": 0})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return errors.New("发布已过期")
	}
	var previous int
	if err := r.db.Model(&model.AssetVersion{}).Select("COALESCE(MAX(version),0)").Where("asset_id = ?", asset.ID).Scan(&previous).Error; err != nil {
		return err
	}
	if err := r.UpsertAsset(asset); err != nil {
		return err
	}
	return r.CreateAssetVersion(&model.AssetVersion{ID: versionID, AssetID: asset.ID, Version: previous + 1, DefinitionJSON: asset.PayloadJSON, Status: asset.Status})
}

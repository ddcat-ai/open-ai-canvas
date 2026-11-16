package repository

import (
	"encoding/json"
	"errors"
	"strings"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

// PublishedOfficialResource checks the server's records, never a client-supplied
// officialAssetId, before treating another user's resource as public.
func (r *Repository) PublishedOfficialResource(id string) (bool, error) {
	resource, err := r.Resource(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if resource.Status != model.ResourceStatusReady {
		return false, nil
	}
	var count int64
	if err := r.db.Model(&model.OfficialAsset{}).Where("resource_id = ? AND status = ? AND deleted_at IS NULL", id, model.OfficialAssetStatusPublished).Count(&count).Error; err != nil {
		return false, err
	}
	if count > 0 {
		return true, nil
	}
	var candidates []model.OfficialAsset
	if err := r.db.Select("character_snapshot_json").Where("status = ? AND deleted_at IS NULL AND character_snapshot_json LIKE ?", model.OfficialAssetStatusPublished, "%"+id+"%").Find(&candidates).Error; err != nil {
		return false, err
	}
	for _, candidate := range candidates {
		var snapshot struct {
			Images []struct {
				ResourceID string `json:"resourceId"`
			} `json:"images"`
			Representations []struct {
				ResourceID string `json:"resourceId"`
			} `json:"representations"`
			Voice *struct {
				Profile struct {
					SampleResourceID string `json:"sampleResourceId"`
				} `json:"profile"`
			} `json:"voice"`
		}
		if err := json.Unmarshal([]byte(candidate.CharacterSnapshotJSON), &snapshot); err != nil {
			return false, err
		}
		for _, image := range append(snapshot.Images, snapshot.Representations...) {
			if strings.TrimSpace(image.ResourceID) == id {
				return true, nil
			}
		}
		if snapshot.Voice != nil && strings.TrimSpace(snapshot.Voice.Profile.SampleResourceID) == id {
			return true, nil
		}
	}
	return false, nil
}

// RetainedCanvasOfficialResource grants access only when the server already
// saved the reference in this user's canvas before the asset was unpublished.
func (r *Repository) RetainedCanvasOfficialResource(userID, canvasID, resourceID string) (bool, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(canvasID) == "" {
		return false, nil
	}
	canvas, err := r.CanvasProjectForUser(userID, canvasID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if !assets.DocumentReferences(canvas.PayloadJSON, map[string]struct{}{resourceID: {}}) {
		return false, nil
	}
	resource, err := r.Resource(resourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if resource.Status != model.ResourceStatusReady {
		return false, nil
	}
	official, err := r.OfficialAssetByResourceID(resourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return official.Status == model.OfficialAssetStatusUnpublished && official.PublishedAt != nil, nil
}

// RetainedOfficialResourceByUser is used only for reading an existing canvas
// reference; the save path additionally requires the same canvas ID.
func (r *Repository) RetainedOfficialResourceByUser(userID, resourceID string) (bool, error) {
	canvases, err := r.CanvasProjects(userID)
	if err != nil {
		return false, err
	}
	for _, canvas := range canvases {
		if !assets.DocumentReferences(canvas.PayloadJSON, map[string]struct{}{resourceID: {}}) {
			continue
		}
		allowed, err := r.RetainedCanvasOfficialResource(userID, canvas.ID, resourceID)
		if err != nil || allowed {
			return allowed, err
		}
	}
	return false, nil
}

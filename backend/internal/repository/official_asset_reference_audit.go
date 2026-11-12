package repository

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

// OfficialAssetResourceIDs includes every shared image and voice sample in a character snapshot.
func OfficialAssetResourceIDs(asset *model.OfficialAsset) ([]string, error) {
	if asset == nil {
		return nil, nil
	}
	ids := map[string]struct{}{}
	add := func(id string) {
		if id = strings.TrimSpace(id); id != "" {
			ids[id] = struct{}{}
		}
	}
	add(asset.ResourceID)
	if raw := strings.TrimSpace(asset.CharacterSnapshotJSON); raw != "" {
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
			return nil, err
		}
		for _, image := range snapshot.Images {
			add(image.ResourceID)
		}
		for _, image := range snapshot.Representations {
			add(image.ResourceID)
		}
		if snapshot.Voice != nil {
			add(snapshot.Voice.Profile.SampleResourceID)
		}
	}
	return assets.SortedIDs(ids), nil
}

// OfficialAssetHasReferences is a conservative read-only audit; it does not authorize deletion.
func (r *Repository) OfficialAssetHasReferences(officialID string, resourceIDs []string) (bool, error) {
	count, err := r.OfficialAssetImportCount(officialID)
	if err != nil || count > 0 {
		return count > 0, err
	}
	ids := map[string]struct{}{}
	for _, id := range resourceIDs {
		if id = strings.TrimSpace(id); id != "" {
			ids[id] = struct{}{}
		}
	}
	var canvases []model.CanvasProject
	if err := r.db.Select("id", "payload_json").Find(&canvases).Error; err != nil {
		return false, err
	}
	for _, canvas := range canvases {
		found, err := officialAssetDocumentReferences(canvas.PayloadJSON, officialID, ids)
		if err != nil || found {
			return found, err
		}
	}
	var snapshots []model.CanvasSnapshot
	if err := r.db.Select("id", "payload_json").Find(&snapshots).Error; err != nil {
		return false, err
	}
	for _, snapshot := range snapshots {
		found, err := officialAssetDocumentReferences(snapshot.PayloadJSON, officialID, ids)
		if err != nil || found {
			return found, err
		}
	}
	var personalAssets []model.Asset
	if err := r.db.Select("id", "payload_json").Find(&personalAssets).Error; err != nil {
		return false, err
	}
	for _, asset := range personalAssets {
		found, err := officialAssetDocumentReferences(asset.PayloadJSON, officialID, ids)
		if err != nil || found {
			return found, err
		}
	}
	var versions []model.AssetVersion
	if err := r.db.Select("id", "definition_json").Find(&versions).Error; err != nil {
		return false, err
	}
	for _, version := range versions {
		found, err := officialAssetDocumentReferences(version.DefinitionJSON, officialID, ids)
		if err != nil || found {
			return found, err
		}
	}
	if len(ids) == 0 {
		return false, nil
	}
	for _, table := range []struct {
		model  any
		column string
	}{{&model.AssetRepresentation{}, "resource_id IN ?"}, {&model.VoiceProfile{}, "sample_resource_id IN ?"}, {&model.CanvasSnapshotResource{}, "resource_id IN ?"}} {
		var n int64
		if err := r.db.Model(table.model).Where(table.column, resourceIDs).Count(&n).Error; err != nil {
			return false, err
		}
		if n > 0 {
			return true, nil
		}
	}
	return false, nil
}

func officialAssetDocumentReferences(raw, officialID string, resourceIDs map[string]struct{}) (bool, error) {
	if strings.TrimSpace(raw) == "" {
		return false, nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return false, err
	}
	var containsReference func(any) bool
	containsReference = func(v any) bool {
		switch x := v.(type) {
		case map[string]any:
			if id, ok := x["officialAssetId"].(string); ok && id == officialID {
				return true
			}
			for _, child := range x {
				if containsReference(child) {
					return true
				}
			}
		case []any:
			for _, child := range x {
				if containsReference(child) {
					return true
				}
			}
		case string:
			value := strings.TrimSpace(x)
			if _, ok := resourceIDs[value]; ok {
				return true
			}
			if id := assets.ResourceID(value); id != "" {
				if _, ok := resourceIDs[id]; ok {
					return true
				}
			}
		}
		return false
	}
	if containsReference(value) {
		return true, nil
	}
	refs, err := assets.CollectDocumentResourceReferences(raw)
	if err != nil {
		return false, err
	}
	for _, ref := range refs {
		if _, found := resourceIDs[ref.ResourceID]; found {
			return true, nil
		}
	}
	return false, nil
}

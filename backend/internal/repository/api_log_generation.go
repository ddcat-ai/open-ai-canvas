package repository

import (
	"encoding/json"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

const APICallLogResourceReferenceKind = "请求生成内容"

// Snapshot references are owned by the log, so normal log retention/deletion
// releases them without retaining credentials or a second resource index.
func (r *Repository) APICallLogResourceReferences(userID string, resourceIDs []string) ([]ResourceDirectReference, error) {
	result := []ResourceDirectReference{}
	if len(resourceIDs) == 0 {
		return result, nil
	}
	candidates := make(map[string]bool, len(resourceIDs))
	for _, id := range resourceIDs {
		candidates[id] = true
	}
	var logs []model.ApiCallLog
	query := r.db.Select("id", "generation_content_json").Where("capability = ? AND request_kind = ? AND generation_content_json <> ''", "video", "create")
	if userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	err := query.FindInBatches(&logs, 100, func(_ *gorm.DB, _ int) error {
		for _, log := range logs {
			var snapshot struct {
				Version    int `json:"version"`
				References []struct {
					ResourceID string `json:"resourceId"`
				} `json:"references"`
			}
			if len(log.GenerationContentJSON) > 256<<10 || json.Unmarshal([]byte(log.GenerationContentJSON), &snapshot) != nil || snapshot.Version != 1 {
				continue
			}
			seen := map[string]bool{}
			for _, ref := range snapshot.References {
				if candidates[ref.ResourceID] && !seen[ref.ResourceID] {
					result = append(result, ResourceDirectReference{Kind: APICallLogResourceReferenceKind, ID: log.ID, Title: "视频请求原始媒体", ResourceID: ref.ResourceID})
					seen[ref.ResourceID] = true
				}
			}
		}
		return nil
	}).Error
	return result, err
}

func (r *Repository) HasArkPrivateAssetResourceBinding(userID, resourceID, arkAssetID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.ArkPrivateAssetBinding{}).Where("user_id = ? AND resource_id = ? AND ark_asset_id = ? AND status = ?", userID, resourceID, arkAssetID, "active").Count(&count).Error
	return count > 0, err
}

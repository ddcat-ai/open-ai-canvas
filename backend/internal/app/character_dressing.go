package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/model"
)

// 来源信息不能成为资源权限凭据；任务、角色与最终产物必须在服务端重新核对。
func (s *Service) validateCharacterDressingSources(userID, assetID string, definition map[string]any) error {
	outfits, _ := definition["outfits"].([]any)
	for _, raw := range outfits {
		outfit, _ := raw.(map[string]any)
		source, _ := outfit["source"].(map[string]any)
		taskID, _ := source["taskId"].(string)
		if taskID == "" {
			continue
		}
		task, err := s.repo.TaskForUser(userID, taskID)
		if err != nil {
			return BadAuthRequest("形象来源任务不可访问")
		}
		var input struct {
			Metadata struct {
				Source   string `json:"source"`
				Dressing struct {
					CharacterAssetID string `json:"characterAssetId"`
				} `json:"dressing"`
			} `json:"metadata"`
		}
		if json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Metadata.Source != "character-dressing-table" || input.Metadata.Dressing.CharacterAssetID != assetID || task.Status != model.TaskStatusSucceeded {
			return BadAuthRequest("形象来源与当前角色不匹配，或任务尚未完成")
		}
		resourceID, _ := outfit["resourceId"].(string)
		var result struct {
			Images []struct {
				StorageKey string `json:"storageKey"`
				ResourceID string `json:"resourceId"`
			} `json:"images"`
		}
		if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
			return BadAuthRequest("任务结果尚未就绪")
		}
		found := false
		for _, image := range result.Images {
			if resourceID != "" && (image.ResourceID == resourceID || strings.TrimPrefix(image.StorageKey, "resource:") == resourceID) {
				found = true
			}
		}
		if !found {
			return BadAuthRequest("形象图片不属于来源任务")
		}
	}
	return nil
}

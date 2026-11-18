package app

import (
	"encoding/json"
	"regexp"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

var tryOnBatchPattern = regexp.MustCompile(`^tryon_[a-z-]+_[a-zA-Z0-9]+$`)

// DeleteTryOnBatch removes generated assets and persisted batch tasks together.
func (s *Service) DeleteTryOnBatch(userID, batchID string) ([]string, error) {
	if userID == "" || len(batchID) > 64 || !tryOnBatchPattern.MatchString(batchID) {
		return nil, BadAuthRequest("换装批次编号无效")
	}
	assetIDs := []string{}
	err := s.repo.Transaction(func(repo *repository.Repository) error {
		tasks, err := repo.TryOnBatchTasks(userID, batchID)
		if err != nil {
			return err
		}
		taskIDs := make([]string, 0, len(tasks))
		taskSet := map[string]bool{}
		for _, task := range tasks {
			switch task.Status {
			case model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled:
			default:
				return BadAuthRequest("这批图片仍在处理中，请完成后再删除")
			}
			taskIDs = append(taskIDs, task.ID)
			taskSet[task.ID] = true
		}
		assets, err := repo.Assets(userID)
		if err != nil {
			return err
		}
		for _, asset := range assets {
			var payload struct {
				Metadata struct {
					TaskID string `json:"taskId"`
				} `json:"metadata"`
			}
			if json.Unmarshal([]byte(asset.PayloadJSON), &payload) == nil && taskSet[payload.Metadata.TaskID] {
				assetIDs = append(assetIDs, asset.ID)
			}
		}
		// Remove this batch's own references inside the transaction before checking
		// remaining canvas, project and task references. A conflict rolls back all rows.
		if err := repo.DeleteTerminalTasks(userID, taskIDs); err != nil {
			return err
		}
		if len(assetIDs) > 0 {
			if err := s.deleteUserAssetsWithResources(userID, assetIDs, false, repo); err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil && len(assetIDs) > 0 {
		s.runWorkerTask(func() { s.drainResourceDeletionJobs(1000) })
	}
	return assetIDs, err
}

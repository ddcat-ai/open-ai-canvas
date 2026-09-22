package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

// A deleted canvas/project must not be resurrected by an old download worker.
func (s *Service) mediaTaskProject(task *model.Task) (string, error) {
	id := task.ProjectID
	if id == "" {
		return "", nil
	}
	canvas, err := s.repo.CanvasProjectForUser(task.UserID, id)
	if err == nil {
		id = canvas.ProjectID
		if id == "" {
			return "", nil
		}
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	project, err := s.repo.ProjectForUser(task.UserID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", NotFound("任务所属画布或项目已不存在")
	}
	if err != nil {
		return "", err
	}
	if project.Status == model.ProjectStatusArchived {
		return "", BadAuthRequest("项目已归档，无法恢复作品")
	}
	return project.ID, nil
}

// Uses the same effect key and ID as browser materialization, so reconnecting
// the canvas cannot create a second asset for a server-delivered output.
func (s *Service) registerRecoveredMediaAssets(task model.Task) error {
	projectID, err := s.mediaTaskProject(&task)
	if err != nil {
		return err
	}
	checkpoint, err := s.decodeMediaCheckpoint(&task)
	if err != nil {
		return err
	}
	representations, err := s.repo.AssetRepresentationsForTask(task.ID)
	if err != nil {
		return err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	for index, item := range checkpoint.Items {
		registered := false
		for _, representation := range representations {
			if representation.ResourceID == item.ResourceID && representation.AssetVersionID != "" {
				registered = true
				break
			}
		}
		if registered {
			continue
		}
		resource, err := s.repo.ResourceForUser(task.UserID, item.ResourceID)
		if err != nil {
			return err
		}
		if resource.Status != model.ResourceStatusReady {
			return errors.New("作品文件尚未保存完成")
		}
		effectKey := fmt.Sprintf("materialize:%s:%d", task.ID, index)
		sum := sha256.Sum256([]byte(effectKey))
		assetID := "generation_" + hex.EncodeToString(sum[:])
		// Preserve existing user edits on replay; the deterministic key is unique.
		if _, err := s.repo.AssetForUser(task.UserID, assetID); err == nil {
			continue
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		now := time.Now()
		url := resourceFileURL(resource.ID)
		data := map[string]any{"storageKey": "resource:" + resource.ID, "mimeType": resource.MimeType, "bytes": resource.Size, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs}
		if checkpoint.Mode == "image" {
			data["dataUrl"] = url
		} else {
			data["url"] = url
		}
		title := "生成作品"
		metadata := map[string]any{"source": "generation-task", "generationEffectKey": effectKey, "taskId": task.ID, "outputIndex": index}
		if projectID != "" {
			metadata["projectIds"] = []string{projectID}
		}
		payload, err := json.Marshal(map[string]any{"id": assetID, "kind": checkpoint.Mode, "category": model.AssetCategoryMaterial, "status": model.AssetVersionStatusConfirmed, "title": title, "coverUrl": url, "tags": []string{"生成"}, "createdAt": now.UTC().Format(time.RFC3339Nano), "updatedAt": now.UTC().Format(time.RFC3339Nano), "data": data, "metadata": metadata})
		if err != nil {
			return err
		}
		usage, err := s.repo.UserStorageUsage(task.UserID)
		if err != nil {
			return err
		}
		if err := validateStructuredStorageQuotaWithPolicy(usage, "asset", true, int64(len(payload)), policy.Resource); err != nil {
			return err
		}
		asset := &model.Asset{ID: assetID, UserID: task.UserID, Kind: checkpoint.Mode, Category: model.AssetCategoryMaterial, Status: model.AssetVersionStatusConfirmed, Title: title, PayloadJSON: string(payload), CreatedAt: now, UpdatedAt: now}
		if err := s.repo.UpsertAsset(asset); err != nil {
			return err
		}
		if projectID != "" {
			position, err := s.repo.NextProjectAssetPosition(projectID, "")
			if err != nil {
				return err
			}
			_, err = s.repo.LinkProjectAsset(asset, nil, &model.ProjectAssetLink{ID: newID(), ProjectID: projectID, AssetID: assetID, Position: position, CreatedAt: now})
			if err != nil {
				return err
			}
		}
	}
	return nil
}

package repository

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrComfyBridgeRequestOwnership = errors.New("comfy bridge request belongs to another bridge")
var ErrComfyBridgeRequestState = errors.New("comfy bridge request state conflict")

// ComfyBridgeForUser 按用户作用域读取 Bridge，避免管理接口意外越权访问其他用户的设备。
func (r *Repository) ComfyBridgeForUser(userID string, id string) (*model.ComfyBridge, error) {
	var bridge model.ComfyBridge
	if err := r.db.First(&bridge, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &bridge, nil
}
func (r *Repository) ComfyBridgesForUser(userID string) ([]model.ComfyBridge, error) {
	var bridges []model.ComfyBridge
	// 已撤销的 Bridge 仍保留数据库记录用于审计，但不能再出现在可选设备列表中。
	err := r.db.Where("user_id = ? AND enabled = ?", userID, true).Order("created_at desc").Find(&bridges).Error
	return bridges, err
}

// ComfyBridgeByTokenHash 只返回启用的 Bridge。Token 明文不会进入数据库查询或日志。
func (r *Repository) ComfyBridgeByTokenHash(tokenHash string) (*model.ComfyBridge, error) {
	var bridge model.ComfyBridge
	if err := r.db.First(&bridge, "token_hash = ? AND enabled = ?", tokenHash, true).Error; err != nil {
		return nil, err
	}
	return &bridge, nil
}

func (r *Repository) DisableComfyBridge(userID string, id string, now time.Time) error {
	result := r.db.Model(&model.ComfyBridge{}).
		Where("id = ? AND user_id = ? AND enabled = ?", id, userID, true).
		Updates(map[string]any{"enabled": false, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) TouchComfyBridge(id string, now time.Time) error {
	result := r.db.Model(&model.ComfyBridge{}).Where("id = ? AND enabled = ?", id, true).
		Updates(map[string]any{"last_seen_at": now, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) UpdateComfyBridgeHeartbeat(id string, capabilitiesJSON string, now time.Time) error {
	updates := map[string]any{"last_seen_at": now, "updated_at": now}
	if capabilitiesJSON != "" {
		updates["capabilities_json"] = capabilitiesJSON
	}
	result := r.db.Model(&model.ComfyBridge{}).Where("id = ? AND enabled = ?", id, true).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) MarkComfyBridgeTask(id string, now time.Time) error {
	result := r.db.Model(&model.ComfyBridge{}).Where("id = ? AND enabled = ?", id, true).
		Updates(map[string]any{"last_task_at": now, "last_seen_at": now, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) CreateOrGetComfyBridgeRequest(request *model.ComfyBridgeRequest) (*model.ComfyBridgeRequest, bool, error) {
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(request)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 1 {
		return request, true, nil
	}
	var existing model.ComfyBridgeRequest
	if err := r.db.First(&existing, "id = ?", request.ID).Error; err != nil {
		return nil, false, err
	}
	return &existing, false, nil
}

func (r *Repository) ComfyBridgeRequest(id string) (*model.ComfyBridgeRequest, error) {
	var request model.ComfyBridgeRequest
	if err := r.db.First(&request, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &request, nil
}

func (r *Repository) PendingComfyBridgeRequestCount(bridgeID string, now time.Time) (int64, error) {
	var count int64
	err := r.db.Model(&model.ComfyBridgeRequest{}).
		Where("bridge_id = ? AND status IN ? AND expires_at > ?", bridgeID, []string{"queued", "claimed"}, now).
		Count(&count).Error
	return count, err
}

// ClaimNextComfyBridgeRequest 以数据库状态机为队列真相，后端重启后仍可继续投递未领取请求。
func (r *Repository) ClaimNextComfyBridgeRequest(bridgeID string, now time.Time) (*model.ComfyBridgeRequest, error) {
	var request model.ComfyBridgeRequest
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.ComfyBridgeRequest{}).
			Where("status IN ? AND expires_at <= ?", []string{"queued", "claimed"}, now).
			Updates(map[string]any{"status": "failed", "error": "本地 ComfyUI Bridge 请求已过期", "completed_at": now, "updated_at": now}).Error; err != nil {
			return err
		}
		query := tx.Where("bridge_id = ? AND status = ? AND expires_at > ?", bridgeID, "queued", now).
			Order("created_at asc").Limit(1)
		if r.Dialect() == "postgres" {
			query = query.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"})
		}
		result := query.Find(&request)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			request = model.ComfyBridgeRequest{}
			return nil
		}
		updated := tx.Model(&model.ComfyBridgeRequest{}).
			Where("id = ? AND status = ?", request.ID, "queued").
			Updates(map[string]any{"status": "claimed", "claimed_at": now, "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			request = model.ComfyBridgeRequest{}
			return nil
		}
		return tx.First(&request, "id = ?", request.ID).Error
	})
	if err != nil || request.ID == "" {
		return nil, err
	}
	return &request, nil
}

// completeRequestTx 在既有事务内完成一条 Bridge 请求；返回 false 表示终态命中（幂等跳过）。
func completeRequestTx(tx *gorm.DB, bridgeID string, id string, status string, resultJSON string, errorText string, now time.Time, request *model.ComfyBridgeRequest) (bool, error) {
	if err := tx.First(request, "id = ?", id).Error; err != nil {
		return false, err
	}
	if request.BridgeID != bridgeID {
		return false, ErrComfyBridgeRequestOwnership
	}
	// 幂等：终态请求重复回调直接跳过，避免重复落资产
	if request.Status == "succeeded" || request.Status == "failed" || request.Status == "cancelled" {
		return false, nil
	}
	if request.Status != "claimed" {
		return false, ErrComfyBridgeRequestState
	}
	if err := tx.Model(&model.ComfyBridgeRequest{}).Where("id = ? AND status = ?", id, "claimed").Updates(map[string]any{
		"status": status, "result_json": resultJSON, "error": errorText, "completed_at": now, "updated_at": now,
	}).Error; err != nil {
		return false, err
	}
	return true, tx.First(request, "id = ?", id).Error
}

func (r *Repository) CompleteComfyBridgeRequest(bridgeID string, id string, status string, resultJSON string, errorText string, now time.Time) (*model.ComfyBridgeRequest, error) {
	var request model.ComfyBridgeRequest
	err := r.db.Transaction(func(tx *gorm.DB) error {
		_, err := completeRequestTx(tx, bridgeID, id, status, resultJSON, errorText, now, &request)
		return err
	})
	return &request, err
}

// CompleteComfyBridgeRequestWithAssets 是影策 2.0 任务链的完成入口（W1-01 / D-024）：
// 请求状态更新、产物落库、分镜最新指针回写在同一事务内完成。
//
// D-026 并轨：产物落进既有的 shot_artifacts，而不是初版方案里新建的 output_assets。
// 以 (request_id, asset_index) 为幂等键，Bridge 重复回调不会重复入库。
//
// 只有当请求带 ShotID 且能解析出 Shot 时才落产物——画布自由生成没有分镜上下文，
// 此时只回写最新 Job 指针，不阻断任务完成。
//
// 幂等为什么不走 clause.OnConflict：唯一索引是**部分索引**（WHERE request_id <> ''），
// SQLite 不接受部分索引作为 UPSERT 冲突目标；这里按幂等键先查一次，语义等价且跨库通用。
func (r *Repository) CompleteComfyBridgeRequestWithAssets(bridgeID string, id string, status string, resultJSON string, errorText string, now time.Time, outputs []model.BridgeOutputAsset) (*model.ComfyBridgeRequest, bool, error) {
	var request model.ComfyBridgeRequest
	applied := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		ok, err := completeRequestTx(tx, bridgeID, id, status, resultJSON, errorText, now, &request)
		applied = ok
		if err != nil || !ok {
			return err
		}
		if request.ShotID == "" || len(outputs) == 0 {
			return updateShotLatestPointers(tx, request.ShotID, request.GenerationTaskID, id, "", now)
		}
		var shot model.Shot
		if err := tx.First(&shot, "id = ?", request.ShotID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return updateShotLatestPointers(tx, request.ShotID, request.GenerationTaskID, id, "", now)
			}
			return err
		}
		latestArtifactID := ""
		for index, output := range outputs {
			var existing model.ShotArtifact
			err := tx.Select("id").Where("request_id = ? AND asset_index = ?", id, index).First(&existing).Error
			if err == nil {
				latestArtifactID = existing.ID
				continue
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			artifactType := strings.TrimSpace(output.AssetType)
			if artifactType == "" {
				artifactType = "video"
			}
			version, err := nextShotArtifactVersion(tx, shot.ID, artifactType)
			if err != nil {
				return err
			}
			metadata, _ := json.Marshal(map[string]any{
				"storageUri": output.StorageURI,
				"previewUri": output.PreviewURI,
				"mime":       output.Mime,
				"fps":        output.FPS,
				"provider":   output.Provider,
			})
			// D-034：Bridge 完成只代表「文件生成成功」，Resource 尚未登记
			// （真实导入与 Resource 注册归 W3-01），因此这里是 pending_resource 而非 ready。
			// 产物仍可被选中预览——StorageURI 存在 MetadataJSON 里，前端直接用它显示，
			// 不依赖 Resource 是否存在。
			artifact := model.ShotArtifact{
				ID:           repositoryID(),
				ProjectID:    shot.ProjectID,
				UnitID:       shot.UnitID,
				ShotID:       shot.ID,
				RevisionID:   shot.CurrentRevisionID,
				TaskID:       request.GenerationTaskID,
				Type:         artifactType,
				Version:      version,
				Status:       model.ShotArtifactStatusPendingResource,
				Selected:     true,
				MetadataJSON: string(metadata),
				RequestID:    id,
				AssetIndex:   index,
				Checksum:     output.Checksum,
				FileSize:     output.FileSize,
				Provider:     output.Provider,
				DurationMs:   output.DurationMs,
				Width:        output.Width,
				Height:       output.Height,
				CreatedAt:    now,
				UpdatedAt:    now,
			}
			if err := tx.Create(&artifact).Error; err != nil {
				return err
			}
			latestArtifactID = artifact.ID
		}
		return updateShotLatestPointers(tx, shot.ID, request.GenerationTaskID, id, latestArtifactID, now)
	})
	return &request, applied, err
}

// updateShotLatestPointers 回写分镜的最新任务/Job/产物指针（纯加速字段，见 Shot 模型注释）。
func updateShotLatestPointers(tx *gorm.DB, shotID string, taskID string, jobID string, artifactID string, now time.Time) error {
	if shotID == "" {
		return nil
	}
	updates := map[string]any{"updated_at": now}
	if taskID != "" {
		updates["latest_task_id"] = taskID
	}
	if jobID != "" {
		updates["latest_job_id"] = jobID
	}
	if artifactID != "" {
		updates["latest_artifact_id"] = artifactID
	}
	return tx.Model(&model.Shot{}).Where("id = ?", shotID).Updates(updates).Error
}

// nextShotArtifactVersion 取 (shot_id, type) 的下一个版本号，保证同类型产物版本递增不撞唯一约束。
func nextShotArtifactVersion(tx *gorm.DB, shotID string, artifactType string) (int, error) {
	var current int
	if err := tx.Model(&model.ShotArtifact{}).
		Where("shot_id = ? AND type = ?", shotID, artifactType).
		Select("COALESCE(MAX(version), 0)").Scan(&current).Error; err != nil {
		return 0, err
	}
	return current + 1, nil
}

// repositoryID 生成 32 位十六进制 ID，与 service.newID 同规格（仓库层此前不自己造 ID）。
func repositoryID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b[:])
}

func (r *Repository) CancelComfyBridgeRequest(id string, now time.Time) error {
	return r.db.Model(&model.ComfyBridgeRequest{}).
		Where("id = ? AND status IN ?", id, []string{"queued", "claimed"}).
		Updates(map[string]any{"status": "cancelled", "error": "任务已取消", "completed_at": now, "updated_at": now}).Error
}

func (r *Repository) FailComfyBridgeRequests(bridgeID string, errorText string, now time.Time) error {
	return r.db.Model(&model.ComfyBridgeRequest{}).
		Where("bridge_id = ? AND status IN ?", bridgeID, []string{"queued", "claimed"}).
		Updates(map[string]any{"status": "failed", "error": errorText, "completed_at": now, "updated_at": now}).Error
}

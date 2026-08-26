package repository

import (
	"errors"
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

func (r *Repository) CompleteComfyBridgeRequest(bridgeID string, id string, status string, resultJSON string, errorText string, now time.Time) (*model.ComfyBridgeRequest, error) {
	var request model.ComfyBridgeRequest
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&request, "id = ?", id).Error; err != nil {
			return err
		}
		if request.BridgeID != bridgeID {
			return ErrComfyBridgeRequestOwnership
		}
		if request.Status == "succeeded" || request.Status == "failed" || request.Status == "cancelled" {
			return nil
		}
		if request.Status != "claimed" {
			return ErrComfyBridgeRequestState
		}
		if err := tx.Model(&model.ComfyBridgeRequest{}).Where("id = ? AND status = ?", id, "claimed").Updates(map[string]any{
			"status": status, "result_json": resultJSON, "error": errorText, "completed_at": now, "updated_at": now,
		}).Error; err != nil {
			return err
		}
		return tx.First(&request, "id = ?", id).Error
	})
	return &request, err
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

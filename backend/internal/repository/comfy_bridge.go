package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

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

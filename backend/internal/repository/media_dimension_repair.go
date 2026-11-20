package repository

import (
	"time"

	"yingce/backend/internal/model"
)

// 媒体尺寸补探测的持久化：资源行只在尺寸仍未知时写入，素材文档以读取时的 payload 做 CAS，
// 两者重复执行都是幂等的，并发的用户编辑不会被覆盖。

// UpdateUnknownResourceDimensions 只为尺寸仍未知（≤0）的就绪资源写入探测到的宽高。
func (r *Repository) UpdateUnknownResourceDimensions(userID string, id string, width int, height int) (bool, error) {
	result := r.db.Model(&model.Resource{}).
		Where("id = ? AND user_id = ? AND status = ? AND (width <= 0 OR height <= 0)", id, userID, model.ResourceStatusReady).
		Updates(map[string]any{"width": width, "height": height})
	return result.RowsAffected == 1, result.Error
}

// UnknownDimensionLocalVideoResources 按 ID 游标返回本地存储中尺寸未知的就绪视频资源，供有界回填分批处理。
func (r *Repository) UnknownDimensionLocalVideoResources(afterID string, limit int) ([]model.Resource, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	var resources []model.Resource
	err := r.db.Where("id > ? AND status = ? AND provider = ? AND mime_type LIKE ? AND (width <= 0 OR height <= 0)", afterID, model.ResourceStatusReady, "local", "video/%").
		Order("id asc").Limit(limit).Find(&resources).Error
	return resources, err
}

// UserMediaAssetsMentioning 返回当前用户 payload 中出现该存储键的图片/视频素材；
// LIKE 只做粗筛，调用方必须再按 data.storageKey 精确匹配。
func (r *Repository) UserMediaAssetsMentioning(userID string, storageKey string, limit int) ([]model.Asset, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	var assets []model.Asset
	err := r.db.Where("user_id = ? AND kind IN ? AND payload_json LIKE ?", userID, []string{"image", "video"}, "%\""+storageKey+"\"%").
		Order("id asc").Limit(limit).Find(&assets).Error
	return assets, err
}

// ReplaceAssetPayloadIfUnchanged 仅当素材文档仍是读取时的内容才写入新文档。
func (r *Repository) ReplaceAssetPayloadIfUnchanged(asset *model.Asset, payloadJSON string, updatedAt time.Time) (bool, error) {
	result := r.db.Model(&model.Asset{}).
		Where("id = ? AND user_id = ? AND payload_json = ?", asset.ID, asset.UserID, asset.PayloadJSON).
		Updates(map[string]any{"payload_json": payloadJSON, "updated_at": updatedAt})
	return result.RowsAffected == 1, result.Error
}

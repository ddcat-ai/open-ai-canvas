package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

// LockCanvasMutation serializes all operations for an existing canvas, including
// deletion. On SQLite this first write also avoids a deferred read transaction
// trying to upgrade its stale snapshot to a write lock.
func (r *Repository) LockCanvasMutation(userID, canvasID string) error {
	return r.db.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ?", canvasID, userID).
		UpdateColumn("revision", gorm.Expr("revision")).Error
}

func (r *Repository) CanvasMutationReceiptForUser(userID, canvasID, mutationID string) (*model.CanvasMutationReceipt, error) {
	var receipt model.CanvasMutationReceipt
	err := r.db.First(&receipt, "user_id = ? AND canvas_id = ? AND mutation_id = ?", userID, canvasID, mutationID).Error
	return &receipt, err
}

func (r *Repository) TryCreateCanvasMutationReceipt(receipt *model.CanvasMutationReceipt) (bool, error) {
	if receipt.CreatedAt.IsZero() {
		receipt.CreatedAt = time.Now().UTC()
	}
	result := r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "canvas_id"}, {Name: "mutation_id"}}, DoNothing: true}).Create(receipt)
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) FinalizeCanvasMutationReceipt(receipt *model.CanvasMutationReceipt) error {
	if receipt.ResultJSON == "" {
		return errors.New("canvas mutation receipt requires a committed result")
	}
	result := r.db.Model(&model.CanvasMutationReceipt{}).Where("id = ? AND payload_digest = ?", receipt.ID, receipt.PayloadDigest).
		Updates(map[string]any{"result_json": receipt.ResultJSON, "revision": receipt.Revision})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return errors.New("canvas mutation receipt was not finalized")
	}
	return nil
}

// DeleteCanvasMutationReceiptsBefore 分批删除过期回执，每批独立提交，避免首次清理积压数据时长时间持有锁。
// 回执只服务于响应丢失后的短期重放；过期后重放的请求按字段/对象基线校验，已生效的操作返回冲突或成为空操作。
func (r *Repository) DeleteCanvasMutationReceiptsBefore(cutoff time.Time, batchSize int) (int64, error) {
	if batchSize <= 0 {
		batchSize = 1000
	}
	var total int64
	for {
		expired := r.db.Model(&model.CanvasMutationReceipt{}).Select("id").Where("created_at < ?", cutoff).Order("created_at").Limit(batchSize)
		result := r.db.Where("id IN (?)", expired).Delete(&model.CanvasMutationReceipt{})
		if result.Error != nil {
			return total, result.Error
		}
		total += result.RowsAffected
		if result.RowsAffected < int64(batchSize) {
			return total, nil
		}
	}
}

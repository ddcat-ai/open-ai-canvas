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

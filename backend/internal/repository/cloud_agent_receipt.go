package repository

import (
	"fmt"
	"infinite-canvas/backend/internal/model"
)

const CloudAgentReceiptContentLimit = 128 << 10

func (r *Repository) CloudAgentReceipt(userID, runID, kind, key string) (*model.CloudAgentReceipt, error) {
	var receipt model.CloudAgentReceipt
	err := r.db.Where("user_id = ? AND run_id = ? AND kind = ? AND operation_key = ?", userID, runID, kind, key).First(&receipt).Error
	return &receipt, err
}

// SaveCloudAgentReceipt is called inside the run mutation transaction.
func (r *Repository) SaveCloudAgentReceipt(receipt *model.CloudAgentReceipt) error {
	if receipt == nil || receipt.RunID == "" || receipt.UserID == "" || receipt.Kind == "" || receipt.OperationKey == "" || len(receipt.OperationKey) > 160 || len(receipt.Content) > CloudAgentReceiptContentLimit {
		return fmt.Errorf("invalid or oversized Agent receipt")
	}
	return r.db.Save(receipt).Error
}

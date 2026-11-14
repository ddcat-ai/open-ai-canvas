package repository

import (
	"bytes"
	"encoding/json"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/imagebilling"
	"yingce/backend/internal/model"
)

// RecordImageBillingUsage persists provider evidence before media downloads.
func (r *Repository) RecordImageBillingUsage(id string, usage *model.ImageBillingUsage) error {
	if err := imagebilling.ValidateUsage(usage); err != nil {
		return err
	}
	raw, err := json.Marshal(usage)
	if err != nil {
		return err
	}
	return r.db.Transaction(func(tx *gorm.DB) error {
		var order model.BillingOrder
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", id).Error; err != nil {
			return err
		}
		if order.ImageUsage != nil {
			previous, err := json.Marshal(order.ImageUsage)
			if err != nil {
				return err
			}
			if !bytes.Equal(raw, previous) {
				return errors.New("图片用量与已记录用量不一致，需人工核对")
			}
			return nil
		}
		if order.Status != model.BillingStatusReserved && order.Status != model.BillingStatusRunning && order.Status != model.BillingStatusUncertain {
			return errors.New("当前订单状态不允许记录图片用量")
		}
		return updateBillingOrderState(tx, order, map[string]any{"image_usage": string(raw), "usage_available": true, "usage_source": usage.Source, "updated_at": time.Now()})
	})
}

func settleImageBillingOrder(tx *gorm.DB, order model.BillingOrder, providerRequestID string) error {
	actual, err := imagebilling.Amount(order.ImagePricing, order.ImageUsage, order.MultiplierBasisPoints)
	if err != nil {
		return err
	}
	reserved := order.ReservedAmountMicrocredits
	if reserved == 0 {
		reserved = order.AmountMicrocredits
	}
	if actual > reserved || (billingChargeLimitApplies(order) && actual > order.ChargeLimitMicrocredits) || int64(len(order.ImageUsage.Outputs)) > order.ImageMaxOutputImages || order.ImageUsage.InputImages > order.ImageInputImages {
		return errors.New("图片实际费用或用量超过本次预留上限，需人工核对")
	}
	refund := reserved - actual
	updated := tx.Model(&model.CreditAccount{}).
		Where("user_id = ? AND reserved_microcredits >= ?", order.UserID, reserved).
		Updates(map[string]any{"available_microcredits": gorm.Expr("available_microcredits + ?", refund), "reserved_microcredits": gorm.Expr("reserved_microcredits - ?", reserved), "version": gorm.Expr("version + 1"), "updated_at": time.Now()})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return errors.New("预留积分不足以完成图片结算")
	}
	var account model.CreditAccount
	if err := tx.First(&account, "user_id = ?", order.UserID).Error; err != nil {
		return err
	}
	now := time.Now()
	updates := map[string]any{"status": model.BillingStatusSettled, "quantity": len(order.ImageUsage.Outputs), "actual_amount_microcredits": actual, "refunded_amount_microcredits": refund, "settled_at": &now, "updated_at": now}
	if providerRequestID != "" {
		updates["provider_request_id"] = providerRequestID
	}
	if err := updateBillingOrderState(tx, order, updates); err != nil {
		return err
	}
	if err := tx.Create(&model.CreditLedgerEntry{ID: newRepositoryID(), UserID: order.UserID, Type: model.CreditLedgerConsume, AmountMicrocredits: -actual, ReservedDeltaMicrocredits: -reserved, AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits, BillingOrderID: order.ID, Model: order.Model, ChannelID: order.ChannelID, Scene: order.Scene, Note: "图片按实际输入张数及逐张输出像素结算"}).Error; err != nil {
		return err
	}
	if refund > 0 {
		return tx.Create(&model.CreditLedgerEntry{ID: newRepositoryID(), UserID: order.UserID, Type: model.CreditLedgerRefund, AmountMicrocredits: refund, AvailableDeltaMicrocredits: refund, AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits, BillingOrderID: order.ID, Model: order.Model, ChannelID: order.ChannelID, Scene: order.Scene, Note: "图片实际费用低于预留，差额退回"}).Error
	}
	return nil
}

package repository

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var ErrRechargeOrderStateConflict = errors.New("recharge order state changed concurrently")
var ErrRechargePaymentMismatch = errors.New("recharge payment does not match the order snapshot")

func (r *Repository) ListEnabledCreditPackages() ([]model.CreditPackage, error) {
	var items []model.CreditPackage
	err := r.db.Where("enabled = ? AND archived_at IS NULL", true).
		Order("sort_order ASC, amount_fen ASC, created_at ASC").Find(&items).Error
	return items, err
}

func (r *Repository) ListCreditPackages(includeArchived bool) ([]model.CreditPackage, error) {
	var items []model.CreditPackage
	query := r.db.Model(&model.CreditPackage{})
	if !includeArchived {
		query = query.Where("archived_at IS NULL")
	}
	err := query.Order("sort_order ASC, created_at DESC").Find(&items).Error
	return items, err
}

func (r *Repository) CreditPackage(id string) (*model.CreditPackage, error) {
	var item model.CreditPackage
	if err := r.db.First(&item, "id = ? AND archived_at IS NULL", strings.TrimSpace(id)).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) CreateCreditPackage(item *model.CreditPackage) error {
	if item.ID == "" {
		item.ID = newRepositoryID()
	}
	if item.Version <= 0 {
		item.Version = 1
	}
	return r.db.Create(item).Error
}

func (r *Repository) UpdateCreditPackage(item model.CreditPackage, expectedVersion int64) (bool, error) {
	now := time.Now().UTC()
	result := r.db.Model(&model.CreditPackage{}).
		Where("id = ? AND version = ? AND archived_at IS NULL", item.ID, expectedVersion).
		Updates(map[string]any{
			"name": item.Name, "description": item.Description, "currency": item.Currency,
			"amount_fen": item.AmountFen, "base_microcredits": item.BaseMicrocredits,
			"bonus_microcredits": item.BonusMicrocredits, "enabled": item.Enabled,
			"sort_order": item.SortOrder, "updated_by": item.UpdatedBy,
			"version": gorm.Expr("version + 1"), "updated_at": now,
		})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) ArchiveCreditPackage(id string, actorUserID string) (bool, error) {
	now := time.Now().UTC()
	result := r.db.Model(&model.CreditPackage{}).Where("id = ? AND archived_at IS NULL", id).
		Updates(map[string]any{"enabled": false, "archived_at": now, "updated_at": now, "updated_by": actorUserID, "version": gorm.Expr("version + 1")})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) ListEnabledPaymentChannels() ([]model.PaymentChannel, error) {
	var items []model.PaymentChannel
	err := r.db.Where("enabled = ? AND archived_at IS NULL AND active_config_version_id <> ''", true).
		Order("sort_order ASC, created_at ASC").Find(&items).Error
	return items, err
}

func (r *Repository) ListPaymentChannels(includeArchived bool) ([]model.PaymentChannel, error) {
	var items []model.PaymentChannel
	query := r.db.Model(&model.PaymentChannel{})
	if !includeArchived {
		query = query.Where("archived_at IS NULL")
	}
	err := query.Order("sort_order ASC, created_at DESC").Find(&items).Error
	return items, err
}

func (r *Repository) PaymentChannel(id string) (*model.PaymentChannel, error) {
	var item model.PaymentChannel
	if err := r.db.First(&item, "id = ? AND archived_at IS NULL", strings.TrimSpace(id)).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) PaymentChannelIncludingArchived(id string) (*model.PaymentChannel, error) {
	var item model.PaymentChannel
	if err := r.db.First(&item, "id = ?", strings.TrimSpace(id)).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) PaymentReconciliationRun(id string) (*model.PaymentReconciliationRun, error) {
	var item model.PaymentReconciliationRun
	if err := r.db.First(&item, "id = ?", strings.TrimSpace(id)).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) CreatePaymentChannel(item *model.PaymentChannel) error {
	if item.ID == "" {
		item.ID = newRepositoryID()
	}
	return r.db.Create(item).Error
}

func (r *Repository) UpdatePaymentChannel(item model.PaymentChannel) (bool, error) {
	result := r.db.Model(&model.PaymentChannel{}).Where("id = ? AND archived_at IS NULL", item.ID).
		Updates(map[string]any{
			"name": item.Name, "description": item.Description, "enabled": item.Enabled,
			"sort_order": item.SortOrder, "updated_by": item.UpdatedBy, "updated_at": time.Now().UTC(),
		})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) SetPaymentChannelTestResult(id string, status string, testError string, digest string, actorUserID string) error {
	now := time.Now().UTC()
	return r.db.Model(&model.PaymentChannel{}).Where("id = ? AND archived_at IS NULL", id).Updates(map[string]any{
		"last_test_status": status, "last_test_error": testError, "last_test_config_digest": digest,
		"last_tested_at": now, "updated_by": actorUserID, "updated_at": now,
	}).Error
}

func (r *Repository) ArchivePaymentChannel(id string, actorUserID string) (bool, error) {
	now := time.Now().UTC()
	result := r.db.Model(&model.PaymentChannel{}).Where("id = ? AND archived_at IS NULL", id).
		Updates(map[string]any{"enabled": false, "archived_at": now, "updated_at": now, "updated_by": actorUserID})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) CreatePaymentChannelConfigVersion(channelID string, configCipher string, configDigest string, actorUserID string) (*model.PaymentChannelConfigVersion, error) {
	var created model.PaymentChannelConfigVersion
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var channel model.PaymentChannel
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&channel, "id = ? AND archived_at IS NULL", channelID).Error; err != nil {
			return err
		}
		var version int64
		if err := tx.Model(&model.PaymentChannelConfigVersion{}).Where("channel_id = ?", channelID).
			Select("COALESCE(MAX(version), 0)").Scan(&version).Error; err != nil {
			return err
		}
		created = model.PaymentChannelConfigVersion{
			ID: newRepositoryID(), ChannelID: channelID, Version: version + 1,
			ConfigCipher: configCipher, ConfigDigest: configDigest, CreatedBy: actorUserID,
		}
		if err := tx.Create(&created).Error; err != nil {
			return err
		}
		return tx.Model(&model.PaymentChannel{}).Where("id = ?", channelID).Updates(map[string]any{
			"active_config_version_id": created.ID, "enabled": false,
			"last_test_status": "", "last_test_error": "", "last_test_config_digest": "",
			"updated_by": actorUserID, "updated_at": time.Now().UTC(),
		}).Error
	})
	if err != nil {
		return nil, err
	}
	return &created, nil
}

func (r *Repository) PaymentChannelConfigVersion(id string) (*model.PaymentChannelConfigVersion, error) {
	var item model.PaymentChannelConfigVersion
	if err := r.db.First(&item, "id = ?", strings.TrimSpace(id)).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) ListPaymentChannelConfigVersions(channelID string) ([]model.PaymentChannelConfigVersion, error) {
	var items []model.PaymentChannelConfigVersion
	err := r.db.Where("channel_id = ?", channelID).Order("version DESC").Find(&items).Error
	return items, err
}

func (r *Repository) CreateRechargeOrder(item *model.CreditRechargeOrder) (*model.CreditRechargeOrder, bool, error) {
	if item.ID == "" {
		item.ID = newRepositoryID()
	}
	result := r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "user_id"}, {Name: "idempotency_key"}}, DoNothing: true}).Create(item)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 1 {
		return item, true, nil
	}
	var existing model.CreditRechargeOrder
	if err := r.db.First(&existing, "user_id = ? AND idempotency_key = ?", item.UserID, item.IdempotencyKey).Error; err != nil {
		return nil, false, err
	}
	return &existing, false, nil
}

func (r *Repository) RechargeOrder(id string) (*model.CreditRechargeOrder, error) {
	var item model.CreditRechargeOrder
	if err := r.db.First(&item, "id = ?", strings.TrimSpace(id)).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) UserRechargeOrder(userID string, id string) (*model.CreditRechargeOrder, error) {
	var item model.CreditRechargeOrder
	if err := r.db.First(&item, "id = ? AND user_id = ?", strings.TrimSpace(id), userID).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) ListUserRechargeOrders(userID string, limit int, offset int) ([]model.CreditRechargeOrder, int64, error) {
	var items []model.CreditRechargeOrder
	var total int64
	query := r.db.Model(&model.CreditRechargeOrder{}).Where("user_id = ?", userID)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) ListRechargeOrders(status string, userID string, channelID string, limit int, offset int) ([]model.CreditRechargeOrder, int64, error) {
	var items []model.CreditRechargeOrder
	var total int64
	query := r.db.Model(&model.CreditRechargeOrder{})
	if status = strings.TrimSpace(status); status != "" {
		query = query.Where("status = ?", status)
	}
	if userID = strings.TrimSpace(userID); userID != "" {
		query = query.Where("user_id = ?", userID)
	}
	if channelID = strings.TrimSpace(channelID); channelID != "" {
		query = query.Where("channel_id = ?", channelID)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) ClaimRechargePrepay(id string) (bool, error) {
	result := r.db.Model(&model.CreditRechargeOrder{}).
		Where("id = ? AND status IN ?", id, []model.CreditRechargeOrderStatus{model.CreditRechargeOrderCreated, model.CreditRechargeOrderPrepayUncertain}).
		Updates(map[string]any{"status": model.CreditRechargeOrderPrepayRunning, "failure_code": "", "failure_message": "", "updated_at": time.Now().UTC()})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) CompleteRechargePrepay(id string, prepayID string, payPayloadCipher string, expiresAt time.Time) (bool, error) {
	now := time.Now().UTC()
	result := r.db.Model(&model.CreditRechargeOrder{}).
		Where("id = ? AND status = ?", id, model.CreditRechargeOrderPrepayRunning).
		Updates(map[string]any{
			"status": model.CreditRechargeOrderAwaitingPayment, "prepay_id": prepayID,
			"pay_payload_cipher": payPayloadCipher, "expires_at": expiresAt, "next_query_at": now.Add(15 * time.Second), "updated_at": now,
		})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) FailRechargePrepay(id string, uncertain bool, code string, message string) error {
	status := model.CreditRechargeOrderFailed
	if uncertain {
		status = model.CreditRechargeOrderPrepayUncertain
	}
	return r.db.Model(&model.CreditRechargeOrder{}).Where("id = ? AND status = ?", id, model.CreditRechargeOrderPrepayRunning).
		Updates(map[string]any{"status": status, "failure_code": code, "failure_message": message, "updated_at": time.Now().UTC()}).Error
}

func (r *Repository) MarkRechargeQuery(id string, providerState string, nextQueryAt *time.Time) error {
	now := time.Now().UTC()
	return r.db.Model(&model.CreditRechargeOrder{}).
		Where("id = ? AND status IN ?", id, []model.CreditRechargeOrderStatus{
			model.CreditRechargeOrderCreated,
			model.CreditRechargeOrderPrepayRunning,
			model.CreditRechargeOrderAwaitingPayment,
			model.CreditRechargeOrderPrepayUncertain,
		}).Updates(map[string]any{
		"provider_state": providerState, "last_query_at": now, "query_attempts": gorm.Expr("query_attempts + 1"),
		"next_query_at": nextQueryAt, "updated_at": now,
	}).Error
}

func (r *Repository) CloseRechargeOrder(id string, providerState string) (bool, error) {
	now := time.Now().UTC()
	result := r.db.Model(&model.CreditRechargeOrder{}).
		Where("id = ? AND status IN ?", id, []model.CreditRechargeOrderStatus{model.CreditRechargeOrderCreated, model.CreditRechargeOrderAwaitingPayment, model.CreditRechargeOrderPrepayUncertain}).
		Updates(map[string]any{"status": model.CreditRechargeOrderClosed, "provider_state": providerState, "closed_at": now, "next_query_at": nil, "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) MarkRechargeReviewRequired(id string, code string, message string) error {
	return r.db.Model(&model.CreditRechargeOrder{}).
		Where("id = ? AND status <> ?", id, model.CreditRechargeOrderCredited).
		Updates(map[string]any{
			"status": model.CreditRechargeOrderReviewRequired, "failure_code": code,
			"failure_message": message, "next_query_at": nil, "updated_at": time.Now().UTC(),
		}).Error
}

type RechargeCreditResult struct {
	Order         model.CreditRechargeOrder
	Account       model.CreditAccount
	LedgerEntry   model.CreditLedgerEntry
	NewlyCredited bool
}

// ConfirmRechargePaid is the only path that converts a cash payment into credits.
// Its unique ledger reference makes callbacks, manual sync and reconciliation safe
// to retry, while the surrounding database transaction prevents partial crediting.
func (r *Repository) ConfirmRechargePaid(orderID string, providerTransactionID string, amountFen int64, currency string, paidAt time.Time, notificationEventID string) (*RechargeCreditResult, error) {
	var output RechargeCreditResult
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var order model.CreditRechargeOrder
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", orderID).Error; err != nil {
			return err
		}
		if amountFen != order.AmountFen || !strings.EqualFold(strings.TrimSpace(currency), strings.TrimSpace(order.Currency)) || strings.TrimSpace(providerTransactionID) == "" {
			return ErrRechargePaymentMismatch
		}
		if order.ProviderTransactionID != nil && *order.ProviderTransactionID != providerTransactionID {
			return ErrRechargePaymentMismatch
		}

		referenceKey := "credit_recharge:" + order.ID
		ledger := model.CreditLedgerEntry{
			ID: newRepositoryID(), UserID: order.UserID, Type: model.CreditLedgerRecharge,
			AmountMicrocredits: order.TotalMicrocredits, AvailableDeltaMicrocredits: order.TotalMicrocredits,
			RechargeOrderID: order.ID, ChannelID: order.ChannelID, Scene: "credit_recharge",
			Note: order.PackageName, ReferenceKey: &referenceKey,
		}
		inserted := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "reference_key"}}, DoNothing: true}).Create(&ledger)
		if inserted.Error != nil {
			return inserted.Error
		}

		if inserted.RowsAffected == 1 {
			if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.CreditAccount{UserID: order.UserID}).Error; err != nil {
				return err
			}
			if err := tx.Model(&model.CreditAccount{}).Where("user_id = ?", order.UserID).Updates(map[string]any{
				"available_microcredits": gorm.Expr("available_microcredits + ?", order.TotalMicrocredits),
				"version":                gorm.Expr("version + 1"), "updated_at": time.Now().UTC(),
			}).Error; err != nil {
				return err
			}
			output.NewlyCredited = true
		} else {
			// ledger still carries the candidate primary key from the ignored
			// insert. Query into a fresh value so GORM does not append that ID to
			// the unique reference lookup on an idempotent retry.
			var existingLedger model.CreditLedgerEntry
			if err := tx.First(&existingLedger, "reference_key = ?", referenceKey).Error; err != nil {
				return err
			}
			ledger = existingLedger
		}
		if ledger.UserID != order.UserID || ledger.AmountMicrocredits != order.TotalMicrocredits || ledger.RechargeOrderID != order.ID {
			return fmt.Errorf("recharge ledger idempotency collision")
		}

		var account model.CreditAccount
		if err := tx.First(&account, "user_id = ?", order.UserID).Error; err != nil {
			return err
		}
		if output.NewlyCredited {
			if err := tx.Model(&model.CreditLedgerEntry{}).Where("id = ?", ledger.ID).Updates(map[string]any{
				"available_after_microcredits": account.AvailableMicrocredits,
				"reserved_after_microcredits":  account.ReservedMicrocredits,
			}).Error; err != nil {
				return err
			}
			ledger.AvailableAfterMicrocredits = account.AvailableMicrocredits
			ledger.ReservedAfterMicrocredits = account.ReservedMicrocredits
		}
		now := time.Now().UTC()
		if paidAt.IsZero() {
			paidAt = now
		}
		ledgerID := ledger.ID
		txnID := providerTransactionID
		if err := tx.Model(&model.CreditRechargeOrder{}).Where("id = ?", order.ID).Updates(map[string]any{
			"status": model.CreditRechargeOrderCredited, "provider_state": "SUCCESS",
			"provider_transaction_id": &txnID, "paid_at": paidAt, "credited_at": now,
			"ledger_entry_id": &ledgerID, "next_query_at": nil, "failure_code": "", "failure_message": "", "updated_at": now,
		}).Error; err != nil {
			return err
		}
		if notificationEventID != "" {
			if err := tx.Model(&model.PaymentNotificationEvent{}).Where("id = ?", notificationEventID).Updates(map[string]any{
				"order_id": order.ID, "status": model.PaymentNotificationProcessed, "error": "", "processed_at": now,
			}).Error; err != nil {
				return err
			}
		}
		if err := tx.First(&order, "id = ?", order.ID).Error; err != nil {
			return err
		}
		output.Order, output.Account, output.LedgerEntry = order, account, ledger
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &output, nil
}

func (r *Repository) CreatePaymentNotificationEvent(item *model.PaymentNotificationEvent) (*model.PaymentNotificationEvent, bool, error) {
	if item.ID == "" {
		item.ID = newRepositoryID()
	}
	result := r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "provider"}, {Name: "event_id"}}, DoNothing: true}).Create(item)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 1 {
		return item, true, nil
	}
	var existing model.PaymentNotificationEvent
	if err := r.db.First(&existing, "provider = ? AND event_id = ?", item.Provider, item.EventID).Error; err != nil {
		return nil, false, err
	}
	return &existing, false, nil
}

func (r *Repository) FailPaymentNotificationEvent(id string, status model.PaymentNotificationStatus, eventError string) error {
	now := time.Now().UTC()
	return r.db.Model(&model.PaymentNotificationEvent{}).Where("id = ?", id).
		Updates(map[string]any{"status": status, "error": eventError, "processed_at": now}).Error
}

func (r *Repository) CreatePaymentReconciliationRun(item *model.PaymentReconciliationRun) error {
	if item.ID == "" {
		item.ID = newRepositoryID()
	}
	return r.db.Create(item).Error
}

func (r *Repository) CompletePaymentReconciliationRun(id string, status model.PaymentReconciliationStatus, providerOrderCount int64, providerAmountFen int64, localOrderCount int64, localAmountFen int64, anomalyCount int64, digest string, runError string) error {
	now := time.Now().UTC()
	return r.db.Model(&model.PaymentReconciliationRun{}).Where("id = ?", id).Updates(map[string]any{
		"status": status, "provider_order_count": providerOrderCount, "provider_amount_fen": providerAmountFen,
		"local_order_count": localOrderCount, "local_amount_fen": localAmountFen, "anomaly_count": anomalyCount,
		"statement_digest": digest, "error": runError, "completed_at": now,
	}).Error
}

func (r *Repository) CreatePaymentReconciliationAnomaly(item *model.PaymentReconciliationAnomaly) error {
	if item.ID == "" {
		item.ID = newRepositoryID()
	}
	return r.db.Create(item).Error
}

func (r *Repository) ListPaymentReconciliationRuns(channelID string, limit int, offset int) ([]model.PaymentReconciliationRun, int64, error) {
	var items []model.PaymentReconciliationRun
	var total int64
	query := r.db.Model(&model.PaymentReconciliationRun{})
	if channelID = strings.TrimSpace(channelID); channelID != "" {
		query = query.Where("channel_id = ?", channelID)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("created_at DESC").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) ListPaymentReconciliationAnomalies(runID string) ([]model.PaymentReconciliationAnomaly, error) {
	var items []model.PaymentReconciliationAnomaly
	err := r.db.Where("run_id = ?", runID).Order("created_at ASC").Find(&items).Error
	return items, err
}

func (r *Repository) ResolvePaymentReconciliationAnomaly(runID string, anomalyID string, actorUserID string, note string) (bool, error) {
	now := time.Now().UTC()
	result := r.db.Model(&model.PaymentReconciliationAnomaly{}).
		Where("id = ? AND run_id = ? AND resolved = ?", anomalyID, runID, false).
		Updates(map[string]any{
			"resolved": true, "resolved_by": actorUserID, "resolution_note": note, "resolved_at": now,
		})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) RechargeOrdersForReconciliation(channelID string, start time.Time, end time.Time) ([]model.CreditRechargeOrder, error) {
	var items []model.CreditRechargeOrder
	err := r.db.Where("channel_id = ? AND ((paid_at >= ? AND paid_at < ?) OR (paid_at IS NULL AND created_at >= ? AND created_at < ?))", channelID, start, end, start, end).
		Order("created_at ASC").Find(&items).Error
	return items, err
}

func (r *Repository) MarkRechargeReconciled(id string, reconciledAt time.Time) error {
	return r.db.Model(&model.CreditRechargeOrder{}).Where("id = ?", id).
		Update("last_reconciled_at", reconciledAt.UTC()).Error
}

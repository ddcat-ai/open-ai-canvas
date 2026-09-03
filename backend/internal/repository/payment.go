package repository

import (
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrPaymentOrderStateConflict = errors.New("payment order state conflict")
	ErrPaymentEvidenceMismatch   = errors.New("payment evidence does not match order")
	ErrPaymentTradeNoConflict    = errors.New("payment provider trade number is already used")
	ErrPaymentCreditOverflow     = errors.New("payment credit balance would overflow")
)

// Credit balances are serialized to JavaScript clients as JSON numbers.
// Keeping payment grants within Number.MAX_SAFE_INTEGER preserves exact values
// across the database, API, and wallet UI.
const maxPaymentCreditBalance int64 = 9_007_199_254_740_991

type PaymentEvidence struct {
	ProviderTradeNo string
	ProviderStatus  string
	AmountFen       int64
	Currency        string
	PaidAt          time.Time
}

func (r *Repository) TopupProducts(includeDisabled bool) ([]model.TopupProduct, error) {
	var products []model.TopupProduct
	query := r.db.Order("sort_order asc, amount_fen asc, created_at asc")
	if !includeDisabled {
		query = query.Where("enabled = ?", true)
	}
	err := query.Find(&products).Error
	return products, err
}

func (r *Repository) TopupProduct(id string) (*model.TopupProduct, error) {
	var product model.TopupProduct
	return &product, r.db.First(&product, "id = ?", strings.TrimSpace(id)).Error
}

func (r *Repository) CreateTopupProduct(product *model.TopupProduct) error {
	return r.db.Create(product).Error
}

func (r *Repository) UpdateTopupProduct(product *model.TopupProduct) error {
	return r.db.Model(&model.TopupProduct{}).Where("id = ?", product.ID).Updates(map[string]any{
		"name": product.Name, "description": product.Description, "amount_fen": product.AmountFen,
		"credits_microcredits": product.CreditsMicrocredits, "enabled": product.Enabled,
		"sort_order": product.SortOrder, "updated_by": product.UpdatedBy, "updated_at": time.Now(),
	}).Error
}

func (r *Repository) CreatePaymentProviderConfig(config *model.PaymentProviderConfig) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var latest struct{ Version int64 }
		if err := tx.Model(&model.PaymentProviderConfig{}).Select("COALESCE(MAX(version), 0) AS version").Where("provider_id = ?", config.ProviderID).Scan(&latest).Error; err != nil {
			return err
		}
		config.Version = latest.Version + 1
		return tx.Create(config).Error
	})
}

func (r *Repository) LatestPaymentProviderConfig(providerID string) (*model.PaymentProviderConfig, error) {
	var config model.PaymentProviderConfig
	err := r.db.Where("provider_id = ?", strings.TrimSpace(providerID)).Order("version desc").First(&config).Error
	return &config, err
}

func (r *Repository) PaymentProviderConfig(id string) (*model.PaymentProviderConfig, error) {
	var config model.PaymentProviderConfig
	return &config, r.db.First(&config, "id = ?", strings.TrimSpace(id)).Error
}

// CreatePaymentOrder claims the user idempotency key before contacting a
// provider. The returned created flag is false when a retry found its order.
func (r *Repository) CreatePaymentOrder(order *model.PaymentOrder) (*model.PaymentOrder, bool, error) {
	created := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "idempotency_key"}},
		DoNothing: true,
	}).Create(order)
	if created.Error != nil {
		return nil, false, created.Error
	}
	if created.RowsAffected == 1 {
		return order, true, nil
	}
	var existing model.PaymentOrder
	err := r.db.Where("user_id = ? AND idempotency_key = ?", order.UserID, order.IdempotencyKey).First(&existing).Error
	return &existing, false, err
}

func (r *Repository) SetPaymentOrderCheckout(id string, checkoutMode, checkoutValue string, checkoutExpiresAt time.Time) error {
	updated := r.db.Model(&model.PaymentOrder{}).
		Where("id = ? AND status IN ?", id, []model.PaymentOrderStatus{model.PaymentOrderCreated, model.PaymentOrderCreateFailed, model.PaymentOrderPending}).
		Updates(map[string]any{
			"status": model.PaymentOrderPending, "checkout_mode": checkoutMode, "checkout_value": checkoutValue,
			"checkout_expires_at": &checkoutExpiresAt, "last_error": "", "updated_at": time.Now(),
		})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return ErrPaymentOrderStateConflict
	}
	return nil
}

func (r *Repository) SetPaymentOrderCreateFailure(id, message string) error {
	return r.db.Model(&model.PaymentOrder{}).Where("id = ? AND status = ?", id, model.PaymentOrderCreated).Updates(map[string]any{
		"status": model.PaymentOrderCreateFailed, "last_error": message, "updated_at": time.Now(),
	}).Error
}

func (r *Repository) PaymentOrderForUser(userID, id string) (*model.PaymentOrder, error) {
	var order model.PaymentOrder
	return &order, r.db.First(&order, "id = ? AND user_id = ?", strings.TrimSpace(id), strings.TrimSpace(userID)).Error
}

func (r *Repository) PaymentOrderByIdempotency(userID, idempotencyKey string) (*model.PaymentOrder, error) {
	var order model.PaymentOrder
	return &order, r.db.First(&order, "user_id = ? AND idempotency_key = ?", strings.TrimSpace(userID), strings.TrimSpace(idempotencyKey)).Error
}

func (r *Repository) PaymentOrder(id string) (*model.PaymentOrder, error) {
	var order model.PaymentOrder
	return &order, r.db.First(&order, "id = ?", strings.TrimSpace(id)).Error
}

func (r *Repository) PaymentOrderByMerchant(providerID, merchantOrderNo string) (*model.PaymentOrder, error) {
	var order model.PaymentOrder
	return &order, r.db.First(&order, "provider_id = ? AND merchant_order_no = ?", providerID, merchantOrderNo).Error
}

func (r *Repository) ActivePaymentOrderCount(userID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.PaymentOrder{}).Where("user_id = ? AND status IN ?", userID, []model.PaymentOrderStatus{
		model.PaymentOrderCreated, model.PaymentOrderPending, model.PaymentOrderClosing, model.PaymentOrderCreateFailed,
	}).Count(&count).Error
	return count, err
}

func (r *Repository) PaymentOrderCountForProvider(providerID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.PaymentOrder{}).Where("provider_id = ?", strings.TrimSpace(providerID)).Count(&count).Error
	return count, err
}

// ActivePaymentOrderCountForPlugin reports orders that still need the plugin
// runtime for create retries, callbacks, queries or close operations.
func (r *Repository) ActivePaymentOrderCountForPlugin(pluginID, pluginVersion string) (int64, error) {
	query := r.db.Model(&model.PaymentOrder{}).Where("plugin_id = ? AND status IN ?", strings.TrimSpace(pluginID), []model.PaymentOrderStatus{
		model.PaymentOrderCreated, model.PaymentOrderPending, model.PaymentOrderClosing, model.PaymentOrderCreateFailed,
	})
	if strings.TrimSpace(pluginVersion) != "" {
		// Rows created before plugin version pinning have an empty version. Keep
		// them protected during upgrades because they still depend on this
		// plugin's historical runtime.
		query = query.Where("(plugin_version = ? OR plugin_version = '' OR plugin_version IS NULL)", strings.TrimSpace(pluginVersion))
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

func (r *Repository) SaveVerifiedPaymentNotification(notification *model.PaymentNotification) (bool, error) {
	created := r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "provider_id"}, {Name: "provider_event_id"}}, DoNothing: true,
	}).Create(notification)
	return created.RowsAffected == 1, created.Error
}

func (r *Repository) PendingPaymentNotifications(limit int) ([]model.PaymentNotification, error) {
	if limit <= 0 || limit > 100 {
		limit = 32
	}
	var items []model.PaymentNotification
	err := r.db.Where("status IN ? AND next_attempt_at <= ? AND attempts < ?", []model.PaymentNotificationStatus{
		model.PaymentNotificationPending, model.PaymentNotificationFailed,
	}, time.Now(), 20).Order("created_at asc").Limit(limit).Find(&items).Error
	return items, err
}

func (r *Repository) CompletePaymentNotification(id string) error {
	now := time.Now()
	return r.db.Model(&model.PaymentNotification{}).Where("id = ?", id).Updates(map[string]any{
		"status": model.PaymentNotificationProcessed, "processed_at": &now, "last_error": "", "updated_at": now,
	}).Error
}

func (r *Repository) RetryPaymentNotification(id, message string, next time.Time) error {
	return r.db.Model(&model.PaymentNotification{}).Where("id = ?", id).Updates(map[string]any{
		"status": model.PaymentNotificationFailed, "attempts": gorm.Expr("attempts + 1"),
		"last_error": message, "next_attempt_at": next, "updated_at": time.Now(),
	}).Error
}

// CompletePaymentOrder atomically records provider success and grants credits.
// The unique ledger reference is the final guard against callback/query races.
func (r *Repository) CompletePaymentOrder(providerID, merchantOrderNo string, evidence PaymentEvidence) (*model.PaymentOrder, bool, error) {
	var order model.PaymentOrder
	granted := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "provider_id = ? AND merchant_order_no = ?", providerID, merchantOrderNo).Error; err != nil {
			return err
		}
		if order.AmountFen != evidence.AmountFen || order.Currency != evidence.Currency || strings.TrimSpace(evidence.ProviderTradeNo) == "" {
			return ErrPaymentEvidenceMismatch
		}
		if order.AmountFen <= 0 || order.CreditsMicrocredits <= 0 {
			return ErrPaymentOrderStateConflict
		}
		if order.Status == model.PaymentOrderCredited {
			if order.ProviderTradeNo == nil || strings.TrimSpace(*order.ProviderTradeNo) != strings.TrimSpace(evidence.ProviderTradeNo) {
				return ErrPaymentEvidenceMismatch
			}
			return nil
		}
		var duplicate int64
		if err := tx.Model(&model.PaymentOrder{}).Where("provider_id = ? AND provider_trade_no = ? AND id <> ?", providerID, evidence.ProviderTradeNo, order.ID).Count(&duplicate).Error; err != nil {
			return err
		}
		if duplicate > 0 {
			return ErrPaymentTradeNoConflict
		}
		referenceKey := "payment:" + providerID + ":" + merchantOrderNo
		entry := model.CreditLedgerEntry{
			ID: newRepositoryID(), UserID: order.UserID, Type: model.CreditLedgerPaymentTopup,
			AmountMicrocredits: order.CreditsMicrocredits, PaymentOrderID: order.ID,
			ReferenceKey: &referenceKey, Note: order.ProductName + " · 在线支付充值",
		}
		created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "reference_key"}}, DoNothing: true}).Create(&entry)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 0 {
			// A credited order is handled above. Reaching this branch means a
			// ledger row exists while the order is still non-terminal, so treating
			// the operation as successful would hide an inconsistent credit state.
			return ErrPaymentOrderStateConflict
		}
		account := model.CreditAccount{UserID: order.UserID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return err
		}
		now := time.Now()
		accountUpdate := tx.Model(&model.CreditAccount{}).
			Where("user_id = ? AND available_microcredits <= ?", order.UserID, maxPaymentCreditBalance-order.CreditsMicrocredits).
			Updates(map[string]any{
				"available_microcredits": gorm.Expr("available_microcredits + ?", order.CreditsMicrocredits),
				"version":                gorm.Expr("version + 1"), "updated_at": now,
			})
		if accountUpdate.Error != nil {
			return accountUpdate.Error
		}
		if accountUpdate.RowsAffected != 1 {
			return ErrPaymentCreditOverflow
		}
		if err := tx.First(&account, "user_id = ?", order.UserID).Error; err != nil {
			return err
		}
		if err := tx.Model(&entry).Updates(map[string]any{
			"available_delta_microcredits": order.CreditsMicrocredits,
			"available_after_microcredits": account.AvailableMicrocredits,
			"reserved_after_microcredits":  account.ReservedMicrocredits,
		}).Error; err != nil {
			return err
		}
		paidAt := evidence.PaidAt
		if paidAt.IsZero() {
			paidAt = now
		}
		tradeNo := evidence.ProviderTradeNo
		updated := tx.Model(&model.PaymentOrder{}).Where("id = ? AND status <> ?", order.ID, model.PaymentOrderCredited).Updates(map[string]any{
			"status": model.PaymentOrderCredited, "provider_trade_no": &tradeNo,
			"provider_status": evidence.ProviderStatus, "provider_paid_at": &paidAt,
			"credited_at": &now, "last_error": "", "updated_at": now,
		})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrPaymentOrderStateConflict
		}
		granted = true
		return tx.First(&order, "id = ?", order.ID).Error
	})
	if err == nil && !granted && order.ID != "" {
		if reloadErr := r.db.First(&order, "id = ?", order.ID).Error; reloadErr != nil {
			return &order, false, reloadErr
		}
	}
	return &order, granted, err
}

func (r *Repository) RecordPaymentQuery(id, providerStatus string) error {
	now := time.Now()
	return r.db.Model(&model.PaymentOrder{}).Where("id = ?", id).Updates(map[string]any{
		"provider_status": providerStatus, "last_queried_at": &now, "updated_at": now,
	}).Error
}

func (r *Repository) MarkPaymentOrderClosed(id, providerStatus string) error {
	now := time.Now()
	updated := r.db.Model(&model.PaymentOrder{}).Where("id = ? AND status IN ?", id, []model.PaymentOrderStatus{
		model.PaymentOrderCreated, model.PaymentOrderPending, model.PaymentOrderClosing, model.PaymentOrderCreateFailed,
	}).Updates(map[string]any{
		"status": model.PaymentOrderClosed, "provider_status": providerStatus,
		"closed_at": &now, "last_error": "", "updated_at": now,
	})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected == 0 {
		var order model.PaymentOrder
		if err := r.db.First(&order, "id = ?", id).Error; err != nil {
			return err
		}
		if order.Status != model.PaymentOrderCredited && order.Status != model.PaymentOrderClosed {
			return ErrPaymentOrderStateConflict
		}
	}
	return nil
}

func (r *Repository) RestoreClosingPaymentOrder(id, message string) error {
	return r.db.Model(&model.PaymentOrder{}).Where("id = ? AND status = ?", id, model.PaymentOrderClosing).Updates(map[string]any{
		"status": model.PaymentOrderPending, "last_error": message, "updated_at": time.Now(),
	}).Error
}

func (r *Repository) ClaimExpiredPaymentOrders(limit int) ([]model.PaymentOrder, error) {
	if limit <= 0 || limit > 100 {
		limit = 32
	}
	now := time.Now()
	claimable := []model.PaymentOrderStatus{model.PaymentOrderCreated, model.PaymentOrderPending, model.PaymentOrderCreateFailed}
	var candidates []model.PaymentOrder
	if err := r.db.Where(
		"(status IN ? AND expires_at <= ?) OR (status = ? AND updated_at <= ?)",
		claimable, now, model.PaymentOrderClosing, now.Add(-2*time.Minute),
	).Order("expires_at asc").Limit(limit).Find(&candidates).Error; err != nil {
		return nil, err
	}
	claimed := make([]model.PaymentOrder, 0, len(candidates))
	for _, candidate := range candidates {
		query := r.db.Model(&model.PaymentOrder{}).Where("id = ? AND status = ?", candidate.ID, candidate.Status)
		if candidate.Status == model.PaymentOrderClosing {
			query = query.Where("updated_at = ?", candidate.UpdatedAt)
		}
		updated := query.Updates(map[string]any{"status": model.PaymentOrderClosing, "updated_at": time.Now()})
		if updated.Error != nil {
			return claimed, updated.Error
		}
		if updated.RowsAffected == 1 {
			candidate.Status = model.PaymentOrderClosing
			claimed = append(claimed, candidate)
		}
	}
	return claimed, nil
}

func (r *Repository) PaymentOrdersNeedingQuery(cutoff time.Time, limit int) ([]model.PaymentOrder, error) {
	if limit <= 0 || limit > 100 {
		limit = 32
	}
	var items []model.PaymentOrder
	err := r.db.Where("status IN ? AND (last_queried_at IS NULL OR last_queried_at < ?)", []model.PaymentOrderStatus{
		model.PaymentOrderCreated, model.PaymentOrderPending, model.PaymentOrderCreateFailed,
	}, cutoff).
		Order("created_at asc").Limit(limit).Find(&items).Error
	return items, err
}

func (r *Repository) AdminPaymentOrders(status, keyword string, limit, offset int) ([]model.PaymentOrder, int64, error) {
	var items []model.PaymentOrder
	var total int64
	query := r.db.Model(&model.PaymentOrder{})
	if normalized := strings.TrimSpace(status); normalized != "" && normalized != "all" {
		query = query.Where("status = ?", normalized)
	}
	if normalized := strings.TrimSpace(keyword); normalized != "" {
		like := "%" + normalized + "%"
		query = query.Where("merchant_order_no LIKE ? OR provider_trade_no LIKE ? OR user_id LIKE ?", like, like, like)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("created_at desc").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

// BeginPaymentReconciliation creates or safely reuses the single daily run
// for a provider. A recently running job is left alone so two workers cannot
// reconcile and grant the same missing credit concurrently.
func (r *Repository) BeginPaymentReconciliation(run *model.PaymentReconciliationRun) (*model.PaymentReconciliationRun, bool, error) {
	if run == nil {
		return nil, false, errors.New("payment reconciliation run is nil")
	}
	var current model.PaymentReconciliationRun
	started := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("provider_id = ? AND bill_date = ?", run.ProviderID, run.BillDate).
			First(&current).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			created := tx.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "provider_id"}, {Name: "bill_date"}},
				DoNothing: true,
			}).Create(run)
			if created.Error != nil {
				return created.Error
			}
			if created.RowsAffected == 1 {
				current = *run
				started = true
				return nil
			}
			// Another worker won the unique-key race. Reload and apply the
			// same running/cooldown rules instead of surfacing a conflict.
			if reloadErr := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
				Where("provider_id = ? AND bill_date = ?", run.ProviderID, run.BillDate).
				First(&current).Error; reloadErr != nil {
				return reloadErr
			}
			err = nil
		}
		if err != nil {
			return err
		}
		if current.Status == model.PaymentReconciliationRunning && current.UpdatedAt.After(time.Now().Add(-30*time.Minute)) {
			return nil
		}
		if err := tx.Where("run_id = ?", current.ID).Delete(&model.PaymentReconciliationItem{}).Error; err != nil {
			return err
		}
		now := time.Now()
		if err := tx.Model(&model.PaymentReconciliationRun{}).Where("id = ?", current.ID).Updates(map[string]any{
			"config_id": run.ConfigID, "status": model.PaymentReconciliationRunning,
			"total_items": 0, "match_items": 0, "recovered_items": 0, "error_items": 0,
			"error": "", "started_by": run.StartedBy, "started_at": now, "completed_at": nil,
			"updated_at": now,
		}).Error; err != nil {
			return err
		}
		started = true
		return tx.First(&current, "id = ?", current.ID).Error
	})
	return &current, started, err
}

func (r *Repository) CompletePaymentReconciliation(id string, items []model.PaymentReconciliationItem, matched, recovered, failed int) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if len(items) > 0 {
			if err := tx.CreateInBatches(items, 200).Error; err != nil {
				return err
			}
		}
		now := time.Now()
		updated := tx.Model(&model.PaymentReconciliationRun{}).
			Where("id = ? AND status = ?", strings.TrimSpace(id), model.PaymentReconciliationRunning).
			Updates(map[string]any{
				"status": model.PaymentReconciliationCompleted, "total_items": len(items),
				"match_items": matched, "recovered_items": recovered, "error_items": failed,
				"error": "", "completed_at": &now, "updated_at": now,
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return errors.New("payment reconciliation run is no longer running")
		}
		return nil
	})
}

func (r *Repository) FailPaymentReconciliation(id, message string) error {
	now := time.Now()
	return r.db.Model(&model.PaymentReconciliationRun{}).Where("id = ?", strings.TrimSpace(id)).Updates(map[string]any{
		"status": model.PaymentReconciliationFailed, "error": message,
		"completed_at": &now, "updated_at": now,
	}).Error
}

func (r *Repository) PaymentReconciliationRun(id string) (*model.PaymentReconciliationRun, error) {
	var run model.PaymentReconciliationRun
	return &run, r.db.First(&run, "id = ?", strings.TrimSpace(id)).Error
}

func (r *Repository) PaymentReconciliationRunByDate(providerID, billDate string) (*model.PaymentReconciliationRun, error) {
	var run model.PaymentReconciliationRun
	return &run, r.db.First(&run, "provider_id = ? AND bill_date = ?", strings.TrimSpace(providerID), strings.TrimSpace(billDate)).Error
}

func (r *Repository) AdminPaymentReconciliationRuns(providerID, status string, limit, offset int) ([]model.PaymentReconciliationRun, int64, error) {
	var runs []model.PaymentReconciliationRun
	var total int64
	query := r.db.Model(&model.PaymentReconciliationRun{})
	if normalized := strings.TrimSpace(providerID); normalized != "" && normalized != "all" {
		query = query.Where("provider_id = ?", normalized)
	}
	if normalized := strings.TrimSpace(status); normalized != "" && normalized != "all" {
		query = query.Where("status = ?", normalized)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("bill_date desc, started_at desc").Limit(limit).Offset(offset).Find(&runs).Error
	return runs, total, err
}

func (r *Repository) PaymentReconciliationItems(runID, result string, limit, offset int) ([]model.PaymentReconciliationItem, int64, error) {
	var items []model.PaymentReconciliationItem
	var total int64
	query := r.db.Model(&model.PaymentReconciliationItem{}).Where("run_id = ?", strings.TrimSpace(runID))
	if normalized := strings.TrimSpace(result); normalized != "" && normalized != "all" {
		query = query.Where("result = ?", normalized)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("resolved asc, created_at asc").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) CreditedPaymentOrdersBetween(providerID string, start, end time.Time) ([]model.PaymentOrder, error) {
	var orders []model.PaymentOrder
	err := r.db.Where(
		"provider_id = ? AND status = ? AND provider_paid_at >= ? AND provider_paid_at < ?",
		strings.TrimSpace(providerID), model.PaymentOrderCredited, start, end,
	).Order("provider_paid_at asc").Find(&orders).Error
	return orders, err
}

// UnresolvedPaymentOrderCandidateCountOverlapping reports whether an order
// whose payment outcome is still ambiguous overlaps the bill day. Closed
// orders have already been confirmed unpaid by query/close, while credited
// orders are checked separately against the provider bill.
func (r *Repository) UnresolvedPaymentOrderCandidateCountOverlapping(providerID string, start, end time.Time) (int64, error) {
	var count int64
	err := r.db.Model(&model.PaymentOrder{}).
		Where("provider_id = ? AND status IN ? AND created_at < ? AND expires_at >= ?", strings.TrimSpace(providerID), []model.PaymentOrderStatus{
			model.PaymentOrderCreated, model.PaymentOrderPending, model.PaymentOrderClosing, model.PaymentOrderCreateFailed,
		}, end, start).
		Count(&count).Error
	return count, err
}

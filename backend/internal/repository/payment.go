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
	ErrPaymentStateConflict       = errors.New("payment state conflict")
	ErrPaymentTransactionConflict = errors.New("payment transaction conflict")
)

type AdminPaymentOrderRow struct {
	model.PaymentOrder
	Username        string `json:"username" gorm:"column:username"`
	UserDisplayName string `json:"userDisplayName" gorm:"column:user_display_name"`
	ChannelName     string `json:"channelName" gorm:"column:channel_name"`
}

func (r *Repository) ActiveRechargeProducts() ([]model.CreditRechargeProduct, error) {
	var items []model.CreditRechargeProduct
	err := r.db.Where("enabled = ?", true).Order("sort_order asc, created_at asc").Find(&items).Error
	return items, err
}

func (r *Repository) RechargeProducts(includeDisabled bool) ([]model.CreditRechargeProduct, error) {
	var items []model.CreditRechargeProduct
	query := r.db.Order("sort_order asc, created_at asc")
	if !includeDisabled {
		query = query.Where("enabled = ?", true)
	}
	return items, query.Find(&items).Error
}

func (r *Repository) RechargeProduct(id string, includeDisabled bool) (*model.CreditRechargeProduct, error) {
	var item model.CreditRechargeProduct
	query := r.db.Where("id = ?", id)
	if !includeDisabled {
		query = query.Where("enabled = ?", true)
	}
	if err := query.First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) PaymentChannels() ([]model.PaymentChannel, error) {
	var items []model.PaymentChannel
	err := r.db.Order("is_default desc, created_at asc").Find(&items).Error
	return items, err
}

func (r *Repository) PaymentChannel(id string) (*model.PaymentChannel, error) {
	var item model.PaymentChannel
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) ActivePaymentChannel() (*model.PaymentChannel, error) {
	var item model.PaymentChannel
	if err := r.db.Where("enabled = ? AND active_version_id <> ''", true).Order("is_default desc, created_at asc").First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) ActivePaymentChannels() ([]model.PaymentChannel, error) {
	var items []model.PaymentChannel
	err := r.db.Where("enabled = ? AND active_version_id <> ''", true).Order("is_default desc, created_at asc").Find(&items).Error
	return items, err
}

func (r *Repository) ActivePaymentChannelByID(id string) (*model.PaymentChannel, error) {
	var item model.PaymentChannel
	if err := r.db.Where("id = ? AND enabled = ? AND active_version_id <> ''", id, true).First(&item).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) PaymentChannelVersion(id string) (*model.PaymentChannelVersion, error) {
	var item model.PaymentChannelVersion
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) PaymentChannelVersions(channelID string) ([]model.PaymentChannelVersion, error) {
	var items []model.PaymentChannelVersion
	err := r.db.Where("channel_id = ?", channelID).Order("version desc").Find(&items).Error
	return items, err
}

func (r *Repository) CreatePaymentChannel(channel *model.PaymentChannel, version *model.PaymentChannelVersion) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if channel.IsDefault {
			if err := tx.Model(&model.PaymentChannel{}).Where("is_default = ?", true).Update("is_default", false).Error; err != nil {
				return err
			}
		}
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		channel.ActiveVersionID = version.ID
		return tx.Create(channel).Error
	})
}

func (r *Repository) SavePaymentChannel(channel *model.PaymentChannel) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if channel.IsDefault {
			if err := tx.Model(&model.PaymentChannel{}).Where("id <> ? AND is_default = ?", channel.ID, true).Update("is_default", false).Error; err != nil {
				return err
			}
		}
		return tx.Save(channel).Error
	})
}

func (r *Repository) RotatePaymentChannelVersion(channel *model.PaymentChannel, version *model.PaymentChannelVersion) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.PaymentChannelVersion{}).Where("channel_id = ? AND status = ?", channel.ID, model.PaymentChannelVersionActive).Update("status", model.PaymentChannelVersionArchived).Error; err != nil {
			return err
		}
		if err := tx.Create(version).Error; err != nil {
			return err
		}
		channel.ActiveVersionID = version.ID
		return tx.Save(channel).Error
	})
}

func (r *Repository) CreateOrGetPaymentOrder(order *model.PaymentOrder) (*model.PaymentOrder, bool, error) {
	created := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "idempotency_key"}},
		DoNothing: true,
	}).Create(order)
	if created.Error != nil {
		return nil, false, created.Error
	}
	if created.RowsAffected > 0 {
		return order, true, nil
	}
	var existing model.PaymentOrder
	if err := r.db.First(&existing, "user_id = ? AND idempotency_key = ?", order.UserID, order.IdempotencyKey).Error; err != nil {
		return nil, false, err
	}
	return &existing, false, nil
}

func (r *Repository) PaymentOrder(id string) (*model.PaymentOrder, error) {
	var order model.PaymentOrder
	if err := r.db.First(&order, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &order, nil
}

func (r *Repository) PaymentOrderForUser(userID string, id string) (*model.PaymentOrder, error) {
	var order model.PaymentOrder
	if err := r.db.First(&order, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &order, nil
}

func (r *Repository) PaymentOrderByOutTradeNo(outTradeNo string) (*model.PaymentOrder, error) {
	var order model.PaymentOrder
	if err := r.db.First(&order, "out_trade_no = ?", outTradeNo).Error; err != nil {
		return nil, err
	}
	return &order, nil
}

func (r *Repository) PaymentOrdersForUser(userID string, limit int, offset int) ([]model.PaymentOrder, int64, error) {
	var items []model.PaymentOrder
	var total int64
	query := r.db.Model(&model.PaymentOrder{}).Where("user_id = ?", userID)
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("created_at desc").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) AdminPaymentOrders(status string, keyword string, limit int, offset int) ([]AdminPaymentOrderRow, int64, error) {
	var items []AdminPaymentOrderRow
	var total int64
	base := r.db.Table("payment_orders AS payment_order").
		Joins("LEFT JOIN users AS user_account ON user_account.id = payment_order.user_id").
		Joins("LEFT JOIN payment_channels AS payment_channel ON payment_channel.id = payment_order.channel_id")
	if strings.TrimSpace(status) != "" && status != "all" {
		base = base.Where("payment_order.status = ?", strings.TrimSpace(status))
	}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		pattern := "%" + keyword + "%"
		base = base.Where("payment_order.out_trade_no LIKE ? OR payment_order.transaction_id LIKE ? OR user_account.username LIKE ? OR user_account.display_name LIKE ?", pattern, pattern, pattern, pattern)
	}
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := base.Select("payment_order.*, user_account.username AS username, user_account.display_name AS user_display_name, payment_channel.name AS channel_name").
		Order("payment_order.created_at desc").Limit(limit).Offset(offset).Scan(&items).Error
	return items, total, err
}

func (r *Repository) MarkPaymentOrderPending(id string, codeURL string, requestID string, now time.Time) error {
	result := r.db.Model(&model.PaymentOrder{}).Where("id = ? AND status = ?", id, model.PaymentOrderCreated).Updates(map[string]any{
		"status": model.PaymentOrderPending, "code_url": codeURL, "provider_request_id": requestID,
		"last_error_code": "", "last_error_message": "", "updated_at": now,
	})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrPaymentStateConflict
	}
	return nil
}

func (r *Repository) MarkPaymentOrderCreateFailed(id string, code string, message string, now time.Time) error {
	return r.db.Model(&model.PaymentOrder{}).Where("id = ? AND status = ?", id, model.PaymentOrderCreated).Updates(map[string]any{
		"status": model.PaymentOrderFailed, "last_error_code": code, "last_error_message": message, "updated_at": now,
	}).Error
}

func (r *Repository) MarkPaymentOrderException(id string, code string, message string, now time.Time) error {
	return r.db.Model(&model.PaymentOrder{}).Where("id = ? AND status <> ?", id, model.PaymentOrderSucceeded).Updates(map[string]any{
		"status": model.PaymentOrderException, "last_error_code": code, "last_error_message": message, "updated_at": now,
	}).Error
}

func (r *Repository) RecordPaymentOrderQuery(id string, tradeState string, description string, now time.Time) error {
	return r.db.Model(&model.PaymentOrder{}).Where("id = ?", id).Updates(map[string]any{
		"provider_trade_state": tradeState, "provider_trade_state_desc": description,
		"last_query_at": now, "query_attempts": gorm.Expr("query_attempts + 1"), "updated_at": now,
	}).Error
}

func (r *Repository) RecordPaymentOrderQueryError(id string, code string, message string, now time.Time) error {
	return r.db.Model(&model.PaymentOrder{}).Where("id = ?", id).Updates(map[string]any{
		"last_query_at": now, "query_attempts": gorm.Expr("query_attempts + 1"),
		"last_error_code": code, "last_error_message": message, "updated_at": now,
	}).Error
}

func (r *Repository) ClaimPaymentOrderClosing(id string, now time.Time) (bool, error) {
	result := r.db.Model(&model.PaymentOrder{}).Where("id = ? AND status = ?", id, model.PaymentOrderPending).Updates(map[string]any{
		"status": model.PaymentOrderClosing, "updated_at": now,
	})
	return result.RowsAffected > 0, result.Error
}

func (r *Repository) RestorePaymentOrderPending(id string, message string, now time.Time) error {
	return r.db.Model(&model.PaymentOrder{}).Where("id = ? AND status = ?", id, model.PaymentOrderClosing).Updates(map[string]any{
		"status": model.PaymentOrderPending, "last_error_message": message, "updated_at": now,
	}).Error
}

func (r *Repository) MarkPaymentOrderClosed(id string, tradeState string, now time.Time) error {
	return r.db.Model(&model.PaymentOrder{}).Where("id = ? AND status IN ?", id, []model.PaymentOrderStatus{model.PaymentOrderPending, model.PaymentOrderClosing}).Updates(map[string]any{
		"status": model.PaymentOrderClosed, "provider_trade_state": tradeState, "closed_at": now, "code_url": "", "updated_at": now,
	}).Error
}

func (r *Repository) ExpiredPaymentOrders(now time.Time, retryBefore time.Time, limit int) ([]model.PaymentOrder, error) {
	var items []model.PaymentOrder
	err := r.db.Where("status IN ? AND expires_at <= ?", []model.PaymentOrderStatus{model.PaymentOrderPending, model.PaymentOrderClosing}, now).
		Where("last_query_at IS NULL OR last_query_at <= ?", retryBefore).
		Order("expires_at asc").Limit(limit).Find(&items).Error
	return items, err
}

func (r *Repository) RecoverablePaymentOrders(before time.Time, retryBefore time.Time, limit int) ([]model.PaymentOrder, error) {
	var items []model.PaymentOrder
	err := r.db.Where("status IN ? AND updated_at <= ?", []model.PaymentOrderStatus{model.PaymentOrderCreated, model.PaymentOrderException}, before).
		Where("last_query_at IS NULL OR last_query_at <= ?", retryBefore).
		Order("updated_at asc").Limit(limit).Find(&items).Error
	return items, err
}

func (r *Repository) CreatePaymentEvent(event *model.PaymentEvent) (bool, error) {
	result := r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "provider_event_id"}}, DoNothing: true}).Create(event)
	return result.RowsAffected > 0, result.Error
}

func (r *Repository) PendingPaymentEvents(retryBefore time.Time, limit int) ([]model.PaymentEvent, error) {
	var items []model.PaymentEvent
	err := r.db.Where("status IN ?", []model.PaymentEventStatus{model.PaymentEventPending, model.PaymentEventFailed}).
		Where("attempts < ? AND (last_attempt_at IS NULL OR last_attempt_at <= ?)", 10, retryBefore).
		Order("received_at asc").Limit(limit).Find(&items).Error
	return items, err
}

func (r *Repository) SavePaymentEventResult(id string, status model.PaymentEventStatus, orderID string, lastError string, now time.Time) error {
	updates := map[string]any{"status": status, "order_id": orderID, "last_error": lastError, "attempts": gorm.Expr("attempts + 1"), "last_attempt_at": now}
	if status == model.PaymentEventProcessed || status == model.PaymentEventIgnored {
		updates["processed_at"] = now
	}
	return r.db.Model(&model.PaymentEvent{}).Where("id = ?", id).Updates(updates).Error
}

// CompletePaymentOrder 把支付成功、积分入账和账本落库放在同一事务中。
// referenceKey 由商户号和微信交易号组成，是外部支付只到账一次的最终防线。
func (r *Repository) CompletePaymentOrder(orderID string, transactionID string, referenceKey string, paidAt time.Time, tradeState string, description string) (*model.PaymentOrder, bool, error) {
	var order model.PaymentOrder
	credited := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", orderID).Error; err != nil {
			return err
		}
		if order.Status == model.PaymentOrderSucceeded {
			if order.TransactionID == nil || *order.TransactionID != transactionID {
				return ErrPaymentTransactionConflict
			}
			return nil
		}

		account := model.CreditAccount{UserID: order.UserID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return err
		}
		entry := model.CreditLedgerEntry{
			ID: newRepositoryID(), UserID: order.UserID, Type: model.CreditLedgerRecharge,
			AmountMicrocredits: order.CreditsMicrocredits, PaymentOrderID: order.ID,
			ReferenceKey: &referenceKey, Note: "在线支付充值：" + order.ProductNameSnapshot,
		}
		created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "reference_key"}}, DoNothing: true}).Create(&entry)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 0 {
			var existing model.CreditLedgerEntry
			if err := tx.First(&existing, "reference_key = ?", referenceKey).Error; err != nil {
				return err
			}
			if existing.PaymentOrderID != order.ID {
				return ErrPaymentTransactionConflict
			}
		} else {
			credited = true
			if err := tx.Model(&model.CreditAccount{}).Where("user_id = ?", order.UserID).Updates(map[string]any{
				"available_microcredits": gorm.Expr("available_microcredits + ?", order.CreditsMicrocredits),
				"version":                gorm.Expr("version + 1"), "updated_at": time.Now(),
			}).Error; err != nil {
				return err
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
		}

		now := time.Now()
		result := tx.Model(&model.PaymentOrder{}).Where("id = ? AND status <> ?", order.ID, model.PaymentOrderSucceeded).Updates(map[string]any{
			"status": model.PaymentOrderSucceeded, "provider_trade_state": tradeState,
			"provider_trade_state_desc": description, "transaction_id": transactionID,
			"paid_at": paidAt, "credited_at": now, "code_url": "",
			"last_error_code": "", "last_error_message": "", "updated_at": now,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrPaymentStateConflict
		}
		return tx.First(&order, "id = ?", order.ID).Error
	})
	return &order, credited, err
}

func (r *Repository) CreateOrGetPaymentReconciliationRun(run *model.PaymentReconciliationRun) (*model.PaymentReconciliationRun, bool, error) {
	result := r.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "merchant_id"}, {Name: "bill_date"}}, DoNothing: true,
	}).Create(run)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected > 0 {
		return run, true, nil
	}
	var existing model.PaymentReconciliationRun
	if err := r.db.First(&existing, "merchant_id = ? AND bill_date = ?", run.MerchantID, run.BillDate).Error; err != nil {
		return nil, false, err
	}
	return &existing, false, nil
}

func (r *Repository) ClaimPaymentReconciliationRun(id string, staleBefore time.Time, now time.Time) (bool, error) {
	result := r.db.Model(&model.PaymentReconciliationRun{}).
		Where("id = ? AND (status IN ? OR (status = ? AND updated_at <= ?))", id, []model.PaymentReconciliationStatus{model.PaymentReconciliationPending, model.PaymentReconciliationFailed}, model.PaymentReconciliationRunning, staleBefore).
		Updates(map[string]any{"status": model.PaymentReconciliationRunning, "attempts": gorm.Expr("attempts + 1"), "started_at": now, "last_error": "", "updated_at": now})
	return result.RowsAffected > 0, result.Error
}

func (r *Repository) CompletePaymentReconciliationRun(run *model.PaymentReconciliationRun, differences []model.PaymentReconciliationDifference, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("run_id = ?", run.ID).Delete(&model.PaymentReconciliationDifference{}).Error; err != nil {
			return err
		}
		if len(differences) > 0 {
			if err := tx.Create(&differences).Error; err != nil {
				return err
			}
		}
		result := tx.Model(&model.PaymentReconciliationRun{}).Where("id = ? AND status = ?", run.ID, model.PaymentReconciliationRunning).Updates(map[string]any{
			"status": model.PaymentReconciliationCompleted, "bill_hash": run.BillHash,
			"wechat_order_count": run.WechatOrderCount, "local_order_count": run.LocalOrderCount,
			"matched_count": run.MatchedCount, "difference_count": len(differences),
			"external_refund_count": run.ExternalRefundCount,
			"completed_at":          now, "updated_at": now,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrPaymentStateConflict
		}
		return nil
	})
}

func (r *Repository) FailPaymentReconciliationRun(id string, message string, now time.Time) error {
	return r.db.Model(&model.PaymentReconciliationRun{}).Where("id = ? AND status = ?", id, model.PaymentReconciliationRunning).Updates(map[string]any{
		"status": model.PaymentReconciliationFailed, "last_error": message, "updated_at": now,
	}).Error
}

func (r *Repository) PaymentReconciliationRuns(limit int, offset int) ([]model.PaymentReconciliationRun, int64, error) {
	var items []model.PaymentReconciliationRun
	var total int64
	query := r.db.Model(&model.PaymentReconciliationRun{})
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Order("bill_date desc, created_at desc").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) PaymentReconciliationRun(id string) (*model.PaymentReconciliationRun, error) {
	var run model.PaymentReconciliationRun
	if err := r.db.First(&run, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &run, nil
}

func (r *Repository) PaymentReconciliationDifferences(runID string) ([]model.PaymentReconciliationDifference, error) {
	var items []model.PaymentReconciliationDifference
	err := r.db.Where("run_id = ?", runID).Order("type asc, out_trade_no asc").Find(&items).Error
	return items, err
}

func (r *Repository) SuccessfulPaymentOrdersForMerchant(merchantID string, start time.Time, end time.Time) ([]model.PaymentOrder, error) {
	var orders []model.PaymentOrder
	err := r.db.Table("payment_orders AS payment_order").
		Select("payment_order.*").
		Joins("JOIN payment_channel_versions AS channel_version ON channel_version.id = payment_order.channel_version_id").
		Where("channel_version.merchant_id = ? AND payment_order.status = ? AND payment_order.paid_at >= ? AND payment_order.paid_at < ?", merchantID, model.PaymentOrderSucceeded, start, end).
		Order("payment_order.paid_at asc").Scan(&orders).Error
	return orders, err
}

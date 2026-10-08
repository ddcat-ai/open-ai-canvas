// 计费订单：预留、运行中、结算、退款与恢复。
//
// 积分扣减遵循「先预留、再按实际用量结算、多退少补」；所有状态迁移都带期望状态条件，
// 并发或重复的结算/退款请求只有一个会生效（ErrBillingStateConflict）。

package repository

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) ReserveBillingOrder(order *model.BillingOrder) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return reserveBillingOrder(tx, order)
	})
}

func reserveBillingOrder(tx *gorm.DB, order *model.BillingOrder) error {
	if err := validateBillingChargeLimit(*order, order.AmountMicrocredits); err != nil {
		return err
	}
	if order.ReservedAmountMicrocredits <= 0 {
		order.ReservedAmountMicrocredits = order.AmountMicrocredits
	}
	account := model.CreditAccount{UserID: order.UserID}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return err
	}
	updated := tx.Model(&model.CreditAccount{}).
		Where("user_id = ? AND available_microcredits >= ?", order.UserID, order.AmountMicrocredits).
		Updates(map[string]any{
			"available_microcredits": gorm.Expr("available_microcredits - ?", order.AmountMicrocredits),
			"reserved_microcredits":  gorm.Expr("reserved_microcredits + ?", order.AmountMicrocredits),
			"version":                gorm.Expr("version + 1"),
			"updated_at":             time.Now(),
		})
	if updated.Error != nil {
		return updated.Error
	}
	if updated.RowsAffected != 1 {
		return ErrInsufficientCredits
	}
	if err := tx.First(&account, "user_id = ?", order.UserID).Error; err != nil {
		return err
	}
	if err := tx.Create(order).Error; err != nil {
		return err
	}
	return tx.Create(&model.CreditLedgerEntry{
		ID:                         newRepositoryID(),
		UserID:                     order.UserID,
		Type:                       model.CreditLedgerReserve,
		AvailableDeltaMicrocredits: -order.AmountMicrocredits,
		ReservedDeltaMicrocredits:  order.AmountMicrocredits,
		AvailableAfterMicrocredits: account.AvailableMicrocredits,
		ReservedAfterMicrocredits:  account.ReservedMicrocredits,
		BillingOrderID:             order.ID,
		Model:                      order.Model,
		ChannelID:                  order.ChannelID,
		Scene:                      order.Scene,
	}).Error
}

func (r *Repository) BillingOrder(id string) (*model.BillingOrder, error) {
	var order model.BillingOrder
	if err := r.db.First(&order, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &order, nil
}

func (r *Repository) BillingOrdersByIDs(ids []string) (map[string]model.BillingOrder, error) {
	result := make(map[string]model.BillingOrder, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	var orders []model.BillingOrder
	if err := r.db.Where("id IN ?", ids).Find(&orders).Error; err != nil {
		return nil, err
	}
	for _, order := range orders {
		result[order.ID] = order
	}
	return result, nil
}

func (r *Repository) BillingOrdersByTaskIDs(userID string, taskIDs []string) (map[string]model.BillingOrder, error) {
	result := make(map[string]model.BillingOrder, len(taskIDs))
	if len(taskIDs) == 0 {
		return result, nil
	}
	var orders []model.BillingOrder
	if err := r.db.Where("user_id = ? AND task_id IN ?", userID, taskIDs).Find(&orders).Error; err != nil {
		return nil, err
	}
	for _, order := range orders {
		if order.TaskID != "" {
			result[order.TaskID] = order
		}
	}
	return result, nil
}

func (r *Repository) AdminBillingOrders(status string, keyword string, limit int, offset int) ([]model.BillingOrder, int64, error) {
	var items []model.BillingOrder
	var total int64
	query := r.db.Model(&model.BillingOrder{})
	if status == "review" {
		query = query.Joins("LEFT JOIN tasks ON tasks.id = billing_orders.task_id").Where(
			"billing_orders.status = ? OR (billing_orders.status = ? AND billing_orders.updated_at < ?) OR (billing_orders.status = ? AND tasks.status IN ?)",
			model.BillingStatusUncertain, model.BillingStatusRunning, time.Now().Add(-40*time.Minute), model.BillingStatusReserved,
			[]model.TaskStatus{model.TaskStatusFailed, model.TaskStatusCancelled},
		)
	} else if status != "" && status != "all" {
		query = query.Where("billing_orders.status = ?", status)
	}
	if value := strings.TrimSpace(keyword); value != "" {
		pattern := "%" + strings.ToLower(value) + "%"
		query = query.Joins("LEFT JOIN users ON users.id = billing_orders.user_id").Where(
			"lower(billing_orders.model) LIKE ? OR lower(billing_orders.scene) LIKE ? OR lower(billing_orders.provider_request_id) LIKE ? OR lower(users.username) LIKE ? OR lower(users.display_name) LIKE ?",
			pattern, pattern, pattern, pattern, pattern,
		)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Select("billing_orders.*").Order("billing_orders.created_at desc").Limit(limit).Offset(offset).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *Repository) TaskHasSuccessfulBillableCall(taskID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.ApiCallLog{}).
		Where("task_id = ? AND billable = ? AND status = ?", taskID, true, model.ApiCallStatusSucceeded).
		Count(&count).Error
	return count > 0, err
}

type BillingUsage struct {
	InputTokens  int64
	OutputTokens int64
	CachedTokens int64
}

func (r *Repository) BillingUsage(orderID string) (*BillingUsage, error) {
	return billingUsage(r.db, orderID)
}

func billingUsage(db *gorm.DB, orderID string) (*BillingUsage, error) {
	var log model.ApiCallLog
	// 异步视频的真实 usage 由非计费的轮询请求返回；订单本身已经限定了归属，
	// 结算应读取同订单最新的成功 usage，而不是只看创建请求。
	err := db.Where("billing_order_id = ? AND status = ? AND usage_available = ?", orderID, model.ApiCallStatusSucceeded, true).
		Order("created_at desc").First(&log).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrBillingUsageUnavailable
	}
	if err != nil {
		return nil, err
	}
	return &BillingUsage{InputTokens: log.InputTokens, OutputTokens: log.OutputTokens, CachedTokens: log.CachedTokens}, nil
}

const (
	billingUsageSourceProvider     = "provider"
	billingUsageSourceVideoFormula = "video_formula"
)

func tokenSettlementUsage(db *gorm.DB, order model.BillingOrder) (*BillingUsage, string, error) {
	usage, err := billingUsage(db, order.ID)
	if err != nil && !errors.Is(err, ErrBillingUsageUnavailable) {
		return nil, "", err
	}
	if order.Capability != "video" {
		return usage, billingUsageSourceProvider, err
	}
	if err == nil && usage.OutputTokens > 0 && usage.InputTokens >= 0 && usage.CachedTokens >= 0 {
		return &BillingUsage{OutputTokens: usage.OutputTokens}, billingUsageSourceProvider, nil
	}
	// 只有提交时明确记录的公式用量可以结算，预授权 Quantity 含余量，不能用作最终用量。
	if order.VideoFormulaTokens > 0 {
		return &BillingUsage{OutputTokens: order.VideoFormulaTokens}, billingUsageSourceVideoFormula, nil
	}
	return usage, billingUsageSourceProvider, err
}

func (r *Repository) RecordBillingResolution(id string, actorUserID string, note string) error {
	return r.db.Model(&model.BillingOrder{}).Where("id = ?", id).Updates(map[string]any{
		"resolved_by": actorUserID, "resolution_note": note, "updated_at": time.Now(),
	}).Error
}

func (r *Repository) UpdateBillingProviderRequestID(id string, providerRequestID string) error {
	if id == "" || providerRequestID == "" {
		return nil
	}
	return r.db.Model(&model.BillingOrder{}).Where("id = ?", id).Updates(map[string]any{
		"provider_request_id": providerRequestID, "updated_at": time.Now(),
	}).Error
}

func (r *Repository) MarkBillingRunning(id string) error {
	if id == "" {
		return nil
	}
	var order model.BillingOrder
	if err := r.db.Select("id", "status").First(&order, "id = ?", id).Error; err != nil {
		return err
	}
	if order.Status == model.BillingStatusRunning {
		return nil
	}
	now := time.Now()
	result := r.db.Model(&model.BillingOrder{}).
		Where("id = ? AND status = ?", id, model.BillingStatusReserved).
		Updates(map[string]any{"status": model.BillingStatusRunning, "started_at": &now, "updated_at": now})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrBillingStateConflict
	}
	return nil
}

func (r *Repository) MarkBillingUncertain(id string, errorText string) error {
	// uncertain 保留冻结积分，直到人工核对；这里故意不自动结算或退款。
	return r.db.Model(&model.BillingOrder{}).
		Where("id = ? AND status IN ?", id, []model.BillingStatus{model.BillingStatusReserved, model.BillingStatusRunning}).
		Updates(map[string]any{"status": model.BillingStatusUncertain, "error": errorText, "updated_at": time.Now()}).Error
}

func (r *Repository) SettleBillingOrder(id string, providerRequestID string) error {
	return r.settleBillingOrder(id, providerRequestID, nil)
}

func (r *Repository) SettleBillingOrderWithAudioDuration(id string, providerRequestID string, durationMs int64) error {
	return r.settleBillingOrder(id, providerRequestID, &durationMs)
}

func (r *Repository) settleBillingOrder(id string, providerRequestID string, audioDurationMs *int64) error {
	var observedUsage *BillingUsage
	var observedUsageSource string
	var observedActual int64
	observedActualAvailable := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var order model.BillingOrder
		if err := tx.First(&order, "id = ?", id).Error; err != nil {
			return err
		}
		if order.Status == model.BillingStatusSettled {
			return nil
		}
		if order.Status == model.BillingStatusRefunded {
			return errors.New("billing order already refunded")
		}
		if order.BillingMode != "token" {
			if err := validateBillingChargeLimit(order, order.AmountMicrocredits); err != nil {
				return err
			}
		}
		if order.BillingMode == "token" && !zeroPricedTokenOrder(order) {
			usage, usageSource, err := tokenSettlementUsage(tx, order)
			if err != nil {
				return err
			}
			observedUsage = usage
			observedUsageSource = usageSource
			reserved := order.ReservedAmountMicrocredits
			if reserved <= 0 {
				reserved = order.AmountMicrocredits
			}
			actual, err := tokenUsageAmount(order, usage)
			if err != nil {
				return err
			}
			chargeCapped := billingChargeLimitApplies(order) && actual > order.ChargeLimitMicrocredits
			if chargeCapped {
				actual = order.ChargeLimitMicrocredits
			}
			observedActual = actual
			observedActualAvailable = true
			refund := max(reserved-actual, int64(0))
			supplement := max(actual-reserved, int64(0))
			updated := tx.Model(&model.CreditAccount{}).
				Where("user_id = ? AND reserved_microcredits >= ?", order.UserID, reserved).
				Updates(map[string]any{
					"available_microcredits": gorm.Expr("available_microcredits + ?", refund-supplement),
					"reserved_microcredits":  gorm.Expr("reserved_microcredits - ?", reserved),
					"version":                gorm.Expr("version + 1"), "updated_at": time.Now(),
				})
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != 1 {
				return errors.New("reserved credit balance is inconsistent")
			}
			var account model.CreditAccount
			if err := tx.First(&account, "user_id = ?", order.UserID).Error; err != nil {
				return err
			}
			now := time.Now()
			updates := map[string]any{"status": model.BillingStatusSettled, "settled_at": &now, "updated_at": now,
				"actual_amount_microcredits": actual, "refunded_amount_microcredits": refund,
				"input_tokens": usage.InputTokens, "output_tokens": usage.OutputTokens, "cached_tokens": usage.CachedTokens,
				"usage_available": usageSource == billingUsageSourceProvider, "usage_source": usageSource}
			if providerRequestID != "" {
				updates["provider_request_id"] = providerRequestID
			}
			if err := tx.Model(&order).Updates(updates).Error; err != nil {
				return err
			}
			consumeNote := ""
			if chargeCapped {
				consumeNote = "Token 实际用量超过 Agent 报价，已按本轮硬上限结算"
			} else if supplement > 0 {
				consumeNote = "Token 实际用量超过预授权，已补扣差额"
			}
			if usageSource == billingUsageSourceVideoFormula {
				consumeNote = strings.TrimSpace("按提交时的视频 Token 公式快照结算；" + consumeNote)
			}
			if err := tx.Create(&model.CreditLedgerEntry{ID: newRepositoryID(), UserID: order.UserID, Type: model.CreditLedgerConsume,
				AmountMicrocredits: -actual, AvailableDeltaMicrocredits: -supplement, ReservedDeltaMicrocredits: -reserved,
				AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits,
				BillingOrderID: order.ID, Model: order.Model, ChannelID: order.ChannelID, Scene: order.Scene, Note: consumeNote}).Error; err != nil {
				return err
			}
			if refund > 0 {
				if err := tx.Create(&model.CreditLedgerEntry{ID: newRepositoryID(), UserID: order.UserID, Type: model.CreditLedgerRefund,
					AmountMicrocredits: refund, AvailableDeltaMicrocredits: refund,
					AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits,
					BillingOrderID: order.ID, Model: order.Model, ChannelID: order.ChannelID, Scene: order.Scene, Note: "Token 预授权差额退回"}).Error; err != nil {
					return err
				}
			}
			return nil
		}
		actual := order.AmountMicrocredits
		quantity := order.Quantity
		refund := int64(0)
		supplement := int64(0)
		if order.BillingMode == "per_second" && order.Capability == "audio" {
			if audioDurationMs == nil || *audioDurationMs <= 0 {
				return errors.New("音频实际时长不可用，无法按秒结算")
			}
			quantity = (*audioDurationMs + 999) / 1000
			var err error
			actual, err = audioBillingAmount(order.UnitPriceMicrocredits, quantity, order.MultiplierBasisPoints)
			if err != nil {
				return err
			}
			if billingChargeLimitApplies(order) && actual > order.ChargeLimitMicrocredits {
				return errors.New("音频实际费用超过本次授权上限，需人工核对")
			}
			reserved := order.ReservedAmountMicrocredits
			if reserved <= 0 {
				reserved = order.AmountMicrocredits
			}
			refund = max(reserved-actual, int64(0))
			supplement = max(actual-reserved, int64(0))
			updated := tx.Model(&model.CreditAccount{}).
				Where("user_id = ? AND reserved_microcredits >= ? AND available_microcredits >= ?", order.UserID, reserved, supplement).
				Updates(map[string]any{
					"available_microcredits": gorm.Expr("available_microcredits + ?", refund-supplement),
					"reserved_microcredits":  gorm.Expr("reserved_microcredits - ?", reserved),
					"version":                gorm.Expr("version + 1"),
					"updated_at":             time.Now(),
				})
			if updated.Error != nil {
				return updated.Error
			}
			if updated.RowsAffected != 1 {
				return errors.New("预留积分不足以完成音频实际结算")
			}
			var account model.CreditAccount
			if err := tx.First(&account, "user_id = ?", order.UserID).Error; err != nil {
				return err
			}
			now := time.Now()
			costQuantity := order.CostQuantity
			if order.CostBillingMode == "per_second" {
				costQuantity = quantity
			}
			orderUpdates := map[string]any{"status": model.BillingStatusSettled, "quantity": quantity, "actual_amount_microcredits": actual, "refunded_amount_microcredits": refund, "cost_quantity": costQuantity, "settled_at": &now, "updated_at": now}
			if providerRequestID != "" {
				orderUpdates["provider_request_id"] = providerRequestID
			}
			if err := tx.Model(&order).Updates(orderUpdates).Error; err != nil {
				return err
			}
			note := "音频按实际输出时长结算"
			if supplement > 0 {
				note += "，已补扣差额"
			}
			if err := tx.Create(&model.CreditLedgerEntry{ID: newRepositoryID(), UserID: order.UserID, Type: model.CreditLedgerConsume,
				AmountMicrocredits: -actual, AvailableDeltaMicrocredits: -supplement, ReservedDeltaMicrocredits: -reserved,
				AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits,
				BillingOrderID: order.ID, Model: order.Model, ChannelID: order.ChannelID, Scene: order.Scene, Note: note}).Error; err != nil {
				return err
			}
			if refund > 0 {
				if err := tx.Create(&model.CreditLedgerEntry{ID: newRepositoryID(), UserID: order.UserID, Type: model.CreditLedgerRefund,
					AmountMicrocredits: refund, AvailableDeltaMicrocredits: refund,
					AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits,
					BillingOrderID: order.ID, Model: order.Model, ChannelID: order.ChannelID, Scene: order.Scene, Note: "音频实际时长短于预授权，差额退回"}).Error; err != nil {
					return err
				}
			}
			return nil
		}
		updated := tx.Model(&model.CreditAccount{}).
			Where("user_id = ? AND reserved_microcredits >= ?", order.UserID, order.AmountMicrocredits).
			Updates(map[string]any{
				"reserved_microcredits": gorm.Expr("reserved_microcredits - ?", order.AmountMicrocredits),
				"version":               gorm.Expr("version + 1"),
				"updated_at":            time.Now(),
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return errors.New("reserved credit balance is inconsistent")
		}
		var account model.CreditAccount
		if err := tx.First(&account, "user_id = ?", order.UserID).Error; err != nil {
			return err
		}
		now := time.Now()
		orderUpdates := map[string]any{"status": model.BillingStatusSettled, "actual_amount_microcredits": order.AmountMicrocredits, "settled_at": &now, "updated_at": now}
		if providerRequestID != "" {
			orderUpdates["provider_request_id"] = providerRequestID
		}
		if err := tx.Model(&order).Updates(orderUpdates).Error; err != nil {
			return err
		}
		return tx.Create(&model.CreditLedgerEntry{
			ID:                         newRepositoryID(),
			UserID:                     order.UserID,
			Type:                       model.CreditLedgerConsume,
			AmountMicrocredits:         -order.AmountMicrocredits,
			ReservedDeltaMicrocredits:  -order.AmountMicrocredits,
			AvailableAfterMicrocredits: account.AvailableMicrocredits,
			ReservedAfterMicrocredits:  account.ReservedMicrocredits,
			BillingOrderID:             order.ID,
			Model:                      order.Model,
			ChannelID:                  order.ChannelID,
			Scene:                      order.Scene,
		}).Error
	})
	if err != nil && observedUsage != nil {
		// 即使账户状态异常导致回滚，也保留结算依据并标明来源，供用户和管理员核对。
		updates := map[string]any{
			"input_tokens": observedUsage.InputTokens, "output_tokens": observedUsage.OutputTokens,
			"cached_tokens": observedUsage.CachedTokens, "usage_available": observedUsageSource == billingUsageSourceProvider,
			"usage_source": observedUsageSource, "updated_at": time.Now(),
		}
		if observedActualAvailable {
			updates["actual_amount_microcredits"] = observedActual
		}
		if providerRequestID != "" {
			updates["provider_request_id"] = providerRequestID
		}
		usageErr := r.db.Model(&model.BillingOrder{}).
			Where("id = ? AND status NOT IN ?", id, []model.BillingStatus{model.BillingStatusSettled, model.BillingStatusRefunded}).
			Updates(updates).Error
		if usageErr != nil {
			return errors.Join(err, usageErr)
		}
	}
	return err
}

func audioBillingAmount(unitPrice int64, quantity int64, multiplierBPS int64) (int64, error) {
	if unitPrice < 0 || quantity <= 0 || multiplierBPS <= 0 {
		return 0, errors.New("积分计费参数无效")
	}
	const maxInt64 = int64(^uint64(0) >> 1)
	if unitPrice > maxInt64/quantity || unitPrice*quantity > (maxInt64-9_999)/multiplierBPS {
		return 0, errors.New("积分计费金额溢出")
	}
	amount := (unitPrice*quantity*multiplierBPS + 9_999) / 10_000
	if amount < 0 {
		return 0, fmt.Errorf("积分计费金额无效：%d", amount)
	}
	return amount, nil
}

// RestoreRefundedBillingOrder compensates a billing order that was refunded
// before an operator confirmed the upstream task had actually succeeded.
//
// The original reservation has already been returned to available credits, so
// this transition charges the final amount directly from available credits.
// The conditional refunded -> settled update keeps concurrent/repeated manual
// recovery requests idempotent.
func (r *Repository) RestoreRefundedBillingOrder(id string, providerRequestID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var order model.BillingOrder
		if err := tx.First(&order, "id = ?", id).Error; err != nil {
			return err
		}
		if order.Status == model.BillingStatusSettled {
			return nil
		}
		if order.Status != model.BillingStatusRefunded {
			return ErrBillingStateConflict
		}
		if order.BillingMode != "token" {
			if err := validateBillingChargeLimit(order, order.AmountMicrocredits); err != nil {
				return err
			}
		}

		actual := order.AmountMicrocredits
		var usage *BillingUsage
		var usageSource string
		if order.BillingMode == "token" {
			if zeroPricedTokenOrder(order) {
				actual = 0
			} else {
				var err error
				usage, usageSource, err = tokenSettlementUsage(tx, order)
				if err != nil {
					return err
				}
				actual, err = tokenUsageAmount(order, usage)
				if err != nil {
					return err
				}
			}
		}
		chargeCapped := billingChargeLimitApplies(order) && actual > order.ChargeLimitMicrocredits
		if chargeCapped {
			actual = order.ChargeLimitMicrocredits
		}
		if actual < 0 {
			return errors.New("invalid restored billing amount")
		}

		updated := tx.Model(&model.CreditAccount{}).
			Where("user_id = ?", order.UserID).
			Updates(map[string]any{
				"available_microcredits": gorm.Expr("available_microcredits - ?", actual),
				"version":                gorm.Expr("version + 1"),
				"updated_at":             time.Now(),
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return errors.New("credit account does not exist")
		}

		var account model.CreditAccount
		if err := tx.First(&account, "user_id = ?", order.UserID).Error; err != nil {
			return err
		}
		now := time.Now()
		orderUpdates := map[string]any{
			"status":                       model.BillingStatusSettled,
			"actual_amount_microcredits":   actual,
			"refunded_amount_microcredits": max(order.AmountMicrocredits-actual, int64(0)),
			"refunded_at":                  nil,
			"settled_at":                   &now,
			"error":                        "",
			"updated_at":                   now,
		}
		if providerRequestID != "" {
			orderUpdates["provider_request_id"] = providerRequestID
		}
		if usage != nil {
			orderUpdates["input_tokens"] = usage.InputTokens
			orderUpdates["output_tokens"] = usage.OutputTokens
			orderUpdates["cached_tokens"] = usage.CachedTokens
			orderUpdates["usage_available"] = usageSource == billingUsageSourceProvider
			orderUpdates["usage_source"] = usageSource
		}
		orderUpdate := tx.Model(&model.BillingOrder{}).
			Where("id = ? AND status = ?", order.ID, model.BillingStatusRefunded).
			Updates(orderUpdates)
		if orderUpdate.Error != nil {
			return orderUpdate.Error
		}
		if orderUpdate.RowsAffected != 1 {
			return ErrBillingStateConflict
		}

		consumeNote := "人工查询确认上游成功，退款订单重新扣费"
		if usageSource == billingUsageSourceVideoFormula {
			consumeNote += "；按提交时的视频 Token 公式快照结算"
		}
		if chargeCapped {
			consumeNote += "；已按本轮 Agent 硬上限结算"
		}
		return tx.Create(&model.CreditLedgerEntry{
			ID:                         newRepositoryID(),
			UserID:                     order.UserID,
			Type:                       model.CreditLedgerConsume,
			AmountMicrocredits:         -actual,
			AvailableDeltaMicrocredits: -actual,
			AvailableAfterMicrocredits: account.AvailableMicrocredits,
			ReservedAfterMicrocredits:  account.ReservedMicrocredits,
			BillingOrderID:             order.ID,
			Model:                      order.Model,
			ChannelID:                  order.ChannelID,
			Scene:                      order.Scene,
			Note:                       consumeNote,
		}).Error
	})
}

func zeroPricedTokenOrder(order model.BillingOrder) bool {
	return order.BillingMode == "token" &&
		order.InputTokenPriceMicrocredits == 0 &&
		order.OutputTokenPriceMicrocredits == 0 &&
		order.CachedTokenPriceMicrocredits == 0
}

func (r *Repository) RefundBillingOrder(id string, errorText string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var order model.BillingOrder
		if err := tx.First(&order, "id = ?", id).Error; err != nil {
			return err
		}
		if order.Status == model.BillingStatusRefunded {
			return nil
		}
		if order.Status == model.BillingStatusSettled {
			return errors.New("settled billing order requires a manual refund")
		}
		updated := tx.Model(&model.CreditAccount{}).
			Where("user_id = ? AND reserved_microcredits >= ?", order.UserID, order.AmountMicrocredits).
			Updates(map[string]any{
				"available_microcredits": gorm.Expr("available_microcredits + ?", order.AmountMicrocredits),
				"reserved_microcredits":  gorm.Expr("reserved_microcredits - ?", order.AmountMicrocredits),
				"version":                gorm.Expr("version + 1"),
				"updated_at":             time.Now(),
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return errors.New("reserved credit balance is inconsistent")
		}
		var account model.CreditAccount
		if err := tx.First(&account, "user_id = ?", order.UserID).Error; err != nil {
			return err
		}
		now := time.Now()
		updates := map[string]any{"status": model.BillingStatusRefunded, "error": errorText, "refunded_amount_microcredits": order.AmountMicrocredits, "refunded_at": &now, "updated_at": now}
		if err := tx.Model(&order).Updates(updates).Error; err != nil {
			return err
		}
		return tx.Create(&model.CreditLedgerEntry{
			ID:                         newRepositoryID(),
			UserID:                     order.UserID,
			Type:                       model.CreditLedgerRefund,
			AmountMicrocredits:         order.AmountMicrocredits,
			AvailableDeltaMicrocredits: order.AmountMicrocredits,
			ReservedDeltaMicrocredits:  -order.AmountMicrocredits,
			AvailableAfterMicrocredits: account.AvailableMicrocredits,
			ReservedAfterMicrocredits:  account.ReservedMicrocredits,
			BillingOrderID:             order.ID,
			Model:                      order.Model,
			ChannelID:                  order.ChannelID,
			Scene:                      order.Scene,
			Note:                       errorText,
		}).Error
	})
}

func tokenUsageAmount(order model.BillingOrder, usage *BillingUsage) (int64, error) {
	if usage == nil {
		return 0, ErrBillingUsageUnavailable
	}
	if usage.InputTokens < 0 || usage.OutputTokens < 0 || usage.CachedTokens < 0 {
		return 0, errors.New("invalid token usage amount")
	}
	if order.Capability == "video" && usage.OutputTokens <= 0 {
		return 0, ErrBillingUsageUnavailable
	}
	terms := []kernel.TokenBillingTerm{
		{Tokens: usage.OutputTokens, PriceMicrocredits: order.OutputTokenPriceMicrocredits},
	}
	// 视频 Token 总用量已由供应商 completion_tokens 表达，不再叠加文本输入和缓存费用。
	if order.Capability != "video" {
		input := max(usage.InputTokens-usage.CachedTokens, 0)
		terms = append(terms,
			kernel.TokenBillingTerm{Tokens: input, PriceMicrocredits: order.InputTokenPriceMicrocredits},
			kernel.TokenBillingTerm{Tokens: usage.CachedTokens, PriceMicrocredits: order.CachedTokenPriceMicrocredits},
		)
	}
	amount, err := kernel.TokenBillingAmount(order.MultiplierBasisPoints, terms...)
	if err != nil {
		return 0, errors.New("invalid token usage amount")
	}
	return amount, nil
}

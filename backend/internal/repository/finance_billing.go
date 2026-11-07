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
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
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
		Note:                       referenceVideoLedgerNote(*order),
	}).Error
}

// referenceVideoLedgerNote 在账单流水里写明参考视频秒数和计费状态；没有参考视频时为空。
func referenceVideoLedgerNote(order model.BillingOrder) string {
	if order.ReferenceVideoCount <= 0 {
		return ""
	}
	status := "未计费"
	if order.ReferenceVideoBilled {
		status = "已计费"
	}
	if order.ReferenceVideoMillis <= 0 {
		return fmt.Sprintf("参考视频 %d 个%s", order.ReferenceVideoCount, status)
	}
	seconds := fmt.Sprintf("%.1f", float64(order.ReferenceVideoMillis)/1000)
	if order.ReferenceVideoMillis%1000 == 0 {
		seconds = fmt.Sprintf("%d", order.ReferenceVideoMillis/1000)
	}
	return "参考视频 " + seconds + " 秒" + status
}

func joinLedgerNotes(notes ...string) string {
	parts := make([]string, 0, len(notes))
	for _, note := range notes {
		if note = strings.TrimSpace(note); note != "" {
			parts = append(parts, note)
		}
	}
	return strings.Join(parts, "；")
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

type BillingAutoRefundCursor struct {
	CreatedAt time.Time
	ID        string
}

// AutoRefundableBillingOrders 只自动退回通用任务已失败或取消、且没有作品交付证据的订单。
// 无通用任务的订单可能属于电商等独立运行域，不能把缺少 tasks 行当作停止执行的证据。
func (r *Repository) AutoRefundableBillingOrders(limit int, before *BillingAutoRefundCursor) ([]BillingAutoRefundCursor, error) {
	var items []BillingAutoRefundCursor
	query := autoRefundableBillingQuery(r.db)
	if before != nil {
		query = query.Where("billing_orders.created_at < ? OR (billing_orders.created_at = ? AND billing_orders.id < ?)", before.CreatedAt, before.CreatedAt, before.ID)
	}
	// 扫描只读取定位字段；退款事务重新检查资格并读取完整订单。
	err := query.Select("billing_orders.id", "billing_orders.created_at").
		Order("billing_orders.created_at desc, billing_orders.id desc").Limit(limit).Find(&items).Error
	return items, err
}

func autoRefundableBillingQuery(db *gorm.DB) *gorm.DB {
	return db.Model(&model.BillingOrder{}).
		Joins("JOIN tasks ON tasks.id = billing_orders.task_id").
		Where("billing_orders.status IN ? OR (billing_orders.status = ? AND billing_orders.updated_at < ?)",
			[]model.BillingStatus{model.BillingStatusUncertain, model.BillingStatusReserved}, model.BillingStatusRunning, time.Now().Add(-40*time.Minute)).
		Where("tasks.status IN ?", []model.TaskStatus{model.TaskStatusFailed, model.TaskStatusCancelled}).
		Where("COALESCE(tasks.media_recovery_json, '') = '' AND COALESCE(tasks.execution_diagnostic_json, '') NOT LIKE ?", `%"code":"result_persistence_failed"%`)
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

// BillingOrderHasTerminalFailure 只读取该次订单的明确上游失败证据，不借用重试后的任务状态。
func (r *Repository) BillingOrderHasTerminalFailure(orderID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.ApiCallLog{}).
		Where("billing_order_id = ? AND billable = ? AND request_kind = ? AND status = ? AND error_code IN ?", orderID, true, "create", model.ApiCallStatusFailed, []string{"task_failed", "task_cancelled"}).
		Count(&count).Error
	return count > 0, err
}

func (r *Repository) BillingOrderHasSuccessfulBillableCall(orderID string) (bool, error) {
	var count int64
	err := r.db.Model(&model.ApiCallLog{}).
		Where("billing_order_id = ? AND billable = ? AND status = ?", orderID, true, model.ApiCallStatusSucceeded).
		Count(&count).Error
	return count > 0, err
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
	// CacheWriteTokens 已计入 InputTokens。
	CacheWriteTokens int64
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
	return &BillingUsage{InputTokens: log.InputTokens, OutputTokens: log.OutputTokens, CachedTokens: log.CachedTokens, CacheWriteTokens: log.CacheWriteTokens}, nil
}

const (
	billingUsageSourceProvider     = "provider"
	billingUsageSourceVideoFormula = "video_formula"
)

func tokenSettlementUsage(db *gorm.DB, order model.BillingOrder) (*BillingUsage, string, error) {
	// 参考视频不计费的视频订单：上游 usage 含参考视频用量，不能直接计费；
	// 改用提交时只按生成时长固化的公式快照结算。
	if order.Capability == "video" && order.ReferenceVideoCount > 0 && !order.ReferenceVideoBilled && order.VideoFormulaTokens > 0 {
		return &BillingUsage{OutputTokens: order.VideoFormulaTokens}, billingUsageSourceVideoFormula, nil
	}
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
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", id).Error; err != nil {
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
			actual, priceRule, err := tokenUsageAmount(order, usage)
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
				"input_tokens": usage.InputTokens, "output_tokens": usage.OutputTokens, "cached_tokens": usage.CachedTokens, "cache_write_tokens": usage.CacheWriteTokens,
				"usage_available": usageSource == billingUsageSourceProvider, "usage_source": usageSource, "token_price_rule": priceRule}
			if providerRequestID != "" {
				updates["provider_request_id"] = providerRequestID
			}
			if err := updateBillingOrderState(tx, order, updates); err != nil {
				return err
			}
			consumeNote := ""
			if chargeCapped {
				consumeNote = "Token 实际用量超过 Agent 报价，已按本轮硬上限结算"
			} else if supplement > 0 {
				consumeNote = "Token 实际用量超过预授权，已补扣差额"
			}
			if priceRule > 0 {
				ruleNote := fmt.Sprintf("按分时与上下文价格第 %d 条结算", priceRule)
				if consumeNote != "" {
					ruleNote += "；" + consumeNote
				}
				consumeNote = ruleNote
			}
			if usageSource == billingUsageSourceVideoFormula {
				consumeNote = strings.TrimSpace("按提交时的视频 Token 公式快照结算；" + consumeNote)
			}
			if err := tx.Create(&model.CreditLedgerEntry{ID: newRepositoryID(), UserID: order.UserID, Type: model.CreditLedgerConsume,
				AmountMicrocredits: -actual, AvailableDeltaMicrocredits: -supplement, ReservedDeltaMicrocredits: -reserved,
				AvailableAfterMicrocredits: account.AvailableMicrocredits, ReservedAfterMicrocredits: account.ReservedMicrocredits,
				BillingOrderID: order.ID, Model: order.Model, ChannelID: order.ChannelID, Scene: order.Scene, Note: joinLedgerNotes(consumeNote, referenceVideoLedgerNote(order))}).Error; err != nil {
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
		// 音频始终按实测时长结算；视频处理任务（画质增强等）由调用方显式传入输出时长，
		// 普通视频生成仍传 nil，保持按请求时长一次扣定。
		if order.BillingMode == "per_second" && (order.Capability == "audio" || (order.Capability == "video" && audioDurationMs != nil)) {
			mediaLabel := "音频"
			if order.Capability == "video" {
				mediaLabel = "视频"
			}
			if audioDurationMs == nil || *audioDurationMs <= 0 {
				return errors.New(mediaLabel + "实际时长不可用，无法按秒结算")
			}
			quantity = (*audioDurationMs + 999) / 1000
			if order.Capability == "video" && order.ReferenceVideoBilled {
				// 与预留一致：开启参考视频计费的按秒订单 = 输出秒数 + 后端实测的参考视频秒数。
				quantity += (order.ReferenceVideoMillis + 999) / 1000
			}
			var err error
			actual, err = audioBillingAmount(order.UnitPriceMicrocredits, quantity, order.MultiplierBasisPoints)
			if err != nil {
				return err
			}
			if billingChargeLimitApplies(order) && actual > order.ChargeLimitMicrocredits {
				return errors.New(mediaLabel + "实际费用超过本次授权上限，需人工核对")
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
				return errors.New("预留积分不足以完成" + mediaLabel + "实际结算")
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
			if err := updateBillingOrderState(tx, order, orderUpdates); err != nil {
				return err
			}
			note := mediaLabel + "按实际输出时长结算"
			if supplement > 0 {
				note += "，已补扣差额"
			}
			note = joinLedgerNotes(note, referenceVideoLedgerNote(order))
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
					BillingOrderID: order.ID, Model: order.Model, ChannelID: order.ChannelID, Scene: order.Scene, Note: mediaLabel + "实际时长短于预授权，差额退回"}).Error; err != nil {
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
		if err := updateBillingOrderState(tx, order, orderUpdates); err != nil {
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
			Note:                       referenceVideoLedgerNote(order),
		}).Error
	})
	if err != nil && observedUsage != nil {
		// 即使账户状态异常导致回滚，也保留结算依据并标明来源，供用户和管理员核对。
		updates := map[string]any{
			"input_tokens": observedUsage.InputTokens, "output_tokens": observedUsage.OutputTokens,
			"cached_tokens": observedUsage.CachedTokens, "cache_write_tokens": observedUsage.CacheWriteTokens, "usage_available": observedUsageSource == billingUsageSourceProvider,
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
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", id).Error; err != nil {
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
		priceRule := 0
		if order.BillingMode == "token" {
			if zeroPricedTokenOrder(order) {
				actual = 0
			} else {
				var err error
				usage, usageSource, err = tokenSettlementUsage(tx, order)
				if err != nil {
					return err
				}
				actual, priceRule, err = tokenUsageAmount(order, usage)
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
			orderUpdates["cache_write_tokens"] = usage.CacheWriteTokens
			orderUpdates["usage_available"] = usageSource == billingUsageSourceProvider
			orderUpdates["usage_source"] = usageSource
			orderUpdates["token_price_rule"] = priceRule
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
	if order.BillingMode != "token" ||
		order.InputTokenPriceMicrocredits != 0 ||
		order.OutputTokenPriceMicrocredits != 0 ||
		order.CachedTokenPriceMicrocredits != 0 ||
		order.CacheWriteTokenPriceMicrocredits != 0 {
		return false
	}
	// 基础价为 0 但分时规则有价时仍需读取 usage 结算；快照损坏交给结算路径报错。
	rules, err := order.BillingTokenPriceRules()
	if err != nil {
		return false
	}
	for _, rule := range rules {
		if rule.Input != 0 || rule.Output != 0 || rule.Cached != 0 || rule.CacheWrite != 0 {
			return false
		}
	}
	return true
}

func (r *Repository) RefundBillingOrder(id string, errorText string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var order model.BillingOrder
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", id).Error; err != nil {
			return err
		}
		return refundBillingOrder(tx, order, errorText)
	})
}

// AutoRefundBillingOrder 重新检查候选，避免扫描后任务重试或作品落库仍被自动退款。
// 锁顺序与任务写路径保持一致：任务、订单、账户。退款及处理记录一起提交。
func (r *Repository) AutoRefundBillingOrder(id string, note string) (bool, error) {
	refunded := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var candidate model.BillingOrder
		if err := tx.Select("id", "task_id").First(&candidate, "id = ?", id).Error; err != nil {
			return err
		}
		if candidate.TaskID != "" {
			var task model.Task
			err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").First(&task, "id = ?", candidate.TaskID).Error
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		var order model.BillingOrder
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", id).Error; err != nil {
			return err
		}
		var count int64
		if err := autoRefundableBillingQuery(tx).Where("billing_orders.id = ?", id).Count(&count).Error; err != nil {
			return err
		}
		if count == 0 {
			return nil
		}
		if err := refundBillingOrder(tx, order, note); err != nil {
			return err
		}
		if err := New(tx).RecordBillingResolution(id, "", note); err != nil {
			return err
		}
		refunded = true
		return nil
	})
	return refunded && err == nil, err
}

// updateBillingOrderState 是账务事务的最后一道状态栅栏；冲突必须回滚账户和流水。
func updateBillingOrderState(tx *gorm.DB, order model.BillingOrder, updates map[string]any) error {
	result := tx.Model(&model.BillingOrder{}).Where("id = ? AND status = ?", order.ID, order.Status).Updates(updates)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return ErrBillingStateConflict
	}
	return nil
}

func refundBillingOrder(tx *gorm.DB, order model.BillingOrder, errorText string) error {
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
	if err := updateBillingOrderState(tx, order, updates); err != nil {
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
}

// tokenUsageAmount 返回实际费用与命中的分时规则序号（0 表示基础价）。上下文档位按 usage.InputTokens
// 判定，它包含缓存命中与缓存写入，与上游计费口径的“输入上下文”一致。
func tokenUsageAmount(order model.BillingOrder, usage *BillingUsage) (int64, int, error) {
	if usage == nil {
		return 0, 0, ErrBillingUsageUnavailable
	}
	if usage.InputTokens < 0 || usage.OutputTokens < 0 || usage.CachedTokens < 0 || usage.CacheWriteTokens < 0 {
		return 0, 0, errors.New("invalid token usage amount")
	}
	if order.Capability == "video" && usage.OutputTokens <= 0 {
		return 0, 0, ErrBillingUsageUnavailable
	}
	prices, rule, err := order.TokenPrices(usage.InputTokens)
	if err != nil {
		return 0, 0, err
	}
	terms := []kernel.TokenBillingTerm{
		{Tokens: usage.OutputTokens, PriceMicrocredits: prices.Output},
	}
	// 视频 Token 总用量已由供应商 completion_tokens 表达，不再叠加文本输入和缓存费用。
	if order.Capability != "video" {
		input := max(usage.InputTokens-usage.CachedTokens-usage.CacheWriteTokens, 0)
		terms = append(terms,
			kernel.TokenBillingTerm{Tokens: input, PriceMicrocredits: prices.Input},
			kernel.TokenBillingTerm{Tokens: usage.CachedTokens, PriceMicrocredits: prices.Cached},
			kernel.TokenBillingTerm{Tokens: usage.CacheWriteTokens, PriceMicrocredits: prices.CacheWrite},
		)
	}
	amount, err := kernel.TokenBillingAmount(order.MultiplierBasisPoints, terms...)
	if err != nil {
		return 0, 0, errors.New("invalid token usage amount")
	}
	return amount, rule, nil
}

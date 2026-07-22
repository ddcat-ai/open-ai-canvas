package repository

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInsufficientCredits  = errors.New("insufficient credits")
	ErrRedeemCodeInvalid    = errors.New("redeem code invalid")
	ErrActiveTaskLimit      = errors.New("active task limit reached")
	ErrTaskNotRetryable     = errors.New("task is not retryable")
	ErrBillingStateConflict = errors.New("billing state conflict")
)

// 先抢占唯一业务键再更新账户，确保注册和签到奖励在多实例并发下只入账一次。
func (r *Repository) GrantCreditsOnce(userID string, entryType model.CreditLedgerType, amount int64, referenceKey string, note string) (*model.CreditAccount, bool, error) {
	var account model.CreditAccount
	granted := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		account = model.CreditAccount{UserID: userID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return err
		}
		entry := model.CreditLedgerEntry{ID: newRepositoryID(), UserID: userID, Type: entryType, AmountMicrocredits: amount, ReferenceKey: &referenceKey, Note: note}
		created := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "reference_key"}}, DoNothing: true}).Create(&entry)
		if created.Error != nil {
			return created.Error
		}
		if created.RowsAffected == 0 {
			return tx.First(&account, "user_id = ?", userID).Error
		}
		granted = true
		if err := tx.Model(&model.CreditAccount{}).Where("user_id = ?", userID).Updates(map[string]any{
			"available_microcredits": gorm.Expr("available_microcredits + ?", amount),
			"version":                gorm.Expr("version + 1"),
			"updated_at":             time.Now(),
		}).Error; err != nil {
			return err
		}
		if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
			return err
		}
		return tx.Model(&entry).Updates(map[string]any{
			"available_delta_microcredits": amount,
			"available_after_microcredits": account.AvailableMicrocredits,
			"reserved_after_microcredits":  account.ReservedMicrocredits,
		}).Error
	})
	return &account, granted, err
}

type AdminRedeemCodeRow struct {
	model.RedeemCode
	RedeemedUsername    string `json:"redeemedUsername" gorm:"column:redeemed_username"`
	RedeemedDisplayName string `json:"redeemedDisplayName" gorm:"column:redeemed_display_name"`
}

func (r *Repository) ChannelModels(channelID string, includeDisabled bool) ([]model.ChannelModel, error) {
	var items []model.ChannelModel
	query := r.db.Where("channel_id = ?", channelID).Order("created_at asc")
	if !includeDisabled {
		query = query.Where("enabled = ?", true)
	}
	return items, query.Find(&items).Error
}

func (r *Repository) ChannelModelByID(channelID string, id string) (*model.ChannelModel, error) {
	var item model.ChannelModel
	if err := r.db.First(&item, "id = ? AND channel_id = ?", id, channelID).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) ChannelModelByKey(channelID string, modelKey string) (*model.ChannelModel, error) {
	var item model.ChannelModel
	if err := r.db.First(&item, "channel_id = ? AND model_key = ? AND enabled = ?", channelID, modelKey, true).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) SaveChannelModel(item *model.ChannelModel) error {
	return r.db.Save(item).Error
}

func (r *Repository) CreditAccount(userID string) (*model.CreditAccount, error) {
	account := model.CreditAccount{UserID: userID}
	if err := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
		return nil, err
	}
	if err := r.db.First(&account, "user_id = ?", userID).Error; err != nil {
		return nil, err
	}
	return &account, nil
}

func (r *Repository) CreditAccounts(userIDs []string) ([]model.CreditAccount, error) {
	if len(userIDs) == 0 {
		return []model.CreditAccount{}, nil
	}
	var accounts []model.CreditAccount
	err := r.db.Where("user_id IN ?", userIDs).Find(&accounts).Error
	return accounts, err
}

func (r *Repository) CreditLedger(userID string, entryType string, limit int, offset int) ([]model.CreditLedgerEntry, int64, error) {
	var items []model.CreditLedgerEntry
	var total int64
	query := r.db.Model(&model.CreditLedgerEntry{}).Where("user_id = ? AND type <> ?", userID, model.CreditLedgerReserve)
	switch entryType {
	case "income":
		query = query.Where("type IN ?", []model.CreditLedgerType{model.CreditLedgerRedeem, model.CreditLedgerAdminGrant, model.CreditLedgerAdminAdjust, model.CreditLedgerSignupBonus, model.CreditLedgerCheckinBonus})
	case "consume":
		query = query.Where("type = ?", model.CreditLedgerConsume)
	case "refund":
		query = query.Where("type = ?", model.CreditLedgerRefund)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	if offset < 0 {
		offset = 0
	}
	err := query.Order("created_at desc").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) CreditLedgerReferenceExists(referenceKey string) (bool, error) {
	var count int64
	err := r.db.Model(&model.CreditLedgerEntry{}).Where("reference_key = ?", referenceKey).Count(&count).Error
	return count > 0, err
}

func (r *Repository) CreateTaskWithCreditReservation(task *model.Task, order *model.BillingOrder) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := enforceActiveTaskLimit(tx, task.UserID); err != nil {
			return err
		}
		if err := reserveBillingOrder(tx, order); err != nil {
			return err
		}
		return tx.Create(task).Error
	})
}

func (r *Repository) CreateTaskWithActiveLimit(task *model.Task) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := enforceActiveTaskLimit(tx, task.UserID); err != nil {
			return err
		}
		return tx.Create(task).Error
	})
}

func (r *Repository) RetryTaskWithBilling(userID string, taskID string, order *model.BillingOrder) (*model.Task, error) {
	var task model.Task
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := enforceActiveTaskLimit(tx, userID); err != nil {
			return err
		}
		if order != nil {
			if err := reserveBillingOrder(tx, order); err != nil {
				return err
			}
		}
		updates := map[string]any{
			"status": model.TaskStatusQueued, "stage": "等待队列调度", "progress": 5, "error": "", "result_json": "",
			"started_at": nil, "completed_at": nil, "updated_at": time.Now(),
		}
		if order != nil {
			updates["billing_order_id"] = order.ID
		}
		updated := tx.Model(&model.Task{}).
			Where("id = ? AND user_id = ? AND status IN ?", taskID, userID, []model.TaskStatus{model.TaskStatusFailed, model.TaskStatusCancelled}).
			Updates(updates)
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrTaskNotRetryable
		}
		return tx.First(&task, "id = ? AND user_id = ?", taskID, userID).Error
	})
	return &task, err
}

func enforceActiveTaskLimit(tx *gorm.DB, userID string) error {
	var count int64
	if err := tx.Model(&model.Task{}).Where("user_id = ? AND status IN ?", userID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).Count(&count).Error; err != nil {
		return err
	}
	if count >= 5 {
		return ErrActiveTaskLimit
	}
	return nil
}

func (r *Repository) ReserveBillingOrder(order *model.BillingOrder) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return reserveBillingOrder(tx, order)
	})
}

func reserveBillingOrder(tx *gorm.DB, order *model.BillingOrder) error {
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
	return r.db.Model(&model.BillingOrder{}).
		Where("id = ? AND status IN ?", id, []model.BillingStatus{model.BillingStatusReserved, model.BillingStatusRunning}).
		Updates(map[string]any{"status": model.BillingStatusUncertain, "error": errorText, "updated_at": time.Now()}).Error
}

func (r *Repository) SettleBillingOrder(id string, providerRequestID string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
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
		orderUpdates := map[string]any{"status": model.BillingStatusSettled, "settled_at": &now, "updated_at": now}
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
		if err := tx.Model(&order).Updates(map[string]any{"status": model.BillingStatusRefunded, "error": errorText, "refunded_at": &now, "updated_at": now}).Error; err != nil {
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

func (r *Repository) AdjustCredits(userID string, actorUserID string, amount int64, note string) (*model.CreditAccount, error) {
	var account model.CreditAccount
	err := r.db.Transaction(func(tx *gorm.DB) error {
		account = model.CreditAccount{UserID: userID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return err
		}
		updated := tx.Model(&model.CreditAccount{}).
			Where("user_id = ? AND available_microcredits + ? >= 0", userID, amount).
			Updates(map[string]any{
				"available_microcredits": gorm.Expr("available_microcredits + ?", amount),
				"version":                gorm.Expr("version + 1"),
				"updated_at":             time.Now(),
			})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrInsufficientCredits
		}
		if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
			return err
		}
		entryType := model.CreditLedgerAdminAdjust
		if amount > 0 {
			entryType = model.CreditLedgerAdminGrant
		}
		return tx.Create(&model.CreditLedgerEntry{
			ID:                         newRepositoryID(),
			UserID:                     userID,
			Type:                       entryType,
			AmountMicrocredits:         amount,
			AvailableDeltaMicrocredits: amount,
			AvailableAfterMicrocredits: account.AvailableMicrocredits,
			ReservedAfterMicrocredits:  account.ReservedMicrocredits,
			ActorUserID:                actorUserID,
			Note:                       note,
		}).Error
	})
	return &account, err
}

func (r *Repository) CreateRedeemBatch(batch *model.RedeemBatch, codes []model.RedeemCode) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(batch).Error; err != nil {
			return err
		}
		return tx.CreateInBatches(&codes, 200).Error
	})
}

func (r *Repository) AdminRedeemBatches(keyword string, validity string, limit int, offset int) ([]model.RedeemBatch, int64, error) {
	var items []model.RedeemBatch
	var total int64
	query := r.db.Model(&model.RedeemBatch{})
	if value := strings.TrimSpace(keyword); value != "" {
		pattern := "%" + strings.ToLower(value) + "%"
		query = query.Where("lower(note) LIKE ? OR CAST(amount_microcredits AS TEXT) LIKE ? OR CAST(count AS TEXT) LIKE ?", pattern, pattern, pattern)
	}
	if validity == "active" {
		query = query.Where("expires_at IS NULL OR expires_at > ?", time.Now())
	} else if validity == "expired" {
		query = query.Where("expires_at IS NOT NULL AND expires_at <= ?", time.Now())
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	now := time.Now()
	listQuery := query.Select(`redeem_batches.id, redeem_batches.amount_microcredits, redeem_batches.count,
		redeem_batches.note, redeem_batches.created_by, redeem_batches.expires_at, redeem_batches.created_at,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'unused' AND (rc.expires_at IS NULL OR rc.expires_at > ?)) AS available_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'redeemed') AS redeemed_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'disabled') AS disabled_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'unused' AND rc.expires_at IS NOT NULL AND rc.expires_at <= ?) AS expired_count`, now, now)
	if err := listQuery.Order("created_at desc").Limit(limit).Offset(offset).Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *Repository) RedeemBatch(id string) (*model.RedeemBatch, error) {
	var batch model.RedeemBatch
	now := time.Now()
	query := r.db.Model(&model.RedeemBatch{}).Select(`redeem_batches.*,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'unused' AND (rc.expires_at IS NULL OR rc.expires_at > ?)) AS available_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'redeemed') AS redeemed_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'disabled') AS disabled_count,
		(SELECT COUNT(*) FROM redeem_codes rc WHERE rc.batch_id = redeem_batches.id AND rc.status = 'unused' AND rc.expires_at IS NOT NULL AND rc.expires_at <= ?) AS expired_count`, now, now)
	if err := query.First(&batch, "redeem_batches.id = ?", id).Error; err != nil {
		return nil, err
	}
	return &batch, nil
}

func (r *Repository) AdminRedeemCodes(batchID string, status string, limit int, offset int) ([]AdminRedeemCodeRow, int64, error) {
	var items []AdminRedeemCodeRow
	var total int64
	query := r.db.Model(&model.RedeemCode{}).Where("redeem_codes.batch_id = ?", batchID)
	now := time.Now()
	switch status {
	case "available":
		query = query.Where("redeem_codes.status = ? AND (redeem_codes.expires_at IS NULL OR redeem_codes.expires_at > ?)", model.RedeemCodeUnused, now)
	case "redeemed":
		query = query.Where("redeem_codes.status = ?", model.RedeemCodeRedeemed)
	case "disabled":
		query = query.Where("redeem_codes.status = ?", model.RedeemCodeDisabled)
	case "expired":
		query = query.Where("redeem_codes.status = ? AND redeem_codes.expires_at IS NOT NULL AND redeem_codes.expires_at <= ?", model.RedeemCodeUnused, now)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	err := query.Select("redeem_codes.*, users.username AS redeemed_username, users.display_name AS redeemed_display_name").
		Joins("LEFT JOIN users ON users.id = redeem_codes.redeemed_by").
		Order("redeem_codes.created_at asc, redeem_codes.id asc").Limit(limit).Offset(offset).Scan(&items).Error
	return items, total, err
}

func (r *Repository) RedeemCode(userID string, codeHash string, redeemedIP string) (*model.CreditAccount, error) {
	var account model.CreditAccount
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var code model.RedeemCode
		if err := tx.First(&code, "code_hash = ?", codeHash).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrRedeemCodeInvalid
			}
			return err
		}
		now := time.Now()
		query := tx.Model(&model.RedeemCode{}).Where("id = ? AND status = ?", code.ID, model.RedeemCodeUnused)
		if code.ExpiresAt != nil {
			query = query.Where("expires_at > ?", now)
		}
		updated := query.Updates(map[string]any{"status": model.RedeemCodeRedeemed, "redeemed_by": userID, "redeemed_at": &now, "redeemed_ip": redeemedIP, "updated_at": now})
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return ErrRedeemCodeInvalid
		}
		account = model.CreditAccount{UserID: userID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.CreditAccount{}).Where("user_id = ?", userID).Updates(map[string]any{
			"available_microcredits": gorm.Expr("available_microcredits + ?", code.AmountMicrocredits),
			"version":                gorm.Expr("version + 1"),
			"updated_at":             now,
		}).Error; err != nil {
			return err
		}
		if err := tx.First(&account, "user_id = ?", userID).Error; err != nil {
			return err
		}
		return tx.Create(&model.CreditLedgerEntry{
			ID:                         newRepositoryID(),
			UserID:                     userID,
			Type:                       model.CreditLedgerRedeem,
			AmountMicrocredits:         code.AmountMicrocredits,
			AvailableDeltaMicrocredits: code.AmountMicrocredits,
			AvailableAfterMicrocredits: account.AvailableMicrocredits,
			ReservedAfterMicrocredits:  account.ReservedMicrocredits,
			RedeemCodeID:               code.ID,
			Note:                       "兑换码充值",
		}).Error
	})
	return &account, err
}

func newRepositoryID() string {
	return randomRepositorySuffix()
}

func randomRepositorySuffix() string {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "fallback"
	}
	return hex.EncodeToString(value[:])
}

package repository

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
)

var (
	ErrInsufficientCredits     = errors.New("积分不足，请先充值")
	ErrRedeemCodeInvalid       = errors.New("兑换码无效或已使用")
	ErrActiveTaskLimit         = errors.New("同时进行的任务数已达上限，请等待已有任务完成")
	ErrTaskNotRetryable        = errors.New("该任务当前状态不支持重试")
	ErrBillingStateConflict    = errors.New("计费状态已变化，请刷新后重试")
	ErrBillingUsageUnavailable = errors.New("暂时无法获取用量，计费未完成")
	ErrBillingChargeLimit      = errors.New("本次费用超过授权上限，已拒绝扣费")
	ErrChannelModelInUse       = errors.New("该渠道模型正在被使用，无法删除或停用")
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

func (r *Repository) CreateTaskWithCreditReservation(task *model.Task, order *model.BillingOrder, activeTaskLimit int) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockOwnedWriteUser(tx, task.UserID); err != nil {
			return err
		}
		if err := requireActiveAgentSessionForTask(tx, task); err != nil {
			return err
		}
		if err := r.requireActiveLogicalModelForTask(tx, task); err != nil {
			return err
		}
		if err := enforceActiveTaskLimit(tx, task.UserID, activeTaskLimit); err != nil {
			return err
		}
		if err := reserveBillingOrder(tx, order); err != nil {
			return err
		}
		return tx.Create(task).Error
	})
}

func (r *Repository) CreateTaskWithActiveLimit(task *model.Task, activeTaskLimit int) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockOwnedWriteUser(tx, task.UserID); err != nil {
			return err
		}
		if err := requireActiveAgentSessionForTask(tx, task); err != nil {
			return err
		}
		if err := r.requireActiveLogicalModelForTask(tx, task); err != nil {
			return err
		}
		if err := enforceActiveTaskLimit(tx, task.UserID, activeTaskLimit); err != nil {
			return err
		}
		return tx.Create(task).Error
	})
}

func (r *Repository) RetryTaskWithBilling(userID string, prepared *model.Task, order *model.BillingOrder, activeTaskLimit int) (*model.Task, error) {
	var task model.Task
	taskID := prepared.ID
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := enforceActiveTaskLimit(tx, userID, activeTaskLimit); err != nil {
			return err
		}
		if order != nil {
			if err := reserveBillingOrder(tx, order); err != nil {
				return err
			}
		}
		updates := map[string]any{
			"status": model.TaskStatusQueued, "stage": "等待队列调度", "progress": 5, "error": "", "result_json": "",
			"execution_diagnostic_json": "", "cancellation_source": "", "cancellation_actor_id": "", "cancellation_requested_at": nil,
			"text_draft": "", "started_at": nil, "completed_at": nil,
			"provider_request_id": "", "poll_stage": "", "next_poll_at": nil,
			"provider_cancel_status": "", "provider_cancel_error": "", "provider_cancel_attempts": 0,
			"provider_cancel_requested_at": nil, "provider_cancelled_at": nil, "provider_cancel_next_check_at": nil,
			"route_run":                 gorm.Expr("route_run + ?", 1),
			"logical_model_revision_id": prepared.LogicalModelRevisionID, "route_id": prepared.RouteID,
			"channel_model_id": prepared.ChannelModelID, "input_json": prepared.InputJSON,
			"model": prepared.Model, "provider": prepared.Provider,
			"lease_owner": "", "lease_expires_at": nil, "updated_at": time.Now(),
		}
		if order != nil {
			updates["billing_order_id"] = order.ID
		} else {
			// 免费模式重试必须解除旧订单，避免任务执行阶段复用上一次的计费状态。
			updates["billing_order_id"] = ""
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
		if err := tx.Delete(&model.TaskTextDelta{}, "user_id = ? AND task_id = ?", userID, taskID).Error; err != nil {
			return err
		}
		return tx.First(&task, "id = ? AND user_id = ?", taskID, userID).Error
	})
	return &task, err
}

func enforceActiveTaskLimit(tx *gorm.DB, userID string, activeTaskLimit int) error {
	var count int64
	if err := tx.Model(&model.Task{}).Where("user_id = ? AND status IN ?", userID, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).Count(&count).Error; err != nil {
		return err
	}
	if count >= int64(activeTaskLimit) {
		return ErrActiveTaskLimit
	}
	return nil
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

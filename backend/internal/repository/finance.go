package repository

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

var (
	ErrInsufficientCredits     = errors.New("insufficient credits")
	ErrRedeemCodeInvalid       = errors.New("redeem code invalid")
	ErrActiveTaskLimit         = errors.New("active task limit reached")
	ErrTaskNotRetryable        = errors.New("task is not retryable")
	ErrBillingStateConflict    = errors.New("billing state conflict")
	ErrBillingUsageUnavailable = errors.New("billing usage unavailable")
	ErrChannelModelInUse       = errors.New("channel model is in use")
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
	if err := query.Find(&items).Error; err != nil {
		return nil, err
	}
	pointers := make([]*model.ChannelModel, len(items))
	for index := range items {
		pointers[index] = &items[index]
	}
	return items, r.attachChannelModelPriceTiers(pointers)
}

func (r *Repository) ChannelModelByID(channelID string, id string) (*model.ChannelModel, error) {
	var item model.ChannelModel
	if err := r.db.First(&item, "id = ? AND channel_id = ?", id, channelID).Error; err != nil {
		return nil, err
	}
	if err := r.attachChannelModelPriceTiers([]*model.ChannelModel{&item}); err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) ChannelModelByKey(channelID string, modelKey string) (*model.ChannelModel, error) {
	var item model.ChannelModel
	if err := r.db.First(&item, "channel_id = ? AND model_key = ? AND enabled = ?", channelID, modelKey, true).Error; err != nil {
		return nil, err
	}
	if err := r.attachChannelModelPriceTiers([]*model.ChannelModel{&item}); err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) ChannelModelByKeyIncludingDisabled(channelID string, modelKey string) (*model.ChannelModel, error) {
	var item model.ChannelModel
	if err := r.db.First(&item, "channel_id = ? AND model_key = ?", channelID, modelKey).Error; err != nil {
		return nil, err
	}
	if err := r.attachChannelModelPriceTiers([]*model.ChannelModel{&item}); err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) SaveChannelModel(item *model.ChannelModel) error {
	return r.db.Save(item).Error
}

// SaveChannelModelWithPriceTiers 原子保存系统模型与其活动价格档。移除价格档采用软删除，
// 让已结算订单的 PriceTierID 仍能回溯到原始配置版本。
func (r *Repository) SaveChannelModelWithPriceTiers(item *model.ChannelModel, tiers []model.ChannelModelPriceTier) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var existing []model.ChannelModelPriceTier
		if err := tx.Where("channel_model_id = ?", item.ID).Find(&existing).Error; err != nil {
			return err
		}
		existingByKey := make(map[string]model.ChannelModelPriceTier, len(existing))
		for _, tier := range existing {
			existingByKey[channelModelPriceTierKey(tier)] = tier
		}
		selected := make(map[string]bool, len(tiers))
		for index := range tiers {
			tier := &tiers[index]
			tier.ChannelModelID = item.ID
			key := channelModelPriceTierKey(*tier)
			if existingTier, exists := existingByKey[key]; exists {
				tier.ID = existingTier.ID
				tier.PriceVersion = existingTier.PriceVersion + 1
				if err := tx.Save(tier).Error; err != nil {
					return err
				}
			} else if err := tx.Create(tier).Error; err != nil {
				return err
			}
			selected[tier.ID] = true
		}
		for _, tier := range existing {
			if selected[tier.ID] {
				continue
			}
			if err := tx.Delete(&tier).Error; err != nil {
				return err
			}
		}
		if err := tx.Save(item).Error; err != nil {
			return err
		}
		return nil
	})
}

func channelModelPriceTierKey(tier model.ChannelModelPriceTier) string {
	if strings.TrimSpace(tier.SelectorKey) != "" {
		return tier.SelectorKey
	}
	_, key, err := model.CanonicalSKUSelector(map[string]string{
		"vquality":     strings.TrimSpace(tier.Resolution),
		"videoSeconds": strconv.Itoa(tier.VideoSeconds),
	})
	if err != nil {
		return "{}"
	}
	return key
}

func (r *Repository) attachChannelModelPriceTiers(items []*model.ChannelModel) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, 0, len(items))
	for _, item := range items {
		ids = append(ids, item.ID)
	}
	var tiers []model.ChannelModelPriceTier
	if r.db.Migrator().HasTable(&model.ChannelModelPriceTier{}) {
		if err := r.db.Where("channel_model_id IN ?", ids).Order("selector_key asc, created_at asc").Find(&tiers).Error; err != nil {
			return err
		}
	}
	for index := range tiers {
		tiers[index].Selector = model.DecodeSKUSelector(tiers[index].SelectorJSON)
	}
	tiersByModelID := make(map[string][]model.ChannelModelPriceTier, len(items))
	for _, tier := range tiers {
		tiersByModelID[tier.ChannelModelID] = append(tiersByModelID[tier.ChannelModelID], tier)
	}
	for _, item := range items {
		item.PriceTiers = tiersByModelID[item.ID]
		// 兼容尚未执行价格档回填的旧数据库；正式迁移会将同一数据持久化为默认档。
		if len(item.PriceTiers) == 0 && item.PriceConfigured {
			item.PriceTiers = []model.ChannelModelPriceTier{{
				ChannelModelID: item.ID, SelectorKey: "{}", SelectorJSON: "{}", Resolution: "*",
				ProviderModelKey: item.ProviderModelKey, BillingMode: item.BillingMode,
				UnitPriceMicrocredits: item.UnitPriceMicrocredits, InputTokenPriceMicrocredits: item.InputTokenPriceMicrocredits,
				OutputTokenPriceMicrocredits: item.OutputTokenPriceMicrocredits, CachedTokenPriceMicrocredits: item.CachedTokenPriceMicrocredits,
				PriceConfigured: item.PriceConfigured, Enabled: item.Enabled, PriceVersion: item.PriceVersion,
			}}
		}
	}
	return nil
}

// PopulateChannelModelPriceTiers 将价格档附着到已经查询出的渠道模型，供路由关系图批量加载使用。
func (r *Repository) PopulateChannelModelPriceTiers(items []model.ChannelModel) error {
	pointers := make([]*model.ChannelModel, len(items))
	for index := range items {
		pointers[index] = &items[index]
	}
	return r.attachChannelModelPriceTiers(pointers)
}

func (r *Repository) PopulateChannelModelPriceTier(item *model.ChannelModel) error {
	if item == nil {
		return nil
	}
	return r.attachChannelModelPriceTiers([]*model.ChannelModel{item})
}

func (r *Repository) DeleteChannelModel(channelID string, id string, modelsJSON string, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var activeReferences int64
		if err := tx.Table("logical_model_routes AS route").
			Joins("JOIN logical_models AS logical_model ON logical_model.active_revision_id = route.logical_model_revision_id").
			Where("route.channel_model_id = ?", id).
			Count(&activeReferences).Error; err != nil {
			return err
		}
		if activeReferences > 0 {
			return ErrChannelModelInUse
		}
		if err := tx.Model(&model.Task{}).
			Where("channel_model_id = ? AND status IN ?", id, []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning}).
			Count(&activeReferences).Error; err != nil {
			return err
		}
		if activeReferences > 0 {
			return ErrChannelModelInUse
		}
		result := tx.Model(&model.ChannelModel{}).
			Where("id = ? AND channel_id = ?", id, channelID).
			Updates(map[string]any{"enabled": false, "price_version": gorm.Expr("price_version + 1"), "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Where("id = ? AND channel_id = ?", id, channelID).Delete(&model.ChannelModel{}).Error; err != nil {
			return err
		}
		channelResult := tx.Model(&model.ModelChannel{}).
			Where("id = ? AND scope = ?", channelID, model.ChannelScopeSystem).
			Updates(map[string]any{"models_json": modelsJSON, "updated_at": now})
		if channelResult.Error != nil {
			return channelResult.Error
		}
		if channelResult.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

func (r *Repository) CreateMissingChannelModels(items []model.ChannelModel) (int64, error) {
	if len(items) == 0 {
		return 0, nil
	}
	// 拉取目录可能与其他管理员操作并发，唯一键冲突时保留已有定价配置。
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&items)
	return result.RowsAffected, result.Error
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

func (r *Repository) ReserveBillingOrder(order *model.BillingOrder) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		return reserveBillingOrder(tx, order)
	})
}

func reserveBillingOrder(tx *gorm.DB, order *model.BillingOrder) error {
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
	var observedUsage *BillingUsage
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
		if order.BillingMode == "token" && !zeroPricedTokenOrder(order) {
			usage, err := billingUsage(tx, id)
			if err != nil {
				return err
			}
			observedUsage = usage
			reserved := order.ReservedAmountMicrocredits
			if reserved <= 0 {
				reserved = order.AmountMicrocredits
			}
			actual, err := tokenUsageAmount(order, usage)
			if err != nil {
				return err
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
				"usage_available": true}
			if providerRequestID != "" {
				updates["provider_request_id"] = providerRequestID
			}
			if err := tx.Model(&order).Updates(updates).Error; err != nil {
				return err
			}
			consumeNote := ""
			if supplement > 0 {
				consumeNote = "Token 实际用量超过预授权，已补扣差额"
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
		// usage 是上游已经确认的事实；即使结算因账户状态异常回滚，也要保留给用户和管理员核对。
		updates := map[string]any{
			"input_tokens": observedUsage.InputTokens, "output_tokens": observedUsage.OutputTokens,
			"cached_tokens": observedUsage.CachedTokens, "usage_available": true, "updated_at": time.Now(),
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
	if order.Capability == "video" && usage.OutputTokens <= 0 {
		return 0, ErrBillingUsageUnavailable
	}
	input := usage.InputTokens - usage.CachedTokens
	if input < 0 {
		input = 0
	}
	inputAmount, ok := safeTokenUsageProduct(input, order.InputTokenPriceMicrocredits)
	if !ok {
		return 0, errors.New("invalid token usage amount")
	}
	outputAmount, ok := safeTokenUsageProduct(usage.OutputTokens, order.OutputTokenPriceMicrocredits)
	if !ok || inputAmount > 1<<63-1-outputAmount {
		return 0, errors.New("invalid token usage amount")
	}
	cachedAmount, ok := safeTokenUsageProduct(usage.CachedTokens, order.CachedTokenPriceMicrocredits)
	base := inputAmount + outputAmount
	if !ok || base > 1<<63-1-cachedAmount {
		return 0, errors.New("invalid token usage amount")
	}
	base += cachedAmount
	if order.MultiplierBasisPoints <= 0 || base > (1<<63-1-9_999_999_999)/order.MultiplierBasisPoints {
		return 0, errors.New("invalid token usage amount")
	}
	return (base*order.MultiplierBasisPoints + 9_999_999_999) / 10_000_000_000, nil
}

func safeTokenUsageProduct(tokens int64, price int64) (int64, bool) {
	if tokens < 0 || price < 0 || (tokens > 0 && price > (1<<63-1)/tokens) {
		return 0, false
	}
	return tokens * price, true
}

func (r *Repository) AdjustCredits(userID string, actorUserID string, amount int64, note string) (*model.CreditAccount, error) {
	var account model.CreditAccount
	err := r.db.Transaction(func(tx *gorm.DB) error {
		account = model.CreditAccount{UserID: userID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&account).Error; err != nil {
			return err
		}
		accountQuery := tx.Model(&model.CreditAccount{}).Where("user_id = ?", userID)
		if amount < 0 {
			accountQuery = accountQuery.Where("available_microcredits + ? >= 0", amount)
		}
		updated := accountQuery.
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

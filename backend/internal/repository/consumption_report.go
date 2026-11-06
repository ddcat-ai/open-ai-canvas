package repository

import (
	"time"

	"yingce/backend/internal/model"
)

// ConsumptionLedgerRow 是消费日报需要的账本行；Capability 与 DisplayModel 来自关联订单。
type ConsumptionLedgerRow struct {
	Type               model.CreditLedgerType
	AmountMicrocredits int64
	Model              string
	Scene              string
	Capability         string
	BillingOrderID     string
	CreatedAt          time.Time
}

// ConsumptionLedger 读取用户 [from, to) 内的消费与退回流水。
func (r *Repository) ConsumptionLedger(userID string, from, to time.Time) ([]ConsumptionLedgerRow, error) {
	rows := []ConsumptionLedgerRow{}
	err := r.db.Table("credit_ledger_entries AS l").
		Select("l.type, l.amount_microcredits, l.model, l.scene, COALESCE(o.capability, '') AS capability, l.billing_order_id, l.created_at").
		Joins("LEFT JOIN billing_orders o ON o.id = l.billing_order_id").
		Where("l.user_id = ? AND l.type IN ? AND l.created_at >= ? AND l.created_at < ?", userID, []model.CreditLedgerType{model.CreditLedgerConsume, model.CreditLedgerRefund}, from.UTC(), to.UTC()).
		Order("l.created_at").
		Scan(&rows).Error
	return rows, err
}

// ConsumptionReportCandidates 返回已订阅且 [from, to) 内有消费、今天尚未发送日报的用户。
func (r *Repository) ConsumptionReportCandidates(date string, from, to time.Time, limit int) ([]model.User, error) {
	users := []model.User{}
	err := r.db.Model(&model.User{}).
		Joins("JOIN user_notification_settings n ON n.user_id = users.id").
		Where("n.consumption_report_enabled = ? AND n.last_consumption_report_date <> ?", true, date).
		Where("users.status = ? AND users.email <> ''", model.UserStatusActive).
		Where("EXISTS (SELECT 1 FROM credit_ledger_entries l WHERE l.user_id = users.id AND l.type = ? AND l.created_at >= ? AND l.created_at < ?)", model.CreditLedgerConsume, from.UTC(), to.UTC()).
		Order("users.id").Limit(limit).Find(&users).Error
	return users, err
}

// ClaimConsumptionReport 用条件更新占用当天的发送名额；返回 false 表示其他实例已发送。
func (r *Repository) ClaimConsumptionReport(userID, date string) (bool, error) {
	result := r.db.Model(&model.UserNotificationSetting{}).
		Where("user_id = ? AND consumption_report_enabled = ? AND last_consumption_report_date <> ?", userID, true, date).
		Updates(map[string]any{"last_consumption_report_date": date, "updated_at": time.Now()})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) UserNotificationSetting(userID string) (*model.UserNotificationSetting, error) {
	setting := model.UserNotificationSetting{UserID: userID}
	err := r.db.Where("user_id = ?", userID).Limit(1).Find(&setting).Error
	return &setting, err
}

func (r *Repository) SaveConsumptionReportSubscription(userID string, enabled bool) (*model.UserNotificationSetting, error) {
	now := time.Now()
	setting, err := r.UserNotificationSetting(userID)
	if err != nil {
		return nil, err
	}
	setting.ConsumptionReportEnabled = enabled
	setting.UpdatedAt = now
	if setting.CreatedAt.IsZero() {
		setting.CreatedAt = now
	}
	if err := r.db.Save(setting).Error; err != nil {
		return nil, err
	}
	return setting, nil
}

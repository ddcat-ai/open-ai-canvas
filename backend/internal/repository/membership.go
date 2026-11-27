package repository

import (
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrMembershipGroupMissing = errors.New("membership group missing")

func (r *Repository) SaveMembershipCard(product *model.TopupProduct) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var group model.UserGroup
		err := tx.Select("id").Clauses(clause.Locking{Strength: "SHARE"}).Where("code = ?", product.MembershipGroup).Take(&group).Error
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrMembershipGroupMissing
		}
		if err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}},
			DoUpdates: clause.AssignmentColumns([]string{"amount_fen", "currency", "credits_microcredits", "enabled", "membership_group", "updated_by", "updated_at"}),
		}).Create(product).Error
	})
}

func (r *Repository) MembershipPeriods(userID string, now time.Time) ([]model.MembershipPeriod, error) {
	rows := []model.MembershipPeriod{}
	err := r.db.Model(&model.PaymentOrder{}).Select("product_name, membership_group, membership_starts_at, membership_ends_at").
		Where("user_id = ? AND product_kind = ? AND status = ? AND membership_ends_at > ?", userID, model.TopupProductKindMembership, model.PaymentOrderCredited, now.UTC()).
		Order("membership_starts_at").Scan(&rows).Error
	return rows, err
}

func (r *Repository) ActiveMembershipPeriod(userID string, now time.Time) (*model.PaymentOrder, error) {
	var result model.PaymentOrder
	err := r.db.Select("membership_group, membership_ends_at").Where("user_id = ? AND product_kind = ? AND status = ? AND membership_starts_at <= ? AND membership_ends_at > ?",
		userID, model.TopupProductKindMembership, model.PaymentOrderCredited, now.UTC(), now.UTC()).Take(&result).Error
	return &result, err
}

// 以账号行串行化来自不同订单的发放。每张卡独占一段 [start,end)，按实际到账顺序衔接。
func grantMembership(tx *gorm.DB, order *model.PaymentOrder, now time.Time) error {
	if order.MembershipGroup == "" || order.MembershipDays <= 0 || order.MembershipDays > 365 || order.CreditsMicrocredits < 0 {
		return ErrPaymentOrderStateConflict
	}
	var user model.User
	if err := tx.Select("id", "membership_until").Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", order.UserID).Error; err != nil {
		return err
	}
	start := now.UTC()
	if user.MembershipUntil != nil && user.MembershipUntil.After(start) {
		start = user.MembershipUntil.UTC()
	}
	end := start.AddDate(0, 0, order.MembershipDays)
	if err := tx.Model(order).Updates(map[string]any{"membership_starts_at": start, "membership_ends_at": end}).Error; err != nil {
		return err
	}
	return tx.Table("users").Where("id = ?", order.UserID).Update("membership_until", end).Error
}

func membershipReferencesGroup(tx *gorm.DB, code string) (bool, error) {
	var count int64
	if err := tx.Model(&model.TopupProduct{}).Where("membership_group = ?", code).Count(&count).Error; err != nil || count > 0 {
		return count > 0, err
	}
	// 渠道可能迟到补单，未发放订单仍需兑现下单时的分组。
	err := tx.Model(&model.PaymentOrder{}).Where("membership_group = ? AND (status <> ? OR membership_ends_at > ?)", code, model.PaymentOrderCredited, time.Now().UTC()).Count(&count).Error
	return count > 0, err
}

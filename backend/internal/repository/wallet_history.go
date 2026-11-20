package repository

import (
	"time"

	"yingce/backend/internal/model"
)

// WalletHistoryEntry is a read projection: one billing order or one standalone credit entry.
type WalletHistoryEntry struct {
	ID                   string              `json:"id"`
	Type                 string              `json:"type"`
	AmountMicrocredits   int64               `json:"amountMicrocredits"`
	Model                string              `json:"model,omitempty"`
	Scene                string              `json:"scene,omitempty"`
	Note                 string              `json:"note,omitempty"`
	CreatedAt            time.Time           `json:"createdAt"`
	BillingOrderID       string              `json:"billingOrderId,omitempty"`
	BillingStatus        model.BillingStatus `json:"billingStatus,omitempty"`
	ReservedMicrocredits int64               `json:"reservedMicrocredits"`
	ChargedMicrocredits  int64               `json:"chargedMicrocredits"`
	RefundedMicrocredits int64               `json:"refundedMicrocredits"`
	PaymentProviderID    string              `json:"paymentProviderId,omitempty"`
	PaymentProviderName  string              `json:"paymentProviderName,omitempty" gorm:"-"`
}

func (r *Repository) WalletHistory(userID string, entryType string, limit int, offset int) ([]WalletHistoryEntry, int64, error) {
	ledger := r.db.Model(&model.CreditLedgerEntry{}).
		Select(`credit_ledger_entries.id, credit_ledger_entries.type, amount_microcredits, model, scene, note, credit_ledger_entries.created_at,
			'' AS billing_order_id, '' AS billing_status, 0 AS reserved_microcredits,
			0 AS charged_microcredits, 0 AS refunded_microcredits, COALESCE(payment_orders.provider_id, '') AS payment_provider_id`).
		Joins("LEFT JOIN payment_orders ON payment_orders.id = credit_ledger_entries.payment_order_id AND payment_orders.user_id = credit_ledger_entries.user_id").
		Where("credit_ledger_entries.account_id = ? AND billing_order_id = ? AND type <> ?", model.PersonalCreditAccountID(userID), "", model.CreditLedgerReserve)
	orders := r.db.Model(&model.BillingOrder{}).
		Select(`id, 'billing' AS type, 0 AS amount_microcredits, model, scene,
			CASE WHEN status = 'settled' THEN COALESCE((
				SELECT note FROM credit_ledger_entries
				WHERE billing_order_id = billing_orders.id AND user_id = billing_orders.user_id AND type = 'consume'
				ORDER BY created_at DESC, id DESC LIMIT 1
			), '') ELSE error END AS note,
			created_at, id AS billing_order_id, status AS billing_status,
			reserved_amount_microcredits AS reserved_microcredits,
			actual_amount_microcredits AS charged_microcredits,
			refunded_amount_microcredits AS refunded_microcredits, '' AS payment_provider_id`).
		Where("billing_account_id = ?", model.PersonalCreditAccountID(userID))
	switch entryType {
	case "income":
		ledger = ledger.Where("(type IN ? OR (type = ? AND amount_microcredits > 0))", []model.CreditLedgerType{
			model.CreditLedgerRedeem, model.CreditLedgerPaymentTopup, model.CreditLedgerAdminGrant,
			model.CreditLedgerAdminAdjust, model.CreditLedgerSignupBonus, model.CreditLedgerCheckinBonus, model.CreditLedgerReferral,
		}, model.CreditLedgerTeamTransfer)
		orders = orders.Where("1 = 0")
	case "expenses":
		ledger = ledger.Where("(type IN ? OR (type = ? AND amount_microcredits < 0))", []model.CreditLedgerType{model.CreditLedgerConsume, model.CreditLedgerRefund}, model.CreditLedgerTeamTransfer)
	case "consume":
		ledger = ledger.Where("type = ?", model.CreditLedgerConsume)
		orders = orders.Where("status = ?", model.BillingStatusSettled)
	case "refund":
		ledger = ledger.Where("type = ?", model.CreditLedgerRefund)
		orders = orders.Where("status = ?", model.BillingStatusRefunded)
	}
	// Paginate the order projection, not raw ledger rows: a release must never land on another page.
	query := r.db.Table("(? UNION ALL ?) AS wallet_history", ledger, orders)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]WalletHistoryEntry, 0)
	err := query.Order("created_at DESC, id DESC").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

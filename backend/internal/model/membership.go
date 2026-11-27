package model

import "time"

const TopupProductKindMembership TopupProductKind = "membership"
const CreditLedgerMembershipBonus CreditLedgerType = "membership_bonus"
const MembershipSalesKey = "membership_sales"

// MembershipTerms 作为商品和订单快照保存。天数以连续的 24 小时计算。
type MembershipTerms struct {
	MembershipDays  int    `json:"membershipDays,omitempty" gorm:"not null;default:0"`
	MembershipGroup string `json:"membershipGroup,omitempty" gorm:"size:40;not null;default:''"`
}

type MembershipPeriod struct {
	ProductName        string    `json:"productName"`
	MembershipGroup    string    `json:"membershipGroup"`
	MembershipStartsAt time.Time `json:"startsAt"`
	MembershipEndsAt   time.Time `json:"endsAt"`
}

type MembershipCardInput struct {
	Enabled             bool   `json:"enabled"`
	Currency            string `json:"currency"`
	AmountFen           int64  `json:"amountFen"`
	MembershipGroup     string `json:"membershipGroup"`
	CreditsMicrocredits int64  `json:"creditsMicrocredits"`
}

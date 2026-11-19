package model

import (
	"errors"
	"time"

	"gorm.io/gorm"
)

const (
	CreditAccountPersonal                     = "personal"
	CreditAccountTeamPool                     = "team_pool"
	CreditAccountTeamMember                   = "team_member"
	CreditLedgerTeamTransfer CreditLedgerType = "team_transfer"
)

func PersonalCreditAccountID(userID string) string         { return "personal:" + userID }
func TeamPoolCreditAccountID(teamID string) string         { return "team_pool:" + teamID }
func TeamMemberCreditAccountID(membershipID string) string { return "team_member:" + membershipID }

func (account *CreditAccount) BeforeCreate(_ *gorm.DB) error {
	if account.Kind == "" {
		account.Kind = CreditAccountPersonal
	}
	switch account.Kind {
	case CreditAccountPersonal:
		if account.UserID == "" || account.TeamID != "" || account.MembershipID != "" {
			return errors.New("个人积分账户归属无效")
		}
		account.ID = PersonalCreditAccountID(account.UserID)
	case CreditAccountTeamPool:
		if account.TeamID == "" || account.UserID != "" || account.MembershipID != "" {
			return errors.New("团队资金池归属无效")
		}
		account.ID = TeamPoolCreditAccountID(account.TeamID)
	case CreditAccountTeamMember:
		if account.TeamID == "" || account.MembershipID == "" || account.UserID != "" {
			return errors.New("团队成员账户归属无效")
		}
		account.ID = TeamMemberCreditAccountID(account.MembershipID)
	default:
		return errors.New("积分账户类型无效")
	}
	return nil
}

func (entry *CreditLedgerEntry) BeforeCreate(_ *gorm.DB) error {
	if entry.AccountID == "" && entry.UserID != "" && entry.TeamID == "" {
		entry.AccountID = PersonalCreditAccountID(entry.UserID)
	}
	return nil
}

func (order *BillingOrder) BeforeCreate(_ *gorm.DB) error {
	if order.BillingAccountID == "" && order.UserID != "" && order.TeamID == "" {
		order.BillingAccountID = PersonalCreditAccountID(order.UserID)
	}
	return nil
}

type CreditTransfer struct {
	ID                 string    `json:"id" gorm:"primaryKey;size:36"`
	TeamID             string    `json:"teamId" gorm:"size:36;index;uniqueIndex:idx_team_transfer_idempotency,priority:1"`
	ActorUserID        string    `json:"actorUserId" gorm:"size:36;uniqueIndex:idx_team_transfer_idempotency,priority:2"`
	Operation          string    `json:"operation" gorm:"size:32"`
	SourceAccountID    string    `json:"sourceAccountId" gorm:"size:80;index"`
	TargetAccountID    string    `json:"targetAccountId" gorm:"size:80;index"`
	AmountMicrocredits int64     `json:"amountMicrocredits"`
	IdempotencyKey     string    `json:"-" gorm:"size:160;uniqueIndex:idx_team_transfer_idempotency,priority:3"`
	RequestHash        string    `json:"-" gorm:"size:64"`
	BillingOrderID     string    `json:"billingOrderId,omitempty" gorm:"size:36;index"`
	CreatedAt          time.Time `json:"createdAt"`
}

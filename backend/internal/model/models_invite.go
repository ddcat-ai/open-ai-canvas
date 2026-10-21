package model

import "time"

// 邀请奖励域：邀请关系、奖励余额账户、奖励明细、提现与划转。
// 金额单位统一为微元（micro-yuan，1 元 = 1e6）；奖励金额 = 订单分 × 奖励率基点，整数精确。

type InviteRecordStatus = string

const (
	// InviteRecordPending 邀请审核开启时的新记录：充值奖励冻结，待管理员通过。
	InviteRecordPending InviteRecordStatus = "pending"
	// InviteRecordApproved 已通过（审核关时新建即 approved）：后续奖励直接入可用余额。
	InviteRecordApproved InviteRecordStatus = "approved"
	// InviteRecordFrozen 已冻结：不再产生奖励；pending 奖励在冻结时作废。
	InviteRecordFrozen InviteRecordStatus = "frozen"
)

type InviteRewardRecordStatus = string

const (
	InviteRewardPending  InviteRewardRecordStatus = "pending"
	InviteRewardCredited InviteRewardRecordStatus = "credited"
	InviteRewardVoided   InviteRewardRecordStatus = "voided"
)

type InviteRewardSource = string

const (
	InviteRewardSourceProduct InviteRewardSource = "product"
)

const CreditLedgerInviteTransfer CreditLedgerType = "invite_transfer"

type WithdrawMethod = string

const (
	WithdrawMethodWechat WithdrawMethod = "wechat"
	WithdrawMethodAlipay WithdrawMethod = "alipay"
	WithdrawMethodBank   WithdrawMethod = "bank"
)

// 提现状态：0 审核中，1 驳回，2 成功。
const (
	WithdrawStatusPending  int = 0
	WithdrawStatusRejected int = 1
	WithdrawStatusSuccess  int = 2
)

// InviteRecord 一名被邀请人的归档：一级/二级邀请人 + 审核状态。
type InviteRecord struct {
	UserID      string             `json:"userId" gorm:"primaryKey;size:36"`
	L1InviterID string             `json:"l1InviterId" gorm:"index;size:36;default:''"`
	L2InviterID string             `json:"l2InviterId" gorm:"index;size:36;default:''"`
	CodeUsed    string             `json:"codeUsed" gorm:"size:16;default:''"`
	Status      InviteRecordStatus `json:"status" gorm:"index;size:16;default:'pending'"`
	ApprovedAt  *time.Time         `json:"approvedAt,omitempty"`
	FrozenAt    *time.Time         `json:"frozenAt,omitempty"`
	CreatedAt   time.Time          `json:"createdAt" gorm:"index"`
	UpdatedAt   time.Time          `json:"updatedAt"`
}

// RewardAccount 奖励余额账户。守恒式：Total = Available + Frozen + Used。
type RewardAccount struct {
	UserID             string    `json:"userId" gorm:"primaryKey;size:36"`
	TotalMicroYuan     int64     `json:"totalMicroYuan" gorm:"default:0"`
	AvailableMicroYuan int64     `json:"availableMicroYuan" gorm:"default:0"`
	FrozenMicroYuan    int64     `json:"frozenMicroYuan" gorm:"default:0"`
	UsedMicroYuan      int64     `json:"usedMicroYuan" gorm:"default:0"`
	Version            int64     `json:"version" gorm:"default:0"`
	CreatedAt          time.Time `json:"createdAt"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

// InviteRewardRecord 一笔奖励：被邀请人的一笔支付订单给某位邀请人产生的分成。
type InviteRewardRecord struct {
	ID              string                   `json:"id" gorm:"primaryKey;size:36"`
	InviterID       string                   `json:"inviterId" gorm:"size:36;index:idx_invite_reward_inviter_time,priority:1;index:idx_invite_reward_pair,priority:1"`
	InviteeID       string                   `json:"inviteeId" gorm:"size:36;index;index:idx_invite_reward_pair,priority:2"`
	Level           int                      `json:"level"`
	Source          InviteRewardSource       `json:"source" gorm:"size:16"`
	PaymentOrderID  string                   `json:"paymentOrderId" gorm:"size:36;index"`
	OrderAmountFen  int64                    `json:"orderAmountFen"`
	RateBP          int64                    `json:"rateBp"`
	AmountMicroYuan int64                    `json:"amountMicroYuan"`
	Status          InviteRewardRecordStatus `json:"status" gorm:"index;size:16;default:'pending'"`
	ReferenceKey    string                   `json:"referenceKey" gorm:"size:180;uniqueIndex"`
	CreditedAt      *time.Time               `json:"creditedAt,omitempty"`
	CreatedAt       time.Time                `json:"createdAt" gorm:"index"`
	UpdatedAt       time.Time                `json:"updatedAt"`
}

// WithdrawRequest 提现申请。Status: 0 审核中 / 1 驳回 / 2 成功。
type WithdrawRequest struct {
	ID              string         `json:"id" gorm:"primaryKey;size:36"`
	UserID          string         `json:"userId" gorm:"size:36;index"`
	AmountMicroYuan int64          `json:"amountMicroYuan"`
	FeeMicroYuan    int64          `json:"feeMicroYuan"`
	ActualMicroYuan int64          `json:"actualMicroYuan"`
	Method          WithdrawMethod `json:"method" gorm:"size:16;index"`
	AccountCipher   string         `json:"-" gorm:"type:text"`
	Status          int            `json:"status" gorm:"index;default:0"`
	RejectReason    string         `json:"rejectReason" gorm:"size:200;default:''"`
	ReviewedBy      string         `json:"reviewedBy" gorm:"size:36;default:''"`
	ReviewedAt      *time.Time     `json:"reviewedAt,omitempty"`
	CreatedAt       time.Time      `json:"createdAt" gorm:"index"`
	UpdatedAt       time.Time      `json:"updatedAt"`
}

// WithdrawAccount 用户保存的常用收款信息（每用户一条，重复保存覆盖）。
type WithdrawAccount struct {
	UserID        string         `json:"userId" gorm:"primaryKey;size:36"`
	Method        WithdrawMethod `json:"method" gorm:"size:16"`
	AccountCipher string         `json:"-" gorm:"type:text"`
	UpdatedAt     time.Time      `json:"updatedAt"`
	CreatedAt     time.Time      `json:"createdAt"`
}

// TransferRecord 奖励余额划转为积分的一条记录。
type TransferRecord struct {
	ID                 string    `json:"id" gorm:"primaryKey;size:36"`
	UserID             string    `json:"userId" gorm:"size:36;index"`
	AmountMicroYuan    int64     `json:"amountMicroYuan"`
	RateMilli          int64     `json:"rateMilli"`
	CreditsMicrocredit int64     `json:"creditsMicrocredits"`
	CreatedAt          time.Time `json:"createdAt" gorm:"index"`
}

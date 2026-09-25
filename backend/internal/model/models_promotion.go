package model

import "time"

// InviteCode 是用户专属推广码，一人一个；注册时用它建立邀请关系。
type InviteCode struct {
	ID        string    `json:"id" gorm:"primaryKey;size:36"`
	UserID    string    `json:"userId" gorm:"uniqueIndex;size:36"`
	Code      string    `json:"code" gorm:"uniqueIndex;size:32"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Invitation 记录邀请关系。被邀请人唯一，绑定后不再变更，避免反复绑定刷返佣。
type Invitation struct {
	ID        string `json:"id" gorm:"primaryKey;size:36"`
	InviterID string `json:"inviterId" gorm:"index;size:36"`
	InviteeID string `json:"inviteeId" gorm:"uniqueIndex;size:36"`
	Code      string `json:"code" gorm:"size:32"`
	// Source 记录绑定来源：link（邀请链接）、code（手填邀请码）、manual（管理员补绑）。
	Source    string    `json:"source" gorm:"size:24"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// CommissionStatus 表示返佣在资金链路中的位置。
type CommissionStatus string

const (
	// CommissionFrozen 已入账但处于冻结期，不能转入或提现。
	CommissionFrozen CommissionStatus = "frozen"
	// CommissionAvailable 冻结期满，可转入账户积分或申请提现。
	CommissionAvailable CommissionStatus = "available"
	// CommissionTransferred 已转入账户积分，不再参与提现。
	CommissionTransferred CommissionStatus = "transferred"
	// CommissionWithdrawing 已提交提现申请，等待管理员审核。
	CommissionWithdrawing CommissionStatus = "withdrawing"
	// CommissionWithdrawn 提现已打款完成。
	CommissionWithdrawn CommissionStatus = "withdrawn"
)

// CommissionRecord 是一次返佣结算流水。金额来自被邀请人的充值入账积分乘以当时比例，
// 冻结期由推广策略决定，到期后由惰性结算转为可用。
type CommissionRecord struct {
	ID        string `json:"id" gorm:"primaryKey;size:36"`
	InviterID string `json:"inviterId" gorm:"index;size:36"`
	InviteeID string `json:"inviteeId" gorm:"index;size:36"`
	// SourceType/SourceID 指向返佣来源，当前只有充值：payment_topup。
	SourceType         string           `json:"sourceType" gorm:"size:24"`
	SourceID           string           `json:"sourceId" gorm:"index;size:64"`
	BaseMicrocredits   int64            `json:"baseMicrocredits"`
	RatioBPS           int64            `json:"ratioBasisPoints"`
	AmountMicrocredits int64            `json:"amountMicrocredits"`
	Status             CommissionStatus `json:"status" gorm:"index;size:24"`
	AvailableAt        time.Time        `json:"availableAt" gorm:"index"`
	WithdrawalID       string           `json:"withdrawalId,omitempty" gorm:"index;size:36"`
	// AllocatedMicrocredits 是已被转入积分或提现占用的额度，剩余可用为 Amount - Allocated。
	// 一条返佣可能被拆给多次操作，因此必须记录分配明细而不是只改状态。
	AllocatedMicrocredits int64 `json:"allocatedMicrocredits"`
	// ReferenceKey 保证同一笔来源只结算一次，回调重放不会重复返佣。
	ReferenceKey string    `json:"-" gorm:"uniqueIndex;size:180"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// AllocationKind 区分返佣额度被转入积分还是被提现占用。
type AllocationKind string

const (
	AllocationTransfer   AllocationKind = "transfer"
	AllocationWithdrawal AllocationKind = "withdrawal"
)

// AllocationStatus 是额度占用状态：pending 占用中、completed 已生效、released 已回退。
type AllocationStatus string

const (
	AllocationPending   AllocationStatus = "pending"
	AllocationCompleted AllocationStatus = "completed"
	AllocationReleased  AllocationStatus = "released"
)

// CommissionAllocation 记录某条返佣被哪次操作占用了多少额度。
// 提现审核被拒时必须按这里回退，否则用户的可用返佣会凭空消失。
type CommissionAllocation struct {
	ID                 string           `json:"id" gorm:"primaryKey;size:36"`
	CommissionID       string           `json:"commissionId" gorm:"index;size:36"`
	UserID             string           `json:"userId" gorm:"index;size:36"`
	AmountMicrocredits int64            `json:"amountMicrocredits"`
	Kind               AllocationKind   `json:"kind" gorm:"size:24"`
	ReferenceID        string           `json:"referenceId" gorm:"index;size:64"`
	Status             AllocationStatus `json:"status" gorm:"index;size:24"`
	CreatedAt          time.Time        `json:"createdAt"`
	UpdatedAt          time.Time        `json:"updatedAt"`
}

// WithdrawalStatus 表示提现申请的审核状态。
type WithdrawalStatus string

const (
	WithdrawalPending  WithdrawalStatus = "pending"
	WithdrawalApproved WithdrawalStatus = "approved"
	WithdrawalRejected WithdrawalStatus = "rejected"
)

// WithdrawalRequest 是用户用可用返佣发起的提现申请，必须经管理员审核。
type WithdrawalRequest struct {
	ID                 string `json:"id" gorm:"primaryKey;size:36"`
	UserID             string `json:"userId" gorm:"index;size:36"`
	AmountMicrocredits int64  `json:"amountMicrocredits"`
	// Channel/Account 是收款信息：alipay、wechat、bank。
	Channel     string           `json:"channel" gorm:"size:24"`
	Account     string           `json:"account" gorm:"size:160"`
	AccountName string           `json:"accountName" gorm:"size:80"`
	Status      WithdrawalStatus `json:"status" gorm:"index;size:24"`
	ReviewNote  string           `json:"reviewNote" gorm:"size:500"`
	ReviewedBy  string           `json:"reviewedBy,omitempty" gorm:"size:36"`
	ReviewedAt  *time.Time       `json:"reviewedAt"`
	CreatedAt   time.Time        `json:"createdAt" gorm:"index"`
	UpdatedAt   time.Time        `json:"updatedAt"`
}

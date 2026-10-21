package invite

import (
	"strconv"

	"yingce/backend/internal/model"
)

// RewardLevel 某一级别的奖励执行参数：repo 层在事务内据此入账。
type RewardLevel struct {
	Level  int
	RateBP int64
}

// InviteRewardInstruction 由 app 层依据策略与邀请记录组装，描述一笔支付订单
// 应产生的奖励。传给 repo.CompletePaymentOrder；nil 表示该订单不产生奖励。
// 是否冻结（审核中）由 repo 在事务内按被邀请人 invite_records 的实际状态决定，
// 避免指令组装与入账之间的竞态。
type InviteRewardInstruction struct {
	InviteeID string
	Source    model.InviteRewardSource
	// RewardCountLimit 每名被邀请人最多前 N 笔订单产生奖励；0 = 无上限。
	RewardCountLimit int64
	Levels           []RewardLevel
}

// ReferenceKey 奖励流水幂等键：一笔订单的每个级别只可能产生一条奖励记录。
func ReferenceKey(paymentOrderID string, level int) string {
	return "invite_reward:" + paymentOrderID + ":" + strconv.Itoa(level)
}

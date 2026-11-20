package app

import (
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 短剧作品花费一律按计费订单当前状态计算（见 repository.DramaBillingTotals）：
// 已结算记实收、已退回记 0、其余状态记冻结额并单独展示为“冻结中”。
// drama_productions.spent_microcredits 只是流水线实收的缓存，展示与预算都不以它为准。

// dramaBillingSettleGrace 是任务进入终态后等待订单结算或退回的时间。正常结算紧跟任务终态；
// 超时仍未落到终态（如结算失败、等待人工核对）时按冻结额记作业花费，不让作业一直挂起。
const dramaBillingSettleGrace = 2 * time.Minute

// dramaOrderSpend 按作品花费口径拆分一张订单：charged 是实收，held 是仍冻结的金额；settled 表示订单已到终态。
func dramaOrderSpend(order model.BillingOrder) (charged int64, held int64, settled bool) {
	switch order.Status {
	case model.BillingStatusSettled:
		return order.ActualAmountMicrocredits, 0, true
	case model.BillingStatusRefunded:
		return 0, 0, true
	}
	return 0, order.AmountMicrocredits, false
}

func (s *Service) dramaBillingTotals(production *model.DramaProduction) (repository.DramaBillingTotals, error) {
	totals, err := s.repo.DramaBillingTotals(production.UserID, []string{production.ProjectID})
	if err != nil {
		return repository.DramaBillingTotals{}, err
	}
	return totals[production.ProjectID], nil
}

// dramaPendingBilling 表示任务已结束但订单还没结算或退回：作业保持运行，下一轮再读。
type dramaPendingBilling struct{ orderID string }

func (e *dramaPendingBilling) Error() string { return "任务计费订单尚未结算：" + e.orderID }

// dramaTaskFinishedAt 是任务进入终态的时间；旧任务没有完成时间时按最后更新时间。
func dramaTaskFinishedAt(task *model.Task) time.Time {
	if task.CompletedAt != nil {
		return *task.CompletedAt
	}
	return task.UpdatedAt
}

package app

import "infinite-canvas/backend/internal/model"

type AnalyticsFinance struct {
	SettledOrders       int      `json:"settledOrders"`
	CostedOrders        int      `json:"costedOrders"`
	RevenueMicrocredits int64    `json:"revenueMicrocredits"`
	CostMicrocredits    int64    `json:"costMicrocredits"`
	ProfitMicrocredits  *int64   `json:"profitMicrocredits"`
	ProfitMargin        *float64 `json:"profitMargin"`
}

type analyticsFinancialRecord struct {
	Log     model.ApiCallLog
	Revenue int64
	Cost    *int64
}

// 一个订单的重试、轮询不能重复计入收入；只归属实际结算渠道。
// 历史订单使用下单价格快照，缺失成本时不反查当前价格。
func (s *Service) analyticsFinancialRecords(logs []model.ApiCallLog) (map[string]analyticsFinancialRecord, error) {
	ids := make([]string, 0, len(logs))
	for _, log := range logs {
		if log.Billable && log.BillingOrderID != "" {
			ids = append(ids, log.BillingOrderID)
		}
	}
	orders, err := s.repo.BillingOrdersByIDs(uniqueNonEmpty(ids))
	if err != nil {
		return nil, err
	}
	byOrder := make(map[string]model.ApiCallLog)
	for _, log := range logs {
		order, exists := orders[log.BillingOrderID]
		if !log.Billable || !exists || order.UserID != log.UserID || order.ChannelID != log.ChannelID || order.Status != model.BillingStatusSettled {
			continue
		}
		switch log.RequestKind {
		case "poll", "download", "upload", "workflow-schema", "cancel-query", "cancel":
			continue
		}
		previous, exists := byOrder[order.ID]
		if !exists || log.CreatedAt.Before(previous.CreatedAt) || (log.CreatedAt.Equal(previous.CreatedAt) && log.ID < previous.ID) {
			byOrder[order.ID] = log
		}
	}
	records := make(map[string]analyticsFinancialRecord, len(byOrder))
	for id, log := range byOrder {
		order := orders[id]
		cost, err := billingCreditCost(order)
		if err != nil {
			return nil, err
		}
		records[log.ID] = analyticsFinancialRecord{Log: log, Revenue: order.ActualAmountMicrocredits, Cost: cost}
	}
	return records, nil
}

func (finance *AnalyticsFinance) add(record analyticsFinancialRecord) {
	finance.SettledOrders++
	finance.RevenueMicrocredits += record.Revenue
	if record.Cost != nil {
		finance.CostedOrders++
		finance.CostMicrocredits += *record.Cost
	}
	finance.ProfitMicrocredits, finance.ProfitMargin = nil, nil
	if finance.CostedOrders == finance.SettledOrders {
		profit := finance.RevenueMicrocredits - finance.CostMicrocredits
		finance.ProfitMicrocredits = &profit
		if finance.RevenueMicrocredits > 0 {
			margin := float64(profit) * 100 / float64(finance.RevenueMicrocredits)
			finance.ProfitMargin = &margin
		}
	}
}

func applyAnalyticsFinance(overview *AnalyticsOverview, records map[string]analyticsFinancialRecord) {
	rows := make(map[[2]string]*AnalyticsFinance, len(overview.Models))
	for index := range overview.Models {
		row := &overview.Models[index]
		rows[[2]string{row.Model, row.Capability}] = &row.Finance
	}
	for _, record := range records {
		overview.KPI.Finance.add(record)
		if row := rows[[2]string{firstNonEmpty(record.Log.Model, "未识别"), record.Log.Capability}]; row != nil {
			row.add(record)
		}
	}
}

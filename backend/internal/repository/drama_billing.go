package repository

import "yingce/backend/internal/model"

// DramaBillingTotals 是短剧作品按计费订单汇总的花费，每次读取都按订单当前状态重算，历史数据不需要迁移：
//   - Charged 是已结算订单的实收（actual_amount_microcredits），已扣除差额退回；
//   - Held 是尚未结算订单（冻结中、处理中、待核对）的冻结额（amount_microcredits）；
//   - 已退回订单两项都不计。
//
// Pipeline 是流水线任务（tasks.project_id 为作品 ID），Canvas 是关联画布（canvas_projects.project_id 为作品 ID）上的任务。
type DramaBillingTotals struct {
	PipelineChargedMicrocredits int64
	PipelineHeldMicrocredits    int64
	CanvasChargedMicrocredits   int64
	CanvasHeldMicrocredits      int64
}

// ChargedMicrocredits 是作品已实际扣费的总额。
func (t DramaBillingTotals) ChargedMicrocredits() int64 {
	return t.PipelineChargedMicrocredits + t.CanvasChargedMicrocredits
}

// HeldMicrocredits 是作品仍冻结、尚未结算的总额。
func (t DramaBillingTotals) HeldMicrocredits() int64 {
	return t.PipelineHeldMicrocredits + t.CanvasHeldMicrocredits
}

const (
	dramaChargedSumSQL = "COALESCE(SUM(CASE WHEN billing_orders.status = ? THEN billing_orders.actual_amount_microcredits ELSE 0 END), 0)"
	dramaHeldSumSQL    = "COALESCE(SUM(CASE WHEN billing_orders.status IN (?, ?) THEN 0 ELSE billing_orders.amount_microcredits END), 0)"
)

type dramaBillingRow struct {
	ProjectID string
	Charged   int64
	Held      int64
}

// DramaBillingTotals 一次汇总多部作品的花费（列表页一页一次查询）；只统计当前用户自己的任务与订单。
func (r *Repository) DramaBillingTotals(userID string, projectIDs []string) (map[string]DramaBillingTotals, error) {
	totals := make(map[string]DramaBillingTotals, len(projectIDs))
	if len(projectIDs) == 0 {
		return totals, nil
	}
	selectSums := "AS project_id, " + dramaChargedSumSQL + " AS charged, " + dramaHeldSumSQL + " AS held"
	args := []any{model.BillingStatusSettled, model.BillingStatusSettled, model.BillingStatusRefunded}
	var pipeline []dramaBillingRow
	if err := r.db.Table("tasks").
		Select("tasks.project_id "+selectSums, args...).
		Joins("JOIN billing_orders ON billing_orders.id = tasks.billing_order_id AND billing_orders.user_id = tasks.user_id").
		Where("tasks.user_id = ? AND tasks.project_id IN ?", userID, projectIDs).
		Group("tasks.project_id").
		Scan(&pipeline).Error; err != nil {
		return nil, err
	}
	var canvas []dramaBillingRow
	if err := r.db.Table("canvas_projects").
		Select("canvas_projects.project_id "+selectSums, args...).
		Joins("JOIN tasks ON tasks.project_id = canvas_projects.id AND tasks.user_id = canvas_projects.user_id").
		Joins("JOIN billing_orders ON billing_orders.id = tasks.billing_order_id AND billing_orders.user_id = tasks.user_id").
		Where("canvas_projects.user_id = ? AND canvas_projects.project_id IN ?", userID, projectIDs).
		Group("canvas_projects.project_id").
		Scan(&canvas).Error; err != nil {
		return nil, err
	}
	for _, row := range pipeline {
		item := totals[row.ProjectID]
		item.PipelineChargedMicrocredits, item.PipelineHeldMicrocredits = row.Charged, row.Held
		totals[row.ProjectID] = item
	}
	for _, row := range canvas {
		item := totals[row.ProjectID]
		item.CanvasChargedMicrocredits, item.CanvasHeldMicrocredits = row.Charged, row.Held
		totals[row.ProjectID] = item
	}
	return totals, nil
}

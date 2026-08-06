package repository

import (
	"time"

	"infinite-canvas/backend/internal/model"
)

// BillingReviewStats 记录需要人工关注的长期未闭合订单数量。
// 巡检只读数据库，不改变订单状态或积分余额。
type BillingReviewStats struct {
	Reserved  int64      `json:"reserved"`
	Running   int64      `json:"running"`
	Uncertain int64      `json:"uncertain"`
	Oldest    *time.Time `json:"oldest,omitempty"`
}

func (s BillingReviewStats) Total() int64 {
	return s.Reserved + s.Running + s.Uncertain
}

// StaleBillingReviewStats 查询超过 age 未更新、仍处于未闭合状态的订单。
func (r *Repository) StaleBillingReviewStats(now time.Time, age time.Duration) (BillingReviewStats, error) {
	cutoff := now.Add(-age)
	stats := BillingReviewStats{}
	var rows []struct {
		Status model.BillingStatus
		Count  int64
	}
	if err := r.db.Model(&model.BillingOrder{}).
		Select("status, count(*) AS count").
		Where("status IN ? AND updated_at < ?", []model.BillingStatus{
			model.BillingStatusReserved,
			model.BillingStatusRunning,
			model.BillingStatusUncertain,
		}, cutoff).
		Group("status").Scan(&rows).Error; err != nil {
		return stats, err
	}
	for _, row := range rows {
		switch row.Status {
		case model.BillingStatusReserved:
			stats.Reserved = row.Count
		case model.BillingStatusRunning:
			stats.Running = row.Count
		case model.BillingStatusUncertain:
			stats.Uncertain = row.Count
		}
	}
	if stats.Total() == 0 {
		return stats, nil
	}
	var oldest struct {
		CreatedAt time.Time
	}
	if err := r.db.Model(&model.BillingOrder{}).
		Select("created_at").
		Where("status IN ? AND updated_at < ?", []model.BillingStatus{
			model.BillingStatusReserved,
			model.BillingStatusRunning,
			model.BillingStatusUncertain,
		}, cutoff).
		Order("created_at asc").Limit(1).Scan(&oldest).Error; err != nil {
		return stats, err
	}
	stats.Oldest = &oldest.CreatedAt
	return stats, nil
}

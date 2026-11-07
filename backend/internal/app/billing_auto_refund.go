package app

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"sync"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

const billingAutoRefundSettingKey = "billing_auto_refund"

// billingAutoRefundInterval 控制自动退回的扫描频率；每轮最多处理一页，避免单轮长事务。
const (
	billingAutoRefundInterval = time.Minute
	billingAutoRefundBatch    = 100
	billingAutoRefundNote     = "系统自动退回：已开启冻结积分自动退回"
)

// BillingAutoRefundSetting 是积分运营页的“自动退回”开关。默认关闭：
// 待核对订单可能已在上游产生费用，只有管理员明确开启后才自动释放冻结积分。
type BillingAutoRefundSetting struct {
	Enabled   bool       `json:"enabled"`
	UpdatedAt *time.Time `json:"updatedAt,omitempty"`
}

func (s *Service) billingAutoRefundSetting(ctx context.Context) (BillingAutoRefundSetting, error) {
	setting, err := s.repo.WithContext(ctx).SystemSetting(billingAutoRefundSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return BillingAutoRefundSetting{}, nil
	}
	if err != nil {
		return BillingAutoRefundSetting{}, err
	}
	var value BillingAutoRefundSetting
	if json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return BillingAutoRefundSetting{}, errors.New("自动退回配置格式无效")
	}
	updatedAt := setting.UpdatedAt
	value.UpdatedAt = &updatedAt
	return value, nil
}

func (s *Service) AdminBillingAutoRefundSetting(actor *model.User) (BillingAutoRefundSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return BillingAutoRefundSetting{}, err
	}
	return s.billingAutoRefundSetting(context.Background())
}

func (s *Service) UpdateBillingAutoRefundSetting(actor *model.User, req BillingAutoRefundSetting) (BillingAutoRefundSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return BillingAutoRefundSetting{}, err
	}
	encoded, err := json.Marshal(BillingAutoRefundSetting{Enabled: req.Enabled})
	if err != nil {
		return BillingAutoRefundSetting{}, err
	}
	setting := model.SystemSetting{Key: billingAutoRefundSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	current, err := s.repo.SystemSetting(billingAutoRefundSettingKey)
	if err == nil {
		setting.CreatedAt = current.CreatedAt
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return BillingAutoRefundSetting{}, err
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return BillingAutoRefundSetting{}, err
	}
	summary := "关闭冻结积分自动退回"
	if req.Enabled {
		summary = "开启冻结积分自动退回"
	}
	if err := s.appendAdminAudit(actor, "billing_auto_refund.update", "system_setting", billingAutoRefundSettingKey, summary, map[string]any{"enabled": req.Enabled}); err != nil {
		return BillingAutoRefundSetting{}, err
	}
	if req.Enabled {
		// 开启后立即跑一轮，不必等下一个扫描周期。
		s.runWorkerLoop(func(ctx context.Context) { s.autoRefundReviewBilling(ctx) })
	}
	return s.billingAutoRefundSetting(context.Background())
}

func (s *Service) startBillingAutoRefundWorker() {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(billingAutoRefundInterval)
		defer ticker.Stop()
		for {
			s.autoRefundReviewBilling(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}

type billingAutoRefundScan struct {
	mu       sync.Mutex
	cursor   *repository.BillingAutoRefundCursor
	failures map[string]billingAutoRefundFailure
}

type billingAutoRefundFailure struct {
	delay   time.Duration
	retryAt time.Time
}

// 退避仅为实例内减载，不作为账务事实源；容量满时淘汰最早可重试的条目。
func (scan *billingAutoRefundScan) recordFailure(id string, now time.Time) {
	if scan.failures == nil {
		scan.failures = make(map[string]billingAutoRefundFailure)
	}
	previous, exists := scan.failures[id]
	if !exists && len(scan.failures) >= billingAutoRefundBatch*10 {
		var oldestID string
		var oldest time.Time
		for key, failure := range scan.failures {
			if oldestID == "" || failure.retryAt.Before(oldest) {
				oldestID, oldest = key, failure.retryAt
			}
		}
		delete(scan.failures, oldestID)
	}
	delay := min(max(previous.delay*2, 2*time.Minute), time.Hour)
	scan.failures[id] = billingAutoRefundFailure{delay: delay, retryAt: now.Add(delay)}
}

// autoRefundReviewBilling 退回审核队列中可安全自动处理的冻结积分。
// 只处理通用任务已失败或取消且没有作品交付证据的订单；其余保留人工核对。
// 每轮重新读取开关，关闭后下一轮立即停止。
func (s *Service) autoRefundReviewBilling(ctx context.Context) int {
	scan := &s.billingAutoRefund
	// 管理员即时触发和定时扫描不叠加，也不堆积等待 goroutine。
	if !scan.mu.TryLock() {
		return 0
	}
	defer scan.mu.Unlock()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	setting, err := s.billingAutoRefundSetting(ctx)
	if err != nil {
		slog.Warn("billing auto refund setting load failed", "error", err)
		return 0
	}
	if !setting.Enabled {
		scan.cursor, scan.failures = nil, nil
		return 0
	}
	orders, err := s.repo.WithContext(ctx).AutoRefundableBillingOrders(billingAutoRefundBatch, scan.cursor)
	if err != nil {
		slog.Warn("billing auto refund query failed", "error", err)
		return 0
	}
	refunded := 0
	for _, order := range orders {
		if ctx.Err() != nil {
			return refunded
		}
		if failure := scan.failures[order.ID]; !time.Now().Before(failure.retryAt) {
			attemptCtx, cancelAttempt := context.WithTimeout(ctx, 5*time.Second)
			changed, err := s.repo.WithContext(attemptCtx).AutoRefundBillingOrder(order.ID, billingAutoRefundNote)
			cancelAttempt()
			if ctx.Err() != nil && err != nil {
				return refunded
			}
			if err != nil {
				scan.recordFailure(order.ID, time.Now())
				slog.Warn("billing auto refund failed", "orderId", order.ID, "error", err)
			} else {
				delete(scan.failures, order.ID)
				if changed {
					refunded++
				}
			}
		}
		// 失败和冷却条目也推进游标，不能让它们长期挡住下一页。
		scan.cursor = &repository.BillingAutoRefundCursor{CreatedAt: order.CreatedAt, ID: order.ID}
	}
	if len(orders) < billingAutoRefundBatch {
		scan.cursor = nil
	}
	return refunded
}

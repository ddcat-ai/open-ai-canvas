package app

import (
	"context"
	"log/slog"
	"time"
)

const (
	arkPortraitWorkerInterval = 30 * time.Second
	arkPortraitRefreshBatch   = 20
	// arkGroupOrderStaleAfter 之后仍冻结、且没有待认证会话引用的素材组订单视为创建中断，自动退回。
	arkGroupOrderStaleAfter = 2 * time.Hour
)

// startArkPortraitWorker 定期结束过期的真人认证会话并退回冻结积分，同时查询方舟审核中的素材，
// 通过后写入素材库；用户不必停留在页面上。
func (s *Service) startArkPortraitWorker() {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(arkPortraitWorkerInterval)
		defer ticker.Stop()
		for {
			s.runArkPortraitMaintenance(ctx)
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}

func (s *Service) runArkPortraitMaintenance(ctx context.Context) {
	now := time.Now()
	sessions, err := s.repo.ExpiredPendingArkPortraitSessions(now, 50)
	if err != nil {
		slog.Warn("ark portrait expired sessions load failed", "error", err)
	}
	for _, session := range sessions {
		s.expireArkPortraitSession(session.ID)
	}
	orders, err := s.repo.StaleArkGroupBillingOrders(now.Add(-arkGroupOrderStaleAfter), 50)
	if err != nil {
		slog.Warn("ark group stale orders load failed", "error", err)
	}
	for _, order := range orders {
		if err := s.repo.RefundArkGroupBillingOrder(order.ID, "素材组创建未完成，冻结积分已自动退回"); err != nil {
			slog.Warn("ark group stale order refund failed", "order", order.ID, "error", err)
		}
	}
	s.refreshProcessingArkAssets(ctx)
}

func (s *Service) refreshProcessingArkAssets(ctx context.Context) {
	_, setting, err := s.readArkPrivateAssetSetting()
	if err != nil || !setting.credentialsReady() {
		return
	}
	assets, err := s.repo.ProcessingArkPortraitAssets(arkPortraitRefreshBatch)
	if err != nil {
		slog.Warn("ark portrait processing assets load failed", "error", err)
		return
	}
	for index := range assets {
		if ctx.Err() != nil {
			return
		}
		asset := &assets[index]
		group, err := s.repo.ArkPortraitGroup(asset.GroupID)
		if err != nil || !arkPortraitGroupAvailable(*group, setting) {
			_ = s.repo.TouchArkPortraitAsset(asset.ID)
			continue
		}
		if err := s.refreshArkPortraitAssetStatus(ctx, setting, asset, *group); err != nil {
			// 单条查询失败只推迟到下一轮，不改变素材状态。
			_ = s.repo.TouchArkPortraitAsset(asset.ID)
			slog.Warn("ark portrait asset refresh failed", "asset", asset.ID, "error", safeArkPortraitError(err))
		}
	}
}

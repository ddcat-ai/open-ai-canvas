package app

import (
	"context"
	"log"
	"time"
)

// CleanupSiteTrafficEvents 使用独立全站单槽租约；保留含今日的365个北京时间自然日。
func (s *Service) CleanupSiteTrafficEvents(ctx context.Context) (int64, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	lease, acquired, err := s.coordinator.AcquireLease(ctx, "site-traffic-event-cleanup", 1, time.Minute)
	if err != nil || !acquired {
		return 0, err
	}
	defer lease.Release()
	cutoff := siteTrafficRetentionStart(time.Now())
	var total int64
	// 满批继续清理，避免高于每日 24000 条的流量让过期数据持续积压；仍受超时和租约约束。
	for {
		deleted, err := s.repo.WithContext(ctx).DeleteSiteTrafficEventsBefore(cutoff, 1000)
		total += deleted
		if err != nil || deleted < 1000 {
			return total, err
		}
	}
}

func (s *Service) startSiteTrafficCleanup(ctx context.Context) {
	s.runWorkerLoop(func(ctx context.Context) {
		cleanup := func() {
			deleted, err := s.CleanupSiteTrafficEvents(ctx)
			if err != nil && ctx.Err() == nil {
				log.Printf("site traffic cleanup failed: deleted=%d error=%v", deleted, err)
			}
		}
		cleanup()
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cleanup()
			}
		}
	})
}

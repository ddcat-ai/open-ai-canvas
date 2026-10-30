package app

import (
	"context"
	"log"
	"time"
)

// 前端 journal 在刷新、断网恢复或后台重试时立即重放未确认请求，7 天足够覆盖离线后再打开的场景。
const canvasMutationReceiptRetention = 7 * 24 * time.Hour

func (s *Service) CleanupCanvasMutationReceipts(ctx context.Context) (int64, error) {
	return s.repo.WithContext(ctx).DeleteCanvasMutationReceiptsBefore(time.Now().Add(-canvasMutationReceiptRetention), 1000)
}

func (s *Service) startCanvasMutationReceiptCleanup(ctx context.Context) {
	s.runWorkerLoop(func(ctx context.Context) {
		cleanup := func() {
			deleted, err := s.CleanupCanvasMutationReceipts(ctx)
			if err != nil && ctx.Err() == nil {
				log.Printf("canvas mutation receipt cleanup failed: deleted=%d error=%v", deleted, err)
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

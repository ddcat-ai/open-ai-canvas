package app

import (
	"context"
	"log"
	"time"
)

// startLoginLogCleanup 每天清理 90 天前的登录日志。
func (s *Service) startLoginLogCleanup(ctx context.Context) {
	cleanup := func() {
		before := time.Now().Add(-90 * 24 * time.Hour)
		deleted, err := s.repo.DeleteLoginLogsBefore(before)
		if err != nil {
			log.Printf("login log cleanup failed: %v", err)
			return
		}
		if deleted > 0 {
			log.Printf("login log cleanup deleted %d entries older than %s", deleted, before.Format(time.DateOnly))
		}
	}
	s.runWorkerLoop(func(ctx context.Context) {
		cleanup()
		ticker := time.NewTicker(24 * time.Hour)
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

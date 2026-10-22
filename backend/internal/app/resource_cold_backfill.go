// 冷备存量补齐：为冷备功能上线前已入库的媒体资源补建本地副本。
//
// 设计与缩略图回填（resource_thumbnail_backfill.go）同构：
//   - 游标分页：用 (created_at, id) 而不是 offset，失败行原地标 failed 后
//     仍命中查询条件，offset 分页会反复捞到同一批行，游标单调前进、必然收敛。
//   - 限并发：最多 3 个 goroutine 同时拉取对象（视频可能上百 MB，带宽优先给线上）。
//   - 单条失败不中断：syncResourceToCold 内部已把该行标 failed，这里只记日志。
//   - 幂等：ready 的行不在候选条件内；本地已有等长文件时 sync 直接标 ready 返回。
//
// 开关：环境变量 CANVAS_COLD_BACKFILL=1，延迟 CANVAS_COLD_BACKFILL_DELAY（默认 60s）。
// 与缩略图回填分开开关，便于只跑其中一个。

package app

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"yingce/backend/internal/model"
)

const (
	// 每批从数据库读取的资源条数。
	coldBackfillBatchSize = 50
	// 同时拉取对象的 goroutine 上限。视频对象较大，并发不宜过高。
	coldBackfillConcurrency = 3
)

// BackfillColdBackups 为存量媒体资源补建本地冷备。
// 处理过程中可被 ctx 取消，取消后不再开始新的资源，已开始的会自然结束。
func (s *Service) BackfillColdBackups(ctx context.Context) {
	if s == nil || s.repo == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	startedAt := time.Now()
	var succeeded, failed, skipped int
	var cursorTime time.Time
	var cursorID string
	batches := 0

	slog.Info("冷备回填开始")
	for {
		if err := ctx.Err(); err != nil {
			slog.Warn("冷备回填已取消", "reason", err, "processed", succeeded+failed+skipped)
			break
		}
		batch, err := s.repo.ColdBackupBackfillCandidates(cursorTime, cursorID, coldBackfillBatchSize)
		if err != nil {
			slog.Error("冷备回填查询失败", "error", err, "processed", succeeded+failed+skipped)
			break
		}
		if len(batch) == 0 {
			break
		}
		batches++
		// 先推进游标再处理：本批处理期间即使某行状态变化，下一批也不会重复读取它。
		last := batch[len(batch)-1]
		cursorTime, cursorID = last.CreatedAt, last.ID

		batchSucceeded, batchFailed, batchSkipped := s.processColdBackfillBatch(ctx, batch)
		succeeded += batchSucceeded
		failed += batchFailed
		skipped += batchSkipped
		if batchSucceeded+batchFailed+batchSkipped < len(batch) {
			// 批内被取消打断，剩余资源留到下次开启回填时处理。
			break
		}
	}

	slog.Info("冷备回填结束",
		"processed", succeeded+failed+skipped,
		"success", succeeded,
		"failed", failed,
		"skipped", skipped,
		"batches", batches,
		"canceled", ctx.Err() != nil,
		"elapsed", time.Since(startedAt).String(),
	)
}

// processColdBackfillBatch 用固定大小的并发池处理一批资源，等待全部结束再返回。
func (s *Service) processColdBackfillBatch(ctx context.Context, batch []model.Resource) (int, int, int) {
	var mu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, coldBackfillConcurrency)
	var succeeded, failed, skipped int

dispatch:
	for index := range batch {
		if ctx.Err() != nil {
			break
		}
		resource := batch[index]
		// 等名额时也要能被取消打断，否则 ctx 取消后仍会卡在满队列上。
		select {
		case slots <- struct{}{}:
		case <-ctx.Done():
			break dispatch
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			outcome, panicValue := s.coldBackfillOne(ctx, &resource)
			if panicValue != nil {
				slog.Error("冷备回填单条异常", "resourceId", resource.ID, "panic", panicValue)
			}
			mu.Lock()
			switch outcome {
			case model.ColdBackupStatusReady:
				succeeded++
			case model.ColdBackupStatusFailed:
				failed++
			default:
				skipped++
			}
			mu.Unlock()
			slog.Info("冷备回填单条完成", "resourceId", resource.ID, "kind", resource.Kind, "status", outcome)
		}()
	}
	wg.Wait()
	return succeeded, failed, skipped
}

// coldBackfillOne 处理单个资源，返回落库后的冷备状态。
func (s *Service) coldBackfillOne(ctx context.Context, resource *model.Resource) (string, any) {
	if ctx.Err() != nil {
		return resource.ColdBackupStatus, nil
	}
	var panicValue any
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				panicValue = recovered
			}
		}()
		if err := s.syncResourceToCold(resource); err != nil {
			slog.Warn("冷备回填失败", "resourceId", resource.ID, "error", err)
		}
	}()
	return resource.ColdBackupStatus, panicValue
}

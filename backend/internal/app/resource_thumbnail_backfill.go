// 缩略图存量补齐：为缩略图功能上线前已入库的图片资源补生成缩略图。
//
// 设计要点：
//   - 分批 + 游标：每批只取 50 条，避免把几千张图一次性读进内存；
//     游标用 (created_at, id) 而不是 offset，因为回填会把失败行原地标 failed，
//     这些行仍然命中查询条件，用 offset 分页会反复捞到同一批行。
//   - 限并发：最多 4 个 goroutine 同时生成，避免打爆 R2 带宽与 CPU。
//   - 单条失败不中断：generateResourceThumbnail 内部已把该行标 failed，这里只记日志。
//   - 幂等：ready 的行不在候选条件内；重复执行只会处理仍缺缩略图的行。

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
	thumbnailBackfillBatchSize = 50
	// 同时生成缩略图的 goroutine 上限。
	thumbnailBackfillConcurrency = 4
)

// thumbnailBackfillOutcome 是单个资源的处理结果，用于汇总统计。
type thumbnailBackfillOutcome int

const (
	thumbnailBackfillSucceeded thumbnailBackfillOutcome = iota
	thumbnailBackfillFailed
	thumbnailBackfillSkipped
)

// thumbnailBackfillCounts 统计一批（或全部）资源的处理结果。
type thumbnailBackfillCounts struct {
	succeeded int
	failed    int
	skipped   int
}

func (c *thumbnailBackfillCounts) add(outcome thumbnailBackfillOutcome) {
	switch outcome {
	case thumbnailBackfillSucceeded:
		c.succeeded++
	case thumbnailBackfillFailed:
		c.failed++
	default:
		c.skipped++
	}
}

func (c *thumbnailBackfillCounts) total() int {
	return c.succeeded + c.failed + c.skipped
}

// BackfillResourceThumbnails 为存量图片资源补齐缩略图。
// 分批处理，避免一次性把几千张图全加载进内存；限并发避免打爆 R2 和 CPU。
//
// 候选条件见 repository.ThumbnailBackfillCandidates：kind=image、已就绪、
// 非本地存储，且缩略图状态为空/none/failed。处理过程中可被 ctx 取消，
// 取消后不再开始新的资源，已开始的会自然结束。
func (s *Service) BackfillResourceThumbnails(ctx context.Context) {
	if s == nil || s.repo == nil {
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	startedAt := time.Now()
	var counts thumbnailBackfillCounts
	var cursorTime time.Time
	var cursorID string
	batches := 0

	slog.Info("缩略图回填开始")
	for {
		if err := ctx.Err(); err != nil {
			slog.Warn("缩略图回填已取消", "reason", err, "processed", counts.total())
			break
		}
		batch, err := s.repo.ThumbnailBackfillCandidates(cursorTime, cursorID, thumbnailBackfillBatchSize)
		if err != nil {
			slog.Error("缩略图回填查询失败", "error", err, "processed", counts.total())
			break
		}
		if len(batch) == 0 {
			break
		}
		batches++
		// 先推进游标再处理：本批处理期间即使某行状态变化，下一批也不会重复读取它。
		last := batch[len(batch)-1]
		cursorTime, cursorID = last.CreatedAt, last.ID

		batchCounts := s.processThumbnailBackfillBatch(ctx, batch)
		counts.succeeded += batchCounts.succeeded
		counts.failed += batchCounts.failed
		counts.skipped += batchCounts.skipped
		if batchCounts.total() < len(batch) {
			// 批内被取消打断，剩余资源留到下次开启回填时处理。
			break
		}
	}

	slog.Info("缩略图回填结束",
		"processed", counts.total(),
		"success", counts.succeeded,
		"failed", counts.failed,
		"skipped", counts.skipped,
		"batches", batches,
		"canceled", ctx.Err() != nil,
		"elapsed", time.Since(startedAt).String(),
	)
}

// processThumbnailBackfillBatch 用固定大小的并发池处理一批资源，等待全部结束再返回。
func (s *Service) processThumbnailBackfillBatch(ctx context.Context, batch []model.Resource) thumbnailBackfillCounts {
	var counts thumbnailBackfillCounts
	if len(batch) == 0 {
		return counts
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	slots := make(chan struct{}, thumbnailBackfillConcurrency)

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
			outcome, size, panicValue := s.backfillOneThumbnail(ctx, &resource)
			if panicValue != nil {
				slog.Error("缩略图回填单条异常", "resourceId", resource.ID, "panic", panicValue)
			}
			mu.Lock()
			counts.add(outcome)
			mu.Unlock()
			s.logThumbnailBackfillResult(resource.ID, outcome, size, resource.ThumbnailStatus)
		}()
	}
	wg.Wait()
	return counts
}

// backfillOneThumbnail 处理单个资源。generateResourceThumbnail 不返回错误，
// 只能通过回写后的 ThumbnailStatus 判断结果：
//   - ready：缩略图已上传，size 为缩略图字节数；
//   - failed：生成失败（内部已落库标记）；
//   - none 或状态未变：无需生成（原图长边本来就不大，或不是可处理的图片）。
func (s *Service) backfillOneThumbnail(ctx context.Context, resource *model.Resource) (thumbnailBackfillOutcome, int64, any) {
	if ctx.Err() != nil {
		return thumbnailBackfillSkipped, 0, nil
	}
	var panicValue any
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				panicValue = recovered
			}
		}()
		s.generateResourceThumbnail(resource)
	}()
	if panicValue != nil {
		return thumbnailBackfillFailed, 0, panicValue
	}
	switch resource.ThumbnailStatus {
	case model.ThumbnailStatusReady:
		return thumbnailBackfillSucceeded, resource.ThumbnailSize, nil
	case model.ThumbnailStatusFailed:
		return thumbnailBackfillFailed, 0, nil
	default:
		return thumbnailBackfillSkipped, 0, nil
	}
}

// logThumbnailBackfillResult 每个资源打印一行，便于观察长任务的进度。
func (s *Service) logThumbnailBackfillResult(resourceID string, outcome thumbnailBackfillOutcome, size int64, status string) {
	switch outcome {
	case thumbnailBackfillSucceeded:
		slog.Info("缩略图回填成功", "resourceId", resourceID, "thumbnailBytes", size)
	case thumbnailBackfillFailed:
		slog.Warn("缩略图回填失败", "resourceId", resourceID, "status", status, "thumbnailBytes", size)
	default:
		slog.Info("缩略图回填跳过", "resourceId", resourceID, "status", status, "thumbnailBytes", size)
	}
}

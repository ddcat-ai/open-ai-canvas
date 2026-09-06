package service

import (
	"context"
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"
)

type textReplayCacheKey struct {
	userID, taskID string
	after          int64
}

func (s *Service) initReadCaches() {
	s.readCachesOnce.Do(func() {
		s.concurrencyReadCache = newBoundedReadCache[string, RuntimeTaskPolicy](1, 1024, 1, 2*time.Second)
		s.textReplayReadCache = newBoundedReadCache[textReplayCacheKey, *TextReplayResult](256, 8<<20, 8, 750*time.Millisecond)
		s.routeVersionReadCache = newBoundedReadCache[string, int64](1, 1024, 1, 250*time.Millisecond)
	})
}

// SSE 展示专用，不用于写路径和权限决策；userID 进入 key，回源仍检查任务归属。
// 游标保留在 key 中，避免重连读取到其他客户端已经越过的增量窗口。
func (s *Service) CachedTaskTextReplay(ctx context.Context, userID, taskID string, after int64) (*TextReplayResult, error) {
	s.initReadCaches()
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	value, err := s.textReplayReadCache.get(ctx, textReplayCacheKey{userID, taskID, after}, func(ctx context.Context) (*TextReplayResult, int, error) {
		reader := &Service{repo: s.repo.WithContext(ctx)}
		value, err := reader.TaskTextReplay(userID, taskID, after)
		if err != nil {
			return nil, 0, err
		}
		bytes := 512 + len(value.TextDraft) + len(value.FinalText) + len(value.Error) + len(value.Stage)
		for _, delta := range value.Deltas {
			bytes += 256 + len(delta.Content) + len(delta.ID) + len(delta.UserID) + len(delta.TaskID)
		}
		return value, bytes, nil
	})
	if errors.Is(err, errReadCacheBusy) {
		return nil, &AppError{Status: 503, Code: 503, Message: "任务状态查询繁忙，请稍后重试", Retryable: true}
	}
	if err != nil {
		return nil, err
	}
	copy := *value
	copy.Deltas = append([]model.TaskTextDelta(nil), value.Deltas...)
	return &copy, nil
}

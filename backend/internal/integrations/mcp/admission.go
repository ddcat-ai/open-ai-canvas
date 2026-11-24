package mcpintegration

import (
	"context"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/platform"
)

func (s *Service) acquireOperation(ctx context.Context, operation, userID, connectionID string) (func(), error) {
	if s.coordinator == nil || (s.repo.Dialect() == "postgres" && !s.coordinator.HasRedis()) {
		return nil, kernel.NewAppError(503, "MCP 并发协调服务不可用，已停止外部请求")
	}
	rate, global := 60, 32
	if operation == "test" {
		rate, global = 6, 16
	}
	coordinationCtx, cancel := context.WithTimeout(ctx, platform.CoordinationTimeout)
	defer cancel()
	allowed, err := s.coordinator.Allow(coordinationCtx, "mcp:"+operation+":"+userID, rate, time.Minute)
	if err != nil {
		return nil, kernel.WrapAppError(503, "MCP 限流协调失败，已停止外部请求", err)
	}
	if !allowed {
		return nil, kernel.RateLimited("MCP 操作过于频繁，请稍后重试")
	}
	releases := []func(){}
	release := func() {
		for i := len(releases) - 1; i >= 0; i-- {
			releases[i]()
		}
	}
	for _, slot := range []struct {
		key   string
		limit int
	}{
		{"mcp:connection:" + connectionID, 1},
		{"mcp:user:" + userID, 2},
		{"mcp:" + operation + ":global", global},
		{"mcp:egress:global", 32},
	} {
		free, acquired, err := s.coordinator.Acquire(coordinationCtx, slot.key, slot.limit, 2*time.Minute)
		if err != nil {
			release()
			return nil, kernel.WrapAppError(503, "MCP 并发协调失败，已停止外部请求", err)
		}
		if !acquired {
			release()
			return nil, kernel.RateLimited("MCP 并发已达上限或此连接正在使用，请稍后重试")
		}
		releases = append(releases, free)
	}
	return release, nil
}

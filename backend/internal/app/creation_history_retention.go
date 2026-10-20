package app

import (
	"context"
	"errors"
	"log/slog"
	"time"
	"yingce/backend/internal/repository"
)

func (s *Service) cleanupExpiredCreationHistory(ctx context.Context) {
	policy, err := s.RuntimePolicy()
	if err != nil {
		slog.Warn("conversation retention policy unavailable", "error", err)
		return
	}
	days := policy.Resource.ConversationRetentionDays
	if days <= 0 {
		return
	}
	cutoff := time.Now().Add(-time.Duration(days) * 24 * time.Hour)
	after := ""
	for ctx.Err() == nil {
		rows, err := s.repo.WithContext(ctx).ExpiredCreationSessions(cutoff, after, 100)
		if err != nil {
			slog.Warn("conversation retention query failed", "error", err)
			return
		}
		for _, row := range rows {
			if ctx.Err() != nil {
				return
			}
			if err := s.repo.WithContext(ctx).ExpireCreationSession(row.UserID, row.ID, cutoff); err != nil && !errors.Is(err, repository.ErrAgentSessionBusy) {
				slog.Warn("conversation retention failed", "sessionId", row.ID, "error", err)
			}
			after = row.ID
		}
		if len(rows) < 100 {
			return
		}
	}
}

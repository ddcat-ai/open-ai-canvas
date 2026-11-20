package app

import (
	"context"
	"time"

	"yingce/backend/internal/inspirations"
	"yingce/backend/internal/model"
)

type (
	InspirationFeed               = inspirations.Feed
	InspirationFeedAdminStatus    = inspirations.AdminStatus
	InspirationFeedSettingsUpdate = inspirations.SettingsUpdate
)

type inspirationFeedAdminGate struct{ svc *Service }

func (g inspirationFeedAdminGate) RequireAdmin(user *model.User) error {
	if g.svc == nil {
		return Unauthorized("请先登录")
	}
	return g.svc.RequireAdmin(user)
}

func (g inspirationFeedAdminGate) AppendAudit(actor *model.User, action, targetType, targetID, summary string, metadata any) error {
	if g.svc == nil {
		return Unauthorized("请先登录")
	}
	return g.svc.appendAdminAudit(actor, action, targetType, targetID, summary, metadata)
}

// inspirationFeedLock 用协调器保证多实例部署里只有一个实例在同步上新；没有 Redis 的单实例部署是进程内互斥。
func (s *Service) inspirationFeedLock(ctx context.Context, key string, ttl time.Duration) (func(), bool, error) {
	return s.coordinator.Acquire(ctx, key, 1, ttl)
}

func (s *Service) inspirationFeedDomain() *inspirations.Service {
	if s.inspirationFeed != nil {
		return s.inspirationFeed
	}
	return inspirations.New(s.repo, inspirationFeedAdminGate{svc: s}, nil, nil)
}

func (s *Service) startInspirationFeedWorker() {
	s.inspirationFeedDomain().StartSyncWorker()
}

func (s *Service) InspirationFeed() (*InspirationFeed, error) {
	return s.inspirationFeedDomain().Feed()
}

func (s *Service) AdminInspirationFeed(actor *model.User) (*InspirationFeedAdminStatus, error) {
	return s.inspirationFeedDomain().AdminStatus(actor)
}

func (s *Service) UpdateInspirationFeedSettings(actor *model.User, input InspirationFeedSettingsUpdate) (*InspirationFeedAdminStatus, error) {
	return s.inspirationFeedDomain().UpdateSettings(actor, input)
}

func (s *Service) SyncInspirationFeed(ctx context.Context, actor *model.User) (*InspirationFeedAdminStatus, error) {
	return s.inspirationFeedDomain().SyncNow(ctx, actor)
}

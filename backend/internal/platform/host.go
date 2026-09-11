package platform

import (
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const TaskWorkerConcurrency = 3

// Host 由组合根注入，避免 platform → app 回环。
type Host interface {
	RequireAdmin(user *model.User) error
	AppendAudit(actor *model.User, action, targetType, targetID, summary string, metadata any) error
	DesktopLocalChannelsEnabled() bool
	ChannelConcurrencyLimit(channelID string) (int, error)
}

type nopHost struct{}

func (nopHost) RequireAdmin(*model.User) error { return nil }
func (nopHost) AppendAudit(*model.User, string, string, string, string, any) error {
	return nil
}
func (nopHost) DesktopLocalChannelsEnabled() bool { return false }
func (nopHost) ChannelConcurrencyLimit(string) (int, error) {
	return 0, nil
}

type Service struct {
	repo             *repository.Repository
	host             Host
	Coordinator      *Coordinator
	concurrencyCache *BoundedReadCache[string, RuntimeTaskPolicy]
}

func New(repo *repository.Repository, coordinator *Coordinator, host Host) *Service {
	if host == nil {
		host = nopHost{}
	}
	return &Service{
		repo:             repo,
		host:             host,
		Coordinator:      coordinator,
		concurrencyCache: NewBoundedReadCache[string, RuntimeTaskPolicy](1, 1024, 1, 2*time.Second),
	}
}

func (s *Service) requireAdmin(user *model.User) error {
	if s == nil || s.host == nil {
		return kernel.Unauthorized("请先登录")
	}
	return s.host.RequireAdmin(user)
}

func (s *Service) appendAdminAudit(actor *model.User, action, targetType, targetID, summary string, metadata any) error {
	if s == nil || s.host == nil {
		return nil
	}
	return s.host.AppendAudit(actor, action, targetType, targetID, summary, metadata)
}

func (s *Service) desktopLocalChannelsEnabled() bool {
	if s == nil || s.host == nil {
		return false
	}
	return s.host.DesktopLocalChannelsEnabled()
}

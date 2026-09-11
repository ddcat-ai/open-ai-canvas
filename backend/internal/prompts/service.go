package prompts

import (
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// AdminGate 由组合根注入，避免 prompts → service 回环。
type AdminGate interface {
	RequireAdmin(user *model.User) error
	AppendAudit(actor *model.User, action, targetType, targetID, summary string, metadata any) error
}

type Service struct {
	repo  *repository.Repository
	admin AdminGate
}

func New(repo *repository.Repository, admin AdminGate) *Service {
	return &Service{repo: repo, admin: admin}
}

func (s *Service) requireAdmin(user *model.User) error {
	if s == nil || s.admin == nil {
		return nil
	}
	return s.admin.RequireAdmin(user)
}

func (s *Service) appendAdminAudit(actor *model.User, action, targetType, targetID, summary string, metadata any) error {
	if s == nil || s.admin == nil {
		return nil
	}
	return s.admin.AppendAudit(actor, action, targetType, targetID, summary, metadata)
}

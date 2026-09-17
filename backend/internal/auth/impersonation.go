package auth

import (
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// User is the effective data owner; Impersonator is only used for returning and auditing.
type AuthSessionContext struct {
	User         *model.User
	Session      *model.AuthSession
	Impersonator *model.User
}

func (s *Service) CanImpersonateUsers(user *model.User) (bool, error) {
	if user == nil || user.Role != model.UserRoleAdmin || user.Status != model.UserStatusActive {
		return false, nil
	}
	primary, err := s.repo.FirstUser()
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return primary.ID == user.ID, nil
}

func (s *Service) StartUserImpersonation(cookieValue string, targetID string) (*AuthSessionResult, error) {
	context, err := s.CurrentAuthSession(cookieValue)
	if err != nil {
		return nil, err
	}
	if context.Impersonator != nil {
		return nil, kernel.Forbidden("当前已处于身份切换状态")
	}
	actor := context.User
	allowed, err := s.CanImpersonateUsers(actor)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, kernel.Forbidden("仅主管理员可以进入用户账号")
	}
	if strings.TrimSpace(targetID) == "" {
		return nil, kernel.BadAuthRequest("请选择用户")
	}
	target, err := s.repo.User(strings.TrimSpace(targetID))
	if err != nil {
		return nil, err
	}
	if target.ID == actor.ID || target.Role != model.UserRoleUser || target.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("只能进入已启用的普通用户账号")
	}
	result, nextSession, err := s.newAuthSession(target, actor.ID)
	if err != nil {
		return nil, err
	}
	event := &model.AdminAuditEvent{
		ID: kernel.NewID(), ActorUserID: actor.ID, Action: "user.impersonation.start", TargetType: "user", TargetID: target.ID,
		Summary: "以管理员身份进入用户账号", MetadataJSON: `{"mode":"impersonation"}`, CreatedAt: time.Now(),
	}
	if err := s.repo.ReplaceAuthSessionWithAudit(context.Session.ID, nextSession, event); err != nil {
		return nil, err
	}
	return result, nil
}

func (s *Service) ExitUserImpersonation(cookieValue string) (*AuthSessionResult, error) {
	context, err := s.CurrentAuthSession(cookieValue)
	if err != nil {
		return nil, err
	}
	if context.Impersonator == nil {
		return nil, kernel.BadAuthRequest("当前不在身份切换状态")
	}
	result, nextSession, err := s.newAuthSession(context.Impersonator, "")
	if err != nil {
		return nil, err
	}
	event := &model.AdminAuditEvent{
		ID: kernel.NewID(), ActorUserID: context.Impersonator.ID, Action: "user.impersonation.exit", TargetType: "user", TargetID: context.User.ID,
		Summary: "退出用户身份并返回管理员账号", MetadataJSON: `{"mode":"impersonation"}`, CreatedAt: time.Now(),
	}
	if err := s.repo.ReplaceAuthSessionWithAudit(context.Session.ID, nextSession, event); err != nil {
		return nil, err
	}
	return result, nil
}

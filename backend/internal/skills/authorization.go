package skills

import (
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// IsAdministrator checks current persisted authorization, never a caller's cached role.
// Active ordinary users are not administrators; missing and disabled accounts are errors.
func (s *Service) IsAdministrator(userID string) (bool, error) {
	if strings.TrimSpace(userID) == "" {
		return false, kernel.Unauthorized("请先登录")
	}
	user, err := s.repo.User(userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, kernel.Unauthorized("用户不存在，请重新登录")
	}
	if err != nil {
		return false, err
	}
	if user.Status != model.UserStatusActive {
		return false, kernel.Forbidden("账号已停用")
	}
	return user.Role == model.UserRoleAdmin, nil
}

// RequireSkillAccess is the shared boundary for an authenticated user's skill usage.
// Management operations use RequireAdministrator separately.
func (s *Service) RequireSkillAccess(userID string) error {
	if strings.TrimSpace(userID) == "" {
		return kernel.Unauthorized("请先登录")
	}
	user, err := s.repo.User(userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.Unauthorized("用户不存在，请重新登录")
	}
	if err != nil {
		return err
	}
	if user.Status != model.UserStatusActive {
		return kernel.Forbidden("账号已停用")
	}
	return nil
}

// RequireAdministrator is the shared boundary for skill management.
func (s *Service) RequireAdministrator(userID string) error {
	admin, err := s.IsAdministrator(userID)
	if err != nil {
		return err
	}
	if !admin {
		return kernel.Forbidden("只有管理员可以上传和管理技能")
	}
	return nil
}

func (s *Service) requireSkillAdmin(actor *model.User) error {
	if actor == nil {
		return kernel.Unauthorized("请先登录")
	}
	return s.RequireAdministrator(actor.ID)
}

package auth

import (
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

// 指针字段区分“未提交”与“清空”：只更新调用方显式传入的字段，
// 避免改昵称时把未携带的 avatar_url/email 覆盖为空值。
type UpdateProfileRequest struct {
	DisplayName *string `json:"displayName"`
	Email       *string `json:"email"`
	AvatarURL   *string `json:"avatarUrl"`
}

type ChangePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (s *Service) UpdateProfile(user *model.User, req UpdateProfileRequest) (*model.User, error) {
	if user == nil {
		return nil, kernel.Forbidden("请先登录")
	}
	updates := map[string]any{"updated_at": time.Now()}
	if req.DisplayName != nil {
		displayName := strings.TrimSpace(*req.DisplayName)
		if displayName == "" {
			return nil, kernel.BadAuthRequest("昵称不能为空")
		}
		if len(displayName) > 80 {
			return nil, kernel.BadAuthRequest("昵称最长 80 个字符")
		}
		if displayName != user.DisplayName {
			updates["display_name"] = displayName
		}
	}
	if req.Email != nil {
		email := NormalizeEmail(*req.Email)
		if email != user.Email {
			if email != "" {
				if err := ValidateEmail(email); err != nil {
					return nil, err
				}
				if existing, err := s.repo.UserByEmail(email); err == nil && existing != nil && existing.ID != user.ID {
					return nil, kernel.BadAuthRequest("该邮箱已被其他账号使用")
				}
			}
			updates["email"] = email
		}
	}
	if req.AvatarURL != nil {
		avatarURL := strings.TrimSpace(*req.AvatarURL)
		if len(avatarURL) > 512 {
			return nil, kernel.BadAuthRequest("头像 URL 过长")
		}
		if avatarURL != user.AvatarURL {
			updates["avatar_url"] = avatarURL
		}
	}
	if len(updates) == 1 {
		return user, nil
	}
	if err := s.repo.UpdateUserProfile(user.ID, updates); err != nil {
		return nil, err
	}
	updated, err := s.repo.User(user.ID)
	if err != nil {
		return nil, err
	}
	return updated, nil
}

func (s *Service) ChangePassword(user *model.User, req ChangePasswordRequest) error {
	if user == nil {
		return kernel.Forbidden("请先登录")
	}
	if strings.TrimSpace(user.PasswordHash) == "" {
		return kernel.BadAuthRequest("当前账号未设置密码，请通过忘记密码流程设置")
	}
	if !verifyPassword(req.CurrentPassword, user.PasswordHash) {
		return kernel.BadAuthRequest("当前密码不正确")
	}
	if err := ValidatePassword(req.NewPassword); err != nil {
		return err
	}
	hash, err := HashPassword(req.NewPassword)
	if err != nil {
		return err
	}
	return s.repo.UpdateUserPassword(user.ID, hash, time.Now())
}

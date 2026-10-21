package auth

import (
	"errors"
	"log"

	"yingce/backend/internal/invite"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

// readInvitePolicySetting 读取邀请策略；未配置时返回默认（关闭）策略，
// 与 app 层 readInvitePolicy 保持同一语义。损坏配置返回错误，不擅自开启奖励。
func readInvitePolicySetting(repo *repository.Repository) (invite.InvitePolicy, error) {
	setting, err := repo.SystemSetting(invite.SettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return invite.DefaultInvitePolicy(), nil
	}
	if err != nil {
		return invite.InvitePolicy{}, err
	}
	return invite.ParseInvitePolicy(setting.ValueJSON)
}

func (s *Service) ensureInviteCode(user *model.User) {
	code, err := s.repo.EnsureUserInviteCode(user.ID)
	if err != nil {
		log.Printf("invite code generation failed: user=%s err=%v", user.ID, err)
		return
	}
	user.InviteCode = code
}

// 无效或达到人数上限的邀请码不阻断已通过认证的合法注册。
func (s *Service) attachInviteRecord(userID, rawCode string) {
	code := invite.NormalizeInviteCode(rawCode)
	if code == "" || invite.ValidateInviteCode(code) != nil {
		return
	}
	policy, err := readInvitePolicySetting(s.repo)
	if err != nil {
		log.Printf("invite policy read failed on register: user=%s err=%v", userID, err)
		return
	}
	if !policy.Enabled {
		return
	}
	if _, _, err := s.repo.AttachInviteRecord(userID, code, policy); err != nil {
		log.Printf("invite record attach failed: user=%s err=%v", userID, err)
	}
}

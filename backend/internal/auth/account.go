package auth

import (
	"context"
	"crypto/hmac"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type UserProfile struct {
	User                 AuthUser   `json:"user"`
	HasPassword          bool       `json:"hasPassword"`
	EmailEnabled         bool       `json:"emailEnabled"`
	LinuxDOEnabled       bool       `json:"linuxdoEnabled"`
	ReauthenticatedUntil *time.Time `json:"reauthenticatedUntil,omitempty"`
}
type ProfilePasswordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}
type ProfileEmailCodeRequest struct {
	Email           string `json:"email"`
	CurrentPassword string `json:"currentPassword"`
}
type ProfileEmailChangeRequest struct {
	Ticket          string `json:"ticket"`
	EmailCode       string `json:"emailCode"`
	CurrentPassword string `json:"currentPassword"`
}
type ProfileEmailChangeResult struct {
	Changed            bool   `json:"changed"`
	NotificationStatus string `json:"notificationStatus"`
}

func (s *Service) profileSession(actor *model.User, cookie string) (*model.User, *model.AuthSession, error) {
	if actor == nil || actor.ID == "" {
		return nil, nil, kernel.Unauthorized("请先登录")
	}
	id, token := parseSessionCookie(cookie)
	if id == "" || token == "" {
		return nil, nil, kernel.Unauthorized("登录状态已失效")
	}
	session, err := s.repo.AuthSession(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, kernel.Unauthorized("登录状态已失效")
	}
	if err != nil {
		return nil, nil, err
	}
	if session.UserID != actor.ID || !session.ExpiresAt.After(time.Now()) || !hmac.Equal([]byte(session.TokenHash), []byte(HashToken(token))) {
		return nil, nil, kernel.Unauthorized("登录状态已失效")
	}
	user, err := s.repo.User(actor.ID)
	if err != nil {
		return nil, nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, nil, kernel.Forbidden("该账号已被禁用")
	}
	return user, session, nil
}

func authorizeProfileChange(user *model.User, session *model.AuthSession, password string) error {
	if user.PasswordHash != "" {
		if !verifyPassword(password, user.PasswordHash) {
			return kernel.Unauthorized("当前密码不正确")
		}
		return nil
	}
	now := time.Now()
	if session.ReauthenticatedAt == nil || session.ReauthenticatedAt.After(now) || !session.ReauthenticatedAt.Add(repository.ProfileReauthenticationTTL).After(now) {
		return kernel.Unauthorized("请先通过 Linux.do 重新验证身份")
	}
	return nil
}

func profileWriteError(err error) error {
	if errors.Is(err, repository.ErrProfileAuthorization) {
		return kernel.Unauthorized("账号或身份验证状态已变化，请重新登录或验证")
	}
	if errors.Is(err, repository.ErrVerificationInvalid) {
		return invalidVerification()
	}
	return err
}

func (s *Service) UserProfile(actor *model.User, cookie string) (*UserProfile, error) {
	user, session, err := s.profileSession(actor, cookie)
	if err != nil {
		return nil, err
	}
	public, err := s.PublicAuthUser(user)
	if err != nil {
		return nil, err
	}
	emailEnabled, err := s.EmailEnabled()
	if err != nil {
		return nil, err
	}
	_, linuxdo, err := s.readLinuxDOSetting()
	if err != nil {
		return nil, err
	}
	result := &UserProfile{User: public, HasPassword: user.PasswordHash != "", EmailEnabled: emailEnabled, LinuxDOEnabled: linuxdo.Enabled}
	now := time.Now()
	if session.ReauthenticatedAt != nil && !session.ReauthenticatedAt.After(now) {
		until := session.ReauthenticatedAt.Add(repository.ProfileReauthenticationTTL)
		if until.After(now) {
			result.ReauthenticatedUntil = &until
		}
	}
	return result, nil
}

func (s *Service) ChangeProfilePassword(actor *model.User, cookie string, req ProfilePasswordRequest) error {
	if err := ValidatePassword(req.NewPassword); err != nil {
		return err
	}
	if len([]byte(req.NewPassword)) > 72 {
		return kernel.BadAuthRequest("密码的 UTF-8 长度不能超过 72 字节")
	}
	user, session, err := s.profileSession(actor, cookie)
	if err != nil {
		return err
	}
	if err := authorizeProfileChange(user, session, req.CurrentPassword); err != nil {
		return err
	}
	hash, err := HashPassword(req.NewPassword)
	if err != nil {
		return err
	}
	return profileWriteError(s.repo.ChangeProfilePassword(user, session, hash, time.Now()))
}

func (s *Service) profileEmailSetting() (EmailSettingValue, error) {
	_, setting, err := s.readEmailSetting()
	if err != nil {
		return setting, err
	}
	if !setting.Enabled || setting.Host == "" || setting.Port < 1 || setting.FromEmail == "" {
		return setting, kernel.Forbidden("邮件服务未启用，暂时无法更换邮箱")
	}
	return resolveEmailSender(setting, s.host.BrandName()), nil
}

func (s *Service) SendProfileEmailCode(ctx context.Context, actor *model.User, cookie string, req ProfileEmailCodeRequest) (*VerificationTicket, error) {
	user, session, err := s.profileSession(actor, cookie)
	if err != nil {
		return nil, err
	}
	if err := authorizeProfileChange(user, session, req.CurrentPassword); err != nil {
		return nil, err
	}
	setting, err := s.profileEmailSetting()
	if err != nil {
		return nil, err
	}
	email := NormalizeEmail(req.Email)
	if err := ValidateEmail(email); err != nil {
		return nil, err
	}
	if email == NormalizeEmail(user.Email) {
		return nil, kernel.BadAuthRequest("请输入与当前邮箱不同的新邮箱")
	}
	if err := s.repo.CheckEmailAvailable(email, user.ID); err != nil {
		return nil, err
	}
	code, err := randomNumericCode(6)
	if err != nil {
		return nil, err
	}
	secret := RandomToken()
	now := time.Now()
	v := &model.AuthVerification{ID: kernel.NewID(), TokenHash: HashToken(secret), Purpose: "profile_email", Method: "email", UserID: user.ID, SessionID: session.ID, CredentialHash: repository.ProfileCredentialHash(user.PasswordHash), Email: email, CreatedAt: now, ExpiresAt: now.Add(10 * time.Minute)}
	v.EmailHash, err = s.verificationHash(v.ID + ":email:" + email + ":" + code)
	if err != nil {
		return nil, err
	}
	deliveryHash, err := s.verificationHash("delivery:" + email)
	if err != nil {
		return nil, err
	}
	limits := []repository.NotificationLimit{{Key: "auth-day:" + deliveryHash + ":" + now.UTC().Format("2006-01-02"), Limit: 20, Cooldown: time.Minute, ExpiresAt: now.Add(48 * time.Hour)}, {Key: "auth-hour:" + deliveryHash + ":" + now.UTC().Format("2006-01-02T15"), Limit: 5, ExpiresAt: now.Add(2 * time.Hour)}}
	if err := s.repo.CreateAuthVerification(v, limits); err != nil {
		if errors.Is(err, repository.ErrNotificationLimit) {
			return nil, kernel.RateLimited("发送过于频繁，请至少等待 60 秒后重试（每小时最多 5 次）")
		}
		return nil, err
	}
	if err := s.deliverEmail(setting, email, setting.FromName+"更换邮箱验证码", "验证码："+code+"\n\n验证码 10 分钟内有效，仅用于更换本账号的邮箱。若非本人操作，请忽略本邮件。"); err != nil {
		return nil, kernel.NewAppError(503, "邮件发送失败，请稍后重试")
	}
	if err := s.repo.SetAuthVerificationReady(v.ID); err != nil {
		return nil, err
	}
	return &VerificationTicket{Ticket: v.ID + "." + secret, ExpiresIn: 600, RetryAfter: 60}, nil
}

func (s *Service) ChangeProfileEmail(actor *model.User, cookie string, req ProfileEmailChangeRequest) (*ProfileEmailChangeResult, error) {
	user, session, err := s.profileSession(actor, cookie)
	if err != nil {
		return nil, err
	}
	if err := authorizeProfileChange(user, session, req.CurrentPassword); err != nil {
		return nil, err
	}
	setting, err := s.profileEmailSetting()
	if err != nil {
		return nil, err
	}
	id, secret, ok := strings.Cut(req.Ticket, ".")
	if !ok || id == "" || len(id) > 36 || len(secret) != 64 {
		return nil, invalidVerification()
	}
	v, err := s.repo.AuthVerification(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, invalidVerification()
	}
	if err != nil {
		return nil, err
	}
	if v.Purpose != "profile_email" || v.Method != "email" || v.UserID != user.ID || v.SessionID != session.ID || v.CredentialHash != repository.ProfileCredentialHash(user.PasswordHash) || !hmac.Equal([]byte(v.TokenHash), []byte(HashToken(secret))) {
		return nil, invalidVerification()
	}
	if err := s.repo.AttemptAuthVerification(v.ID, time.Now()); err != nil {
		return nil, profileWriteError(err)
	}
	hash, err := s.verificationHash(v.ID + ":email:" + v.Email + ":" + strings.TrimSpace(req.EmailCode))
	if err != nil {
		return nil, err
	}
	if !hmac.Equal([]byte(hash), []byte(v.EmailHash)) {
		return nil, invalidVerification()
	}
	if err := s.repo.ChangeProfileEmail(user, session, v, time.Now()); err != nil {
		return nil, profileWriteError(err)
	}
	result := &ProfileEmailChangeResult{Changed: true, NotificationStatus: "not_needed"}
	if user.Email != "" {
		result.NotificationStatus = "sent"
		if err := s.deliverEmail(setting, user.Email, setting.FromName+"账号邮箱已变更", "你的"+setting.FromName+"账号邮箱已成功变更，所有登录会话已退出。若非本人操作，请立即联系管理员。"); err != nil {
			result.NotificationStatus = "failed"
		}
	}
	return result, nil
}

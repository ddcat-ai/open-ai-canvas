package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"infinite-canvas/backend/internal/sms"
	"strings"
	"time"
)

type VerificationRequest struct {
	Purpose  string `json:"purpose"`
	Method   string `json:"method"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Password string `json:"password"`
}
type VerificationTicket struct {
	Ticket     string `json:"ticket"`
	ExpiresIn  int    `json:"expiresIn"`
	RetryAfter int    `json:"retryAfter"`
}
type VerificationConfirm struct {
	Ticket    string `json:"ticket"`
	EmailCode string `json:"emailCode"`
	SMSCode   string `json:"smsCode"`
}

func (s *Service) verificationHash(value string) (string, error) {
	key, err := s.host.SettingsEncryptionKey()
	if err != nil {
		return "", err
	}
	if len(key) < 16 {
		return "", kernel.NewAppError(503, "验证码加密密钥不可用")
	}
	h := hmac.New(sha256.New, key)
	h.Write([]byte(value))
	return hex.EncodeToString(h.Sum(nil)), nil
}
func (s *Service) checkVerificationPolicy(p VerificationPolicy, purpose, method string) error {
	if !p.allows(purpose, method) {
		return kernel.Forbidden("此验证方式未开启，请刷新页面")
	}
	if purpose == "register" {
		enabled, err := s.RegistrationEnabled()
		if err != nil {
			return err
		}
		if !enabled {
			return kernel.Forbidden("管理员未开放新用户注册")
		}
	}
	return nil
}
func (s *Service) StartVerification(ctx context.Context, actor *model.User, req VerificationRequest) (*VerificationTicket, error) {
	p, err := s.verificationPolicy()
	if err != nil {
		return nil, err
	}
	if err := s.checkVerificationPolicy(p, req.Purpose, req.Method); err != nil {
		return nil, err
	}
	email, phone := "", ""
	if req.Method == "email" || req.Method == "sms_email" {
		email = NormalizeEmail(req.Email)
		if err := ValidateEmail(email); err != nil {
			return nil, err
		}
		enabled, err := s.EmailEnabled()
		if err != nil {
			return nil, err
		}
		if !enabled {
			return nil, kernel.NewAppError(503, "邮件服务未启用")
		}
		if req.Purpose == "register" {
			if err := s.validateRegistrationEmailDomain(email); err != nil {
				return nil, err
			}
		}
	}
	if req.Method == "sms" || req.Method == "sms_email" {
		phone, err = sms.NormalizePhone(req.Phone)
		if err != nil {
			return nil, err
		}
		enabled, err := s.smsAvailable(req.Purpose)
		if err != nil {
			return nil, err
		}
		if !enabled {
			return nil, kernel.NewAppError(503, "此场景短信服务未启用")
		}
	}
	userID := ""
	if req.Purpose == "bind" {
		if actor == nil || actor.Status != model.UserStatusActive {
			return nil, kernel.Unauthorized("请先登录")
		}
		if !verifyPassword(req.Password, actor.PasswordHash) {
			return nil, kernel.Unauthorized("当前密码不正确")
		}
		userID = actor.ID
	}
	// Existing, active, verified contacts only. Responses do not disclose whether
	// an account exists; unknown accounts receive an unusable, equally shaped ticket.
	if req.Purpose == "login" {
		var user *model.User
		if email != "" {
			user, err = s.repo.UserByEmail(email)
		} else {
			user, err = s.repo.UserByPhone(phone)
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
		if err == nil && user.Status == model.UserStatusActive && ((email != "" && user.EmailVerifiedAt != nil) || (phone != "" && user.PhoneVerifiedAt != nil)) {
			userID = user.ID
		}
	}
	if req.Purpose != "login" {
		if err := s.contactAvailable(email, phone, userID); err != nil {
			return nil, err
		}
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	now := time.Now()
	v := &model.AuthVerification{ID: kernel.NewID(), TokenHash: HashToken(hex.EncodeToString(secret)), Purpose: req.Purpose, Method: req.Method, UserID: userID, Email: email, Phone: phone, PolicyHash: p.hash(), CreatedAt: now, ExpiresAt: now.Add(10 * time.Minute)}
	var emailCode, smsCode string
	if email != "" {
		emailCode, err = randomNumericCode(6)
		if err != nil {
			return nil, err
		}
		v.EmailHash, err = s.verificationHash(v.ID + ":email:" + email + ":" + emailCode)
		if err != nil {
			return nil, err
		}
	}
	if phone != "" {
		smsCode, err = randomNumericCode(6)
		if err != nil {
			return nil, err
		}
		v.PhoneHash, err = s.verificationHash(v.ID + ":sms:" + phone + ":" + smsCode)
		if err != nil {
			return nil, err
		}
	}
	limits := []repository.NotificationLimit{}
	for _, target := range []string{email, phone} {
		if target == "" {
			continue
		}
		hash, err := s.verificationHash("delivery:" + target)
		if err != nil {
			return nil, err
		}
		// Daily shared key also enforces a sliding 60-second cooldown across scenes.
		limits = append(limits, repository.NotificationLimit{Key: "auth-day:" + hash + ":" + now.UTC().Format("2006-01-02"), Limit: 20, Cooldown: 60 * time.Second, ExpiresAt: now.Add(48 * time.Hour)}, repository.NotificationLimit{Key: "auth-hour:" + hash + ":" + now.UTC().Format("2006-01-02T15"), Limit: 5, ExpiresAt: now.Add(2 * time.Hour)})
	}
	if err := s.repo.CreateAuthVerification(v, limits); err != nil {
		if errors.Is(err, repository.ErrNotificationLimit) {
			return nil, kernel.RateLimited("发送过于频繁，请至少等待 60 秒后重试（每小时最多 5 次）")
		}
		return nil, err
	}
	ticket := &VerificationTicket{Ticket: v.ID + "." + hex.EncodeToString(secret), ExpiresIn: 600, RetryAfter: 60}
	if req.Purpose == "login" && userID == "" {
		return ticket, nil
	}
	if phone != "" {
		if err := s.sms.SendCode(ctx, req.Purpose, phone, smsCode); err != nil {
			return nil, err
		}
	}
	if email != "" {
		_, setting, err := s.readEmailSetting()
		if err != nil {
			return nil, err
		}
		setting = resolveEmailSender(setting, s.host.BrandName())
		if err := s.deliverEmail(setting, email, setting.FromName+"身份验证码", fmt.Sprintf("您的验证码是：%s\n10 分钟内有效，仅用于本次身份验证。请勿向他人透露验证码。", emailCode)); err != nil {
			return nil, kernel.NewAppError(503, "邮件发送失败，请稍后重试")
		}
	}
	if err := s.repo.SetAuthVerificationReady(v.ID); err != nil {
		return nil, err
	}
	return ticket, nil
}
func (s *Service) contactAvailable(email, phone, ownID string) error {
	for _, kind := range []string{"email", "sms"} {
		var user *model.User
		var err error
		if kind == "email" {
			if email == "" {
				continue
			}
			user, err = s.repo.UserByEmail(email)
		} else {
			if phone == "" {
				continue
			}
			user, err = s.repo.UserByPhone(phone)
		}
		if err == nil && user.ID != ownID {
			return kernel.BadAuthRequest("该邮箱或手机号已被使用")
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
	}
	return nil
}
func invalidVerification() error {
	return kernel.BadAuthRequest("验证码错误、已失效或验证次数已用尽，请重新获取")
}
func (s *Service) verifyTicket(purpose string, req VerificationConfirm) (*model.AuthVerification, error) {
	id, secret, ok := strings.Cut(req.Ticket, ".")
	if !ok || len(secret) != 64 || len(id) > 36 {
		return nil, invalidVerification()
	}
	v, err := s.repo.AuthVerification(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, invalidVerification()
	}
	if err != nil {
		return nil, err
	}
	if !hmac.Equal([]byte(v.TokenHash), []byte(HashToken(secret))) || v.Purpose != purpose {
		return nil, invalidVerification()
	}
	p, err := s.verificationPolicy()
	if err != nil {
		return nil, err
	}
	if err := s.checkVerificationPolicy(p, v.Purpose, v.Method); err != nil {
		return nil, err
	}
	if p.hash() != v.PolicyHash {
		return nil, kernel.BadAuthRequest("验证策略已更新，请重新获取验证码")
	}
	if err := s.repo.AttemptAuthVerification(v.ID, time.Now()); err != nil {
		if errors.Is(err, repository.ErrVerificationInvalid) {
			return nil, invalidVerification()
		}
		return nil, err
	}
	if v.Email != "" {
		hash, err := s.verificationHash(v.ID + ":email:" + v.Email + ":" + strings.TrimSpace(req.EmailCode))
		if err != nil {
			return nil, err
		}
		if !hmac.Equal([]byte(hash), []byte(v.EmailHash)) {
			return nil, invalidVerification()
		}
	}
	if v.Phone != "" {
		hash, err := s.verificationHash(v.ID + ":sms:" + v.Phone + ":" + strings.TrimSpace(req.SMSCode))
		if err != nil {
			return nil, err
		}
		if !hmac.Equal([]byte(hash), []byte(v.PhoneHash)) {
			return nil, invalidVerification()
		}
	}
	return v, nil
}
func (s *Service) LoginVerification(req VerificationConfirm) (*AuthSessionResult, error) {
	v, err := s.verifyTicket("login", req)
	if err != nil {
		return nil, err
	}
	user, err := s.repo.CompleteAuthVerification(v, false)
	if err != nil {
		if errors.Is(err, repository.ErrVerificationInvalid) {
			return nil, invalidVerification()
		}
		return nil, err
	}
	if err := s.host.EnsureSignupBonus(user.ID); err != nil {
		return nil, err
	}
	s.host.RecordActivity(user.ID, "login", 1)
	return s.createAuthSession(user)
}
func (s *Service) BindVerification(actor *model.User, req VerificationConfirm) (*AuthUser, error) {
	if actor == nil {
		return nil, kernel.Unauthorized("请先登录")
	}
	v, err := s.verifyTicket("bind", req)
	if err != nil {
		return nil, err
	}
	if v.UserID != actor.ID {
		return nil, invalidVerification()
	}
	if err := s.contactAvailable(v.Email, v.Phone, actor.ID); err != nil {
		return nil, err
	}
	user, err := s.repo.CompleteAuthVerification(v, true)
	if err != nil {
		return nil, invalidVerification()
	}
	result, err := s.PublicAuthUser(user)
	return &result, err
}

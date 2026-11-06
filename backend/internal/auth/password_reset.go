package auth

import (
	"crypto/hmac"
	"errors"
	"log"
	"strings"
	"time"
	"yingce/backend/internal/emailtpl"
	"yingce/backend/internal/kernel"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

const passwordResetEmailPurpose = "password_reset"
const passwordResetCodeTTL = 10 * time.Minute

type PasswordResetRequest struct {
	Email     string `json:"email"`
	EmailCode string `json:"emailCode"`
	Password  string `json:"password"`
}

func (s *Service) SendPasswordResetEmailCode(rawEmail string) error {
	email := NormalizeEmail(rawEmail)
	if err := ValidateEmail(email); err != nil {
		return err
	}
	_, setting, err := s.readEmailSetting()
	if err != nil {
		return err
	}
	if !setting.Enabled || setting.Host == "" || setting.Port < 1 || setting.FromEmail == "" {
		return kernel.Forbidden("管理员尚未启用密码找回，请联系管理员")
	}

	s.emailCodeMu.Lock()
	defer s.emailCodeMu.Unlock()

	// 以下不发信的分支对外仍返回成功，避免枚举账号；原因写入发送记录，管理员可在后台排查“收不到邮件”。
	user, err := s.repo.UserByEmail(email)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		s.recordSkippedEmail(EmailPurposePasswordReset, "", email, "该邮箱未绑定任何账号")
		return nil
	}
	if err != nil {
		return err
	}
	if user.Status != model.UserStatusActive {
		s.recordSkippedEmail(EmailPurposePasswordReset, user.ID, email, "账号已停用")
		return nil
	}
	if strings.TrimSpace(user.PasswordHash) == "" {
		s.recordSkippedEmail(EmailPurposePasswordReset, user.ID, email, "账号未设置密码（第三方登录或验证码注册），请用原方式登录后在账号设置中设置密码")
		return nil
	}
	if latest, latestErr := s.repo.LatestEmailVerificationCode(email, passwordResetEmailPurpose); latestErr == nil && time.Since(latest.CreatedAt) < time.Minute {
		s.recordSkippedEmail(EmailPurposePasswordReset, user.ID, email, "60 秒内已发送过验证码，本次未重复发送")
		return nil
	} else if latestErr != nil && !errors.Is(latestErr, gorm.ErrRecordNotFound) {
		return latestErr
	}

	code, err := randomNumericCode(6)
	if err != nil {
		return err
	}
	codeHash, err := s.emailVerificationCodeHash(passwordResetEmailPurpose, email, code)
	if err != nil {
		return err
	}
	now := time.Now()
	record := model.EmailVerificationCode{
		ID:        kernel.NewID(),
		Email:     email,
		CodeHash:  codeHash,
		Purpose:   passwordResetEmailPurpose,
		ExpiresAt: now.Add(passwordResetCodeTTL),
		CreatedAt: now,
	}
	if err := s.repo.Create(&record); err != nil {
		return err
	}
	setting = resolveEmailSender(setting, s.host.BrandName())
	rendered, err := passwordResetEmail(setting.FromName, email, code)
	if err != nil {
		return err
	}
	if err := s.deliverEmail(setting, EmailDelivery{Purpose: EmailPurposePasswordReset, UserID: user.ID, Recipient: email, Mail: rendered}); err != nil {
		if cleanupErr := s.repo.DeleteEmailVerificationCode(record.ID); cleanupErr != nil {
			log.Printf("password reset email cleanup failed: recipient=%s error=%v", maskedEmail(email), cleanupErr)
		}
		return nil
	}
	if cleanupErr := s.repo.DeleteExpiredEmailVerificationCodes(now.Add(-24 * time.Hour)); cleanupErr != nil {
		log.Printf("expired password reset code cleanup failed: error=%v", cleanupErr)
	}
	return nil
}

func (s *Service) ResetPassword(req PasswordResetRequest) error {
	email := NormalizeEmail(req.Email)
	if err := ValidateEmail(email); err != nil {
		return err
	}
	if err := ValidatePassword(req.Password); err != nil {
		return err
	}
	code := strings.TrimSpace(req.EmailCode)
	if len(code) != 6 {
		return invalidPasswordResetCode()
	}

	user, err := s.repo.UserByEmail(email)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return invalidPasswordResetCode()
		}
		return err
	}
	if user.Status != model.UserStatusActive || strings.TrimSpace(user.PasswordHash) == "" {
		return invalidPasswordResetCode()
	}
	record, err := s.repo.LatestEmailVerificationCode(email, passwordResetEmailPurpose)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return invalidPasswordResetCode()
		}
		return err
	}
	if time.Now().After(record.ExpiresAt) {
		return invalidPasswordResetCode()
	}
	expectedHash, err := s.emailVerificationCodeHash(passwordResetEmailPurpose, email, code)
	if err != nil {
		return err
	}
	if !hmac.Equal([]byte(expectedHash), []byte(record.CodeHash)) {
		return invalidPasswordResetCode()
	}
	passwordHash, err := HashPassword(req.Password)
	if err != nil {
		return err
	}
	if err := s.repo.ResetUserPasswordWithEmailVerification(user.ID, email, passwordResetEmailPurpose, record.ID, passwordHash, time.Now()); err != nil {
		if errors.Is(err, repository.ErrEmailVerificationCodeInvalid) {
			return invalidPasswordResetCode()
		}
		return err
	}
	return nil
}

func invalidPasswordResetCode() *AuthError {
	return kernel.BadAuthRequest("验证码无效或已过期")
}

func passwordResetEmail(brandName, recipient, code string) (OutgoingMail, error) {
	return codeMail(emailtpl.CodeEmail{Brand: brandName, Heading: "重置密码", SubjectLabel: "密码重置验证码", Intro: "你正在重置" + brandName + "账号密码。请在找回密码页面输入下方验证码，然后设置新密码。", Code: code, TTLMinutes: 10, Recipient: recipient,
		SecurityTip: "如果这不是你本人的操作，请忽略本邮件，密码不会被修改；同时建议检查邮箱账号的安全。重置成功后，所有设备上的登录会话都会退出。"})
}

func maskedEmail(email string) string {
	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 || parts[0] == "" {
		return "***"
	}
	return string([]rune(parts[0])[0]) + "***@" + parts[1]
}

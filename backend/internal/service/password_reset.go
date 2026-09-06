package service

import (
	"crypto/hmac"
	"errors"
	"log"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

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
	email := normalizeEmail(rawEmail)
	if err := validateEmail(email); err != nil {
		return err
	}
	_, setting, err := s.readEmailSetting()
	if err != nil {
		return err
	}
	if !setting.Enabled || setting.Host == "" || setting.Port < 1 || setting.FromEmail == "" {
		return Forbidden("管理员尚未启用密码找回，请联系管理员")
	}

	s.emailCodeMu.Lock()
	defer s.emailCodeMu.Unlock()

	user, err := s.repo.UserByEmail(email)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if user.Status != model.UserStatusActive || strings.TrimSpace(user.PasswordHash) == "" {
		return nil
	}
	if latest, latestErr := s.repo.LatestEmailVerificationCode(email, passwordResetEmailPurpose); latestErr == nil && time.Since(latest.CreatedAt) < time.Minute {
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
		ID:        newID(),
		Email:     email,
		CodeHash:  codeHash,
		Purpose:   passwordResetEmailPurpose,
		ExpiresAt: now.Add(passwordResetCodeTTL),
		CreatedAt: now,
	}
	if err := s.repo.Create(&record); err != nil {
		return err
	}
	setting = resolveEmailSender(setting, s.appearanceBrandName())
	if err := s.deliverEmail(setting, email, setting.FromName+"密码重置验证码", passwordResetEmailBody(setting.FromName, code)); err != nil {
		if cleanupErr := s.repo.DeleteEmailVerificationCode(record.ID); cleanupErr != nil {
			log.Printf("password reset email cleanup failed: recipient=%s error=%v", maskedEmail(email), cleanupErr)
		}
		log.Printf("password reset email delivery failed: recipient=%s error=%v", maskedEmail(email), err)
		return nil
	}
	if cleanupErr := s.repo.DeleteExpiredEmailVerificationCodes(now.Add(-24 * time.Hour)); cleanupErr != nil {
		log.Printf("expired password reset code cleanup failed: error=%v", cleanupErr)
	}
	return nil
}

func (s *Service) ResetPassword(req PasswordResetRequest) error {
	email := normalizeEmail(req.Email)
	if err := validateEmail(email); err != nil {
		return err
	}
	if err := validatePassword(req.Password); err != nil {
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
	passwordHash, err := hashPassword(req.Password)
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
	return BadAuthRequest("验证码无效或已过期")
}

func passwordResetEmailBody(brandName string, code string) string {
	return "你正在重置" + brandName + "账号密码。\n\n验证码：" + code + "\n\n验证码 10 分钟内有效。若非本人操作，请忽略本邮件，并确保邮箱账号安全。"
}

func maskedEmail(email string) string {
	parts := strings.SplitN(email, "@", 2)
	if len(parts) != 2 || parts[0] == "" {
		return "***"
	}
	return string([]rune(parts[0])[0]) + "***@" + parts[1]
}

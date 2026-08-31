package service

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestPasswordResetChangesPasswordConsumesCodeAndRevokesSessions(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	oldHash, err := hashPassword("old-password")
	if err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "user-1", Username: "creator", Email: "creator@example.com", DisplayName: "Creator", Role: model.UserRoleUser, Status: model.UserStatusActive, PasswordHash: oldHash}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	sessions := []model.AuthSession{
		{ID: "session-1", UserID: user.ID, TokenHash: "one", ExpiresAt: time.Now().Add(time.Hour)},
		{ID: "session-2", UserID: user.ID, TokenHash: "two", ExpiresAt: time.Now().Add(time.Hour)},
	}
	if err := db.Create(&sessions).Error; err != nil {
		t.Fatal(err)
	}

	var deliveredCode string
	svc.mailSender = func(_ emailSettingValue, recipient string, subject string, body string) error {
		if recipient != user.Email || subject != "影策密码重置验证码" {
			t.Fatalf("unexpected reset email: recipient=%q subject=%q", recipient, subject)
		}
		deliveredCode = codeFromEmailBody(body)
		return nil
	}
	if err := svc.SendPasswordResetEmailCode(" Creator@Example.com "); err != nil {
		t.Fatal(err)
	}
	if err := svc.SendPasswordResetEmailCode(user.Email); err != nil {
		t.Fatalf("repeat send should keep the public response generic: %v", err)
	}
	if len(deliveredCode) != 6 {
		t.Fatalf("delivered code = %q", deliveredCode)
	}
	var storedCode model.EmailVerificationCode
	if err := db.Where("email = ? AND purpose = ?", user.Email, passwordResetEmailPurpose).First(&storedCode).Error; err != nil {
		t.Fatal(err)
	}
	if storedCode.CodeHash == deliveredCode || storedCode.CodeHash == "" {
		t.Fatalf("verification code was not hashed: %#v", storedCode)
	}

	if err := svc.ResetPassword(PasswordResetRequest{Email: user.Email, EmailCode: deliveredCode, Password: "new-password"}); err != nil {
		t.Fatal(err)
	}
	var updated model.User
	if err := db.First(&updated, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if bcrypt.CompareHashAndPassword([]byte(updated.PasswordHash), []byte("new-password")) != nil {
		t.Fatal("new password hash does not match")
	}
	if bcrypt.CompareHashAndPassword([]byte(updated.PasswordHash), []byte("old-password")) == nil {
		t.Fatal("old password still matches")
	}
	var sessionCount int64
	if err := db.Model(&model.AuthSession{}).Where("user_id = ?", user.ID).Count(&sessionCount).Error; err != nil {
		t.Fatal(err)
	}
	if sessionCount != 0 {
		t.Fatalf("auth session count = %d, want 0", sessionCount)
	}
	if err := db.First(&storedCode, "id = ?", storedCode.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedCode.UsedAt == nil {
		t.Fatal("password reset code was not consumed")
	}
	if err := svc.ResetPassword(PasswordResetRequest{Email: user.Email, EmailCode: deliveredCode, Password: "another-password"}); !isInvalidPasswordResetError(err) {
		t.Fatalf("reused code error = %v", err)
	}
}

func TestPasswordResetSendDoesNotRevealAccountEligibility(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	hash, err := hashPassword("strong-password")
	if err != nil {
		t.Fatal(err)
	}
	users := []model.User{
		{ID: "oauth-user", Username: "oauth-user", Email: "oauth@example.com", Status: model.UserStatusActive},
		{ID: "disabled-user", Username: "disabled-user", Email: "disabled@example.com", Status: model.UserStatusDisabled, PasswordHash: hash},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	deliveries := 0
	svc.mailSender = func(_ emailSettingValue, _ string, _ string, _ string) error {
		deliveries++
		return nil
	}
	for _, email := range []string{"missing@example.com", "oauth@example.com", "disabled@example.com"} {
		if err := svc.SendPasswordResetEmailCode(email); err != nil {
			t.Fatalf("SendPasswordResetEmailCode(%q) error = %v", email, err)
		}
	}
	if deliveries != 0 {
		t.Fatalf("mail deliveries = %d, want 0", deliveries)
	}
	var codeCount int64
	if err := db.Model(&model.EmailVerificationCode{}).Count(&codeCount).Error; err != nil {
		t.Fatal(err)
	}
	if codeCount != 0 {
		t.Fatalf("verification code count = %d, want 0", codeCount)
	}
}

func TestPasswordResetRejectsWrongExpiredAndPurposeMismatchedCodes(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	hash, err := hashPassword("old-password")
	if err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "user-1", Username: "creator", Email: "creator@example.com", Status: model.UserStatusActive, PasswordHash: hash}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}

	resetHash, err := svc.emailVerificationCodeHash(passwordResetEmailPurpose, user.Email, "123456")
	if err != nil {
		t.Fatal(err)
	}
	registrationHash, err := svc.emailVerificationCodeHash(registrationEmailPurpose, user.Email, "123456")
	if err != nil {
		t.Fatal(err)
	}
	if resetHash == registrationHash {
		t.Fatal("email verification hashes must be separated by purpose")
	}
	record := model.EmailVerificationCode{ID: "expired", Email: user.Email, Purpose: passwordResetEmailPurpose, CodeHash: resetHash, ExpiresAt: time.Now().Add(-time.Minute), CreatedAt: time.Now().Add(-11 * time.Minute)}
	if err := db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.ResetPassword(PasswordResetRequest{Email: user.Email, EmailCode: "123456", Password: "new-password"}); !isInvalidPasswordResetError(err) {
		t.Fatalf("expired code error = %v", err)
	}
	record.ID = "active"
	record.ExpiresAt = time.Now().Add(time.Minute)
	record.CreatedAt = time.Now()
	if err := db.Create(&record).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.ResetPassword(PasswordResetRequest{Email: user.Email, EmailCode: "654321", Password: "new-password"}); !isInvalidPasswordResetError(err) {
		t.Fatalf("wrong code error = %v", err)
	}
}

func TestPasswordResetDeliveryFailureRemovesUnusableCode(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	hash, err := hashPassword("old-password")
	if err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "user-1", Username: "creator", Email: "creator@example.com", Status: model.UserStatusActive, PasswordHash: hash}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	svc.mailSender = func(_ emailSettingValue, _ string, _ string, _ string) error { return errors.New("smtp unavailable") }
	if err := svc.SendPasswordResetEmailCode(user.Email); err != nil {
		t.Fatalf("delivery failure should keep the public response generic: %v", err)
	}
	var count int64
	if err := db.Model(&model.EmailVerificationCode{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("verification code count = %d, want 0", count)
	}
}

func newPasswordResetTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.EmailVerificationCode{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	settingJSON, err := json.Marshal(emailSettingValue{Enabled: true, Host: "smtp.example.com", Port: 587, Encryption: "starttls", FromEmail: "noreply@example.com", FromName: "影策"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: emailSettingKey, ValueJSON: string(settingJSON)}).Error; err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: t.TempDir()}, db
}

func codeFromEmailBody(body string) string {
	marker := "验证码："
	start := strings.Index(body, marker)
	if start < 0 {
		return ""
	}
	value := body[start+len(marker):]
	if end := strings.IndexByte(value, '\n'); end >= 0 {
		value = value[:end]
	}
	return strings.TrimSpace(value)
}

func isInvalidPasswordResetError(err error) bool {
	var appErr *AppError
	return errors.As(err, &appErr) && appErr.Status == 400 && appErr.Message == "验证码无效或已过期"
}

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
	// Existing users can reset passwords even outside the registration whitelist.
	user := model.User{ID: "user-1", Username: "creator", Email: "creator@external.example", DisplayName: "Creator", Role: model.UserRoleUser, Status: model.UserStatusActive, PasswordHash: oldHash}
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

func TestSenderNameBrandsRegistrationAndPasswordResetEmails(t *testing.T) {
	for _, tc := range []struct {
		name     string
		fromName string
		wantName string
	}{
		{name: "default inherits appearance", fromName: defaultAppearanceBrandName, wantName: "HIMA Studio"},
		{name: "empty inherits appearance", fromName: "", wantName: "HIMA Studio"},
		{name: "custom sender overrides appearance", fromName: "Custom Canvas", wantName: "Custom Canvas"},
		{name: "custom sender is trimmed", fromName: "  自定义工作台  ", wantName: "自定义工作台"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			assertRegistrationAndPasswordResetEmailBrand(t, tc.fromName, tc.wantName)
		})
	}
}

func assertRegistrationAndPasswordResetEmailBrand(t *testing.T, fromName, wantName string) {
	t.Helper()
	svc, db := newPasswordResetTestService(t)
	_, emailSetting, err := svc.readEmailSetting()
	if err != nil {
		t.Fatal(err)
	}
	emailSetting.FromName = fromName
	settingJSON, err := json.Marshal(emailSetting)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.SystemSetting{}).Where("key = ?", emailSettingKey).Update("value_json", string(settingJSON)).Error; err != nil {
		t.Fatal(err)
	}
	appearanceJSON, err := json.Marshal(AppearanceSetting{
		SchemaVersion:    appearanceSchemaVersion,
		BrandName:        "HIMA Studio",
		BrandSlug:        "hima-studio",
		AuthHeroTitle:    defaultAppearanceHeroTitle,
		LogoFrameEnabled: true,
		SkinID:           defaultAppearanceSkinID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: appearanceSettingKey, ValueJSON: string(appearanceJSON)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: registrationSettingKey, ValueJSON: `{"enabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	passwordHash, err := hashPassword("strong-password")
	if err != nil {
		t.Fatal(err)
	}
	existing := model.User{ID: "brand-admin", Username: "brand-admin", Email: "admin@example.com", Role: model.UserRoleAdmin, Status: model.UserStatusActive, PasswordHash: passwordHash}
	resetUser := model.User{ID: "brand-user", Username: "brand-user", Email: "member@example.com", Role: model.UserRoleUser, Status: model.UserStatusActive, PasswordHash: passwordHash}
	if err := db.Create(&[]model.User{existing, resetUser}).Error; err != nil {
		t.Fatal(err)
	}

	type delivery struct {
		fromName  string
		recipient string
		subject   string
		body      string
	}
	deliveries := make([]delivery, 0, 2)
	svc.mailSender = func(setting emailSettingValue, recipient string, subject string, body string) error {
		deliveries = append(deliveries, delivery{fromName: setting.FromName, recipient: recipient, subject: subject, body: body})
		return nil
	}
	if err := svc.SendRegistrationEmailCode("new-member@example.com"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SendPasswordResetEmailCode(resetUser.Email); err != nil {
		t.Fatal(err)
	}
	if len(deliveries) != 2 {
		t.Fatalf("deliveries = %d, want 2", len(deliveries))
	}
	for _, delivered := range deliveries {
		if delivered.fromName != wantName || !strings.Contains(delivered.subject, wantName) || !strings.Contains(delivered.body, wantName) || strings.Contains(delivered.subject, defaultAppearanceBrandName) || strings.Contains(delivered.body, defaultAppearanceBrandName) {
			t.Fatalf("email did not use resolved sender name %q: %#v", wantName, delivered)
		}
	}
	if deliveries[0].subject != wantName+"注册验证码" || deliveries[1].subject != wantName+"密码重置验证码" {
		t.Fatalf("unexpected branded subjects: %#v", deliveries)
	}
	if !strings.Contains(deliveries[0].body, "你正在注册"+wantName+"。") {
		t.Fatalf("registration body did not use resolved sender name: %q", deliveries[0].body)
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
	settingJSON, err := json.Marshal(emailSettingValue{Enabled: true, Host: "smtp.example.com", Port: 587, Encryption: "starttls", FromEmail: "noreply@example.com", FromName: "影策", RegistrationAllowedDomains: []string{"example.com"}})
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

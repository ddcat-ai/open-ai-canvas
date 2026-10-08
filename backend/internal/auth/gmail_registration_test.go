package auth

import (
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestGmailAliasRegistrationRejectsExistingMailbox(t *testing.T) {
	svc, db := newRegistrationTestService(t)
	for _, setting := range []model.SystemSetting{
		{Key: registrationSettingKey, ValueJSON: `{"enabled":true}`},
	} {
		if err := db.Create(&setting).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&model.SystemSetting{}).Where("key = ?", emailSettingKey).Update("value_json", `{"enabled":true,"host":"smtp.example.com","port":587,"fromEmail":"sender@gmail.com","registrationAllowedDomains":["gmail.com","googlemail.com"]}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: "existing", Username: "existing", Email: "a.b+old@googlemail.com", Role: model.UserRoleUser, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	// A valid code isolates the registration uniqueness check from email delivery.
	email, code := "ab+new@gmail.com", "123456"
	now := time.Now()
	hash, err := svc.emailVerificationCodeHash(registrationEmailPurpose, email, code)
	if err != nil {
		t.Fatal(err)
	}
	verification := model.EmailVerificationCode{ID: "code", Email: email, Purpose: registrationEmailPurpose, CodeHash: hash, ExpiresAt: now.Add(time.Hour), CreatedAt: now}
	if err := db.Create(&verification).Error; err != nil {
		t.Fatal(err)
	}
	_, err = svc.Register(RegisterRequest{Username: "new-member", Email: email, EmailCode: code, Password: "password", AcceptedTerms: true})
	if err == nil || !strings.Contains(err.Error(), "邮箱已被注册") {
		t.Fatalf("registration accepted a second account for the same Gmail mailbox or failed unexpectedly: %v", err)
	}
	var count int64
	if err := db.Model(&model.User{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("users=%d err=%v", count, err)
	}
	if err := db.First(&verification, "id = ?", "code").Error; err != nil || verification.UsedAt != nil {
		t.Fatalf("verification consumed: %#v err=%v", verification, err)
	}
}

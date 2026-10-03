package auth

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestEmailCodeBodiesPutExpiryInFinalParagraph(t *testing.T) {
	const code = "123456"
	const expiry = "本验证码有效期为 10 分钟。"

	for _, test := range []struct {
		name string
		body string
	}{
		{name: "registration", body: registrationEmailBody("影策", code)},
		{name: "password reset", body: passwordResetEmailBody("影策", code)},
	} {
		t.Run(test.name, func(t *testing.T) {
			if !strings.HasSuffix(test.body, expiry) {
				t.Fatalf("email body must end with expiry paragraph: %q", test.body)
			}
			marker := "验证码：" + code
			index := strings.Index(test.body, marker)
			if index < 0 {
				t.Fatalf("email body is missing code marker: %q", test.body)
			}
			if !strings.HasPrefix(test.body[index+len(marker):], "\n\n") {
				t.Fatalf("email code must be separated from following text by a blank line: %q", test.body)
			}
		})
	}
}

type verificationEmailTestHost struct{ nopHost }

func (verificationEmailTestHost) SettingsEncryptionKey() ([]byte, error) {
	return []byte("verification-email-test-key"), nil
}

func TestIdentityVerificationEmailSeparatesCodeAndExpiry(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	if err := db.AutoMigrate(&model.AuthVerification{}, &model.NotificationQuota{}); err != nil {
		t.Fatal(err)
	}
	policyJSON, err := json.Marshal(VerificationPolicy{EmailLogin: true})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: authPolicyKey, ValueJSON: string(policyJSON)}).Error; err != nil {
		t.Fatal(err)
	}
	verifiedAt := time.Now()
	user := model.User{ID: "verification-user", Username: "verification-user", Email: "verification@example.com", Status: model.UserStatusActive, EmailVerifiedAt: &verifiedAt}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	svc.host = verificationEmailTestHost{}
	var body string
	svc.SetMailSender(func(_ EmailSettingValue, _ string, _ string, deliveredBody string) error {
		body = deliveredBody
		return nil
	})
	if _, err := svc.StartVerification(context.Background(), nil, VerificationRequest{Purpose: "login", Method: "email", Email: user.Email}); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body, "您的验证码是：") {
		t.Fatalf("identity verification email is missing code marker: %q", body)
	}
	const marker = "您的验证码是："
	codeAndBody := strings.TrimPrefix(body, marker)
	lineEnd := strings.IndexByte(codeAndBody, '\n')
	if lineEnd != 6 {
		t.Fatalf("identity verification code must be exactly six digits on its own line: %q", body)
	}
	for _, char := range codeAndBody[:lineEnd] {
		if char < '0' || char > '9' {
			t.Fatalf("identity verification code must contain only digits: %q", body)
		}
	}
	if !strings.HasPrefix(codeAndBody[lineEnd:], "\n\n") {
		t.Fatalf("identity verification code must be separated from following text by a blank line: %q", body)
	}
	if !strings.HasSuffix(body, "本验证码有效期为 10 分钟。") {
		t.Fatalf("identity verification email must end with expiry paragraph: %q", body)
	}
}

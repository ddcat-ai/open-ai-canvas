package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestBuildMIMEMessageHasRequiredHeadersAndBothParts(t *testing.T) {
	setting := EmailSettingValue{FromEmail: "noreply@example.com", FromName: "影策", Host: "smtp.example.com"}
	raw := string(buildMIMEMessage(setting, "reader@example.com", OutgoingMail{Subject: "123456 是你的影策注册验证码", Text: "验证码：123456", HTML: "<p>123456</p>"}, time.Date(2026, 11, 6, 10, 0, 0, 0, time.UTC)))
	for _, want := range []string{"\r\nDate: Fri, 06 Nov 2026 10:00:00 +0000\r\n", "\r\nMessage-ID: <", "@example.com>\r\n", "multipart/alternative; boundary=", "Content-Type: text/plain; charset=UTF-8", "Content-Type: text/html; charset=UTF-8", "Auto-Submitted: auto-generated"} {
		if !strings.Contains(raw, want) {
			t.Fatalf("MIME message missing %q:\n%s", want, raw)
		}
	}
	if strings.Contains(raw, "验证码") || !strings.Contains(raw, "Subject: =?UTF-8?q?") {
		t.Fatal("subject must be Q-encoded and body base64-encoded")
	}
}

func TestImplicitTLSPortOverridesStartTLS(t *testing.T) {
	for _, tc := range []struct {
		port       int
		encryption string
		want       string
	}{{465, "starttls", "tls"}, {465, "none", "none"}, {587, "starttls", "starttls"}, {587, "tls", "tls"}} {
		if got := smtpEncryption(EmailSettingValue{Port: tc.port, Encryption: tc.encryption}); got != tc.want {
			t.Fatalf("port %d %s => %s, want %s", tc.port, tc.encryption, got, tc.want)
		}
	}
}

func TestPasswordResetRecordsSkipReasonsAndDeliveries(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	hash, err := HashPassword("old-password")
	if err != nil {
		t.Fatal(err)
	}
	users := []model.User{
		{ID: "oauth-user", Username: "oauth-user", Email: "oauth@example.com", Status: model.UserStatusActive},
		{ID: "member", Username: "member", Email: "member@example.com", Status: model.UserStatusActive, PasswordHash: hash},
		{ID: "broken", Username: "broken", Email: "broken@example.com", Status: model.UserStatusActive, PasswordHash: hash},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	svc.SetMailSender(func(_ EmailSettingValue, recipient, _, _ string) error {
		if recipient == "broken@example.com" {
			return errors.New("550 mailbox unavailable")
		}
		return nil
	})
	for _, email := range []string{"missing@example.com", "oauth@example.com", "member@example.com", "member@example.com", "broken@example.com"} {
		if err := svc.SendPasswordResetEmailCode(email); err != nil {
			t.Fatalf("send %s: %v", email, err)
		}
	}
	var logs []model.EmailLog
	if err := db.Order("created_at, id").Find(&logs).Error; err != nil {
		t.Fatal(err)
	}
	got := map[string][]string{}
	for _, entry := range logs {
		if entry.Purpose != EmailPurposePasswordReset {
			t.Fatalf("purpose = %q", entry.Purpose)
		}
		if strings.ContainsAny(entry.Subject, "0123456789") {
			t.Fatalf("log subject leaks code: %q", entry.Subject)
		}
		got[entry.Recipient] = append(got[entry.Recipient], entry.Status+":"+entry.Reason)
	}
	expect := func(recipient, prefix string, index int) {
		t.Helper()
		if len(got[recipient]) <= index || !strings.HasPrefix(got[recipient][index], prefix) {
			t.Fatalf("%s log[%d] = %v, want prefix %q", recipient, index, got[recipient], prefix)
		}
	}
	expect("missing@example.com", "skipped:该邮箱未绑定任何账号", 0)
	expect("oauth@example.com", "skipped:账号未设置密码", 0)
	expect("member@example.com", "sent:", 0)
	expect("member@example.com", "skipped:60 秒内已发送过", 1)
	expect("broken@example.com", "failed:550 mailbox unavailable", 0)
}

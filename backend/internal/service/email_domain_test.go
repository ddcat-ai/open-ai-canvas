package service

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestRegistrationDomainPolicyChecksSendingAndRegistration(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	admin := &model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: registrationSettingKey, ValueJSON: `{"enabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	var deliveredCode string
	sends := 0
	svc.mailSender = func(_ emailSettingValue, _, _ string, body string) error {
		sends++
		deliveredCode = codeFromEmailBody(body)
		return nil
	}
	if err := svc.SendRegistrationEmailCode("member@blocked.example"); err == nil || !strings.Contains(err.Error(), "白名单") {
		t.Fatalf("blocked domain must not receive registration code: %v", err)
	}
	var codes int64
	if err := db.Model(&model.EmailVerificationCode{}).Count(&codes).Error; err != nil {
		t.Fatal(err)
	}
	if sends != 0 || codes != 0 {
		t.Fatalf("blocked send created side effects: sends=%d codes=%d", sends, codes)
	}
	if err := svc.SendRegistrationEmailCode("member@example.com"); err != nil {
		t.Fatal(err)
	}
	if deliveredCode == "" || sends != 1 {
		t.Fatal("allowed domain did not receive a code")
	}
	// A code issued before an administrator tightens the policy must not bypass it.
	if _, err := svc.UpdateEmailSetting(admin, EmailSettingRequest{RegistrationAllowedDomains: []string{"gmail.com"}}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Register(RegisterRequest{Username: "member", Email: "member@example.com", Password: "strong-password", EmailCode: deliveredCode}); err == nil || !strings.Contains(err.Error(), "白名单") {
		t.Fatalf("registration must recheck current domain policy: %v", err)
	}
	count, err := svc.repo.UserCount()
	if err != nil || count != 1 {
		t.Fatalf("blocked registration created a user: count=%d err=%v", count, err)
	}
}

func TestEmailDomainSettingsRoundTripAndValidation(t *testing.T) {
	svc, _ := newPasswordResetTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	setting, err := svc.UpdateEmailSetting(admin, EmailSettingRequest{RegistrationAllowedDomains: []string{" @GMAIL.COM. ", "gmail.com"}})
	if err != nil || setting == nil || len(setting.RegistrationAllowedDomains) != 1 || setting.RegistrationAllowedDomains[0] != "gmail.com" {
		t.Fatalf("normalization failed: setting=%+v err=%v", setting, err)
	}
	if _, err := svc.UpdateEmailSetting(admin, EmailSettingRequest{RegistrationAllowedDomains: []string{"bad_domain"}}); err == nil {
		t.Fatal("invalid whitelist accepted while SMTP is disabled")
	}
	setting, err = svc.AdminEmailSetting(admin)
	if err != nil || setting == nil || len(setting.RegistrationAllowedDomains) != 1 || setting.RegistrationAllowedDomains[0] != "gmail.com" {
		t.Fatalf("failed update changed the saved whitelist: setting=%+v err=%v", setting, err)
	}
	if _, err := svc.UpdateEmailSetting(admin, EmailSettingRequest{RegistrationAllowedDomains: []string{}}); err != nil {
		t.Fatal(err)
	}
	setting, err = svc.AdminEmailSetting(admin)
	if err != nil || setting == nil || setting.RegistrationAllowedDomains == nil || len(setting.RegistrationAllowedDomains) != 0 {
		t.Fatalf("explicit empty whitelist must survive persistence: setting=%+v err=%v", setting, err)
	}
	if err := svc.validateRegistrationEmailDomain("member@custom.example"); err != nil {
		t.Fatalf("empty saved whitelist should allow custom domains: %v", err)
	}
}

func TestNormalizeEmailSettingDefaultsToMainstreamRegistrationDomains(t *testing.T) {
	setting := normalizeEmailSetting(emailSettingValue{})
	for _, domain := range []string{"gmail.com", "163.com", "126.com", "qq.com", "outlook.com", "hotmail.com", "icloud.com", "yahoo.com", "foxmail.com"} {
		if !containsEmailDomain(setting.RegistrationAllowedDomains, domain) {
			t.Fatalf("default allowed domains = %#v, missing %q", setting.RegistrationAllowedDomains, domain)
		}
	}

	setting = normalizeEmailSetting(emailSettingValue{RegistrationAllowedDomains: []string{}})
	if len(setting.RegistrationAllowedDomains) != 0 {
		t.Fatalf("explicit empty allowed domains = %#v, want unrestricted", setting.RegistrationAllowedDomains)
	}
}

func TestValidateRegistrationEmailDomainUsesExactWhitelistMatch(t *testing.T) {
	allowed := []string{"gmail.com", "example.org"}
	for _, email := range []string{"member@gmail.com", "member@example.org"} {
		if err := validateRegistrationEmailDomain(email, allowed); err != nil {
			t.Fatalf("%s should be allowed: %v", email, err)
		}
	}
	for _, test := range []struct {
		email string
		want  string
	}{
		{email: "member@fakegmail.com", want: "不在管理员设置的白名单"},
		{email: "member@blocked.example", want: "不在管理员设置的白名单"},
	} {
		if err := validateRegistrationEmailDomain(test.email, allowed); err == nil || !strings.Contains(err.Error(), test.want) {
			t.Fatalf("validateRegistrationEmailDomain(%q) error = %v", test.email, err)
		}
	}
}

func TestValidateRegistrationEmailDomainsRejectsInvalidDomain(t *testing.T) {
	if err := validateRegistrationEmailDomains([]string{"invalid_domain"}); err == nil {
		t.Fatal("invalid domain should be rejected")
	}
}

func TestValidateRegistrationEmailDomainAllowsAnyDomainWhenWhitelistIsEmpty(t *testing.T) {
	if err := validateRegistrationEmailDomain("member@example.org", nil); err != nil {
		t.Fatalf("empty whitelist should not restrict registration: %v", err)
	}
}

func containsEmailDomain(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

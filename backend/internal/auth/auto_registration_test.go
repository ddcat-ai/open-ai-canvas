package auth

import (
	"errors"
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

func seedRegistrationSetting(t *testing.T, db *gorm.DB, valueJSON string) {
	t.Helper()
	if err := db.Create(&model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: registrationSettingKey, ValueJSON: valueJSON}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestLoginAutoRegisterSignalsUnknownAccount(t *testing.T) {
	svc, db := newRegistrationTestService(t)
	seedRegistrationSetting(t, db, `{"enabled":true}`)

	_, err := svc.Login(LoginRequest{Username: "member@example.com", Password: "password", AutoRegister: true})
	var appErr *kernel.AppError
	if !errors.As(err, &appErr) || appErr.Reason != kernel.ReasonAccountNotRegistered || appErr.Details["accountKind"] != "email" {
		t.Fatalf("Login() error = %#v", err)
	}
	// 未声明一体表单的旧客户端保持原有提示。
	_, err = svc.Login(LoginRequest{Username: "member@example.com", Password: "password"})
	if !errors.As(err, &appErr) || appErr.Status != 401 {
		t.Fatalf("Login() without autoRegister error = %#v", err)
	}
}

func TestLoginAutoRegisterKeepsGenericErrorWhenRegistrationClosed(t *testing.T) {
	svc, db := newRegistrationTestService(t)
	seedRegistrationSetting(t, db, `{"enabled":false}`)
	_, err := svc.Login(LoginRequest{Username: "new-member", Password: "password", AutoRegister: true})
	var appErr *kernel.AppError
	if !errors.As(err, &appErr) || appErr.Status != 401 || appErr.Reason == kernel.ReasonAccountNotRegistered {
		t.Fatalf("Login() error = %#v", err)
	}
}

func TestRegisterWithoutVerificationWhenDisabled(t *testing.T) {
	svc, db := newRegistrationTestService(t)
	seedRegistrationSetting(t, db, `{"enabled":true,"emailVerificationRequired":false}`)

	result, err := svc.Register(RegisterRequest{Username: "member", Password: "password", AcceptedTerms: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.User.Email != "" || result.User.EmailVerifiedAt != nil {
		t.Fatalf("user = %#v", result.User)
	}
	// 填写的邮箱按未验证保存，后续在账号设置里验证绑定。
	result, err = svc.Register(RegisterRequest{Email: "Writer.One@example.com", Password: "password", AcceptedTerms: true})
	if err != nil {
		t.Fatal(err)
	}
	if result.User.Username != "writer-one" || result.User.Email != "writer.one@example.com" || result.User.EmailVerifiedAt != nil {
		t.Fatalf("email user = %#v", result.User)
	}
}

func TestRegisterRequiresEmailWhenConfigured(t *testing.T) {
	svc, db := newRegistrationTestService(t)
	seedRegistrationSetting(t, db, `{"enabled":true,"emailRequired":true,"emailVerificationRequired":false}`)
	if _, err := svc.Register(RegisterRequest{Username: "member", Password: "password", AcceptedTerms: true}); err == nil {
		t.Fatal("Register() without email succeeded")
	}
	if _, err := svc.Register(RegisterRequest{Email: "member@example.com", Password: "password", AcceptedTerms: true}); err != nil {
		t.Fatal(err)
	}
}

func TestRegisterLegacySettingStillRequiresVerification(t *testing.T) {
	svc, db := newRegistrationTestService(t)
	seedRegistrationSetting(t, db, `{"enabled":true}`)
	if _, err := svc.Register(RegisterRequest{Username: "member", Email: "member@example.com", Password: "password", AcceptedTerms: true}); err == nil {
		t.Fatal("legacy setting registered without verification code")
	}
}

func TestDisablingVerificationRequiresNoSender(t *testing.T) {
	svc, _ := newRegistrationTestService(t)
	admin := &model.User{ID: "root", Username: "root", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	saved, err := svc.UpdateRegistrationSetting(admin, RegistrationSettingRequest{Enabled: true, EmailRequired: boolPtr(true), EmailVerificationRequired: boolPtr(false)})
	if err != nil {
		t.Fatal(err)
	}
	if !saved.EmailRequired || saved.EmailVerificationRequired {
		t.Fatalf("saved = %#v", saved)
	}
	// 只切换注册开关时保留邮箱要求。
	saved, err = svc.UpdateRegistrationSetting(admin, RegistrationSettingRequest{Enabled: false})
	if err != nil || !saved.EmailRequired || saved.EmailVerificationRequired {
		t.Fatalf("toggle = %#v, %v", saved, err)
	}
}

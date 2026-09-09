package service

import (
	"context"
	"errors"
	"infinite-canvas/backend/internal/model"
	"testing"
	"time"
)

func TestRegistrationCooldownAndFailedSMTPDoesNotBlockRetry(t *testing.T) {
	svc, db := newPasswordResetTestService(t)
	db.Create(&model.User{ID: "admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive})
	db.Create(&model.SystemSetting{Key: registrationSettingKey, ValueJSON: `{"enabled":true}`})
	svc.mailSender = func(emailSettingValue, string, string, string) error { return errors.New("synthetic SMTP failure") }
	if err := svc.SendRegistrationEmailCode("new@example.com"); err == nil {
		t.Fatal("SMTP error hidden")
	}
	sent := 0
	svc.mailSender = func(emailSettingValue, string, string, string) error { sent++; return nil }
	if err := svc.SendRegistrationEmailCode("new@example.com"); err != nil {
		t.Fatal(err)
	}
	var cooldown *EmailCodeCooldownError
	if err := svc.SendRegistrationEmailCode("new@example.com"); !errors.As(err, &cooldown) || cooldown.Seconds < 58 || cooldown.Seconds > 60 {
		t.Fatalf("cooldown: %v", err)
	}
	if sent != 1 {
		t.Fatal("duplicate mail sent")
	}
}

func TestRequestRetryAfterMatchesWindow(t *testing.T) {
	s := &Service{coordinator: &runtimeCoordinator{localRate: map[string]localRateEntry{}}}
	ctx := context.Background()
	if ok, err := s.AllowRequest(ctx, "email-code:test", 1, time.Hour); err != nil || !ok {
		t.Fatal(err)
	}
	if ok, _ := s.AllowRequest(ctx, "email-code:test", 1, time.Hour); ok {
		t.Fatal("limit bypassed")
	}
	wait := s.RequestRetryAfter(ctx, "email-code:test", time.Hour)
	if wait < 59*time.Minute || wait > time.Hour {
		t.Fatalf("wrong wait: %v", wait)
	}
	if s.coordinator.localRate["email-code:test"].count != 1 {
		t.Fatal("rejection consumed quota")
	}
}

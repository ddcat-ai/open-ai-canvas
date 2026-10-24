package auth

import (
	"os"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestWechatConfigAndManualCode(t *testing.T) {
	code := newManualCode()
	if len(code) != 6 {
		t.Fatalf("expected 6 char code, got %s", code)
	}

	os.Setenv("CANVAS_WECHAT_LOGIN_ENABLED", "true")
	os.Setenv("CANVAS_WECHAT_APPID", "wx1234567890abcdef")
	os.Setenv("CANVAS_WECHAT_QR_MANUAL", "true")
	defer func() {
		os.Unsetenv("CANVAS_WECHAT_LOGIN_ENABLED")
		os.Unsetenv("CANVAS_WECHAT_APPID")
		os.Unsetenv("CANVAS_WECHAT_QR_MANUAL")
	}()

	enabled, appID, _, _, _, manual := wechatLoginEnvConfig()
	if !enabled || appID != "wx1234567890abcdef" || !manual {
		t.Fatalf("expected enabled and manual, got enabled=%v appID=%s manual=%v", enabled, appID, manual)
	}
}

func TestWechatTicketWorkflow(t *testing.T) {
	svc, db := newRegistrationTestService(t)
	if err := db.AutoMigrate(&model.WechatQRTicket{}); err != nil {
		t.Fatalf("AutoMigrate error: %v", err)
	}

	os.Setenv("CANVAS_WECHAT_LOGIN_ENABLED", "true")
	os.Setenv("CANVAS_WECHAT_APPID", "wx1234567890abcdef")
	os.Setenv("CANVAS_WECHAT_QR_MANUAL", "true")
	defer func() {
		os.Unsetenv("CANVAS_WECHAT_LOGIN_ENABLED")
		os.Unsetenv("CANVAS_WECHAT_APPID")
		os.Unsetenv("CANVAS_WECHAT_QR_MANUAL")
	}()

	// 1. Create Ticket
	ticketRes, err := svc.CreateWechatQRTicket("login", "")
	if err != nil {
		t.Fatalf("CreateWechatQRTicket error: %v", err)
	}
	if ticketRes.Ticket == "" || ticketRes.Code == "" || !ticketRes.Manual {
		t.Fatalf("unexpected ticket response: %+v", ticketRes)
	}

	// 2. Poll pending
	statusRes, err := svc.GetWechatQRTicketStatus(ticketRes.Ticket)
	if err != nil {
		t.Fatalf("GetWechatQRTicketStatus error: %v", err)
	}
	if statusRes.Status != model.WechatTicketStatusPending {
		t.Fatalf("expected pending status, got %s", statusRes.Status)
	}

	// 3. Confirm with mock/manual code
	confirmRes, err := svc.ConfirmWechatTicket(ticketRes.Ticket, "", "mock_test_js_code_123")
	if err != nil {
		t.Fatalf("ConfirmWechatTicket error: %v", err)
	}
	if !confirmRes.Success || confirmRes.Action != "login" {
		t.Fatalf("unexpected confirm response: %+v", confirmRes)
	}

	// 4. Poll confirmed
	statusRes, err = svc.GetWechatQRTicketStatus(ticketRes.Ticket)
	if err != nil {
		t.Fatalf("GetWechatQRTicketStatus after confirm error: %v", err)
	}
	if statusRes.Status != model.WechatTicketStatusConfirmed || statusRes.Session == "" || statusRes.User == nil {
		t.Fatalf("expected confirmed with session and user, got %+v", statusRes)
	}

	// 5. Test Bind workflow
	bindTicketRes, err := svc.CreateWechatQRTicket("bind", statusRes.User.ID)
	if err != nil {
		t.Fatalf("CreateWechatQRTicket for bind error: %v", err)
	}
	// Try binding the same wechat openid to another user -> should fail
	otherUser := &model.User{ID: "other-user-999", Username: "other", Status: model.UserStatusActive, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	_ = db.Create(otherUser)
	otherBindTicket, _ := svc.CreateWechatQRTicket("bind", otherUser.ID)
	_, err = svc.ConfirmWechatTicket(otherBindTicket.Ticket, "", "mock_test_js_code_123")
	if err == nil {
		t.Fatalf("expected error when binding already bound wechat to another user")
	}

	// Confirm bind to the same user -> should succeed
	confirmBindRes, err := svc.ConfirmWechatTicket(bindTicketRes.Ticket, "", "mock_test_js_code_123")
	if err != nil {
		t.Fatalf("ConfirmWechatTicket for same user bind error: %v", err)
	}
	if !confirmBindRes.Success || confirmBindRes.Action != "bind" {
		t.Fatalf("unexpected confirm bind result: %+v", confirmBindRes)
	}
}

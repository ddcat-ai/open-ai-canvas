package app

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newFeishuFeedbackTestService(t *testing.T) (*Service, *model.User) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.UserFeedback{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	admin := &model.User{ID: "feishu-admin", Username: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive, CreatedAt: time.Now()}
	if err := db.Create(admin).Error; err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: t.TempDir()}, admin
}

func TestHandleFeishuCallbackStoresOnce(t *testing.T) {
	svc, admin := newFeishuFeedbackTestService(t)
	if _, err := svc.SaveFeishuFeedbackSettings(admin, FeishuFeedbackSettingsInput{
		Enabled: true, AppID: "app", AppSecret: "secret", VerificationToken: "verify", AdminChatID: "oc_admin",
	}); err != nil {
		t.Fatal(err)
	}
	content, _ := json.Marshal(map[string]string{"text": "bug: 导出失败\n点击按钮没有反应"})
	body, _ := json.Marshal(map[string]any{
		"header": map[string]string{"event_id": "evt-1", "tenant_key": "tenant-1", "token": "verify"},
		"event": map[string]any{
			"sender":  map[string]any{"sender_id": map[string]string{"open_id": "ou_1"}},
			"message": map[string]string{"message_id": "om_1", "chat_id": "oc_1", "message_type": "text", "content": string(content)},
		},
	})
	challenge, first, duplicate, err := svc.HandleFeishuCallback(body, http.Header{})
	if err != nil || challenge != "" || duplicate || first == nil || first.Type != model.FeedbackTypeBug {
		t.Fatalf("first callback = challenge %q feedback %+v duplicate %v err %v", challenge, first, duplicate, err)
	}
	_, second, duplicate, err := svc.HandleFeishuCallback(body, http.Header{})
	if err != nil || !duplicate || second == nil || second.ID != first.ID {
		t.Fatalf("duplicate callback = feedback %+v duplicate %v err %v", second, duplicate, err)
	}
	rows, err := svc.repo.ListFeishuFeedbacksBetween(time.Now().UTC().Add(-time.Hour), time.Now().UTC().Add(time.Hour))
	if err != nil || len(rows) != 1 {
		t.Fatalf("stored rows = %d err=%v", len(rows), err)
	}
}

func TestFeishuDigestFormattingIsDeterministic(t *testing.T) {
	rows := []model.UserFeedback{
		{ID: "b", Type: model.FeedbackTypeFeature, Title: "需求 B", Content: "第二条", UserName: "小乙"},
		{ID: "a", Type: model.FeedbackTypeBug, Title: "问题 A", Content: "第一条", UserName: "小甲"},
	}
	first := formatFeishuDigest("2026-11-11", rows)
	second := formatFeishuDigest("2026-11-11", rows)
	if first != second || first == "" {
		t.Fatalf("digest is not deterministic: %q != %q", first, second)
	}
}

func TestSaveFeishuFeedbackSettingsSupportsMidnightAndClearsCustomBaseURL(t *testing.T) {
	svc, admin := newFeishuFeedbackTestService(t)
	hour, minute := 0, 5
	view, err := svc.SaveFeishuFeedbackSettings(admin, FeishuFeedbackSettingsInput{
		Enabled: true, AppID: "app", AppSecret: "secret", VerificationToken: "verify",
		BaseURL: "https://open.larksuite.com", AdminChatID: "oc_admin", DigestHour: &hour, DigestMinute: &minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.DigestHour != 0 || view.DigestMinute != 5 || view.BaseURL != "https://open.larksuite.com" {
		t.Fatalf("saved settings = %+v, want 00:05 and custom base URL", view)
	}

	// An empty BaseURL intentionally resets the endpoint to the client's official
	// default. This keeps partial administrator updates from retaining a stale
	// regional endpoint after it has been cleared in the settings form.
	zero := 0
	view, err = svc.SaveFeishuFeedbackSettings(admin, FeishuFeedbackSettingsInput{
		Enabled: true, DigestHour: &zero, DigestMinute: &zero,
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.BaseURL != "" || view.DigestHour != 0 || view.DigestMinute != 0 {
		t.Fatalf("cleared settings = %+v, want default endpoint and 00:00", view)
	}
}

func TestRunFeishuFeedbackDigestNowRejectsInvalidPersistedTimezone(t *testing.T) {
	svc, admin := newFeishuFeedbackTestService(t)
	if err := svc.repo.SaveSystemSetting(&model.SystemSetting{
		Key:       feishuFeedbackSettingKey,
		ValueJSON: `{"enabled":true,"appId":"app","appSecret":"secret","verificationToken":"verify","adminChatId":"oc_admin","timezone":"Mars/Invalid","digestHour":0,"digestMinute":0}`,
	}); err != nil {
		t.Fatal(err)
	}
	_, err := svc.RunFeishuFeedbackDigestNow(context.Background(), admin)
	if err == nil || !strings.Contains(err.Error(), "时区") {
		t.Fatalf("invalid timezone error = %v, want a validation error", err)
	}
}

func TestFeishuFeedbackDayWindowUsesCivilMidnightAcrossDST(t *testing.T) {
	location, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	start, end := localDayWindow(time.Date(2026, 3, 8, 12, 0, 0, 0, location))
	if start.Hour() != 0 || end.Hour() != 0 || end.Day() != 9 {
		t.Fatalf("DST window = %v..%v, want consecutive local midnights", start, end)
	}
	if got := end.Sub(start); got != 23*time.Hour {
		t.Fatalf("DST window duration = %v, want 23h", got)
	}
}

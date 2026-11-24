package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

type reportMail struct{ recipient, subject, body string }

func newConsumptionReportTestService(t *testing.T) (*Service, *gorm.DB, *[]reportMail) {
	t.Helper()
	t.Setenv("REDIS_URL", "")
	t.Setenv("CANVAS_PUBLIC_BASE_URL", "https://canvas.example.com/")
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.SystemSetting{}, &model.CreditAccount{}, &model.CreditLedgerEntry{}, &model.BillingOrder{}, &model.EmailLog{}, &model.UserNotificationSetting{}); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(auth.EmailSettingValue{Enabled: true, Host: "smtp.example.com", Port: 587, Encryption: "starttls", FromEmail: "noreply@example.com", FromName: "影策"})
	if err := db.Create(&model.SystemSetting{Key: "email", ValueJSON: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	coordinator, err := platform.NewCoordinator("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	mails := &[]reportMail{}
	repo := repository.New(db)
	domain := auth.New(repo, nil, func(_ auth.EmailSettingValue, recipient, subject, body string) error {
		*mails = append(*mails, reportMail{recipient, subject, body})
		return nil
	})
	return &Service{repo: repo, coordinator: coordinator, auth: domain}, db, mails
}

func TestConsumptionReportSendsOnceAt2359ForSubscribedSpenders(t *testing.T) {
	svc, db, mails := newConsumptionReportTestService(t)
	day := time.Date(2026, 11, 6, 0, 0, 0, 0, consumptionReportLocation)
	users := []model.User{
		{ID: "spender", Username: "spender", DisplayName: "小王", Email: "spender@example.com", Status: model.UserStatusActive},
		{ID: "idle", Username: "idle", Email: "idle@example.com", Status: model.UserStatusActive},
		{ID: "unsubscribed", Username: "unsubscribed", Email: "off@example.com", Status: model.UserStatusActive},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"spender", "idle"} {
		if _, err := svc.repo.SaveConsumptionReportSubscription(id, true); err != nil {
			t.Fatal(err)
		}
	}
	orders := []model.BillingOrder{{ID: "o-video", UserID: "spender", IdempotencyKey: "a", Capability: "video", Model: "Seedance"}, {ID: "o-image", UserID: "spender", IdempotencyKey: "b", Capability: "image", Model: "GPT Image"}, {ID: "o-off", UserID: "unsubscribed", IdempotencyKey: "c", Capability: "image"}}
	if err := db.Create(&orders).Error; err != nil {
		t.Fatal(err)
	}
	entries := []model.CreditLedgerEntry{
		{ID: "l1", UserID: "spender", Type: model.CreditLedgerConsume, AmountMicrocredits: -80_000_000, BillingOrderID: "o-video", Model: "Seedance", CreatedAt: day.Add(14 * time.Hour)},
		{ID: "l2", UserID: "spender", Type: model.CreditLedgerConsume, AmountMicrocredits: -20_000_000, BillingOrderID: "o-image", Model: "GPT Image", CreatedAt: day.Add(15 * time.Hour)},
		{ID: "l3", UserID: "spender", Type: model.CreditLedgerRefund, AmountMicrocredits: 5_000_000, BillingOrderID: "o-image", Model: "GPT Image", CreatedAt: day.Add(15*time.Hour + time.Minute)},
		{ID: "l4", UserID: "spender", Type: model.CreditLedgerConsume, AmountMicrocredits: -50_000_000, BillingOrderID: "o-video", Model: "Seedance", CreatedAt: day.Add(-10 * time.Hour)},
		{ID: "l5", UserID: "unsubscribed", Type: model.CreditLedgerConsume, AmountMicrocredits: -1_000_000, BillingOrderID: "o-off", CreatedAt: day.Add(9 * time.Hour)},
	}
	if err := db.Create(&entries).Error; err != nil {
		t.Fatal(err)
	}

	svc.runConsumptionReports(t.Context(), day.Add(23*time.Hour+58*time.Minute))
	if len(*mails) != 0 {
		t.Fatalf("reports must wait for 23:59, sent %d", len(*mails))
	}
	at := day.Add(23*time.Hour + 59*time.Minute + 5*time.Second)
	svc.runConsumptionReports(t.Context(), at)
	svc.runConsumptionReports(t.Context(), at.Add(20*time.Second))
	if len(*mails) != 1 {
		t.Fatalf("want exactly one report, got %#v", *mails)
	}
	mail := (*mails)[0]
	if mail.recipient != "spender@example.com" || !strings.Contains(mail.subject, "11 月 6 日") || !strings.Contains(mail.subject, "95 积分") {
		t.Fatalf("unexpected report mail: %+v", mail)
	}
	for _, want := range []string{"今日净消费：95 积分", "较昨日 ↑ 90%", "生成次数：2", "失败退回：5 积分", "视频生成：80 积分（80.0%，1 次）", "https://canvas.example.com/wallet"} {
		if !strings.Contains(mail.body, want) {
			t.Fatalf("report text missing %q:\n%s", want, mail.body)
		}
	}
	var log model.EmailLog
	if err := db.First(&log, "purpose = ?", auth.EmailPurposeConsumptionReport).Error; err != nil || log.Status != "sent" || log.UserID != "spender" {
		t.Fatalf("report delivery must be logged: %+v %v", log, err)
	}
}

func TestNotificationSubscriptionDefaultsOffAndRequiresEmail(t *testing.T) {
	svc, db, _ := newConsumptionReportTestService(t)
	withEmail := &model.User{ID: "u1", Username: "u1", Email: "u1@example.com", Status: model.UserStatusActive}
	noEmail := &model.User{ID: "u2", Username: "u2", Status: model.UserStatusActive}
	if err := db.Create([]*model.User{withEmail, noEmail}).Error; err != nil {
		t.Fatal(err)
	}
	settings, err := svc.UserNotificationSettings(withEmail)
	if err != nil || settings.ConsumptionReportEnabled || !settings.EmailAvailable {
		t.Fatalf("default settings = %+v, %v", settings, err)
	}
	if _, err := svc.UpdateUserNotificationSettings(noEmail, true); err == nil {
		t.Fatal("subscribing without email must fail")
	}
	settings, err = svc.UpdateUserNotificationSettings(withEmail, true)
	if err != nil || !settings.ConsumptionReportEnabled {
		t.Fatalf("subscribe = %+v, %v", settings, err)
	}
	settings, err = svc.UpdateUserNotificationSettings(withEmail, false)
	if err != nil || settings.ConsumptionReportEnabled {
		t.Fatalf("unsubscribe = %+v, %v", settings, err)
	}
}

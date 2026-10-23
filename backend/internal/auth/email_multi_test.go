package auth

import (
	"encoding/json"
	"strings"
	"sync"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type testHost struct {
	nopHost
}

func (testHost) RequireAdmin(actor *model.User) error {
	if actor != nil && actor.Role == model.UserRoleAdmin {
		return nil
	}
	return gorm.ErrRecordNotFound
}

func (testHost) BrandName() string {
	return "测试系统"
}

func (testHost) EncryptSecret(value string) (string, error) {
	return "enc:" + value, nil
}

func (testHost) DecryptSecret(value string) (string, error) {
	return strings.TrimPrefix(value, "enc:"), nil
}

func setupEmailTestService(t *testing.T) (*Service, *model.User) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:auth-email-multi-test?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	svc := New(repo, testHost{}, nil)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin}
	return svc, admin
}

func TestMultiSenderConfigAndRoundRobin(t *testing.T) {
	svc, admin := setupEmailTestService(t)

	req := EmailSettingRequest{
		Enabled:      true,
		DispatchMode: "round_robin",
		Senders: []EmailSenderRequest{
			{
				ID:         "sender-1",
				Name:       "飞书发信",
				Host:       "smtp.larksuite.com",
				Port:       465,
				Username:   "mexai@mexai.cc",
				Password:   "pwd-1",
				Encryption: "tls",
				FromEmail:  "mexai@mexai.cc",
				FromName:   "测试A",
				Enabled:    true,
			},
			{
				ID:         "sender-2",
				Name:       "备用SMTP",
				Host:       "mail.smtp2go.com",
				Port:       587,
				Username:   "smtp2go-user",
				Password:   "pwd-2",
				Encryption: "starttls",
				FromEmail:  "support@example.com",
				FromName:   "测试B",
				Enabled:    true,
			},
		},
	}

	setting, err := svc.UpdateEmailSetting(admin, req)
	if err != nil {
		t.Fatalf("UpdateEmailSetting failed: %v", err)
	}
	if !setting.Enabled || setting.DispatchMode != "round_robin" || len(setting.Senders) != 2 {
		t.Fatalf("unexpected setting: %+v", setting)
	}
	if !setting.Senders[0].HasPassword || !setting.Senders[1].HasPassword {
		t.Fatal("senders should indicate hasPassword")
	}

	// 验证发信轮询
	var mu sync.Mutex
	var sentFrom []string
	svc.SetMailSender(func(s EmailSettingValue, recipient, subject, body string) error {
		mu.Lock()
		defer mu.Unlock()
		sentFrom = append(sentFrom, s.FromEmail)
		return nil
	})

	_, settingVal, err := svc.readEmailSetting()
	if err != nil {
		t.Fatal(err)
	}

	// 连续发送 4 封
	for i := 0; i < 4; i++ {
		if err := svc.deliverEmail(settingVal, "test@example.com", "Test", "Content"); err != nil {
			t.Fatalf("deliverEmail %d failed: %v", i, err)
		}
	}

	mu.Lock()
	defer mu.Unlock()
	if len(sentFrom) != 4 {
		t.Fatalf("expected 4 emails, got %d", len(sentFrom))
	}
	// 验证交替轮询：mexai -> support -> mexai -> support
	expected := []string{"mexai@mexai.cc", "support@example.com", "mexai@mexai.cc", "support@example.com"}
	for i := 0; i < 4; i++ {
		if sentFrom[i] != expected[i] {
			t.Errorf("email %d sent from %q, want %q", i, sentFrom[i], expected[i])
		}
	}
}

func TestLegacySingleSenderAutoMigration(t *testing.T) {
	svc, _ := setupEmailTestService(t)

	// 模拟数据库中只有旧格式单邮箱
	legacyData := map[string]any{
		"enabled":    true,
		"host":       "smtp.legacy.com",
		"port":       465,
		"username":   "legacy-user",
		"password":   "enc:legacy-pass",
		"encryption": "tls",
		"fromEmail":  "legacy@legacy.com",
		"fromName":   "旧通道",
	}
	raw, _ := json.Marshal(legacyData)
	setting := &model.SystemSetting{Key: emailSettingKey, ValueJSON: string(raw)}
	_ = svc.repo.SaveSystemSetting(setting)

	_, val, err := svc.readEmailSetting()
	if err != nil {
		t.Fatal(err)
	}
	if len(val.Senders) != 1 {
		t.Fatalf("expected 1 migrated sender, got %d", len(val.Senders))
	}
	sender := val.Senders[0]
	if sender.Host != "smtp.legacy.com" || sender.FromEmail != "legacy@legacy.com" || sender.Password != "legacy-pass" {
		t.Fatalf("migrated sender mismatch: %+v", sender)
	}
}

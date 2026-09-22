package auth

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// smsTestHost 给测试用的宿主：密钥"加密"成 `enc:` 前缀（够验证"落库不是明文"这件事），
// 管理员权限一律放行。
type smsTestHost struct {
	nopHost
}

func (smsTestHost) RequireAdmin(*model.User) error             { return nil }
func (smsTestHost) EncryptSecret(value string) (string, error) { return "enc:" + value, nil }
func (smsTestHost) DecryptSecret(value string) (string, error) {
	return strings.TrimPrefix(value, "enc:"), nil
}
func (smsTestHost) SettingsEncryptionKey() ([]byte, error) { return []byte("test-key"), nil }
func (smsTestHost) BrandName() string                      { return "趣影" }
func (smsTestHost) RecordActivity(string, string, int)     {}

func newSmsTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+kernel.NewID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.UserIdentity{}, &model.PhoneVerificationCode{}, &model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	settingJSON, err := json.Marshal(SmsSettingValue{
		Enabled: true, AccessKeyId: "LTAI-test", AccessKeySecret: "secret-test",
		SignName: "趣影", RegisterTemplateCode: "SMS_REG", ResetTemplateCode: "SMS_RESET", RegionId: "cn-hangzhou",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SystemSetting{Key: smsSettingKey, ValueJSON: string(settingJSON)}).Error; err != nil {
		t.Fatal(err)
	}
	// 注册开关也要打开：短信注册走的是与邮件注册**同一条** Register()，
	// 里面第一件事就是查"管理员有没有开放注册"。
	if err := db.Create(&model.SystemSetting{Key: registrationSettingKey, ValueJSON: `{"enabled":true}`}).Error; err != nil {
		t.Fatal(err)
	}
	return New(repository.New(db), smsTestHost{}, nil), db
}

// captureSms 装一个假发送器，返回"最后一次发出去的验证码"的读取函数。
func captureSms(svc *Service, t *testing.T) func() string {
	t.Helper()
	codes := make([]string, 0, 4)
	svc.SetSmsSender(func(_ SmsSettingValue, phone string, code string, templateCode string) (string, error) {
		if smsTestPhoneOf(phone) == "" {
			t.Fatalf("发送器拿到未归一化的号码：%q", phone)
		}
		if templateCode == "" {
			t.Fatal("发送器没拿到模板 CODE")
		}
		codes = append(codes, code)
		return "biz-" + code, nil
	})
	return func() string {
		if len(codes) == 0 {
			return ""
		}
		return codes[len(codes)-1]
	}
}

func smsTestPhoneOf(phone string) string { return NormalizeSmsPhone(phone) }

func TestNormalizeSmsPhoneAcceptsThreeFormsAndRejectsJunk(t *testing.T) {
	cases := map[string]string{
		"13800138000":     "+8613800138000",
		" 138 0013 8000 ": "+8613800138000",
		"8613800138000":   "+8613800138000",
		"+8613800138000":  "+8613800138000",
		"+14155552671":    "+14155552671", // 国际号：带 + 就按 E.164 放行
		"12345":           "",
		"23800138000":     "",
		"":                "",
	}
	for input, want := range cases {
		if got := NormalizeSmsPhone(input); got != want {
			t.Fatalf("NormalizeSmsPhone(%q) = %q，期望 %q", input, got, want)
		}
	}
}

func TestSmsSettingEncryptsSecretAtRestAndNeverExposesIt(t *testing.T) {
	svc, db := newSmsTestService(t)
	admin := &model.User{ID: "admin-1", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	public, err := svc.AdminSmsSetting(admin)
	if err != nil {
		t.Fatal(err)
	}
	// 公开投影只能给出"有没有配"，绝不能带出密钥本身。
	if !public.HasAccessKeySecret || !public.Configured {
		t.Fatalf("公开投影漏了 hasAccessKeySecret/configured：%#v", public)
	}
	raw, _ := json.Marshal(public)
	if strings.Contains(string(raw), "secret-test") {
		t.Fatalf("公开投影把密钥带出去了：%s", raw)
	}

	// 换一个密钥保存 → 落库的必须是密文。
	if _, err := svc.UpdateSmsSetting(admin, SmsSettingRequest{
		Enabled: true, AccessKeyId: "LTAI-new", AccessKeySecret: "brand-new-secret",
		SignName: "趣影", RegisterTemplateCode: "SMS_REG",
	}); err != nil {
		t.Fatal(err)
	}
	var stored model.SystemSetting
	if err := db.Where("key = ?", smsSettingKey).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	// ⚠️ 比的是"字段值"而不是整串包含：测试用的假加密只是在前面加 `enc:`，
	//    明文仍是整串的子串 ⇒ 用 Contains(整串) 会永远为真、这条断言就废了。
	if strings.Contains(stored.ValueJSON, `"accessKeySecret":"brand-new-secret"`) {
		t.Fatalf("密钥明文落库了：%s", stored.ValueJSON)
	}
	if !strings.Contains(stored.ValueJSON, `"accessKeySecret":"enc:brand-new-secret"`) {
		t.Fatalf("密钥没有走加密：%s", stored.ValueJSON)
	}

	// 留空 = 保留原密钥（配置页永远不回显，所以"不填"就是"不改"）。
	if _, err := svc.UpdateSmsSetting(admin, SmsSettingRequest{Enabled: true, AccessKeyId: "LTAI-new", SignName: "趣影", RegisterTemplateCode: "SMS_REG"}); err != nil {
		t.Fatal(err)
	}
	_, value, err := svc.readSmsSetting()
	if err != nil {
		t.Fatal(err)
	}
	if value.AccessKeySecret != "brand-new-secret" {
		t.Fatalf("留空没有保留原密钥：%q", value.AccessKeySecret)
	}
}

func TestSendRegistrationSmsCodeHashesStoresAndCoolsDown(t *testing.T) {
	svc, db := newSmsTestService(t)
	if err := db.Create(&model.User{ID: "u1", Username: "someone", Status: model.UserStatusActive, Role: model.UserRoleUser}).Error; err != nil {
		t.Fatal(err)
	}
	last := captureSms(svc, t)

	if err := svc.SendRegistrationSmsCode("13800138000"); err != nil {
		t.Fatal(err)
	}
	code := last()
	if len(code) != 6 {
		t.Fatalf("验证码应是 6 位：%q", code)
	}
	var stored model.PhoneVerificationCode
	if err := db.Where("phone = ? AND purpose = ?", "+8613800138000", registrationSmsPurpose).First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	// 落库的必须是**哈希**，且带上 purpose（同一个码不能跨用途复用）。
	if stored.CodeHash == code || stored.CodeHash == "" {
		t.Fatalf("验证码没哈希：%#v", stored)
	}
	if stored.ExpiresAt.Before(time.Now()) {
		t.Fatal("验证码应当还没过期")
	}

	// 60 秒冷却：第二次发要抛**带秒数**的冷却错误（handler 靠它写 429 + Retry-After）。
	err := svc.SendRegistrationSmsCode("13800138000")
	var cooldown *SmsCodeCooldownError
	if !errors.As(err, &cooldown) || cooldown.Seconds <= 0 {
		t.Fatalf("第二次发送应当被冷却拦住，实得 %v", err)
	}
}

func TestVerifyRegistrationSmsCodeRejectsWrongAndMissing(t *testing.T) {
	svc, db := newSmsTestService(t)
	if err := db.Create(&model.User{ID: "u1", Username: "someone", Status: model.UserStatusActive, Role: model.UserRoleUser}).Error; err != nil {
		t.Fatal(err)
	}
	last := captureSms(svc, t)
	if err := svc.SendRegistrationSmsCode("13800138000"); err != nil {
		t.Fatal(err)
	}
	right := last()

	if _, err := svc.VerifyRegistrationSmsCode("+8613800138000", right); err != nil {
		t.Fatalf("正确的码应当通过：%v", err)
	}
	if _, err := svc.VerifyRegistrationSmsCode("+8613800138000", "000000"); err == nil {
		t.Fatal("错误的码应当被拒")
	}
	if _, err := svc.VerifyRegistrationSmsCode("+8613800138000", "123"); err == nil {
		t.Fatal("长度不对应当被拒")
	}
	if _, err := svc.VerifyRegistrationSmsCode("+8613900139000", right); err == nil {
		t.Fatal("别人的号码用这个码应当被拒")
	}
	// 校验**不消费**（used_at 仍为空）—— 消费在建号事务里，别在这里提前标记。
	var stored model.PhoneVerificationCode
	if err := db.Where("phone = ?", "+8613800138000").First(&stored).Error; err != nil {
		t.Fatal(err)
	}
	if stored.UsedAt != nil {
		t.Fatal("校验阶段不该标记已用（验证与消费必须分离）")
	}
}

func TestRegisterWithPhoneConsumesCodeOnce(t *testing.T) {
	svc, db := newSmsTestService(t)
	if err := db.Create(&model.User{ID: "u1", Username: "someone", Status: model.UserStatusActive, Role: model.UserRoleUser}).Error; err != nil {
		t.Fatal(err)
	}
	last := captureSms(svc, t)
	if err := svc.SendRegistrationSmsCode("13800138000"); err != nil {
		t.Fatal(err)
	}
	code := last()

	result, err := svc.Register(RegisterRequest{Username: "newbie", Phone: "13800138000", SmsCode: code, Password: "password-123", DisplayName: "新来的", AcceptedTerms: true})
	if err != nil {
		t.Fatal(err)
	}
	if result == nil || result.User.Phone != "+8613800138000" {
		t.Fatalf("注册后手机号没落库：%#v", result)
	}

	// 同一个码不能再注册第二个号（消费是原子的）。
	if _, err := svc.Register(RegisterRequest{Username: "second", Phone: "13800138000", SmsCode: code, Password: "password-123", AcceptedTerms: true}); err == nil {
		t.Fatal("同一个验证码不该能注册两次")
	}
	// 号码占用也要拦住。
	if err := svc.SendRegistrationSmsCode("13800138000"); err == nil {
		t.Fatal("已注册的手机号不该还能收注册码")
	}
}

func TestRegisterRejectsBothOrNeitherContactMethods(t *testing.T) {
	svc, db := newSmsTestService(t)
	if err := db.Create(&model.User{ID: "u1", Username: "someone", Status: model.UserStatusActive, Role: model.UserRoleUser}).Error; err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		name string
		req  RegisterRequest
	}{
		{"都不填", RegisterRequest{Username: "a1", Password: "password-123", AcceptedTerms: true}},
		{"都填", RegisterRequest{Username: "a2", Password: "password-123", Email: "a@example.com", EmailCode: "123456", Phone: "13800138000", SmsCode: "123456", AcceptedTerms: true}},
	}
	for _, item := range cases {
		if _, err := svc.Register(item.req); err == nil {
			t.Fatalf("%s 应当被拒（注册方式二选一）", item.name)
		}
	}
}

func TestResetPasswordBySmsRotatesPasswordAndRevokesSessions(t *testing.T) {
	svc, db := newSmsTestService(t)
	oldHash, err := HashPassword("old-password")
	if err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "u-phone", Username: "byphone", Phone: "+8613800138000", Status: model.UserStatusActive, Role: model.UserRoleUser, PasswordHash: oldHash}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AuthSession{ID: "s1", UserID: user.ID, TokenHash: "t", ExpiresAt: time.Now().Add(time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	last := captureSms(svc, t)
	if err := svc.SendPasswordResetSmsCode("13800138000"); err != nil {
		t.Fatal(err)
	}
	if err := svc.ResetPasswordBySms("13800138000", last(), "new-password-123"); err != nil {
		t.Fatal(err)
	}
	var refreshed model.User
	if err := db.First(&refreshed, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if refreshed.PasswordHash == oldHash {
		t.Fatal("密码没被改掉")
	}
	// 改密后旧会话必须失效。
	var sessions int64
	if err := db.Model(&model.AuthSession{}).Where("user_id = ?", user.ID).Count(&sessions).Error; err != nil {
		t.Fatal(err)
	}
	if sessions != 0 {
		t.Fatalf("改密后应当吊销所有会话，还剩 %d 条", sessions)
	}
	// 用过的码不能再改一次。
	if err := svc.ResetPasswordBySms("13800138000", last(), "another-password"); err == nil {
		t.Fatal("同一个码不该能改两次密码")
	}
}

func TestSendPasswordResetSmsCodeStaysSilentForUnknownPhone(t *testing.T) {
	svc, _ := newSmsTestService(t)
	last := captureSms(svc, t)
	// 没注册的号码：**静默成功**（防枚举）——接口不能变成"查手机号在不在本站注册过"的工具。
	if err := svc.SendPasswordResetSmsCode("13900139000"); err != nil {
		t.Fatalf("未注册号码应当静默成功，实得 %v", err)
	}
	if last() != "" {
		t.Fatal("未注册号码不该真的发短信")
	}
}

func TestBindAndUnbindPhone(t *testing.T) {
	svc, db := newSmsTestService(t)
	user := model.User{ID: "u-bind", Username: "binder", Status: model.UserStatusActive, Role: model.UserRoleUser}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	last := captureSms(svc, t)
	if err := svc.SendBindPhoneSmsCode(&user, "13800138000"); err != nil {
		t.Fatal(err)
	}
	if err := svc.BindPhone(&user, "13800138000", last()); err != nil {
		t.Fatal(err)
	}
	var bound model.User
	if err := db.First(&bound, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if bound.Phone != "+8613800138000" {
		t.Fatalf("手机号没绑上：%q", bound.Phone)
	}

	// 别的账号不能绑同一个号。
	other := model.User{ID: "u-other", Username: "other", Status: model.UserStatusActive, Role: model.UserRoleUser}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.SendBindPhoneSmsCode(&other, "13800138000"); err == nil {
		t.Fatal("已被占用的号码不该还能收绑定码")
	}

	if err := svc.UnbindPhone(&bound); err != nil {
		t.Fatal(err)
	}
	var unbound model.User
	if err := db.First(&unbound, "id = ?", user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if unbound.Phone != "" {
		t.Fatalf("解绑后应当为空串：%q", unbound.Phone)
	}
}

func TestSmsDisabledBlocksSending(t *testing.T) {
	svc, db := newSmsTestService(t)
	if err := db.Create(&model.User{ID: "u1", Username: "someone", Status: model.UserStatusActive, Role: model.UserRoleUser}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.SystemSetting{}).Where("key = ?", smsSettingKey).Update("value_json", `{"enabled":false}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.SendRegistrationSmsCode("13800138000"); err == nil {
		t.Fatal("关掉短信后不该还能发")
	}
	enabled, err := svc.SmsEnabled()
	if err != nil || enabled {
		t.Fatalf("SmsEnabled 应当是 false：%v %v", enabled, err)
	}
}

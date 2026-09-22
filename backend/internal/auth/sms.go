package auth

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"regexp"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/platform"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

// 阿里云短信—— 与 `email.go` **逐条对称**。
//
// 文件分工与邮件那边一致：设置读写 + 验证码下发/核销都在这里，投递走 `deliverSms`
//（默认用 `platform.SendAliyunSmsCode`，测试可注入假发送器）。
//
// ⚠️ **验证与消费分离**（照抄邮件的规矩，别为了"简单"合并）：
//   - `Verify*Code` 只**校验**并返回那条记录，**不**标记 `used_at`；
//   - 真正的"用掉"在仓储的事务方法里（`CreateUserWithPhoneVerification` /
//     `ResetUserPasswordWithPhoneVerification` / `BindUserPhone`），靠 `RowsAffected == 1` 保证
//     同一个码不可能被用两次（并发下也安全）。
//
// ⚠️ 密钥（`AccessKeySecret`）**加密入库**，与 SMTP 密码同一条密钥（`host.EncryptSecret`）。

const smsSettingKey = "sms"

// 三种用途各自隔离：同一个验证码不能跨用途复用（哈希里带了 purpose）。
const (
	registrationSmsPurpose  = "registration"
	passwordResetSmsPurpose = "password_reset"
	bindPhoneSmsPurpose     = "bind_phone"
)

// smsCodeTTL 验证码有效期（与邮件版同一个值）。
const smsCodeTTL = 10 * time.Minute

// smsCodeCooldown 同一号码的重发冷却。
const smsCodeCooldown = time.Minute

var (
	// 中国大陆手机号：11 位、1[3-9] 开头。
	mainlandPhonePattern = regexp.MustCompile(`^1[3-9]\d{9}$`)
	// 带国家码的 E.164（给将来国际号码留路）。
	e164PhonePattern = regexp.MustCompile(`^\+[1-9]\d{6,14}$`)
)

// NormalizeSmsPhone 把用户输入的号码归一化成 **E.164**（`+8613800138000`）。
//
// 认三种写法：`13800138000`、`8613800138000`、`+8613800138000`；认不出返回空串。
// 归一化后的串是**唯一键**（入库、查重、哈希都用它）—— 同一号码的三种写法必须归一。
func NormalizeSmsPhone(raw string) string {
	trimmed := strings.TrimSpace(raw)
	trimmed = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "").Replace(trimmed)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "+") {
		if e164PhonePattern.MatchString(trimmed) {
			return trimmed
		}
		return ""
	}
	if mainlandPhonePattern.MatchString(trimmed) {
		return "+86" + trimmed
	}
	// `8613800138000`：去掉国家码前缀后再校验。
	if strings.HasPrefix(trimmed, "86") && mainlandPhonePattern.MatchString(trimmed[2:]) {
		return "+" + trimmed
	}
	return ""
}

// MaskPhone 日志脱敏（`+8613****8000`）。
func MaskPhone(phone string) string {
	trimmed := strings.TrimSpace(phone)
	if len(trimmed) < 8 {
		return "***"
	}
	return trimmed[:5] + "****" + trimmed[len(trimmed)-4:]
}

// SmsSettingValue 短信配置的落库形态（含明文密钥 —— 只在内存里，落库前加密）。
type SmsSettingValue struct {
	Enabled              bool   `json:"enabled"`
	AccessKeyId          string `json:"accessKeyId"`
	AccessKeySecret      string `json:"accessKeySecret"`
	SignName             string `json:"signName"`
	RegisterTemplateCode string `json:"registerTemplateCode"`
	ResetTemplateCode    string `json:"resetTemplateCode"`
	RegionId             string `json:"regionId"`
}

// SmsSettingRequest 是 PATCH 的入参（与落库形态同形；`AccessKeySecret` 留空 = 保留原值）。
type SmsSettingRequest = SmsSettingValue

// PublicSmsSetting 是**公开投影**：密钥只回一个「是否已设置」的布尔。
type PublicSmsSetting struct {
	Enabled              bool   `json:"enabled"`
	AccessKeyId          string `json:"accessKeyId"`
	HasAccessKeySecret   bool   `json:"hasAccessKeySecret"`
	SignName             string `json:"signName"`
	RegisterTemplateCode string `json:"registerTemplateCode"`
	ResetTemplateCode    string `json:"resetTemplateCode"`
	RegionId             string `json:"regionId"`
	/** 三项齐备（AccessKey + 签名 + 注册模板）—— 注册页据此判断能不能走手机号。 */
	Configured bool      `json:"configured"`
	UpdatedBy  string    `json:"updatedBy"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

func (s *Service) AdminSmsSetting(actor *model.User) (*PublicSmsSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readSmsSetting()
	if err != nil {
		return nil, err
	}
	return s.publicSmsSetting(setting, value), nil
}

func (s *Service) UpdateSmsSetting(actor *model.User, req SmsSettingRequest) (*PublicSmsSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	currentSetting, current, err := s.readSmsSetting()
	if err != nil {
		return nil, err
	}
	next := normalizeSmsSetting(SmsSettingValue{
		Enabled:              req.Enabled,
		AccessKeyId:          req.AccessKeyId,
		AccessKeySecret:      req.AccessKeySecret,
		SignName:             req.SignName,
		RegisterTemplateCode: req.RegisterTemplateCode,
		ResetTemplateCode:    req.ResetTemplateCode,
		RegionId:             req.RegionId,
	})
	// 留空 = 保留原密钥（配置页永远不回显密钥，所以"不填"就是"不改"）。
	if next.AccessKeySecret == "" {
		next.AccessKeySecret = current.AccessKeySecret
	}
	if err := validateSmsSetting(next); err != nil {
		return nil, err
	}
	stored := next
	stored.AccessKeySecret, err = s.host.EncryptSecret(next.AccessKeySecret)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: smsSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if currentSetting != nil {
		setting.CreatedAt = currentSetting.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	return s.publicSmsSetting(&setting, next), nil
}

// SmsEnabled 短信通道是否可用（注册页/找回页据此决定显不显示手机号那条路）。
func (s *Service) SmsEnabled() (bool, error) {
	_, value, err := s.readSmsSetting()
	if err != nil {
		return false, err
	}
	return value.Enabled && value.canSend(), nil
}

func (v SmsSettingValue) canSend() bool {
	return strings.TrimSpace(v.AccessKeyId) != "" &&
		strings.TrimSpace(v.AccessKeySecret) != "" &&
		strings.TrimSpace(v.SignName) != "" &&
		strings.TrimSpace(v.RegisterTemplateCode) != ""
}

func (s *Service) readSmsSetting() (*model.SystemSetting, SmsSettingValue, error) {
	setting, err := s.repo.SystemSetting(smsSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, normalizeSmsSetting(SmsSettingValue{}), nil
	}
	if err != nil {
		return nil, SmsSettingValue{}, err
	}
	value := SmsSettingValue{}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return nil, SmsSettingValue{}, errors.New("短信配置格式无效")
	}
	value.AccessKeySecret, err = s.host.DecryptSecret(value.AccessKeySecret)
	if err != nil {
		return nil, SmsSettingValue{}, err
	}
	return setting, normalizeSmsSetting(value), nil
}

func normalizeSmsSetting(value SmsSettingValue) SmsSettingValue {
	value.AccessKeyId = strings.TrimSpace(value.AccessKeyId)
	value.AccessKeySecret = strings.TrimSpace(value.AccessKeySecret)
	value.SignName = strings.TrimSpace(value.SignName)
	value.RegisterTemplateCode = strings.TrimSpace(value.RegisterTemplateCode)
	value.ResetTemplateCode = strings.TrimSpace(value.ResetTemplateCode)
	value.RegionId = strings.TrimSpace(value.RegionId)
	if value.RegionId == "" {
		value.RegionId = "cn-hangzhou"
	}
	return value
}

func validateSmsSetting(value SmsSettingValue) error {
	if !value.Enabled {
		return nil // 没启用就不拦（与邮件一致：先允许存草稿）
	}
	if value.AccessKeyId == "" || value.AccessKeySecret == "" {
		return kernel.BadAuthRequest("启用短信前请完整填写阿里云 AccessKey ID 与 Secret")
	}
	if value.SignName == "" {
		return kernel.BadAuthRequest("启用短信前请填写短信签名（控制台审核通过的签名名称）")
	}
	if value.RegisterTemplateCode == "" {
		return kernel.BadAuthRequest("启用短信前请填写注册验证码的模板 CODE")
	}
	return nil
}

func (s *Service) publicSmsSetting(setting *model.SystemSetting, value SmsSettingValue) *PublicSmsSetting {
	result := &PublicSmsSetting{
		Enabled:              value.Enabled,
		AccessKeyId:          value.AccessKeyId,
		HasAccessKeySecret:   value.AccessKeySecret != "",
		SignName:             value.SignName,
		RegisterTemplateCode: value.RegisterTemplateCode,
		ResetTemplateCode:    value.ResetTemplateCode,
		RegionId:             value.RegionId,
		Configured:           value.canSend(),
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

// smsVerificationCodeHash 与邮件版同一个算法，只是把 email 换成归一化手机号。
//
// 用 HMAC（不是裸 sha256）：密钥是宿主的「设置加密密钥」，这样即使库被读走也推不出码。
// ⚠️ 哈希里带 `purpose` —— 注册的码不能拿去改密码。
func (s *Service) smsVerificationCodeHash(purpose, phone, code string) (string, error) {
	key, err := s.host.SettingsEncryptionKey()
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(strings.TrimSpace(purpose) + ":" + NormalizeSmsPhone(phone) + ":" + strings.TrimSpace(code)))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// deliverSms 投递一条验证码短信，返回阿里云的 BizId。
//
// 默认走 `platform.SendAliyunSmsCode`；测试可以 `SetSmsSender` 换成假的
// （与 `mailSender` 同一套注入手法）。
func (s *Service) deliverSms(setting SmsSettingValue, phone string, code string, templateCode string) (string, error) {
	if s.smsSender != nil {
		return s.smsSender(setting, phone, code, templateCode)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return platform.SendAliyunSmsCode(ctx, platform.AliyunSmsConfig{
		AccessKeyId:     setting.AccessKeyId,
		AccessKeySecret: setting.AccessKeySecret,
		SignName:        setting.SignName,
		TemplateCode:    templateCode,
		RegionId:        setting.RegionId,
	}, phone, code)
}

// ------------------------------------------------------------------
// 下发
// ------------------------------------------------------------------

// SendRegistrationSmsCode 注册用的短信验证码。
//
// 顺序即业务规则（与 `SendRegistrationEmailCode` 一一对应）：
// 归一化 → 首个用户短路 → 注册开关 → 号码占用 → 读配置 → 总开关 → 串行锁 → 冷却 →
// 生成/哈希/落库 → 投递（失败则回滚那条码）→ 顺手清理过期。
func (s *Service) SendRegistrationSmsCode(rawPhone string) error {
	phone := NormalizeSmsPhone(rawPhone)
	if phone == "" {
		return kernel.BadAuthRequest("手机号格式不正确")
	}
	count, err := s.repo.UserCount()
	if err != nil {
		return err
	}
	if count == 0 {
		return kernel.BadAuthRequest("首个管理员账号不需要短信验证码")
	}
	registrationEnabled, err := s.RegistrationEnabled()
	if err != nil {
		return err
	}
	if !registrationEnabled {
		return kernel.Forbidden("管理员未开放新用户注册")
	}
	if _, err := s.repo.UserByPhone(phone); err == nil {
		return kernel.BadAuthRequest("该手机号已被注册")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	_, setting, err := s.readSmsSetting()
	if err != nil {
		return err
	}
	if !setting.Enabled || !setting.canSend() {
		return kernel.Forbidden("平台尚未启用短信服务，请联系管理员")
	}
	return s.sendSmsCode(setting, phone, registrationSmsPurpose, setting.RegisterTemplateCode, "注册")
}

// SendPasswordResetSmsCode 找回密码用的短信验证码。
//
// ⚠️ **手机号没注册时静默成功**（不报"该手机号不存在"）—— 与邮件版同一个防枚举口径：
// 否则这个接口就成了"查手机号在不在本站注册过"的工具。
func (s *Service) SendPasswordResetSmsCode(rawPhone string) error {
	phone := NormalizeSmsPhone(rawPhone)
	if phone == "" {
		return kernel.BadAuthRequest("手机号格式不正确")
	}
	_, setting, err := s.readSmsSetting()
	if err != nil {
		return err
	}
	if !setting.Enabled || !setting.canSend() {
		return kernel.Forbidden("管理员尚未启用密码找回，请联系管理员")
	}

	s.smsCodeMu.Lock()
	defer s.smsCodeMu.Unlock()

	user, err := s.repo.UserByPhone(phone)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if user.Status != model.UserStatusActive || strings.TrimSpace(user.PasswordHash) == "" {
		return nil
	}
	if latest, latestErr := s.repo.LatestPhoneVerificationCode(phone, passwordResetSmsPurpose); latestErr == nil && time.Since(latest.CreatedAt) < smsCodeCooldown {
		return nil
	} else if latestErr != nil && !errors.Is(latestErr, gorm.ErrRecordNotFound) {
		return latestErr
	}

	code, err := randomNumericCode(6)
	if err != nil {
		return err
	}
	codeHash, err := s.smsVerificationCodeHash(passwordResetSmsPurpose, phone, code)
	if err != nil {
		return err
	}
	now := time.Now()
	record := model.PhoneVerificationCode{
		ID:        kernel.NewID(),
		Phone:     phone,
		CodeHash:  codeHash,
		Purpose:   passwordResetSmsPurpose,
		ExpiresAt: now.Add(smsCodeTTL),
		CreatedAt: now,
	}
	if err := s.repo.Create(&record); err != nil {
		return err
	}
	if _, err := s.deliverSms(setting, phone, code, setting.resetTemplateCode()); err != nil {
		if cleanupErr := s.repo.DeletePhoneVerificationCode(record.ID); cleanupErr != nil {
			log.Printf("找回密码短信投递失败后清理验证码失败: id=%s error=%v", record.ID, cleanupErr)
		}
		return fmt.Errorf("找回密码短信发送失败：%w", err)
	}
	return nil
}

// ResetPasswordBySms 用短信验证码改密码（校验与消费分离，消费在仓储事务里）。
func (s *Service) ResetPasswordBySms(rawPhone string, rawCode string, password string) error {
	phone := NormalizeSmsPhone(rawPhone)
	if phone == "" {
		return invalidPasswordResetCode()
	}
	code := strings.TrimSpace(rawCode)
	if len(code) != 6 {
		return invalidPasswordResetCode()
	}
	user, err := s.repo.UserByPhone(phone)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return invalidPasswordResetCode()
		}
		return err
	}
	if user.Status != model.UserStatusActive || strings.TrimSpace(user.PasswordHash) == "" {
		return invalidPasswordResetCode()
	}
	record, err := s.repo.LatestPhoneVerificationCode(phone, passwordResetSmsPurpose)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return invalidPasswordResetCode()
		}
		return err
	}
	if time.Now().After(record.ExpiresAt) {
		return invalidPasswordResetCode()
	}
	expectedHash, err := s.smsVerificationCodeHash(passwordResetSmsPurpose, phone, code)
	if err != nil {
		return err
	}
	if !hmac.Equal([]byte(expectedHash), []byte(record.CodeHash)) {
		return invalidPasswordResetCode()
	}
	passwordHash, err := HashPassword(password)
	if err != nil {
		return err
	}
	if err := s.repo.ResetUserPasswordWithPhoneVerification(user.ID, phone, passwordResetSmsPurpose, record.ID, passwordHash, time.Now()); err != nil {
		if errors.Is(err, repository.ErrPhoneVerificationCodeInvalid) {
			return invalidPasswordResetCode()
		}
		return err
	}
	return nil
}

// BindPhone 绑定手机号（消费验证码 + 写 user.phone，同一事务）。
func (s *Service) BindPhone(user *model.User, rawPhone string, rawCode string) error {
	if user == nil {
		return kernel.Unauthorized("请先登录")
	}
	phone := NormalizeSmsPhone(rawPhone)
	if phone == "" {
		return kernel.BadAuthRequest("手机号格式不正确")
	}
	// 号码唯一性（库里没唯一索引，见 model.User.Phone 注释）——这里先查一次。
	if owner, err := s.repo.UserByPhone(phone); err == nil && owner.ID != user.ID {
		return kernel.BadAuthRequest("该手机号已绑定其它账号")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	record, err := s.verifySmsCode(phone, bindPhoneSmsPurpose, rawCode, "绑定")
	if err != nil {
		return err
	}
	if err := s.repo.BindUserPhone(user.ID, phone, bindPhoneSmsPurpose, record.ID, time.Now()); err != nil {
		if errors.Is(err, repository.ErrPhoneVerificationCodeInvalid) {
			return kernel.BadAuthRequest("验证码无效或已过期")
		}
		return err
	}
	return nil
}

// UnbindPhone 解绑手机号。
func (s *Service) UnbindPhone(user *model.User) error {
	if user == nil {
		return kernel.Unauthorized("请先登录")
	}
	return s.repo.UnbindUserPhone(user.ID)
}

// SendBindPhoneSmsCode 绑定手机号用的短信验证码。
func (s *Service) SendBindPhoneSmsCode(user *model.User, rawPhone string) error {
	if user == nil {
		return kernel.Unauthorized("请先登录")
	}
	phone := NormalizeSmsPhone(rawPhone)
	if phone == "" {
		return kernel.BadAuthRequest("手机号格式不正确")
	}
	if owner, err := s.repo.UserByPhone(phone); err == nil && owner.ID != user.ID {
		return kernel.BadAuthRequest("该手机号已绑定其它账号")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	_, setting, err := s.readSmsSetting()
	if err != nil {
		return err
	}
	if !setting.Enabled || !setting.canSend() {
		return kernel.Forbidden("平台尚未启用短信服务，请联系管理员")
	}
	return s.sendSmsCode(setting, phone, bindPhoneSmsPurpose, setting.resetTemplateCode(), "绑定")
}

// sendSmsCode 是三条链共用的"生成 → 哈希 → 落库 → 投递"段（含冷却与失败回滚）。
func (s *Service) sendSmsCode(setting SmsSettingValue, phone string, purpose string, templateCode string, scene string) error {
	// 串行锁：同一进程内的并发下发排队（与邮件同一手法，避免两个请求同时过冷却）。
	s.smsCodeMu.Lock()
	defer s.smsCodeMu.Unlock()

	if latest, err := s.repo.LatestPhoneVerificationCode(phone, purpose); err == nil && time.Since(latest.CreatedAt) < smsCodeCooldown {
		seconds := max(1, int((time.Until(latest.CreatedAt.Add(smsCodeCooldown))+time.Second-1)/time.Second))
		return &SmsCodeCooldownError{Seconds: seconds}
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}

	code, err := randomNumericCode(6)
	if err != nil {
		return err
	}
	codeHash, err := s.smsVerificationCodeHash(purpose, phone, code)
	if err != nil {
		return err
	}
	now := time.Now()
	record := model.PhoneVerificationCode{
		ID:        kernel.NewID(),
		Phone:     phone,
		CodeHash:  codeHash,
		Purpose:   purpose,
		ExpiresAt: now.Add(smsCodeTTL),
		CreatedAt: now,
	}
	if err := s.repo.Create(&record); err != nil {
		return err
	}
	bizId, err := s.deliverSms(setting, phone, code, templateCode)
	if err != nil {
		// 投递失败 → 把刚落的码删掉，别让它占着冷却窗口（用户重试会立刻被"请稍后再试"挡住）。
		if cleanupErr := s.repo.DeletePhoneVerificationCode(record.ID); cleanupErr != nil {
			log.Printf("短信投递失败后清理验证码失败: id=%s error=%v", record.ID, cleanupErr)
		}
		return fmt.Errorf("%s短信发送失败：%w", scene, err)
	}
	// ⚠️ 「提交成功 ≠ 送达」：阿里云返回 OK 只代表**它收下了**，运营商回执失败照样收不到。
	//    所以这行日志要和**阿里云控制台 → 短信服务 → 发送记录**对着看（BizId 是唯一的对账键）。
	log.Printf("短信已提交: 场景=%s 号码=%s 模板=%s bizId=%s", scene, MaskPhone(phone), templateCode, bizId)
	if cleanupErr := s.repo.DeleteExpiredPhoneVerificationCodes(now.Add(-24 * time.Hour)); cleanupErr != nil {
		log.Printf("清理过期手机验证码失败: %v", cleanupErr)
	}
	return nil
}

// resetTemplateCode 找回/绑定共用一个模板（阿里云模板是审核制的，少审一个是一个）。
// 要拆开的话：`SmsSettingValue` 加一个字段、这里按用途选即可。
func (v SmsSettingValue) resetTemplateCode() string {
	if strings.TrimSpace(v.ResetTemplateCode) != "" {
		return v.ResetTemplateCode
	}
	return v.RegisterTemplateCode
}

// ------------------------------------------------------------------
// 核销（只校验，不标记已用）
// ------------------------------------------------------------------

func (s *Service) verifySmsCode(phone string, purpose string, rawCode string, scene string) (*model.PhoneVerificationCode, error) {
	code := strings.TrimSpace(rawCode)
	if len(code) != 6 {
		return nil, kernel.BadAuthRequest(fmt.Sprintf("请输入 6 位%s短信验证码", scene))
	}
	record, err := s.repo.LatestPhoneVerificationCode(phone, purpose)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.BadAuthRequest(fmt.Sprintf("请先获取%s短信验证码", scene))
	}
	if err != nil {
		return nil, err
	}
	if time.Now().After(record.ExpiresAt) {
		return nil, kernel.BadAuthRequest(fmt.Sprintf("%s短信验证码已过期，请重新获取", scene))
	}
	expected, err := s.smsVerificationCodeHash(purpose, phone, code)
	if err != nil {
		return nil, err
	}
	if !hmac.Equal([]byte(expected), []byte(record.CodeHash)) {
		return nil, kernel.BadAuthRequest(fmt.Sprintf("%s短信验证码不正确", scene))
	}
	return record, nil
}

// VerifyRegistrationSmsCode 校验注册码（真正的"用掉"在建号事务里）。
func (s *Service) VerifyRegistrationSmsCode(phone string, rawCode string) (*model.PhoneVerificationCode, error) {
	enabled, err := s.SmsEnabled()
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, kernel.Forbidden("平台尚未启用短信服务，请联系管理员")
	}
	return s.verifySmsCode(phone, registrationSmsPurpose, rawCode, "注册")
}

// VerifyPasswordResetSmsCode 校验找回密码的码。
func (s *Service) VerifyPasswordResetSmsCode(phone string, rawCode string) (*model.PhoneVerificationCode, error) {
	enabled, err := s.SmsEnabled()
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, kernel.Forbidden("平台尚未启用短信服务，请联系管理员")
	}
	return s.verifySmsCode(phone, passwordResetSmsPurpose, rawCode, "找回密码")
}

// VerifyBindPhoneSmsCode 校验绑定的码。
func (s *Service) VerifyBindPhoneSmsCode(phone string, rawCode string) (*model.PhoneVerificationCode, error) {
	return s.verifySmsCode(phone, bindPhoneSmsPurpose, rawCode, "绑定")
}

// SendTestSms 后台配置页的「发送测试短信」（只有管理员能调，真发一条、计费）。
//
// 返回阿里云的 **BizId** —— 出现「显示成功但没收到」时，拿它去
// **阿里云控制台 → 短信服务 → 发送记录** 查真正的投递状态与失败原因（提交成功 ≠ 送达）。
func (s *Service) SendTestSms(actor *model.User, rawPhone string) (string, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return "", err
	}
	phone := NormalizeSmsPhone(rawPhone)
	if phone == "" {
		return "", kernel.BadAuthRequest("手机号格式不正确")
	}
	_, setting, err := s.readSmsSetting()
	if err != nil {
		return "", err
	}
	if !setting.canSend() {
		return "", kernel.BadAuthRequest("请先填写 AccessKey、签名与注册模板 CODE")
	}
	code, err := randomNumericCode(6)
	if err != nil {
		return "", err
	}
	bizId, err := s.deliverSms(setting, phone, code, setting.RegisterTemplateCode)
	if err != nil {
		return "", kernel.BadAuthRequest("测试短信发送失败：" + err.Error())
	}
	log.Printf("测试短信已提交: 号码=%s 模板=%s bizId=%s", MaskPhone(phone), setting.RegisterTemplateCode, bizId)
	return bizId, nil
}

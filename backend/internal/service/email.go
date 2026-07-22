package service

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const emailSettingKey = "email"
const registrationEmailPurpose = "registration"
const registrationCodeTTL = 10 * time.Minute

type EmailSettingRequest struct {
	Enabled    bool   `json:"enabled"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	Encryption string `json:"encryption"`
	FromEmail  string `json:"fromEmail"`
	FromName   string `json:"fromName"`
}

type PublicEmailSetting struct {
	Enabled     bool      `json:"enabled"`
	Host        string    `json:"host"`
	Port        int       `json:"port"`
	Username    string    `json:"username"`
	Encryption  string    `json:"encryption"`
	FromEmail   string    `json:"fromEmail"`
	FromName    string    `json:"fromName"`
	HasPassword bool      `json:"hasPassword"`
	UpdatedBy   string    `json:"updatedBy"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type emailSettingValue struct {
	Enabled    bool   `json:"enabled"`
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	Encryption string `json:"encryption"`
	FromEmail  string `json:"fromEmail"`
	FromName   string `json:"fromName"`
}

func (s *Service) AdminEmailSetting(actor *model.User) (*PublicEmailSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readEmailSetting()
	if err != nil {
		return nil, err
	}
	return publicEmailSetting(setting, value), nil
}

func (s *Service) UpdateEmailSetting(actor *model.User, req EmailSettingRequest) (*PublicEmailSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	currentSetting, current, err := s.readEmailSetting()
	if err != nil {
		return nil, err
	}
	next := normalizeEmailSetting(emailSettingValue{Enabled: req.Enabled, Host: req.Host, Port: req.Port, Username: req.Username, Password: req.Password, Encryption: req.Encryption, FromEmail: req.FromEmail, FromName: req.FromName})
	if next.Password == "" {
		next.Password = current.Password
	}
	if err := validateEmailSetting(next); err != nil {
		return nil, err
	}
	stored := next
	stored.Password, err = s.encryptSettingSecret(next.Password)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: emailSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if currentSetting != nil {
		setting.CreatedAt = currentSetting.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	return publicEmailSetting(&setting, next), nil
}

func (s *Service) EmailEnabled() (bool, error) {
	_, value, err := s.readEmailSetting()
	if err != nil {
		return false, err
	}
	return value.Enabled && value.Host != "" && value.Port > 0 && value.FromEmail != "", nil
}

func (s *Service) SendRegistrationEmailCode(rawEmail string) error {
	email := normalizeEmail(rawEmail)
	if err := validateEmail(email); err != nil {
		return err
	}
	count, err := s.repo.UserCount()
	if err != nil {
		return err
	}
	if count == 0 {
		return BadAuthRequest("首个管理员账号不需要邮箱验证码")
	}
	registrationEnabled, err := s.RegistrationEnabled()
	if err != nil {
		return err
	}
	if !registrationEnabled {
		return Forbidden("管理员未开放新用户注册")
	}
	if _, err := s.repo.UserByEmail(email); err == nil {
		return BadAuthRequest("邮箱已被注册")
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	_, setting, err := s.readEmailSetting()
	if err != nil {
		return err
	}
	if !setting.Enabled {
		return Forbidden("平台尚未启用注册邮件，请联系管理员")
	}
	s.emailCodeMu.Lock()
	defer s.emailCodeMu.Unlock()
	if latest, err := s.repo.LatestEmailVerificationCode(email, registrationEmailPurpose); err == nil && time.Since(latest.CreatedAt) < time.Minute {
		return BadAuthRequest("验证码发送过于频繁，请稍后再试")
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	code, err := randomNumericCode(6)
	if err != nil {
		return err
	}
	codeHash, err := s.emailVerificationCodeHash(email, code)
	if err != nil {
		return err
	}
	now := time.Now()
	record := model.EmailVerificationCode{ID: newID(), Email: email, CodeHash: codeHash, Purpose: registrationEmailPurpose, ExpiresAt: now.Add(registrationCodeTTL), CreatedAt: now}
	if err := s.repo.Create(&record); err != nil {
		return err
	}
	if err := sendSMTPMail(setting, email, "无限画布注册验证码", registrationEmailBody(code)); err != nil {
		_ = s.repo.DeleteEmailVerificationCode(record.ID)
		return fmt.Errorf("发送注册邮件失败：%w", err)
	}
	_ = s.repo.DeleteExpiredEmailVerificationCodes(now.Add(-24 * time.Hour))
	return nil
}

func (s *Service) VerifyRegistrationEmailCode(email string, rawCode string) (*model.EmailVerificationCode, error) {
	emailEnabled, err := s.EmailEnabled()
	if err != nil {
		return nil, err
	}
	if !emailEnabled {
		return nil, Forbidden("平台尚未启用注册邮件，请联系管理员")
	}
	code := strings.TrimSpace(rawCode)
	if len(code) != 6 {
		return nil, BadAuthRequest("请输入 6 位邮箱验证码")
	}
	record, err := s.repo.LatestEmailVerificationCode(email, registrationEmailPurpose)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, BadAuthRequest("请先获取邮箱验证码")
	}
	if err != nil {
		return nil, err
	}
	if time.Now().After(record.ExpiresAt) {
		return nil, BadAuthRequest("邮箱验证码已过期，请重新获取")
	}
	hash, err := s.emailVerificationCodeHash(email, code)
	if err != nil {
		return nil, err
	}
	if !hmac.Equal([]byte(hash), []byte(record.CodeHash)) {
		return nil, BadAuthRequest("邮箱验证码不正确")
	}
	return record, nil
}

func (s *Service) emailVerificationCodeHash(email string, code string) (string, error) {
	key, err := s.settingsEncryptionKey()
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(registrationEmailPurpose + ":" + email + ":" + code))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func (s *Service) readEmailSetting() (*model.SystemSetting, emailSettingValue, error) {
	setting, err := s.repo.SystemSetting(emailSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, normalizeEmailSetting(emailSettingValue{}), nil
	}
	if err != nil {
		return nil, emailSettingValue{}, err
	}
	value := emailSettingValue{}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return nil, emailSettingValue{}, errors.New("邮件配置格式无效")
	}
	value.Password, err = s.decryptSettingSecret(value.Password)
	if err != nil {
		return nil, emailSettingValue{}, err
	}
	return setting, normalizeEmailSetting(value), nil
}

func validateEmailSetting(value emailSettingValue) error {
	if !value.Enabled {
		return nil
	}
	if value.Host == "" || value.Port < 1 || value.Port > 65535 || value.FromEmail == "" {
		return BadAuthRequest("启用邮件前请完整填写 SMTP 主机、端口和发件邮箱")
	}
	if err := validateEmail(value.FromEmail); err != nil {
		return BadAuthRequest("发件邮箱格式不正确")
	}
	if value.Username != "" && value.Password == "" {
		return BadAuthRequest("SMTP 用户名已填写，请同时填写密码")
	}
	if strings.ContainsAny(value.FromName, "\r\n") {
		return BadAuthRequest("发件人名称不能包含换行")
	}
	return nil
}

func normalizeEmailSetting(value emailSettingValue) emailSettingValue {
	value.Host = strings.TrimSpace(value.Host)
	value.Username = strings.TrimSpace(value.Username)
	value.Password = strings.TrimSpace(value.Password)
	value.FromEmail = normalizeEmail(value.FromEmail)
	value.FromName = strings.TrimSpace(value.FromName)
	if value.Port == 0 {
		value.Port = 587
	}
	switch value.Encryption {
	case "tls", "none":
	default:
		value.Encryption = "starttls"
	}
	if value.FromName == "" {
		value.FromName = "无限画布"
	}
	return value
}

func publicEmailSetting(setting *model.SystemSetting, value emailSettingValue) *PublicEmailSetting {
	result := &PublicEmailSetting{Enabled: value.Enabled, Host: value.Host, Port: value.Port, Username: value.Username, Encryption: value.Encryption, FromEmail: value.FromEmail, FromName: value.FromName, HasPassword: value.Password != ""}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

func sendSMTPMail(setting emailSettingValue, recipient string, subject string, body string) error {
	address := net.JoinHostPort(setting.Host, strconv.Itoa(setting.Port))
	tlsConfig := &tls.Config{ServerName: setting.Host, MinVersion: tls.VersionTLS12}
	dialer := &net.Dialer{Timeout: 12 * time.Second}
	var client *smtp.Client
	var err error
	if setting.Encryption == "tls" {
		connection, dialErr := tls.DialWithDialer(dialer, "tcp", address, tlsConfig)
		if dialErr != nil {
			return dialErr
		}
		client, err = smtp.NewClient(connection, setting.Host)
	} else {
		connection, dialErr := dialer.Dial("tcp", address)
		if dialErr != nil {
			return dialErr
		}
		client, err = smtp.NewClient(connection, setting.Host)
		if err == nil && setting.Encryption == "starttls" {
			err = client.StartTLS(tlsConfig)
		}
	}
	if err != nil {
		return err
	}
	defer client.Close()
	if setting.Username != "" {
		if err := client.Auth(smtp.PlainAuth("", setting.Username, setting.Password, setting.Host)); err != nil {
			return err
		}
	}
	if err := client.Mail(setting.FromEmail); err != nil {
		return err
	}
	if err := client.Rcpt(recipient); err != nil {
		return err
	}
	wc, err := client.Data()
	if err != nil {
		return err
	}
	from := mail.Address{Name: setting.FromName, Address: setting.FromEmail}
	message := fmt.Sprintf("From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s", from.String(), recipient, mime.QEncoding.Encode("UTF-8", subject), body)
	if _, err := wc.Write([]byte(message)); err != nil {
		_ = wc.Close()
		return err
	}
	if err := wc.Close(); err != nil {
		return err
	}
	return client.Quit()
}

func randomNumericCode(length int) (string, error) {
	limit := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(length)), nil)
	value, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", length, value.Int64()), nil
}

func registrationEmailBody(code string) string {
	return "你正在注册无限画布。\n\n验证码：" + code + "\n\n验证码 10 分钟内有效。若非本人操作，请忽略本邮件。"
}

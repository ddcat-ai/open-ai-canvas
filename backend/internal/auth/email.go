package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"log/slog"
	"math/big"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"yingce/backend/internal/emailtpl"
	"yingce/backend/internal/kernel"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const emailSettingKey = "email"
const registrationEmailPurpose = "registration"
const registrationCodeTTL = 10 * time.Minute

var defaultRegistrationEmailDomains = []string{
	"gmail.com",
	"163.com",
	"126.com",
	"qq.com",
	"outlook.com",
	"hotmail.com",
	"icloud.com",
	"yahoo.com",
	"foxmail.com",
}

type EmailSettingRequest struct {
	Enabled                    bool     `json:"enabled"`
	Host                       string   `json:"host"`
	Port                       int      `json:"port"`
	Username                   string   `json:"username"`
	Password                   string   `json:"password"`
	Encryption                 string   `json:"encryption"`
	FromEmail                  string   `json:"fromEmail"`
	FromName                   string   `json:"fromName"`
	RegistrationAllowedDomains []string `json:"registrationAllowedDomains"`
}

type PublicEmailSetting struct {
	Enabled                    bool      `json:"enabled"`
	Host                       string    `json:"host"`
	Port                       int       `json:"port"`
	Username                   string    `json:"username"`
	Encryption                 string    `json:"encryption"`
	FromEmail                  string    `json:"fromEmail"`
	FromName                   string    `json:"fromName"`
	FromNameInherited          bool      `json:"fromNameInherited"`
	HasPassword                bool      `json:"hasPassword"`
	RegistrationAllowedDomains []string  `json:"registrationAllowedDomains"`
	UpdatedBy                  string    `json:"updatedBy"`
	CreatedAt                  time.Time `json:"createdAt"`
	UpdatedAt                  time.Time `json:"updatedAt"`
}

type EmailSettingValue struct {
	Enabled                    bool     `json:"enabled"`
	Host                       string   `json:"host"`
	Port                       int      `json:"port"`
	Username                   string   `json:"username"`
	Password                   string   `json:"password"`
	Encryption                 string   `json:"encryption"`
	FromEmail                  string   `json:"fromEmail"`
	FromName                   string   `json:"fromName"`
	RegistrationAllowedDomains []string `json:"registrationAllowedDomains"`
}

func (s *Service) AdminEmailSetting(actor *model.User) (*PublicEmailSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readEmailSetting()
	if err != nil {
		return nil, err
	}
	return s.publicEmailSetting(setting, value), nil
}

func (s *Service) UpdateEmailSetting(actor *model.User, req EmailSettingRequest) (*PublicEmailSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	currentSetting, current, err := s.readEmailSetting()
	if err != nil {
		return nil, err
	}
	allowedDomains := req.RegistrationAllowedDomains
	if allowedDomains == nil {
		allowedDomains = current.RegistrationAllowedDomains
	}
	next := normalizeEmailSetting(EmailSettingValue{
		Enabled: req.Enabled, Host: req.Host, Port: req.Port, Username: req.Username, Password: req.Password,
		Encryption: req.Encryption, FromEmail: req.FromEmail, FromName: req.FromName,
		RegistrationAllowedDomains: allowedDomains,
	})
	if next.Password == "" {
		next.Password = current.Password
	}
	if err := validateEmailSetting(next); err != nil {
		return nil, err
	}
	stored := next
	stored.Password, err = s.host.EncryptSecret(next.Password)
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
	return s.publicEmailSetting(&setting, next), nil
}

func (s *Service) EmailEnabled() (bool, error) {
	_, value, err := s.readEmailSetting()
	if err != nil {
		return false, err
	}
	return value.Enabled && value.Host != "" && value.Port > 0 && value.FromEmail != "", nil
}

func (s *Service) SendRegistrationEmailCode(rawEmail string) error {
	p, err := s.verificationPolicy()
	if err != nil {
		return err
	}
	if !p.allows("register", "email") {
		return kernel.Forbidden("邮箱单独验证注册未开启")
	}
	email := NormalizeEmail(rawEmail)
	if err := ValidateEmail(email); err != nil {
		return err
	}
	count, err := s.repo.UserCount()
	if err != nil {
		return err
	}
	if count == 0 {
		return kernel.BadAuthRequest("首个管理员账号不需要邮箱验证码")
	}
	registrationEnabled, err := s.RegistrationEnabled()
	if err != nil {
		return err
	}
	if !registrationEnabled {
		return kernel.Forbidden("管理员未开放新用户注册")
	}
	if err := s.repo.CheckEmailAvailable(email, ""); err != nil {
		return err
	}
	_, setting, err := s.readEmailSetting()
	if err != nil {
		return err
	}
	if err := validateRegistrationEmailDomain(email, setting.RegistrationAllowedDomains); err != nil {
		return err
	}
	if !setting.Enabled {
		return kernel.Forbidden("平台尚未启用注册邮件，请联系管理员")
	}
	s.emailCodeMu.Lock()
	defer s.emailCodeMu.Unlock()
	if latest, err := s.repo.LatestEmailVerificationCode(email, registrationEmailPurpose); err == nil && time.Since(latest.CreatedAt) < time.Minute {
		seconds := max(1, int((time.Until(latest.CreatedAt.Add(time.Minute))+time.Second-1)/time.Second))
		return &EmailCodeCooldownError{Seconds: seconds}
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	code, err := randomNumericCode(6)
	if err != nil {
		return err
	}
	codeHash, err := s.emailVerificationCodeHash(registrationEmailPurpose, email, code)
	if err != nil {
		return err
	}
	now := time.Now()
	record := model.EmailVerificationCode{ID: kernel.NewID(), Email: email, CodeHash: codeHash, Purpose: registrationEmailPurpose, ExpiresAt: now.Add(registrationCodeTTL), CreatedAt: now}
	if err := s.repo.Create(&record); err != nil {
		return err
	}
	setting = resolveEmailSender(setting, s.host.BrandName())
	rendered, err := registrationEmail(setting.FromName, email, code)
	if err != nil {
		return err
	}
	if err := s.deliverEmail(setting, EmailDelivery{Purpose: EmailPurposeRegistration, Recipient: email, Mail: rendered}); err != nil {
		cleanupErr := s.repo.DeleteEmailVerificationCode(record.ID)
		if cleanupErr != nil {
			return errors.Join(
				fmt.Errorf("发送注册邮件失败：%w", err),
				fmt.Errorf("清理失效验证码失败：%w", cleanupErr),
			)
		}
		return fmt.Errorf("发送注册邮件失败：%w", err)
	}
	if cleanupErr := s.repo.DeleteExpiredEmailVerificationCodes(now.Add(-24 * time.Hour)); cleanupErr != nil {
		log.Printf("expired registration code cleanup failed: error=%v", cleanupErr)
	}
	return nil
}

func (s *Service) VerifyRegistrationEmailCode(email string, rawCode string) (*model.EmailVerificationCode, error) {
	p, err := s.verificationPolicy()
	if err != nil {
		return nil, err
	}
	if !p.allows("register", "email") {
		return nil, kernel.Forbidden("邮箱单独验证注册未开启")
	}
	emailEnabled, err := s.EmailEnabled()
	if err != nil {
		return nil, err
	}
	if !emailEnabled {
		return nil, kernel.Forbidden("平台尚未启用注册邮件，请联系管理员")
	}
	code := strings.TrimSpace(rawCode)
	if len(code) != 6 {
		return nil, kernel.BadAuthRequest("请输入 6 位邮箱验证码")
	}
	record, err := s.repo.LatestEmailVerificationCode(email, registrationEmailPurpose)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.BadAuthRequest("请先获取邮箱验证码")
	}
	if err != nil {
		return nil, err
	}
	if time.Now().After(record.ExpiresAt) {
		return nil, kernel.BadAuthRequest("邮箱验证码已过期，请重新获取")
	}
	if err := s.repo.AttemptLegacyEmailVerification(record.ID); err != nil {
		return nil, invalidVerification()
	}
	hash, err := s.emailVerificationCodeHash(registrationEmailPurpose, email, code)
	if err != nil {
		return nil, err
	}
	if !hmac.Equal([]byte(hash), []byte(record.CodeHash)) {
		return nil, kernel.BadAuthRequest("邮箱验证码不正确")
	}
	return record, nil
}

func (s *Service) emailVerificationCodeHash(purpose string, email string, code string) (string, error) {
	key, err := s.host.SettingsEncryptionKey()
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(strings.TrimSpace(purpose) + ":" + NormalizeEmail(email) + ":" + strings.TrimSpace(code)))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

func (s *Service) readEmailSetting() (*model.SystemSetting, EmailSettingValue, error) {
	setting, err := s.repo.SystemSetting(emailSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, normalizeEmailSetting(EmailSettingValue{}), nil
	}
	if err != nil {
		return nil, EmailSettingValue{}, err
	}
	value := EmailSettingValue{}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return nil, EmailSettingValue{}, errors.New("邮件配置格式无效")
	}
	value.Password, err = s.host.DecryptSecret(value.Password)
	if err != nil {
		return nil, EmailSettingValue{}, err
	}
	return setting, normalizeEmailSetting(value), nil
}

func validateEmailSetting(value EmailSettingValue) error {
	if err := validateRegistrationEmailDomains(value.RegistrationAllowedDomains); err != nil {
		return err
	}
	if !value.Enabled {
		return nil
	}
	if value.Host == "" || value.Port < 1 || value.Port > 65535 || value.FromEmail == "" {
		return kernel.BadAuthRequest("启用邮件前请完整填写 SMTP 主机、端口和发件邮箱")
	}
	if err := ValidateEmail(value.FromEmail); err != nil {
		return kernel.BadAuthRequest("发件邮箱格式不正确")
	}
	if value.Username != "" && value.Password == "" {
		return kernel.BadAuthRequest("SMTP 用户名已填写，请同时填写密码")
	}
	if strings.ContainsAny(value.FromName, "\r\n") {
		return kernel.BadAuthRequest("发件人名称不能包含换行")
	}
	return nil
}

func normalizeEmailSetting(value EmailSettingValue) EmailSettingValue {
	value.Host = strings.TrimSpace(value.Host)
	value.Username = strings.TrimSpace(value.Username)
	value.Password = strings.TrimSpace(value.Password)
	value.FromEmail = NormalizeEmail(value.FromEmail)
	value.FromName = strings.TrimSpace(value.FromName)
	if value.RegistrationAllowedDomains == nil {
		value.RegistrationAllowedDomains = append([]string(nil), defaultRegistrationEmailDomains...)
	}
	value.RegistrationAllowedDomains = normalizeEmailDomains(value.RegistrationAllowedDomains)
	if value.Port == 0 {
		value.Port = 587
	}
	switch value.Encryption {
	case "tls", "none":
	default:
		value.Encryption = "starttls"
	}
	return value
}

func (s *Service) publicEmailSetting(setting *model.SystemSetting, value EmailSettingValue) *PublicEmailSetting {
	inherited := value.FromName == "" || value.FromName == DefaultBrandName
	value = resolveEmailSender(value, s.host.BrandName())
	result := &PublicEmailSetting{
		Enabled: value.Enabled, Host: value.Host, Port: value.Port, Username: value.Username, Encryption: value.Encryption,
		FromEmail: value.FromEmail, FromName: value.FromName, FromNameInherited: inherited, HasPassword: value.Password != "",
		RegistrationAllowedDomains: value.RegistrationAllowedDomains,
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

func normalizeEmailDomains(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, raw := range values {
		value := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "@")))
		value = strings.TrimSuffix(value, ".")
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func validateRegistrationEmailDomains(allowed []string) error {
	if len(allowed) > 100 {
		return kernel.BadAuthRequest("电子邮件域名白名单最多填写 100 项")
	}
	for _, domain := range allowed {
		if !validEmailDomain(domain) {
			return kernel.BadAuthRequest("电子邮件域名格式不正确：" + domain)
		}
	}
	return nil
}

func validEmailDomain(value string) bool {
	if len(value) > 253 || !strings.Contains(value, ".") || strings.HasPrefix(value, ".") || strings.HasSuffix(value, ".") {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, char := range label {
			if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
				return false
			}
		}
	}
	return true
}

func (s *Service) validateRegistrationEmailDomain(email string) error {
	_, setting, err := s.readEmailSetting()
	if err != nil {
		return err
	}
	return validateRegistrationEmailDomain(email, setting.RegistrationAllowedDomains)
}

func validateRegistrationEmailDomain(email string, allowedDomains []string) error {
	parts := strings.Split(email, "@")
	if len(parts) != 2 {
		return kernel.BadAuthRequest("邮箱格式不正确")
	}
	domain := strings.ToLower(parts[1])
	if len(allowedDomains) == 0 {
		return nil
	}
	for _, allowed := range allowedDomains {
		if domain == allowed {
			return nil
		}
	}
	return kernel.BadAuthRequest("该邮箱域名不在管理员设置的白名单内")
}

func resolveEmailSender(value EmailSettingValue, brandName string) EmailSettingValue {
	if value.FromName == "" || value.FromName == DefaultBrandName {
		value.FromName = brandName
	}
	return value
}

// smtpSessionTimeout 限制一次投递的总时长；没有读写期限时，465 端口误配 STARTTLS 会一直等欢迎语，
// 期间持有 emailCodeMu，后续所有验证码发送都会被卡住。
const smtpSessionTimeout = 45 * time.Second

// OutgoingMail 是一封待发送的系统邮件；Text 必须完整可读，HTML 可为空。
type OutgoingMail struct {
	Subject string
	Text    string
	HTML    string
}

type smtpStageError struct {
	stage string
	err   error
}

func (e *smtpStageError) Error() string { return "smtp " + e.stage + ": " + e.err.Error() }
func (e *smtpStageError) Unwrap() error { return e.err }

func smtpEncryption(setting EmailSettingValue) string {
	// 465 是隐式 TLS 端口，按 STARTTLS 连接只会超时；这里按端口纠正，其余端口尊重配置。
	if setting.Port == 465 && setting.Encryption != "none" {
		return "tls"
	}
	return setting.Encryption
}

func sendSMTPMail(setting EmailSettingValue, recipient string, mailItem OutgoingMail) (err error) {
	stage := "connect"
	defer func() {
		if err != nil {
			err = &smtpStageError{stage: stage, err: err}
		}
	}()
	address := net.JoinHostPort(setting.Host, strconv.Itoa(setting.Port))
	tlsConfig := &tls.Config{ServerName: setting.Host, MinVersion: tls.VersionTLS12}
	dialer := &net.Dialer{Timeout: 12 * time.Second}
	deadline := time.Now().Add(smtpSessionTimeout)
	encryption := smtpEncryption(setting)
	var connection net.Conn
	if encryption == "tls" {
		stage = "connect_tls"
		connection, err = tls.DialWithDialer(dialer, "tcp", address, tlsConfig)
	} else {
		connection, err = dialer.Dial("tcp", address)
	}
	if err != nil {
		return err
	}
	if err := connection.SetDeadline(deadline); err != nil {
		_ = connection.Close()
		return err
	}
	stage = "greeting"
	client, err := smtp.NewClient(connection, setting.Host)
	if err != nil {
		_ = connection.Close()
		return err
	}
	defer client.Close()
	if encryption == "starttls" {
		stage = "starttls"
		if err := client.StartTLS(tlsConfig); err != nil {
			return err
		}
	}
	if setting.Username != "" {
		stage = "auth"
		if err := client.Auth(smtp.PlainAuth("", setting.Username, setting.Password, setting.Host)); err != nil {
			return err
		}
	}
	stage = "mail_from"
	if err := client.Mail(setting.FromEmail); err != nil {
		return err
	}
	stage = "rcpt_to"
	if err := client.Rcpt(recipient); err != nil {
		return err
	}
	stage = "data"
	wc, err := client.Data()
	if err != nil {
		return err
	}
	stage = "write_body"
	if _, err := wc.Write(buildMIMEMessage(setting, recipient, mailItem, time.Now())); err != nil {
		_ = wc.Close()
		return err
	}
	stage = "finish_data"
	if err := wc.Close(); err != nil {
		return err
	}
	stage = "quit"
	return client.Quit()
}

// buildMIMEMessage 生成 multipart/alternative 邮件。Date 与 Message-ID 是 RFC 5322 必填头，
// 缺失时 QQ 邮箱、Gmail 等会提高垃圾邮件评分。
func buildMIMEMessage(setting EmailSettingValue, recipient string, mailItem OutgoingMail, now time.Time) []byte {
	from := mail.Address{Name: setting.FromName, Address: setting.FromEmail}
	domain := setting.Host
	if _, after, ok := strings.Cut(setting.FromEmail, "@"); ok && after != "" {
		domain = after
	}
	var b strings.Builder
	header := func(key, value string) { b.WriteString(key + ": " + value + "\r\n") }
	header("From", from.String())
	header("To", recipient)
	header("Subject", mime.QEncoding.Encode("UTF-8", mailItem.Subject))
	header("Date", now.Format(time.RFC1123Z))
	header("Message-ID", "<"+kernel.NewID()+"@"+domain+">")
	header("MIME-Version", "1.0")
	header("Auto-Submitted", "auto-generated")
	header("X-Auto-Response-Suppress", "All")
	if strings.TrimSpace(mailItem.HTML) == "" {
		header("Content-Type", "text/plain; charset=UTF-8")
		header("Content-Transfer-Encoding", "base64")
		b.WriteString("\r\n")
		b.WriteString(wrapBase64(mailItem.Text))
		return []byte(b.String())
	}
	boundary := "=_yc_" + kernel.NewID()
	header("Content-Type", `multipart/alternative; boundary="`+boundary+`"`)
	b.WriteString("\r\n")
	for _, part := range []struct{ kind, body string }{{"text/plain", mailItem.Text}, {"text/html", mailItem.HTML}} {
		b.WriteString("--" + boundary + "\r\n")
		b.WriteString("Content-Type: " + part.kind + "; charset=UTF-8\r\n")
		b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
		b.WriteString(wrapBase64(part.body))
	}
	b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String())
}

func wrapBase64(value string) string {
	encoded := base64.StdEncoding.EncodeToString([]byte(value))
	var b strings.Builder
	for len(encoded) > 76 {
		b.WriteString(encoded[:76] + "\r\n")
		encoded = encoded[76:]
	}
	b.WriteString(encoded + "\r\n")
	return b.String()
}

// 邮件用途，写入 email_logs.purpose。
const (
	EmailPurposeRegistration      = "registration"
	EmailPurposePasswordReset     = "password_reset"
	EmailPurposeVerification      = "verification"
	EmailPurposeProfileEmail      = "profile_email"
	EmailPurposeEmailChanged      = "email_changed"
	EmailPurposeTest              = "test"
	EmailPurposeConsumptionReport = "consumption_report"
	emailLogStatusSent            = "sent"
	emailLogStatusFailed          = "failed"
	emailLogStatusSkipped         = "skipped"
)

// EmailDelivery 描述一次投递的业务上下文，用于发送记录。
type EmailDelivery struct {
	Purpose   string
	UserID    string
	Recipient string
	Mail      OutgoingMail
}

func (s *Service) deliverEmail(setting EmailSettingValue, delivery EmailDelivery) error {
	started := time.Now()
	var err error
	if s.mailSender != nil {
		err = s.mailSender(setting, delivery.Recipient, delivery.Mail.Subject, delivery.Mail.Text)
	} else {
		err = sendSMTPMail(setting, delivery.Recipient, delivery.Mail)
	}
	entry := model.EmailLog{ID: kernel.NewID(), UserID: delivery.UserID, Purpose: delivery.Purpose, Recipient: delivery.Recipient, Subject: logSubject(delivery.Mail.Subject), Status: emailLogStatusSent, SMTPHost: setting.Host, DurationMS: time.Since(started).Milliseconds(), CreatedAt: started}
	if err != nil {
		reason := smtpLogError(err, setting, delivery.Recipient, delivery.Mail.Subject, delivery.Mail.Text)
		slog.Error("smtp email delivery failed",
			"host", setting.Host, "port", setting.Port, "encryption", setting.Encryption,
			"recipient", maskedEmail(delivery.Recipient), "error", reason)
		entry.Status = emailLogStatusFailed
		entry.Reason = truncateRunes(reason, 500)
		var stageErr *smtpStageError
		if errors.As(err, &stageErr) {
			entry.Stage = stageErr.stage
		}
	}
	s.appendEmailLog(&entry)
	return err
}

// recordSkippedEmail 记录按规则未投递的请求（如找回密码时账号不存在），方便管理员排查“收不到邮件”。
func (s *Service) recordSkippedEmail(purpose, userID, recipient, reason string) {
	s.appendEmailLog(&model.EmailLog{ID: kernel.NewID(), UserID: userID, Purpose: purpose, Recipient: recipient, Status: emailLogStatusSkipped, Reason: reason, CreatedAt: time.Now()})
}

func (s *Service) appendEmailLog(entry *model.EmailLog) {
	if s.repo == nil {
		return
	}
	if err := s.repo.AppendEmailLog(entry); err != nil {
		slog.Warn("email log write failed", "purpose", entry.Purpose, "recipient", maskedEmail(entry.Recipient), "error", err)
	}
}

// logSubject 去掉标题里的验证码，发送记录不保存验证码明文。
func logSubject(subject string) string {
	return truncateRunes(strings.TrimSpace(emailCodeLogPattern.ReplaceAllString(subject, "******")), 200)
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

// SendSystemEmail 供其他业务域（如消费日报）复用平台 SMTP 配置与发送记录。
func (s *Service) SendSystemEmail(delivery EmailDelivery) error {
	_, setting, err := s.readEmailSetting()
	if err != nil {
		return err
	}
	if !setting.Enabled || setting.Host == "" || setting.Port < 1 || setting.FromEmail == "" {
		return kernel.Forbidden("邮件服务未启用")
	}
	setting = resolveEmailSender(setting, s.host.BrandName())
	return s.deliverEmail(setting, delivery)
}

// EmailBrandName 是邮件里显示的品牌名：发件人名称优先，其次是外观设置的品牌名。
func (s *Service) EmailBrandName() string {
	_, setting, err := s.readEmailSetting()
	if err != nil {
		return s.host.BrandName()
	}
	return resolveEmailSender(setting, s.host.BrandName()).FromName
}

var emailCodeLogPattern = regexp.MustCompile(`[0-9]{6}`)

func smtpLogError(err error, setting EmailSettingValue, recipient, subject, body string) string {
	// SMTP replies can echo credentials, addresses or message content. Redact
	// those values before logging while preserving the status and failure detail.
	secrets := []string{setting.Password, setting.Username, setting.FromEmail, recipient, subject, body,
		"\x00" + setting.Username + "\x00" + setting.Password}
	secrets = append(secrets, emailCodeLogPattern.FindAllString(body, -1)...)
	values := make([]string, 0, len(secrets)*2)
	for _, secret := range secrets {
		if secret != "" {
			values = append(values, secret, base64.StdEncoding.EncodeToString([]byte(secret)))
		}
	}
	sort.Slice(values, func(i, j int) bool { return len(values[i]) > len(values[j]) })
	pairs := make([]string, 0, len(values)*2)
	for _, value := range values {
		pairs = append(pairs, value, "[redacted]")
	}
	return strings.NewReplacer(pairs...).Replace(err.Error())
}

func randomNumericCode(length int) (string, error) {
	limit := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(length)), nil)
	value, err := rand.Int(rand.Reader, limit)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%0*d", length, value.Int64()), nil
}

func registrationEmail(brandName, recipient, code string) (OutgoingMail, error) {
	return codeMail(emailtpl.CodeEmail{Brand: brandName, Heading: "注册", Intro: "你正在注册" + brandName + "。请在注册页面输入下方验证码，完成邮箱验证。", Code: code, TTLMinutes: 10, Recipient: recipient})
}

func codeMail(item emailtpl.CodeEmail) (OutgoingMail, error) {
	rendered, err := emailtpl.RenderCode(item)
	if err != nil {
		return OutgoingMail{}, err
	}
	return OutgoingMail{Subject: rendered.Subject, Text: rendered.Text, HTML: rendered.HTML}, nil
}

func noticeMail(item emailtpl.NoticeEmail) (OutgoingMail, error) {
	rendered, err := emailtpl.RenderNotice(item)
	if err != nil {
		return OutgoingMail{}, err
	}
	return OutgoingMail{Subject: rendered.Subject, Text: rendered.Text, HTML: rendered.HTML}, nil
}

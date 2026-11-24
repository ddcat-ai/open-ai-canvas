package auth

import (
	"net/mail"
	"strings"
	"time"

	"yingce/backend/internal/emailtpl"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// emailLogRetention 控制发送记录保留时长；记录只有元数据，保留 90 天足够排查投诉。
const emailLogRetention = 90 * 24 * time.Hour

type EmailLogQuery struct{ Keyword, Purpose, Status, From, To string }

type EmailLogPage struct {
	Logs     []model.EmailLog `json:"logs"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
	// Last24h 是近 24 小时各状态数量（sent/failed/skipped）。
	Last24h map[string]int64 `json:"last24h"`
}

var emailLogPurposes = []string{"", EmailPurposeRegistration, EmailPurposePasswordReset, EmailPurposeVerification, EmailPurposeProfileEmail, EmailPurposeEmailChanged, EmailPurposeTest, EmailPurposeConsumptionReport}

func (s *Service) AdminEmailLogs(actor *model.User, query EmailLogQuery, page, pageSize int) (*EmailLogPage, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	filter := repository.EmailLogFilter{Keyword: strings.TrimSpace(query.Keyword), Purpose: strings.TrimSpace(query.Purpose), Status: strings.TrimSpace(query.Status)}
	if !containsString(emailLogPurposes, filter.Purpose) || !containsString([]string{"", emailLogStatusSent, emailLogStatusFailed, emailLogStatusSkipped}, filter.Status) {
		return nil, kernel.BadAuthRequest("邮件记录筛选参数无效")
	}
	if len([]rune(filter.Keyword)) > 160 {
		return nil, kernel.BadAuthRequest("关键词过长")
	}
	for _, bound := range []struct {
		raw   string
		value **time.Time
	}{{query.From, &filter.From}, {query.To, &filter.To}} {
		if bound.raw == "" {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, bound.raw)
		if err != nil {
			return nil, kernel.BadAuthRequest("时间必须使用 RFC3339 格式")
		}
		*bound.value = &parsed
	}
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	logs, total, err := s.repo.EmailLogs(filter, pageSize, (page-1)*pageSize)
	if err != nil {
		return nil, err
	}
	stats, err := s.repo.EmailLogStats(time.Now().Add(-24 * time.Hour))
	if err != nil {
		return nil, err
	}
	return &EmailLogPage{Logs: logs, Total: total, Page: page, PageSize: pageSize, Last24h: stats}, nil
}

// SendTestEmail 用当前保存的 SMTP 配置给管理员指定的邮箱发一封测试信，失败时把脱敏后的 SMTP 原因返回给管理员。
func (s *Service) SendTestEmail(actor *model.User, rawRecipient string) error {
	if err := s.host.RequireAdmin(actor); err != nil {
		return err
	}
	recipient := NormalizeEmail(rawRecipient)
	if recipient == "" {
		recipient = NormalizeEmail(actor.Email)
	}
	if _, err := mail.ParseAddress(recipient); err != nil || recipient == "" {
		return kernel.BadAuthRequest("请填写有效的收件邮箱")
	}
	_, setting, err := s.readEmailSetting()
	if err != nil {
		return err
	}
	if setting.Host == "" || setting.Port < 1 || setting.FromEmail == "" {
		return kernel.BadAuthRequest("请先保存 SMTP 主机、端口和发件邮箱")
	}
	setting = resolveEmailSender(setting, s.host.BrandName())
	rendered, err := codeMail(emailtpl.CodeEmail{Brand: setting.FromName, Heading: "测试邮件", SubjectLabel: "测试邮件（示例验证码）", Intro: "这是一封来自后台的测试邮件，用来确认 SMTP 配置可以正常投递。下方是验证码邮件的示例样式。", Code: "000000", TTLMinutes: 10, Recipient: recipient,
		SecurityTip: "收到这封邮件说明 SMTP 配置可用。如果用户仍反馈收不到验证码，请在后台「邮件发送记录」查看对应邮箱的投递结果。"})
	if err != nil {
		return err
	}
	if err := s.deliverEmail(setting, EmailDelivery{Purpose: EmailPurposeTest, UserID: actor.ID, Recipient: recipient, Mail: rendered}); err != nil {
		return kernel.BadAuthRequest("测试邮件发送失败：" + smtpLogError(err, setting, recipient, rendered.Subject, rendered.Text))
	}
	return nil
}

func (s *Service) CleanupEmailLogs() (int64, error) {
	return s.repo.DeleteEmailLogsBefore(time.Now().Add(-emailLogRetention))
}

func containsString(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

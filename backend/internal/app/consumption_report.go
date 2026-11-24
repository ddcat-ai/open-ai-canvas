package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"sort"
	"strings"
	"time"

	"yingce/backend/internal/auth"
	"yingce/backend/internal/emailtpl"
	"yingce/backend/internal/model"
)

// 消费日报按东八区自然日统计，23:59 起发送；23:59 之后的消费计入次日。
var consumptionReportLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

const (
	consumptionReportHour      = 23
	consumptionReportMinute    = 59
	consumptionReportBatch     = 200
	consumptionReportLockTTL   = 10 * time.Minute
	consumptionReportScanEvery = 20 * time.Second
)

type NotificationSettings struct {
	ConsumptionReportEnabled bool `json:"consumptionReportEnabled"`
	// EmailAvailable 为 false 时前端提示账号未绑定邮箱或平台未启用邮件。
	EmailAvailable bool   `json:"emailAvailable"`
	Email          string `json:"email"`
}

func (s *Service) UserNotificationSettings(actor *model.User) (*NotificationSettings, error) {
	if actor == nil || actor.ID == "" {
		return nil, Unauthorized("请先登录")
	}
	setting, err := s.repo.UserNotificationSetting(actor.ID)
	if err != nil {
		return nil, err
	}
	enabled, err := s.authDomain().EmailEnabled()
	if err != nil {
		return nil, err
	}
	return &NotificationSettings{ConsumptionReportEnabled: setting.ConsumptionReportEnabled, EmailAvailable: enabled && strings.TrimSpace(actor.Email) != "", Email: actor.Email}, nil
}

func (s *Service) UpdateUserNotificationSettings(actor *model.User, enabled bool) (*NotificationSettings, error) {
	if actor == nil || actor.ID == "" {
		return nil, Unauthorized("请先登录")
	}
	if enabled {
		emailEnabled, err := s.authDomain().EmailEnabled()
		if err != nil {
			return nil, err
		}
		if !emailEnabled {
			return nil, BadAuthRequest("平台尚未启用邮件服务，暂时无法订阅")
		}
		if strings.TrimSpace(actor.Email) == "" {
			return nil, BadAuthRequest("请先在账号设置中绑定邮箱")
		}
	}
	if _, err := s.repo.SaveConsumptionReportSubscription(actor.ID, enabled); err != nil {
		return nil, err
	}
	return s.UserNotificationSettings(actor)
}

func (s *Service) startConsumptionReportWorker() {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(consumptionReportScanEvery)
		defer ticker.Stop()
		cleanup := time.NewTicker(6 * time.Hour)
		defer cleanup.Stop()
		for {
			s.runConsumptionReports(ctx, time.Now())
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			case <-cleanup.C:
				if deleted, err := s.authDomain().CleanupEmailLogs(); err != nil {
					slog.Warn("email log cleanup failed", "deleted", deleted, "error", err)
				}
			}
		}
	})
}

// runConsumptionReports 只在东八区 23:59 这一分钟内工作；多实例用协调器租约互斥，
// 每个用户再用 last_consumption_report_date 条件更新保证当天最多一封。
func (s *Service) runConsumptionReports(ctx context.Context, now time.Time) {
	local := now.In(consumptionReportLocation)
	if local.Hour() != consumptionReportHour || local.Minute() != consumptionReportMinute {
		return
	}
	date := local.Format("2006-01-02")
	release, acquired, err := s.coordinator.Acquire(ctx, "consumption-report:"+date, 1, consumptionReportLockTTL)
	if err != nil || !acquired {
		if err != nil && ctx.Err() == nil {
			slog.Warn("consumption report lock failed", "error", err)
		}
		return
	}
	defer release()
	sent, failed := s.sendConsumptionReports(ctx, local)
	if sent > 0 || failed > 0 {
		slog.Info("consumption reports delivered", "date", date, "sent", sent, "failed", failed)
	}
}

func (s *Service) sendConsumptionReports(ctx context.Context, local time.Time) (sent, failed int) {
	dayStart := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, consumptionReportLocation)
	dayEnd := dayStart.Add(24 * time.Hour)
	date := dayStart.Format("2006-01-02")
	enabled, err := s.authDomain().EmailEnabled()
	if err != nil || !enabled {
		return 0, 0
	}
	for ctx.Err() == nil {
		users, err := s.repo.ConsumptionReportCandidates(date, dayStart, dayEnd, consumptionReportBatch)
		if err != nil {
			slog.Warn("consumption report candidates failed", "error", err)
			return
		}
		if len(users) == 0 {
			return
		}
		progressed := false
		for _, user := range users {
			if ctx.Err() != nil {
				return
			}
			claimed, err := s.repo.ClaimConsumptionReport(user.ID, date)
			if err != nil || !claimed {
				continue
			}
			progressed = true
			if err := s.sendConsumptionReport(user, dayStart); err != nil {
				failed++
				// 投递失败不归还名额：SMTP 拒信通常会持续失败，避免本分钟内反复重试；失败原因已写入发送记录。
				slog.Warn("consumption report delivery failed", "user", user.ID, "error", err)
				continue
			}
			sent++
		}
		if !progressed {
			return
		}
	}
	return
}

func (s *Service) sendConsumptionReport(user model.User, dayStart time.Time) error {
	report, err := s.buildConsumptionReport(user, dayStart)
	if err != nil {
		return err
	}
	rendered, err := emailtpl.RenderConsumptionReport(*report)
	if err != nil {
		return err
	}
	return s.authDomain().SendSystemEmail(auth.EmailDelivery{Purpose: auth.EmailPurposeConsumptionReport, UserID: user.ID, Recipient: user.Email,
		Mail: auth.OutgoingMail{Subject: rendered.Subject, Text: rendered.Text, HTML: rendered.HTML}})
}

var capabilityLabels = map[string]string{"image": "图片生成", "video": "视频生成", "text": "文本与对话", "audio": "音频生成", "ark_asset": "素材组"}

var weekdayLabels = []string{"星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"}

func (s *Service) buildConsumptionReport(user model.User, dayStart time.Time) (*emailtpl.ConsumptionReport, error) {
	weekStart := dayStart.AddDate(0, 0, -6)
	rows, err := s.repo.ConsumptionLedger(user.ID, weekStart, dayStart.Add(24*time.Hour))
	if err != nil {
		return nil, err
	}
	report := &emailtpl.ConsumptionReport{
		Brand:       s.authDomain().EmailBrandName(),
		UserName:    firstNonEmpty(strings.TrimSpace(user.DisplayName), user.Username),
		Date:        dayStart.Format("2006-01-02"),
		WeekdayName: weekdayLabels[dayStart.Weekday()],
	}
	daily := make([]int64, 7)
	capabilities := map[string]*emailtpl.Slice{}
	models := map[string]*emailtpl.Slice{}
	type orderTotal struct {
		micro      int64
		model      string
		capability string
		at         time.Time
	}
	orders := map[string]*orderTotal{}
	for _, row := range rows {
		at := row.CreatedAt.In(consumptionReportLocation)
		dayIndex := int(at.Sub(weekStart) / (24 * time.Hour))
		if dayIndex < 0 || dayIndex > 6 {
			continue
		}
		net := -row.AmountMicrocredits // consume 为负数，refund 为正数
		daily[dayIndex] += net
		if dayIndex != 6 {
			continue
		}
		label := capabilityLabels[row.Capability]
		if label == "" {
			label = firstNonEmpty(row.Scene, "其他")
		}
		modelName := firstNonEmpty(strings.TrimSpace(row.Model), "未命名模型")
		if row.Type == model.CreditLedgerRefund {
			report.RefundMicro += row.AmountMicrocredits
		} else {
			charge := -row.AmountMicrocredits
			report.ConsumeMicro += charge
			report.Hourly[at.Hour()] += charge
			addSlice(capabilities, label, charge, 1)
			addSlice(models, modelName, charge, 1)
		}
		key := firstNonEmpty(row.BillingOrderID, fmt.Sprintf("ledger-%d", at.UnixNano()))
		item := orders[key]
		if item == nil {
			item = &orderTotal{model: modelName, capability: label, at: at}
			orders[key] = item
		}
		item.micro += net
	}
	report.TotalMicro = report.ConsumeMicro - report.RefundMicro
	report.PreviousDayMicro = daily[5]
	for index, micro := range daily {
		report.Last7 = append(report.Last7, emailtpl.DayAmount{Label: weekStart.AddDate(0, 0, index).Format("01-02"), Micro: max(micro, 0)})
	}
	report.Capabilities = sortedSlices(capabilities)
	report.Models = sortedSlices(models)
	top := make([]*orderTotal, 0, len(orders))
	for _, item := range orders {
		if item.micro > 0 {
			report.OrderCount++
			top = append(top, item)
		}
	}
	sort.Slice(top, func(i, j int) bool { return top[i].micro > top[j].micro })
	for _, item := range top[:min(len(top), 5)] {
		report.TopOrders = append(report.TopOrders, emailtpl.OrderLine{Time: item.at.Format("15:04"), Model: item.model, Kind: item.capability, Micro: item.micro})
	}
	if account, err := s.repo.CreditAccount(user.ID); err == nil {
		report.AvailableMicro = account.AvailableMicrocredits
	}
	if base := publicSiteURL(); base != "" {
		report.WalletURL = base + "/wallet"
		report.SettingsURL = base + "/settings?tab=profile"
	}
	return report, nil
}

func addSlice(items map[string]*emailtpl.Slice, label string, micro int64, count int) {
	item := items[label]
	if item == nil {
		item = &emailtpl.Slice{Label: label}
		items[label] = item
	}
	item.Micro += micro
	item.Count += count
}

func sortedSlices(items map[string]*emailtpl.Slice) []emailtpl.Slice {
	result := make([]emailtpl.Slice, 0, len(items))
	for _, item := range items {
		result = append(result, *item)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Micro != result[j].Micro {
			return result[i].Micro > result[j].Micro
		}
		return result[i].Label < result[j].Label
	})
	return result
}

// publicSiteURL 返回邮件里可点击的站点地址；只接受 http(s) 绝对地址，未配置时邮件不放链接。
func publicSiteURL() string {
	raw := strings.TrimRight(strings.TrimSpace(os.Getenv("CANVAS_PUBLIC_BASE_URL")), "/")
	parsed, err := url.Parse(raw)
	if raw == "" || err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return ""
	}
	return raw
}

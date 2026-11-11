package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	feishuintegration "yingce/backend/internal/integrations/feishu"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	feishuFeedbackSettingKey     = "feishu_feedback"
	feishuFeedbackDigestStateKey = "feishu_feedback_digest_state"
	feishuFeedbackDefaultTZ      = "Asia/Shanghai"
	feishuFeedbackDefaultHour    = 18
	feishuFeedbackDefaultMinute  = 0
	feishuFeedbackDigestLockTTL  = 10 * time.Minute
	feishuFeedbackScanEvery      = 20 * time.Second
	feishuFeedbackMaxTitleRunes  = 200
	feishuFeedbackMaxDigestRunes = 30000
	feishuFeedbackMaxErrorRunes  = 300
)

// FeishuFeedbackSettingsInput is the administrator-facing configuration. Blank
// secret fields retain the encrypted value already stored; ClearSecrets removes
// all three credentials so a replacement can be entered explicitly.
type FeishuFeedbackSettingsInput struct {
	Enabled           bool   `json:"enabled"`
	AppID             string `json:"appId"`
	AppSecret         string `json:"appSecret"`
	VerificationToken string `json:"verificationToken"`
	EncryptKey        string `json:"encryptKey"`
	BaseURL           string `json:"baseUrl"`
	AdminChatID       string `json:"adminChatId"`
	Timezone          string `json:"timezone"`
	DigestHour        *int   `json:"digestHour"`
	DigestMinute      *int   `json:"digestMinute"`
	ClearSecrets      bool   `json:"clearSecrets"`
}

type FeishuFeedbackSettingsView struct {
	Enabled         bool   `json:"enabled"`
	AppID           string `json:"appId"`
	BaseURL         string `json:"baseUrl"`
	AdminChatID     string `json:"adminChatId"`
	Timezone        string `json:"timezone"`
	DigestHour      int    `json:"digestHour"`
	DigestMinute    int    `json:"digestMinute"`
	AppSecretSet    bool   `json:"appSecretSet"`
	VerificationSet bool   `json:"verificationTokenSet"`
	EncryptKeySet   bool   `json:"encryptKeySet"`
}

type FeishuDigestStateView struct {
	Date        string     `json:"date"`
	Status      string     `json:"status"`
	Count       int        `json:"count"`
	AttemptedAt time.Time  `json:"attemptedAt,omitempty"`
	SentAt      *time.Time `json:"sentAt,omitempty"`
	Error       string     `json:"error,omitempty"`
}

type feishuFeedbackConfig struct {
	Enabled           bool   `json:"enabled"`
	AppID             string `json:"appId"`
	AppSecret         string `json:"appSecret"`
	VerificationToken string `json:"verificationToken"`
	EncryptKey        string `json:"encryptKey"`
	BaseURL           string `json:"baseUrl"`
	AdminChatID       string `json:"adminChatId"`
	Timezone          string `json:"timezone"`
	DigestHour        int    `json:"digestHour"`
	DigestMinute      int    `json:"digestMinute"`
}

type feishuDigestState struct {
	Date        string     `json:"date"`
	Status      string     `json:"status"`
	Count       int        `json:"count"`
	AttemptedAt time.Time  `json:"attemptedAt"`
	SentAt      *time.Time `json:"sentAt,omitempty"`
	Error       string     `json:"error,omitempty"`
}

func defaultFeishuFeedbackConfig() feishuFeedbackConfig {
	return feishuFeedbackConfig{Timezone: feishuFeedbackDefaultTZ, DigestHour: feishuFeedbackDefaultHour, DigestMinute: feishuFeedbackDefaultMinute}
}

func (s *Service) readFeishuFeedbackConfig() (feishuFeedbackConfig, error) {
	config := defaultFeishuFeedbackConfig()
	row, err := s.repo.SystemSettingOptional(feishuFeedbackSettingKey)
	if err != nil {
		return config, err
	}
	if row == nil || strings.TrimSpace(row.ValueJSON) == "" {
		return config, nil
	}
	if err := json.Unmarshal([]byte(row.ValueJSON), &config); err != nil {
		return defaultFeishuFeedbackConfig(), errors.New("飞书反馈配置格式无效")
	}
	for name, value := range map[string]string{
		"appSecret": config.AppSecret, "verificationToken": config.VerificationToken, "encryptKey": config.EncryptKey,
	} {
		plain, err := s.decryptSettingSecret(value)
		if err != nil {
			return defaultFeishuFeedbackConfig(), fmt.Errorf("解密飞书 %s 失败：%w", name, err)
		}
		switch name {
		case "appSecret":
			config.AppSecret = plain
		case "verificationToken":
			config.VerificationToken = plain
		case "encryptKey":
			config.EncryptKey = plain
		}
	}
	normalizeFeishuFeedbackConfig(&config)
	return config, nil
}

func normalizeFeishuFeedbackConfig(config *feishuFeedbackConfig) {
	if config == nil {
		return
	}
	config.AppID = strings.TrimSpace(config.AppID)
	config.AppSecret = strings.TrimSpace(config.AppSecret)
	config.VerificationToken = strings.TrimSpace(config.VerificationToken)
	config.EncryptKey = strings.TrimSpace(config.EncryptKey)
	config.BaseURL = strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	config.AdminChatID = strings.TrimSpace(config.AdminChatID)
	config.Timezone = strings.TrimSpace(config.Timezone)
	if config.Timezone == "" {
		config.Timezone = feishuFeedbackDefaultTZ
	}
	if config.DigestHour < 0 || config.DigestHour > 23 {
		config.DigestHour = feishuFeedbackDefaultHour
	}
	if config.DigestMinute < 0 || config.DigestMinute > 59 {
		config.DigestMinute = feishuFeedbackDefaultMinute
	}
}

func (s *Service) FeishuFeedbackSettings(actor *model.User) (*FeishuFeedbackSettingsView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	config, err := s.readFeishuFeedbackConfig()
	if err != nil {
		return nil, err
	}
	return feishuFeedbackSettingsView(config), nil
}

func feishuFeedbackSettingsView(config feishuFeedbackConfig) *FeishuFeedbackSettingsView {
	return &FeishuFeedbackSettingsView{
		Enabled: config.Enabled, AppID: config.AppID, BaseURL: config.BaseURL, AdminChatID: config.AdminChatID,
		Timezone: config.Timezone, DigestHour: config.DigestHour, DigestMinute: config.DigestMinute,
		AppSecretSet: config.AppSecret != "", VerificationSet: config.VerificationToken != "", EncryptKeySet: config.EncryptKey != "",
	}
}

func (s *Service) SaveFeishuFeedbackSettings(actor *model.User, input FeishuFeedbackSettingsInput) (*FeishuFeedbackSettingsView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	current, err := s.readFeishuFeedbackConfig()
	if err != nil {
		return nil, err
	}
	next := current
	next.Enabled = input.Enabled
	if strings.TrimSpace(input.AppID) != "" || current.AppID == "" {
		next.AppID = strings.TrimSpace(input.AppID)
	}
	if strings.TrimSpace(input.BaseURL) != "" || current.BaseURL != "" {
		next.BaseURL = strings.TrimRight(strings.TrimSpace(input.BaseURL), "/")
	}
	if strings.TrimSpace(input.AdminChatID) != "" || current.AdminChatID == "" {
		next.AdminChatID = strings.TrimSpace(input.AdminChatID)
	}
	if strings.TrimSpace(input.Timezone) != "" {
		next.Timezone = strings.TrimSpace(input.Timezone)
	}
	if input.DigestHour != nil {
		next.DigestHour = *input.DigestHour
	}
	if input.DigestMinute != nil {
		next.DigestMinute = *input.DigestMinute
	}
	if input.ClearSecrets {
		next.AppSecret, next.VerificationToken, next.EncryptKey = "", "", ""
	}
	if strings.TrimSpace(input.AppSecret) != "" {
		next.AppSecret = strings.TrimSpace(input.AppSecret)
	}
	if strings.TrimSpace(input.VerificationToken) != "" {
		next.VerificationToken = strings.TrimSpace(input.VerificationToken)
	}
	if strings.TrimSpace(input.EncryptKey) != "" {
		next.EncryptKey = strings.TrimSpace(input.EncryptKey)
	}
	normalizeFeishuFeedbackConfig(&next)
	if err := validateFeishuFeedbackConfig(next); err != nil {
		return nil, err
	}
	stored := next
	if stored.AppSecret, err = s.encryptSettingSecret(stored.AppSecret); err != nil {
		return nil, err
	}
	if stored.VerificationToken, err = s.encryptSettingSecret(stored.VerificationToken); err != nil {
		return nil, err
	}
	if stored.EncryptKey, err = s.encryptSettingSecret(stored.EncryptKey); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: feishuFeedbackSettingKey, ValueJSON: string(raw), UpdatedBy: actor.ID}); err != nil {
		return nil, err
	}
	return feishuFeedbackSettingsView(next), nil
}

func validateFeishuFeedbackConfig(config feishuFeedbackConfig) error {
	if config.BaseURL != "" {
		parsed, err := url.Parse(config.BaseURL)
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" {
			return kernel.BadAuthRequest("飞书 API 地址必须使用 HTTPS")
		}
		host := strings.ToLower(parsed.Hostname())
		if host != "open.feishu.cn" && host != "open.larksuite.com" {
			return kernel.BadAuthRequest("飞书 API 地址必须是官方域名")
		}
	}
	if _, err := time.LoadLocation(config.Timezone); err != nil {
		return kernel.BadAuthRequest("飞书日报时区无效")
	}
	if config.DigestHour < 0 || config.DigestHour > 23 || config.DigestMinute < 0 || config.DigestMinute > 59 {
		return kernel.BadAuthRequest("飞书日报时间无效")
	}
	if !config.Enabled {
		return nil
	}
	missing := make([]string, 0, 4)
	if config.AppID == "" {
		missing = append(missing, "App ID")
	}
	if config.AppSecret == "" {
		missing = append(missing, "App Secret")
	}
	if config.VerificationToken == "" {
		missing = append(missing, "Verification Token")
	}
	if config.AdminChatID == "" {
		missing = append(missing, "管理员群 ID")
	}
	if len(missing) > 0 {
		return kernel.BadAuthRequest("飞书反馈已启用，但缺少：" + strings.Join(missing, "、"))
	}
	return nil
}

// HandleFeishuCallback verifies the callback and stores one normalized
// feedback record. It does not perform network calls, so Feishu receives a
// quick acknowledgement and the digest worker owns all outbound delivery.
func (s *Service) HandleFeishuCallback(body []byte, headers http.Header) (challenge string, feedback *model.UserFeedback, duplicate bool, err error) {
	config, err := s.readFeishuFeedbackConfig()
	if err != nil {
		return "", nil, false, err
	}
	if !config.Enabled {
		return "", nil, false, kernel.Forbidden("飞书反馈接入尚未启用")
	}
	result, err := feishuintegration.ParseCallback(body, headers, feishuintegration.Config{VerificationToken: config.VerificationToken, EncryptKey: config.EncryptKey})
	if err != nil {
		return "", nil, false, kernel.NewAppError(http.StatusUnauthorized, err.Error())
	}
	if result.Challenge != "" {
		return result.Challenge, nil, false, nil
	}
	if result.Feedback == nil {
		return "", nil, false, nil
	}
	incoming := result.Feedback
	identity := incoming.TenantKey + "\x00" + incoming.EventID
	digest := sha256.Sum256([]byte(identity))
	feedbackID := "fb_feishu_" + hex.EncodeToString(digest[:])
	userID := repository.FeishuFeedbackUserPrefix + hex.EncodeToString(digest[:8])
	createdAt := time.Now().UTC()
	if incoming.CreatedAtUnix > 0 {
		candidate := time.Unix(incoming.CreatedAtUnix, 0).UTC()
		if candidate.Year() >= 2000 && candidate.Before(time.Now().UTC().Add(24*time.Hour)) {
			createdAt = candidate
		}
	}
	content := strings.TrimSpace(incoming.Text)
	environment, _ := json.Marshal(map[string]string{
		"source": "feishu", "eventId": incoming.EventID, "tenantKey": incoming.TenantKey,
		"messageId": incoming.MessageID, "chatId": incoming.ChatID, "senderOpenId": incoming.SenderOpenID,
	})
	feedback = &model.UserFeedback{
		ID: feedbackID, UserID: userID, UserName: firstNonEmptyString(incoming.SenderName, incoming.SenderOpenID),
		Contact: incoming.SenderOpenID, Type: mapFeishuFeedbackType(incoming.FeedbackType), Title: feedbackTitle(content),
		Content: content, Attachments: "[]", Environment: string(environment), Status: model.FeedbackStatusPending,
		CreatedAt: createdAt, UpdatedAt: time.Now().UTC(),
	}
	created, existing, err := s.repo.CreateOrGetFeishuFeedback(feedback)
	if err != nil {
		return "", nil, false, fmt.Errorf("保存飞书反馈失败：%w", err)
	}
	if !created {
		return "", existing, true, nil
	}
	return "", feedback, false, nil
}

func mapFeishuFeedbackType(value string) model.FeedbackType {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "bug":
		return model.FeedbackTypeBug
	case "feature":
		return model.FeedbackTypeFeature
	default:
		return model.FeedbackTypeOther
	}
}

func feedbackTitle(content string) string {
	line := strings.TrimSpace(strings.SplitN(strings.ReplaceAll(content, "\r\n", "\n"), "\n", 2)[0])
	if line == "" {
		line = "飞书反馈"
	}
	if utf8.RuneCountInString(line) > feishuFeedbackMaxTitleRunes {
		line = string([]rune(line)[:feishuFeedbackMaxTitleRunes-1]) + "…"
	}
	return line
}

func (s *Service) startFeishuFeedbackWorker() {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(feishuFeedbackScanEvery)
		defer ticker.Stop()
		for {
			s.runFeishuFeedbackDigest(ctx, time.Now())
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}

func (s *Service) runFeishuFeedbackDigest(ctx context.Context, now time.Time) {
	config, err := s.readFeishuFeedbackConfig()
	if err != nil || !config.Enabled || config.AdminChatID == "" {
		return
	}
	// Invalid persisted settings must not be recorded as an uncertain network
	// delivery. The administrator can correct them and run the digest manually.
	if err := validateFeishuFeedbackConfig(config); err != nil {
		return
	}
	location, err := time.LoadLocation(config.Timezone)
	if err != nil {
		return
	}
	local := now.In(location)
	if local.Hour()*60+local.Minute() < config.DigestHour*60+config.DigestMinute {
		return
	}
	date := local.Format("2006-01-02")
	if s.coordinator == nil {
		return
	}
	release, acquired, err := s.coordinator.Acquire(ctx, "feishu-feedback-digest:"+date, 1, feishuFeedbackDigestLockTTL)
	if err != nil || !acquired {
		return
	}
	defer release()
	state, err := s.readFeishuDigestState()
	if err != nil || state.Date == date && state.Status != "" {
		return
	}
	dayStart, dayEnd := localDayWindow(local)
	rows, err := s.repo.ListFeishuFeedbacksBetween(dayStart, dayEnd)
	if err != nil {
		slog.Warn("飞书反馈日报读取失败", "error", err)
		return
	}
	state = feishuDigestState{Date: date, Status: "running", Count: len(rows), AttemptedAt: time.Now().UTC()}
	if err := s.saveFeishuDigestState(state); err != nil {
		return
	}
	client := feishuintegration.NewClient(feishuintegration.Config{AppID: config.AppID, AppSecret: config.AppSecret, BaseURL: config.BaseURL}, nil)
	err = client.SendText(ctx, config.AdminChatID, formatFeishuDigest(date, rows))
	state.Status = "sent"
	if err != nil {
		state.Status = "uncertain"
		state.Error = clipText(err.Error(), feishuFeedbackMaxErrorRunes)
		slog.Warn("飞书反馈日报发送失败，今日不自动重试", "date", date, "error", err)
	} else {
		sentAt := time.Now().UTC()
		state.SentAt = &sentAt
	}
	if saveErr := s.saveFeishuDigestState(state); saveErr != nil {
		slog.Warn("飞书反馈日报状态保存失败", "date", date, "error", saveErr)
	}
}

func localStart(value time.Time) time.Time {
	local := value
	return time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, local.Location())
}

func localDayWindow(value time.Time) (start, end time.Time) {
	start = localStart(value)
	// AddDate preserves the next civil midnight across 23/25-hour DST days;
	// adding a fixed 24-hour duration would shift the query boundary.
	return start, start.AddDate(0, 0, 1)
}

func (s *Service) readFeishuDigestState() (feishuDigestState, error) {
	row, err := s.repo.SystemSettingOptional(feishuFeedbackDigestStateKey)
	if err != nil || row == nil || strings.TrimSpace(row.ValueJSON) == "" {
		return feishuDigestState{}, err
	}
	var state feishuDigestState
	if err := json.Unmarshal([]byte(row.ValueJSON), &state); err != nil {
		return feishuDigestState{}, err
	}
	return state, nil
}

func (s *Service) saveFeishuDigestState(state feishuDigestState) error {
	raw, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return s.repo.SaveSystemSetting(&model.SystemSetting{Key: feishuFeedbackDigestStateKey, ValueJSON: string(raw)})
}

func formatFeishuDigest(date string, rows []model.UserFeedback) string {
	var builder strings.Builder
	fmt.Fprintf(&builder, "【飞书需求/问题日报】%s\n新增 %d 条\n", date, len(rows))
	if len(rows) == 0 {
		builder.WriteString("今日暂无新增反馈。")
		return builder.String()
	}
	for _, category := range []model.FeedbackType{model.FeedbackTypeBug, model.FeedbackTypeFeature, model.FeedbackTypeImprovement, model.FeedbackTypeOther} {
		count := 0
		for _, row := range rows {
			if row.Type == category {
				count++
			}
		}
		if count == 0 {
			continue
		}
		fmt.Fprintf(&builder, "\n%s（%d）\n", feedbackTypeLabel(category), count)
		for _, row := range rows {
			if row.Type != category {
				continue
			}
			fmt.Fprintf(&builder, "- %s · %s\n  %s\n", feedbackTitle(row.Title), firstNonEmptyString(row.UserName, row.Contact, "匿名"), clipText(strings.ReplaceAll(row.Content, "\n", " "), 500))
			if builder.Len() > feishuFeedbackMaxDigestRunes {
				builder.WriteString("\n（日报内容已截断，请在管理后台查看完整反馈。）")
				return builder.String()
			}
		}
	}
	return builder.String()
}

func feedbackTypeLabel(value model.FeedbackType) string {
	switch value {
	case model.FeedbackTypeBug:
		return "问题 / Bug"
	case model.FeedbackTypeFeature:
		return "需求"
	case model.FeedbackTypeImprovement:
		return "优化建议"
	default:
		return "其他"
	}
}

// RunFeishuFeedbackDigestNow is an explicit administrator action for the first
// rollout and for recovering a known HTTP failure. It uses the same persisted
// state and therefore cannot accidentally send a second digest for a date that
// was already marked sent or uncertain.
func (s *Service) RunFeishuFeedbackDigestNow(ctx context.Context, actor *model.User) (*FeishuDigestStateView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	config, err := s.readFeishuFeedbackConfig()
	if err != nil {
		return nil, err
	}
	if !config.Enabled {
		return nil, kernel.Forbidden("飞书反馈接入尚未启用")
	}
	if err := validateFeishuFeedbackConfig(config); err != nil {
		return nil, err
	}
	location, err := time.LoadLocation(config.Timezone)
	if err != nil {
		return nil, kernel.BadAuthRequest("飞书日报时区无效")
	}
	now := time.Now().In(location)
	date := now.Format("2006-01-02")
	if s.coordinator == nil {
		return nil, kernel.NewAppError(http.StatusConflict, "飞书日报协调器尚未启动")
	}
	release, acquired, err := s.coordinator.Acquire(ctx, "feishu-feedback-digest:"+date, 1, feishuFeedbackDigestLockTTL)
	if err != nil {
		return nil, err
	}
	if !acquired {
		return nil, kernel.NewAppError(http.StatusConflict, "飞书日报正在发送，请稍后查看")
	}
	defer release()
	state, err := s.readFeishuDigestState()
	if err != nil {
		return nil, err
	}
	if state.Date == date && state.Status == "sent" {
		return feishuDigestStateView(state), nil
	}
	dayStart, dayEnd := localDayWindow(now)
	rows, err := s.repo.ListFeishuFeedbacksBetween(dayStart, dayEnd)
	if err != nil {
		return nil, err
	}
	state = feishuDigestState{Date: date, Status: "running", Count: len(rows), AttemptedAt: time.Now().UTC()}
	if err := s.saveFeishuDigestState(state); err != nil {
		return nil, err
	}
	client := feishuintegration.NewClient(feishuintegration.Config{AppID: config.AppID, AppSecret: config.AppSecret, BaseURL: config.BaseURL}, nil)
	if err := client.SendText(ctx, config.AdminChatID, formatFeishuDigest(date, rows)); err != nil {
		state.Status, state.Error = "uncertain", clipText(err.Error(), feishuFeedbackMaxErrorRunes)
	} else {
		state.Status = "sent"
		sentAt := time.Now().UTC()
		state.SentAt = &sentAt
	}
	if err := s.saveFeishuDigestState(state); err != nil {
		return nil, err
	}
	return feishuDigestStateView(state), nil
}

func feishuDigestStateView(state feishuDigestState) *FeishuDigestStateView {
	return &FeishuDigestStateView{Date: state.Date, Status: state.Status, Count: state.Count, AttemptedAt: state.AttemptedAt, SentAt: state.SentAt, Error: state.Error}
}

package sms

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"time"

	sender "github.com/casdoor/go-sms-sender"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"
	"infinite-canvas/backend/internal/repository"
)

const Aliyun = "aliyun"
const Tencent = "tencent"
const PluginAliyun = "official-sms-aliyun"
const PluginTencent = "official-sms-tencent"

type Host interface {
	RequireAdmin(*model.User) error
	EncryptSecret(string) (string, error)
	DecryptSecret(string) (string, error)
	SettingsEncryptionKey() ([]byte, error)
}
type Template struct {
	Purpose    string `json:"purpose"`
	TemplateID string `json:"templateId"`
	// Aliyun: named keys; Tencent: ordered keys "0", "1", ... .
	Parameters []Parameter `json:"parameters"`
}
type Parameter struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}
type ChannelRequest struct {
	Name       string     `json:"name"`
	Provider   string     `json:"provider"`
	Enabled    bool       `json:"enabled"`
	Priority   int        `json:"priority"`
	DailyLimit int        `json:"dailyLimit"`
	SignName   string     `json:"signName"`
	AppID      string     `json:"appId"`
	AccessID   string     `json:"accessId"`
	AccessKey  string     `json:"accessKey"`
	Templates  []Template `json:"templates"`
	Version    int        `json:"version"`
}
type ChannelView struct {
	model.SMSChannel
	Templates      []Template `json:"templates"`
	HasCredentials bool       `json:"hasCredentials"`
	PluginEnabled  bool       `json:"pluginEnabled"`
}
type RecordPage struct {
	Items []model.SMSRecord `json:"items"`
	Total int64             `json:"total"`
}
type credentials struct {
	ID  string `json:"id"`
	Key string `json:"key"`
}
type SendFunc func(context.Context, model.SMSChannel, Template, string, string, string, string) (sender.SendResult, error)
type Service struct {
	repo          *repository.Repository
	host          Host
	pluginEnabled func(string) (bool, error)
	send          SendFunc
}

func New(repo *repository.Repository, host Host, pluginEnabled func(string) (bool, error)) *Service {
	return &Service{repo: repo, host: host, pluginEnabled: pluginEnabled, send: sendAggregate}
}
func PluginID(provider string) string {
	if provider == Aliyun {
		return PluginAliyun
	}
	if provider == Tencent {
		return PluginTencent
	}
	return ""
}

var phonePattern = regexp.MustCompile(`^1[3-9][0-9]{9}$`)
var paramPattern = regexp.MustCompile(`^[a-zA-Z0-9_]{1,40}$`)
var safeCode = regexp.MustCompile(`^[a-zA-Z0-9_.:-]{1,160}$`)

func NormalizePhone(value string) (string, error) {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "+86")
	if !phonePattern.MatchString(value) {
		return "", kernel.BadAuthRequest("请输入中国大陆手机号（支持 +86）")
	}
	return "+86" + value, nil
}
func (s *Service) ready(provider string) (bool, error) {
	if PluginID(provider) == "" || s.pluginEnabled == nil {
		return false, nil
	}
	return s.pluginEnabled(PluginID(provider))
}
func templates(row model.SMSChannel) ([]Template, error) {
	var result []Template
	err := json.Unmarshal([]byte(row.TemplatesJSON), &result)
	return result, err
}
func (s *Service) Channels(actor *model.User) ([]ChannelView, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	rows, err := s.repo.SMSChannels()
	if err != nil {
		return nil, err
	}
	result := make([]ChannelView, 0, len(rows))
	for _, row := range rows {
		t, err := templates(row)
		if err != nil {
			return nil, err
		}
		enabled, err := s.ready(row.Provider)
		if err != nil {
			return nil, err
		}
		result = append(result, ChannelView{SMSChannel: row, Templates: t, HasCredentials: row.Credentials != "", PluginEnabled: enabled})
	}
	return result, nil
}
func (s *Service) SaveChannel(actor *model.User, id string, req ChannelRequest) (*ChannelView, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	req.Name, req.SignName, req.AppID = strings.TrimSpace(req.Name), strings.TrimSpace(req.SignName), strings.TrimSpace(req.AppID)
	if PluginID(req.Provider) == "" || req.Name == "" || len(req.Name) > 240 || req.SignName == "" || len(req.SignName) > 240 || len(req.AppID) > 80 || req.Priority < 0 || req.Priority > 1000 || req.DailyLimit < 1 || req.DailyLimit > 100000 {
		return nil, kernel.BadAuthRequest("请填写有效的渠道名称、供应商、签名、优先级（0–1000）和日限额（1–100000）")
	}
	if req.Provider == Tencent && req.AppID == "" {
		return nil, kernel.BadAuthRequest("腾讯云需要短信 SDK AppID")
	}
	if err := validateTemplates(req.Provider, req.Templates); err != nil {
		return nil, err
	}
	row := &model.SMSChannel{ID: kernel.NewID(), CreatedAt: time.Now(), Version: 1}
	if id != "" {
		var err error
		row, err = s.repo.SMSChannel(id)
		if err != nil {
			return nil, kernel.NotFound("短信渠道不存在")
		}
		if row.Version != req.Version {
			return nil, kernel.NewAppError(409, "渠道已被修改，请刷新后重试")
		}
		if row.Provider != req.Provider {
			return nil, kernel.BadAuthRequest("渠道供应商不能修改，请新建渠道")
		}
	}
	if (req.AccessID == "") != (req.AccessKey == "") {
		return nil, kernel.BadAuthRequest("更换凭据时需同时填写 ID 和密钥")
	}
	if req.AccessID != "" {
		if len(req.AccessID) > 512 || len(req.AccessKey) > 512 {
			return nil, kernel.BadAuthRequest("凭据长度无效")
		}
		encoded, _ := json.Marshal(credentials{ID: req.AccessID, Key: req.AccessKey})
		var err error
		row.Credentials, err = s.host.EncryptSecret(string(encoded))
		if err != nil {
			return nil, err
		}
	}
	if row.Credentials == "" {
		return nil, kernel.BadAuthRequest("请填写短信凭据")
	}
	enabled, err := s.ready(req.Provider)
	if err != nil {
		return nil, err
	}
	if req.Enabled && !enabled {
		return nil, kernel.BadAuthRequest("请先在插件管理启用对应短信插件")
	}
	encoded, _ := json.Marshal(req.Templates)
	row.Name, row.Provider, row.Enabled, row.Priority, row.DailyLimit = req.Name, req.Provider, req.Enabled, req.Priority, req.DailyLimit
	row.SignName, row.AppID, row.TemplatesJSON, row.UpdatedAt = req.SignName, req.AppID, string(encoded), time.Now()
	if err := s.repo.SaveSMSChannel(row, id == ""); err != nil {
		if errors.Is(err, repository.ErrChannelConflict) {
			return nil, kernel.NewAppError(409, "渠道已被修改，请刷新后重试")
		}
		return nil, err
	}
	return &ChannelView{SMSChannel: *row, Templates: req.Templates, HasCredentials: true, PluginEnabled: enabled}, nil
}
func validateTemplates(provider string, values []Template) error {
	if len(values) == 0 || len(values) > 3 {
		return kernel.BadAuthRequest("请配置 1–3 个场景模板")
	}
	seen := map[string]bool{}
	for _, t := range values {
		if (t.Purpose != "login" && t.Purpose != "register" && t.Purpose != "bind") || seen[t.Purpose] || strings.TrimSpace(t.TemplateID) == "" || len(t.TemplateID) > 100 {
			return kernel.BadAuthRequest("模板场景或模板 ID 无效")
		}
		seen[t.Purpose] = true
		keys, hasCode := map[string]bool{}, false
		if len(t.Parameters) == 0 || len(t.Parameters) > 8 {
			return kernel.BadAuthRequest("请配置模板参数")
		}
		for i, p := range t.Parameters {
			if !paramPattern.MatchString(p.Name) || keys[p.Name] || (p.Value != "code" && p.Value != "minutes") || (provider == Tencent && p.Name != strconv.Itoa(i)) {
				return kernel.BadAuthRequest("参数值仅支持 code、minutes；腾讯云参数名必须按 0、1 顺序填写")
			}
			keys[p.Name] = true
			hasCode = hasCode || p.Value == "code"
		}
		if !hasCode {
			return kernel.BadAuthRequest("模板必须包含 code 参数")
		}
	}
	return nil
}
func (s *Service) DeleteChannel(actor *model.User, id string) error {
	if err := s.host.RequireAdmin(actor); err != nil {
		return err
	}
	row, err := s.repo.SMSChannel(id)
	if err != nil {
		return kernel.NotFound("短信渠道不存在")
	}
	if row.Enabled {
		return kernel.BadAuthRequest("请先停用渠道再删除；发送记录将保留")
	}
	return s.repo.DeleteSMSChannel(id)
}
func (s *Service) selectChannel(purpose, id string) (*model.SMSChannel, *Template, error) {
	rows, err := s.repo.SMSChannels()
	if err != nil {
		return nil, nil, err
	}
	for _, row := range rows {
		if !row.Enabled || (id != "" && row.ID != id) {
			continue
		}
		enabled, err := s.ready(row.Provider)
		if err != nil {
			return nil, nil, err
		}
		if !enabled {
			continue
		}
		items, err := templates(row)
		if err != nil {
			return nil, nil, err
		}
		for _, t := range items {
			if t.Purpose == purpose {
				return &row, &t, nil
			}
		}
	}
	return nil, nil, kernel.NewAppError(503, "未配置可用的短信场景渠道")
}
func (s *Service) Available(purpose string) (bool, error) {
	_, _, err := s.selectChannel(purpose, "")
	var appErr *kernel.AppError
	if errors.As(err, &appErr) && appErr.Status == 503 {
		return false, nil
	}
	return err == nil, err
}
func (s *Service) SendCode(ctx context.Context, purpose, phone, code string) error {
	_, err := s.sendCode(ctx, purpose, phone, code, "", false)
	return err
}
func (s *Service) sendCode(ctx context.Context, purpose, phone, code, channelID string, test bool) (*model.SMSRecord, error) {
	phone, err := NormalizePhone(phone)
	if err != nil {
		return nil, err
	}
	row, t, err := s.selectChannel(purpose, channelID)
	if err != nil {
		return nil, err
	}
	raw, err := s.host.DecryptSecret(row.Credentials)
	if err != nil {
		return nil, err
	}
	var creds credentials
	if json.Unmarshal([]byte(raw), &creds) != nil || creds.ID == "" || creds.Key == "" {
		return nil, kernel.NewAppError(503, "短信凭据无效")
	}
	key, err := s.host.SettingsEncryptionKey()
	if err != nil {
		return nil, err
	}
	if len(key) < 16 {
		return nil, kernel.NewAppError(503, "短信加密密钥不可用")
	}
	hash := hmac.New(sha256.New, key)
	hash.Write([]byte(phone))
	target := hex.EncodeToString(hash.Sum(nil))
	now := time.Now()
	day := now.UTC().Format("2006-01-02")
	if err := s.repo.ReserveNotificationLimits([]repository.NotificationLimit{{Key: "sms-channel:" + row.ID + ":" + day, Limit: row.DailyLimit, ExpiresAt: now.Add(48 * time.Hour)}}, now); err != nil {
		if errors.Is(err, repository.ErrNotificationLimit) {
			return nil, kernel.RateLimited("短信渠道当日额度已用尽")
		}
		return nil, err
	}
	// Persist unknown before the network call: a crash can never be called success.
	record := &model.SMSRecord{ID: kernel.NewID(), ChannelID: row.ID, ChannelName: row.Name, Provider: row.Provider, Purpose: purpose, MaskedPhone: phone[:6] + "****" + phone[len(phone)-4:], TargetHash: target, State: "unknown", ErrorCode: "acceptance_unknown", CreatedAt: now, UpdatedAt: now}
	if test {
		record.Purpose = "test:" + purpose
	}
	if err := s.repo.Create(record); err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	result, sendErr := s.send(ctx, *row, *t, creds.ID, creds.Key, phone, code)
	record.State, record.RequestID, record.MessageID, record.ErrorCode = result.State, sanitize(result.RequestID), sanitize(result.MessageID), sanitize(result.Code)
	if record.State != "accepted" && record.State != "rejected" {
		record.State = "unknown"
	}
	record.DurationMS, record.UpdatedAt = time.Since(now).Milliseconds(), time.Now()
	if err := s.repo.Save(record); err != nil {
		return nil, kernel.NewAppError(503, "短信发送结果未能保存，请勿立即重复发送")
	}
	if sendErr != nil || record.State != "accepted" {
		if record.State == "unknown" {
			return record, kernel.NewAppError(503, "短信受理结果未知，请稍后再试；系统不会自动重发")
		}
		return record, kernel.NewAppError(503, "短信服务商拒绝发送，请联系管理员检查发送记录")
	}
	return record, nil
}
func sanitize(value string) string {
	if safeCode.MatchString(value) {
		return value
	}
	return ""
}
func sendAggregate(ctx context.Context, channel model.SMSChannel, t Template, id, key, phone, code string) (sender.SendResult, error) {
	provider := sender.Aliyun
	if channel.Provider == Tencent {
		provider = sender.TencentCloud
	}
	client, err := sender.NewSmsClient(provider, id, key, channel.SignName, t.TemplateID, channel.AppID)
	if err != nil {
		return sender.SendResult{State: "rejected", Code: "invalid_configuration"}, errors.New("sms configuration invalid")
	}
	params := map[string]string{}
	for _, p := range t.Parameters {
		if p.Value == "code" {
			params[p.Name] = code
		} else {
			params[p.Name] = "10"
		}
	}
	if channel.Provider == Aliyun {
		phone = strings.TrimPrefix(phone, "+86")
	}
	return sender.SendMessageContext(ctx, client, outbound.OutboundHTTPClient(10*time.Second).Transport, params, phone)
}
func (s *Service) Records(actor *model.User, channel, state string, page, size int) (*RecordPage, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if page < 1 || page > 100000 || size < 1 || size > 100 || (state != "" && state != "accepted" && state != "rejected" && state != "unknown") {
		return nil, kernel.BadAuthRequest("分页或状态无效")
	}
	rows, count, err := s.repo.SMSRecords(channel, state, page, size)
	return &RecordPage{Items: rows, Total: count}, err
}
func (s *Service) Test(actor *model.User, ctx context.Context, id, purpose, phone, code string) (*model.SMSRecord, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.sendCode(ctx, purpose, phone, code, id, true)
}

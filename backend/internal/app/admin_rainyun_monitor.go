package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
	"yingce/backend/internal/platform"
	"yingce/backend/internal/storage"
)

const (
	rainyunMonitorSettingKey     = "rainyun_monitor"
	rainyunMonitorTimeout        = 2 * time.Second
	rainyunMonitorRequestTimeout = 1500 * time.Millisecond
	rainyunMonitorBodyLimit      = 256 << 10
)

type RainyunMonitorSettingRequest struct {
	Enabled    bool   `json:"enabled"`
	InstanceID int64  `json:"instanceId"`
	APIKey     string `json:"apiKey"`
}

type AdminRainyunMonitorSetting struct {
	Enabled    bool  `json:"enabled"`
	InstanceID int64 `json:"instanceId"`
	HasAPIKey  bool  `json:"hasApiKey"`
}

type rainyunMonitorSettingValue struct {
	Enabled    bool   `json:"enabled"`
	InstanceID int64  `json:"instanceId"`
	APIKey     string `json:"apiKey"`
}

type SystemPerformanceRainyun struct {
	Enabled           bool       `json:"enabled"`
	Configured        bool       `json:"configured"`
	Status            string     `json:"status"`
	StatusMessage     string     `json:"statusMessage"`
	CheckedAt         *time.Time `json:"checkedAt,omitempty"`
	LatencyMs         *int64     `json:"latencyMs,omitempty"`
	InstanceID        int64      `json:"instanceId,omitempty"`
	PlanName          string     `json:"planName,omitempty"`
	CloudStatus       string     `json:"cloudStatus,omitempty"`
	ExpiresAt         *time.Time `json:"expiresAt,omitempty"`
	PeriodStart       *time.Time `json:"periodStart,omitempty"`
	PeriodEnd         *time.Time `json:"periodEnd,omitempty"`
	ExtraAccounting   *bool      `json:"extraAccounting,omitempty"`
	StorageUsedBytes  *int64     `json:"storageUsedBytes,omitempty"`
	StorageQuotaBytes *int64     `json:"storageQuotaBytes,omitempty"`
	TrafficUsedBytes  *int64     `json:"trafficUsedBytes,omitempty"`
	TrafficQuotaBytes *int64     `json:"trafficQuotaBytes,omitempty"`
	StatisticsMessage string     `json:"statisticsMessage,omitempty"`
	SourceStatus      string     `json:"sourceStatus"`
	SourceMessage     string     `json:"sourceMessage"`
	SourceLatencyMs   *int64     `json:"sourceLatencyMs,omitempty"`
}

func (s *Service) readRainyunMonitorSetting(ctx context.Context) (*model.SystemSetting, rainyunMonitorSettingValue, error) {
	record, err := s.repo.WithContext(ctx).SystemSettingOptional(rainyunMonitorSettingKey)
	if err != nil {
		return nil, rainyunMonitorSettingValue{}, errors.New("雨云监控配置读取失败")
	}
	var value rainyunMonitorSettingValue
	if record != nil && json.Unmarshal([]byte(record.ValueJSON), &value) != nil {
		return nil, value, errors.New("雨云监控配置格式无效")
	}
	return record, value, nil
}

func rainyunMonitorSettingView(value rainyunMonitorSettingValue) *AdminRainyunMonitorSetting {
	return &AdminRainyunMonitorSetting{Enabled: value.Enabled, InstanceID: value.InstanceID, HasAPIKey: value.APIKey != ""}
}

func (s *Service) AdminRainyunMonitorSetting(ctx context.Context, actor *model.User) (*AdminRainyunMonitorSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	_, value, err := s.readRainyunMonitorSetting(ctx)
	if err != nil {
		return nil, err
	}
	return rainyunMonitorSettingView(value), nil
}

func validRainyunMonitorAPIKey(value string) bool {
	if len(value) > 4096 {
		return false
	}
	for i := 0; i < len(value); i++ {
		if value[i] <= 32 || value[i] > 126 {
			return false
		}
	}
	return true
}

func (s *Service) rainyunMonitorSecret(ciphertext string) (string, error) {
	// 监控读取绝不创建密钥文件或惰性迁移；缺失本机加密密钥只能由管理员重新保存修复。
	key, err := os.ReadFile(filepath.Join(s.dataDir, ".settings-key"))
	if err != nil || len(key) != 32 || !strings.HasPrefix(ciphertext, encryptedSettingPrefix) {
		return "", errors.New("雨云管理密钥不可用，请重新保存监控配置")
	}
	plain, err := s.decryptSettingSecret(ciphertext)
	if err != nil || plain == "" || !validRainyunMonitorAPIKey(plain) {
		return "", errors.New("雨云管理密钥不可用，请重新保存监控配置")
	}
	return plain, nil
}

func (s *Service) UpdateRainyunMonitorSetting(ctx context.Context, actor *model.User, request RainyunMonitorSettingRequest) (*AdminRainyunMonitorSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if request.InstanceID < 0 || !validRainyunMonitorAPIKey(request.APIKey) {
		return nil, BadAuthRequest("雨云实例 ID 或管理 API Key 无效，密钥仅支持不含空白的可见 ASCII 字符且不能超过 4096 字节")
	}
	s.rainyunMonitorSettingsMu.Lock()
	defer s.rainyunMonitorSettingsMu.Unlock()
	record, current, err := s.readRainyunMonitorSetting(ctx)
	if err != nil {
		return nil, err
	}
	next := rainyunMonitorSettingValue{Enabled: request.Enabled, InstanceID: request.InstanceID, APIKey: current.APIKey}
	if request.Enabled && (request.InstanceID <= 0 || request.APIKey == "" && current.APIKey == "") {
		return nil, BadAuthRequest("启用雨云监控需要正整数实例 ID 和管理 API Key")
	}
	if request.Enabled && request.APIKey == "" {
		if _, err := s.rainyunMonitorSecret(current.APIKey); err != nil {
			return nil, BadAuthRequest("原雨云管理密钥不可用，请填写新密钥")
		}
	}
	if request.APIKey != "" {
		next.APIKey, err = s.encryptSettingSecret(request.APIKey)
		if err != nil {
			return nil, errors.New("雨云管理密钥加密失败")
		}
	}
	encoded, err := json.Marshal(next)
	if err != nil {
		return nil, errors.New("雨云监控配置编码失败")
	}
	setting := model.SystemSetting{Key: rainyunMonitorSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if record != nil {
		setting.CreatedAt = record.CreatedAt
	}
	if err := s.repo.WithContext(ctx).SaveSystemSetting(&setting); err != nil {
		return nil, errors.New("雨云监控配置保存失败")
	}
	s.initRainyunMonitorCache()
	s.rainyunMonitorCache.Clear()
	return rainyunMonitorSettingView(next), nil
}

func (s *Service) initRainyunMonitorCache() {
	s.rainyunMonitorOnce.Do(func() {
		s.rainyunMonitorCache = platform.NewBoundedReadCache[[32]byte, SystemPerformanceRainyun](2, 16<<10, 2, time.Minute)
	})
}

func rainyunMonitorBase(value rainyunMonitorSettingValue) SystemPerformanceRainyun {
	result := SystemPerformanceRainyun{
		Enabled: value.Enabled, Configured: value.InstanceID > 0 && value.APIKey != "", InstanceID: value.InstanceID,
		Status: "disabled", StatusMessage: "雨云监控未启用", SourceStatus: "disabled", SourceMessage: "监控未启用，未探测源站",
	}
	if value.Enabled {
		result.Status, result.StatusMessage = "unconfigured", "雨云管理凭据或实例 ID 未配置完整"
		result.SourceStatus, result.SourceMessage = "unknown", "尚未采集源站状态"
	}
	return result
}

func (s *Service) collectRainyunPerformance(ctx context.Context) SystemPerformanceRainyun {
	ctx, cancel := context.WithTimeout(ctx, rainyunMonitorTimeout)
	defer cancel()
	_, value, err := s.readRainyunMonitorSetting(ctx)
	result := rainyunMonitorBase(value)
	if err != nil {
		result.Status, result.StatusMessage = "unknown", "雨云监控配置读取失败，未进行采集"
		result.SourceStatus, result.SourceMessage = "unknown", "监控配置不可用，未探测源站"
		return result
	}
	if !value.Enabled || !result.Configured {
		return result
	}
	// 不使用 readOSSSetting，避免监控 GET 触发平台存储的旧密钥迁移。
	record, err := s.repo.WithContext(ctx).SystemSettingOptional(ossSettingKey)
	if err != nil {
		result.Status, result.StatusMessage = "unknown", "平台存储配置读取失败，未进行采集"
		result.SourceStatus, result.SourceMessage = "unknown", "平台存储配置不可用，未探测源站"
		return result
	}
	var setting ossSettingValue
	storageJSON := ""
	if record != nil {
		storageJSON = record.ValueJSON
		if json.Unmarshal([]byte(storageJSON), &setting) != nil {
			result.Status, result.StatusMessage = "unknown", "平台存储配置格式无效，未进行采集"
			result.SourceStatus, result.SourceMessage = "unknown", "平台存储配置不可用，未探测源站"
			return result
		}
	}
	setting = storage.NormalizeSettings(setting)
	if !setting.Enabled || setting.Provider != rainyunOSSProvider {
		result.Status, result.StatusMessage = "unknown", "当前平台未启用雨云 OSS，未进行采集"
		result.SourceStatus, result.SourceMessage = "disabled", "当前平台未使用雨云源站"
		return result
	}
	encoded, _ := json.Marshal(value)
	key := sha256.Sum256(append(append(encoded, 0), []byte(storageJSON)...))
	s.initRainyunMonitorCache()
	cached, err := s.rainyunMonitorCache.Get(ctx, key, func(ctx context.Context) (SystemPerformanceRainyun, int, error) {
		collected := s.loadRainyunPerformance(ctx, value, setting)
		if err := ctx.Err(); err != nil {
			// 调用方取消或总预算耗尽不能作为 60 秒失败快照；缓存层会丢弃 context 错误。
			return collected, 0, err
		}
		// 外部服务明确失败也是可展示快照，缓存 60 秒，避免轮询持续冲击失效接口。
		return collected, 4096, nil
	})
	if err != nil {
		result.Status, result.StatusMessage = "unknown", "雨云状态采集繁忙或已取消，请稍后刷新"
		return result
	}
	return cached
}

func (s *Service) loadRainyunPerformance(ctx context.Context, value rainyunMonitorSettingValue, setting ossSettingValue) SystemPerformanceRainyun {
	result := rainyunMonitorBase(value)
	now := time.Now().UTC()
	result.CheckedAt = &now
	sourceResult := make(chan SystemPerformanceRainyun, 1)
	go func() { sourceResult <- s.collectRainyunSource(ctx, setting) }()
	secret, err := s.rainyunMonitorSecret(value.APIKey)
	if err != nil {
		result.Configured = false
		result.Status, result.StatusMessage = "unconfigured", "雨云管理密钥不可用，请重新保存监控配置"
	} else {
		s.collectRainyunInstance(ctx, value.InstanceID, secret, &result)
	}
	// 受控 HEAD 自带独立短预算；等待实际退出，不把超时 goroutine 留到后台。
	source := <-sourceResult
	result.SourceStatus, result.SourceMessage, result.SourceLatencyMs = source.SourceStatus, source.SourceMessage, source.SourceLatencyMs
	return result
}

func (s *Service) collectRainyunInstance(ctx context.Context, instanceID int64, secret string, result *SystemPerformanceRainyun) {
	ctx, cancel := context.WithTimeout(ctx, rainyunMonitorRequestTimeout)
	defer cancel()
	started := time.Now()
	defer func() { elapsed := time.Since(started).Milliseconds(); result.LatencyMs = &elapsed }()
	result.Status, result.StatusMessage = "error", "雨云管理只读查询失败，请检查网络或监控凭据"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("https://api.v2.rainyun.com/product/ros/instance/%d/", instanceID), nil)
	if err != nil {
		return
	}
	req.Header.Set("X-Api-Key", secret)
	req.Header.Set("Accept", "application/json")
	outbound.ApplyDefaultOutboundHeaders(req)
	client := outbound.OutboundHTTPClient(rainyunMonitorRequestTimeout)
	if s.rainyunMonitorTransport != nil {
		client.Transport = s.rainyunMonitorTransport
	}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			result.Status, result.StatusMessage = "unknown", "雨云管理只读查询超时或已取消，暂不能判断状态"
		}
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		result.StatusMessage = "雨云管理 API Key 无效或没有实例读取权限"
		return
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		result.StatusMessage = "雨云管理接口暂不可用或拒绝了请求，未跟随重定向"
		return
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, rainyunMonitorBodyLimit+1))
	if err != nil || len(body) > rainyunMonitorBodyLimit {
		result.StatusMessage = "雨云管理响应读取失败或超出限制"
		return
	}
	if err := parseRainyunInstance(body, time.Now(), result); err != nil {
		result.StatusMessage = "雨云管理响应格式或业务状态无效"
	}
}

func (s *Service) collectRainyunSource(ctx context.Context, setting ossSettingValue) SystemPerformanceRainyun {
	result := SystemPerformanceRainyun{SourceStatus: "unconfigured", SourceMessage: "雨云源站 Endpoint、Bucket 或访问凭据不完整"}
	if setting.Endpoint == "" || setting.Bucket == "" || setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return result
	}
	secret := setting.AccessKeySecret
	var err error
	if strings.HasPrefix(secret, encryptedSettingPrefix) {
		secret, err = s.rainyunMonitorSecret(secret)
	}
	if err != nil || secret == "" {
		result.SourceMessage = "雨云源站凭据不可用，未进行探测"
		return result
	}
	setting.AccessKeySecret = secret
	if setting.SessionToken != "" && strings.HasPrefix(setting.SessionToken, encryptedSettingPrefix) {
		// 非加密存量 SessionToken 直接使用，不读取密钥文件，保证采集路径只读语义。
		setting.SessionToken, err = s.rainyunMonitorSecret(setting.SessionToken)
		if err != nil {
			result.SourceMessage = "雨云源站临时凭据不可用，未进行探测"
			return result
		}
	}
	ctx, cancel := context.WithTimeout(ctx, rainyunMonitorRequestTimeout)
	defer cancel()
	probe := storage.HeadRainyunBucketContext
	if s.rainyunMonitorHead != nil {
		probe = s.rainyunMonitorHead
	}
	started := time.Now()
	status, err := probe(ctx, setting)
	elapsed := time.Since(started).Milliseconds()
	result.SourceLatencyMs = &elapsed
	result.SourceStatus, result.SourceMessage = "error", "雨云源站只读 HEAD 未成功，请检查网络和存储配置"
	if err != nil {
		if ctx.Err() != nil {
			result.SourceStatus, result.SourceMessage = "unknown", "雨云源站 HEAD 超时或已取消，暂不能判断健康状态"
		}
		return result
	}
	switch {
	case status >= 200 && status < 300:
		result.SourceStatus, result.SourceMessage = "healthy", "雨云源站桶 HEAD 可达；未测试上传、下载或删除"
	case status == http.StatusUnauthorized || status == http.StatusForbidden:
		result.SourceStatus, result.SourceMessage = "unknown", "源站拒绝桶 HEAD 权限，不能据此判断宕机；未测试对象读写"
	case status == http.StatusNotFound:
		result.SourceMessage = "雨云源站未找到当前配置的桶"
	case status == http.StatusTooManyRequests:
		result.SourceStatus, result.SourceMessage = "unknown", "雨云源站限制了 HEAD 探测频率，暂不能判断健康状态"
	case status >= 300 && status < 400:
		result.SourceMessage = "雨云源站返回重定向，安全策略未继续访问"
	case status >= 500:
		result.SourceMessage = "雨云源站 HEAD 返回服务端错误"
	default:
		result.SourceStatus, result.SourceMessage = "unknown", "雨云源站 HEAD 返回未识别状态，未测试对象读写"
	}
	return result
}

func rainyunPerformanceDegraded(value SystemPerformanceRainyun) bool {
	return value.Enabled && (value.Status == "warning" || value.Status == "error" || value.SourceStatus == "error")
}

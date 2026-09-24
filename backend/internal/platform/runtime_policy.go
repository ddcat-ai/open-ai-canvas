package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"infinite-canvas/backend/internal/kernel"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

const runtimePolicySettingKey = "runtime_policy"

const (
	maxRuntimeUploadMB       int64 = 999
	maxRuntimeStorageGB      int64 = 999
	maxRuntimeDataMB         int64 = 999_999
	maxRuntimeCount          int64 = 999_999_999
	maxRuntimeRate                 = 999_999
	maxRuntimeConcurrency          = 999
	maxRuntimeTimeoutMinutes       = 9_999
)

// 画布 Agent 单步的输出上限与执行时限。上限是"每次模型调用"的边界（思考 + 正文 + 工具参数），
// 时限是"这一次调用最多等多久"的墙钟；两者一起决定单步最坏耗时。0 在两个口径下都是"该边界不生效"：
// 上限为 0 表示不限制输出（只由执行时限兜底），时限为 0 表示沿用文本任务超时。
const (
	MinRuntimeAgentStepOutputTokens     = 256
	MaxRuntimeAgentStepOutputTokens     = 131_072
	DefaultRuntimeAgentStepOutputTokens = 16_384
	MinRuntimeAgentStepTimeoutSeconds   = 30
	MaxRuntimeAgentStepTimeoutSeconds   = 3_600
	DefaultRuntimeAgentStepTimeout      = 0
)

// agentStepMaxOutputTokensDefault 读取部署级覆盖并按同一套范围夹取；环境变量无法表达"不限制"（0），
// 那个档位只在管理端配置里设置。
func agentStepMaxOutputTokensDefault() int {
	value := envInt("CANVAS_AGENT_STEP_MAX_OUTPUT_TOKENS", DefaultRuntimeAgentStepOutputTokens)
	return min(max(value, MinRuntimeAgentStepOutputTokens), MaxRuntimeAgentStepOutputTokens)
}

func agentStepTimeoutSecondsDefault() int {
	value := envInt("CANVAS_AGENT_STEP_TIMEOUT_SECONDS", DefaultRuntimeAgentStepTimeout)
	if value <= 0 {
		return DefaultRuntimeAgentStepTimeout
	}
	return min(max(value, MinRuntimeAgentStepTimeoutSeconds), MaxRuntimeAgentStepTimeoutSeconds)
}

type RuntimeResourcePolicy struct {
	ResourceUploadMB        int64 `json:"resourceUploadMB"`
	GeneratedFileMB         int64 `json:"generatedFileMB"`
	DailyUploadMB           int64 `json:"dailyUploadMB"`
	StoredFileGB            int64 `json:"storedFileGB"`
	StructuredDataMB        int64 `json:"structuredDataMB"`
	TaskDataGB              int64 `json:"taskDataGB"`
	AssetCount              int64 `json:"assetCount"`
	CanvasCount             int64 `json:"canvasCount"`
	TaskCount               int64 `json:"taskCount"`
	APICallLogCount         int64 `json:"apiCallLogCount"`
	RecycleBinRetentionDays int   `json:"recycleBinRetentionDays"`
}

type RuntimeTaskPolicy struct {
	WorkerConcurrency        int `json:"workerConcurrency"`
	ChannelConcurrency       int `json:"channelConcurrency"`
	ActiveTaskLimit          int `json:"activeTaskLimit"`
	ImageTimeoutMinutes      int `json:"imageTimeoutMinutes"`
	TextTimeoutMinutes       int `json:"textTimeoutMinutes"`
	AudioTimeoutMinutes      int `json:"audioTimeoutMinutes"`
	VideoTimeoutMinutes      int `json:"videoTimeoutMinutes"`
	StoryboardTimeoutMinutes int `json:"storyboardTimeoutMinutes"`
	DefaultTimeoutMinutes    int `json:"defaultTimeoutMinutes"`
	// AgentStepMaxOutputTokens 是画布 Agent 单步模型调用的输出上限（思考 + 正文 + 工具调用参数）。
	// 0 表示不限制输出，此时单步最坏耗时只由 AgentStepTimeoutSeconds 兜底。
	AgentStepMaxOutputTokens int `json:"agentStepMaxOutputTokens"`
	// AgentStepTimeoutSeconds 是画布 Agent 单步模型调用的秒级墙钟；0 表示沿用文本任务超时。
	AgentStepTimeoutSeconds int `json:"agentStepTimeoutSeconds"`
}

type RuntimeRequestPolicy struct {
	TaskCreatePerMinute        int   `json:"taskCreatePerMinute"`
	ResourceUploadPerMinute    int   `json:"resourceUploadPerMinute"`
	ResourceImportPerMinute    int   `json:"resourceImportPerMinute"`
	AssetWritePerMinute        int   `json:"assetWritePerMinute"`
	CanvasWritePerMinute       int   `json:"canvasWritePerMinute"`
	RegisterPerHour            int   `json:"registerPerHour"`
	EmailCodePerHour           int   `json:"emailCodePerHour"`
	LoginIPPerTenMinutes       int   `json:"loginIPPerTenMinutes"`
	LoginAccountPerTenMinutes  int   `json:"loginAccountPerTenMinutes"`
	SystemRelayPerMinute       int   `json:"systemRelayPerMinute"`
	CustomRelayPerMinute       int   `json:"customRelayPerMinute"`
	CustomRelayConcurrency     int   `json:"customRelayConcurrency"`
	CustomRelayRequestMB       int64 `json:"customRelayRequestMB"`
	CustomRelayResponseMB      int64 `json:"customRelayResponseMB"`
	CustomRelayTimeoutMinutes  int   `json:"customRelayTimeoutMinutes"`
	SystemRelayRequestMB       int64 `json:"systemRelayRequestMB"`
	SystemRelayResponseMB      int64 `json:"systemRelayResponseMB"`
	ChannelCircuitFailureCount int   `json:"channelCircuitFailureCount"`
	ChannelCircuitOpenSeconds  int   `json:"channelCircuitOpenSeconds"`
}

type RuntimePolicySetting struct {
	Resource RuntimeResourcePolicy `json:"resource"`
	Task     RuntimeTaskPolicy     `json:"task"`
	Request  RuntimeRequestPolicy  `json:"request"`
}

type PublicRuntimePolicySetting struct {
	RuntimePolicySetting
	Configured bool      `json:"configured"`
	UpdatedBy  string    `json:"updatedBy"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

type PublicRuntimeLimits struct {
	ActiveTaskLimit         int   `json:"activeTaskLimit"`
	ResourceUploadMB        int64 `json:"resourceUploadMB"`
	RecycleBinRetentionDays int   `json:"recycleBinRetentionDays"`
}

// DefaultRuntimePolicy returns the effective baseline policy, including
// deployment-level environment overrides. It is exported so composition-root
// compatibility code and domain tests do not need to reach into platform's
// private implementation.
func DefaultRuntimePolicy() RuntimePolicySetting {
	return RuntimePolicySetting{
		Resource: RuntimeResourcePolicy{
			ResourceUploadMB:        50,
			GeneratedFileMB:         64,
			DailyUploadMB:           2048,
			StoredFileGB:            20,
			StructuredDataMB:        256,
			TaskDataGB:              1,
			AssetCount:              2_000,
			CanvasCount:             1_000,
			TaskCount:               20_000,
			APICallLogCount:         100_000,
			RecycleBinRetentionDays: 30,
		},
		Task: RuntimeTaskPolicy{
			WorkerConcurrency:        effectiveChannelConcurrencyLimit(envInt("CANVAS_WORKER_CONCURRENCY", TaskWorkerConcurrency)),
			ChannelConcurrency:       defaultChannelConcurrencyLimit(),
			ActiveTaskLimit:          5,
			ImageTimeoutMinutes:      8,
			TextTimeoutMinutes:       8,
			AudioTimeoutMinutes:      8,
			VideoTimeoutMinutes:      60,
			StoryboardTimeoutMinutes: 20,
			DefaultTimeoutMinutes:    10,
			AgentStepMaxOutputTokens: agentStepMaxOutputTokensDefault(),
			AgentStepTimeoutSeconds:  agentStepTimeoutSecondsDefault(),
		},
		Request: RuntimeRequestPolicy{
			TaskCreatePerMinute:        30,
			ResourceUploadPerMinute:    30,
			ResourceImportPerMinute:    30,
			AssetWritePerMinute:        120,
			CanvasWritePerMinute:       120,
			RegisterPerHour:            30,
			EmailCodePerHour:           60,
			LoginIPPerTenMinutes:       50,
			LoginAccountPerTenMinutes:  10,
			SystemRelayPerMinute:       120,
			CustomRelayPerMinute:       120,
			CustomRelayConcurrency:     4,
			CustomRelayRequestMB:       32,
			CustomRelayResponseMB:      32,
			CustomRelayTimeoutMinutes:  10,
			SystemRelayRequestMB:       64,
			SystemRelayResponseMB:      128,
			ChannelCircuitFailureCount: min(envInt("CANVAS_CHANNEL_CIRCUIT_FAILURES", 5), maxRuntimeConcurrency),
			ChannelCircuitOpenSeconds:  min(envInt("CANVAS_CHANNEL_CIRCUIT_SECONDS", 60), 86_400),
		},
	}
}

func selfUseRuntimePolicy() RuntimePolicySetting {
	value := DefaultRuntimePolicy()
	value.Resource = RuntimeResourcePolicy{
		ResourceUploadMB: maxRuntimeUploadMB, GeneratedFileMB: maxRuntimeUploadMB,
		DailyUploadMB: maxRuntimeDataMB, StoredFileGB: maxRuntimeStorageGB, StructuredDataMB: maxRuntimeDataMB,
		TaskDataGB: maxRuntimeStorageGB, AssetCount: maxRuntimeCount, CanvasCount: maxRuntimeCount,
		TaskCount: maxRuntimeCount, APICallLogCount: maxRuntimeCount,
		RecycleBinRetentionDays: 0,
	}
	value.Task = RuntimeTaskPolicy{
		WorkerConcurrency: maxRuntimeConcurrency, ChannelConcurrency: maxRuntimeConcurrency, ActiveTaskLimit: maxRuntimeConcurrency,
		ImageTimeoutMinutes: maxRuntimeTimeoutMinutes, TextTimeoutMinutes: maxRuntimeTimeoutMinutes,
		AudioTimeoutMinutes: maxRuntimeTimeoutMinutes, VideoTimeoutMinutes: maxRuntimeTimeoutMinutes,
		StoryboardTimeoutMinutes: maxRuntimeTimeoutMinutes, DefaultTimeoutMinutes: maxRuntimeTimeoutMinutes,
		AgentStepMaxOutputTokens: MaxRuntimeAgentStepOutputTokens, AgentStepTimeoutSeconds: MaxRuntimeAgentStepTimeoutSeconds,
	}
	value.Request = RuntimeRequestPolicy{
		TaskCreatePerMinute:     maxRuntimeRate,
		ResourceUploadPerMinute: maxRuntimeRate, ResourceImportPerMinute: maxRuntimeRate,
		AssetWritePerMinute: maxRuntimeRate, CanvasWritePerMinute: maxRuntimeRate,
		RegisterPerHour: maxRuntimeRate, EmailCodePerHour: maxRuntimeRate,
		LoginIPPerTenMinutes: maxRuntimeRate, LoginAccountPerTenMinutes: maxRuntimeRate,
		SystemRelayPerMinute: maxRuntimeRate, CustomRelayPerMinute: maxRuntimeRate,
		CustomRelayConcurrency: maxRuntimeConcurrency, CustomRelayRequestMB: maxRuntimeUploadMB,
		CustomRelayResponseMB: maxRuntimeUploadMB, CustomRelayTimeoutMinutes: maxRuntimeTimeoutMinutes,
		SystemRelayRequestMB: maxRuntimeUploadMB, SystemRelayResponseMB: maxRuntimeUploadMB,
		ChannelCircuitFailureCount: maxRuntimeConcurrency, ChannelCircuitOpenSeconds: 1,
	}
	return value
}

func SelfUseRuntimePolicy() RuntimePolicySetting { return selfUseRuntimePolicy() }

func (s *Service) RuntimePolicy() (RuntimePolicySetting, error) {
	if s.runtimePolicyCache == nil {
		_, value, err := s.readRuntimePolicy()
		return value, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return s.runtimePolicyCache.Get(ctx, runtimePolicySettingKey, func(ctx context.Context) (RuntimePolicySetting, int, error) {
		reader := &Service{
			repo:        s.repo.WithContext(ctx),
			host:        s.host,
			Coordinator: s.Coordinator,
		}
		_, value, err := reader.readRuntimePolicy()
		return value, 2048, err
	})
}

func (s *Service) RuntimeConcurrencySetting() (RuntimeTaskPolicy, error) {

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return s.concurrencyCache.Get(ctx, runtimePolicySettingKey, func(ctx context.Context) (RuntimeTaskPolicy, int, error) {
		reader := &Service{repo: s.repo.WithContext(ctx), host: s.host, Coordinator: s.Coordinator, concurrencyCache: s.concurrencyCache, runtimePolicyCache: s.runtimePolicyCache}
		policy, err := reader.RuntimePolicy()
		return policy.Task, 256, err
	})
}

func (s *Service) PublicRuntimeLimits() (*PublicRuntimeLimits, error) {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	return &PublicRuntimeLimits{
		ActiveTaskLimit: policy.Task.ActiveTaskLimit, ResourceUploadMB: policy.Resource.ResourceUploadMB,
		RecycleBinRetentionDays: policy.Resource.RecycleBinRetentionDays,
	}, nil
}

func (s *Service) AdminRuntimePolicySetting(actor *model.User) (*PublicRuntimePolicySetting, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readRuntimePolicy()
	if err != nil {
		return nil, err
	}
	return publicRuntimePolicy(setting, value), nil
}

func (s *Service) AdminSelfUseRuntimePolicy(actor *model.User) (*PublicRuntimePolicySetting, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	return publicRuntimePolicy(nil, selfUseRuntimePolicy()), nil
}

func (s *Service) UpdateRuntimePolicySetting(actor *model.User, value RuntimePolicySetting) (*PublicRuntimePolicySetting, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	if err := validateRuntimePolicy(value); err != nil {
		return nil, err
	}
	current, before, err := s.readRuntimePolicy()
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: runtimePolicySettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}

	s.concurrencyCache.Clear()
	if s.runtimePolicyCache != nil {
		s.runtimePolicyCache.Clear()
	}
	if err := s.appendAdminAudit(actor, "runtime_policy.update", "system_setting", runtimePolicySettingKey, "更新资源与请求策略", map[string]any{"before": before, "after": value}); err != nil {
		return nil, err
	}
	return publicRuntimePolicy(&setting, value), nil
}

func (s *Service) ResetRuntimePolicySetting(actor *model.User) (*PublicRuntimePolicySetting, error) {
	if err := s.requireAdmin(actor); err != nil {
		return nil, err
	}
	_, before, err := s.readRuntimePolicy()
	if err != nil {
		return nil, err
	}
	if err := s.repo.DeleteSystemSetting(runtimePolicySettingKey); err != nil {
		return nil, err
	}

	s.concurrencyCache.Clear()
	if s.runtimePolicyCache != nil {
		s.runtimePolicyCache.Clear()
	}
	after := DefaultRuntimePolicy()
	if err := s.appendAdminAudit(actor, "runtime_policy.reset", "system_setting", runtimePolicySettingKey, "重置资源与请求策略", map[string]any{"before": before, "after": after}); err != nil {
		return nil, err
	}
	return publicRuntimePolicy(nil, after), nil
}

func (s *Service) readRuntimePolicy() (*model.SystemSetting, RuntimePolicySetting, error) {
	setting, err := s.repo.SystemSettingOptional(runtimePolicySettingKey)
	if err != nil {
		return nil, RuntimePolicySetting{}, err
	}
	if setting == nil {
		value := DefaultRuntimePolicy()
		return nil, value, validateRuntimePolicy(value)
	}
	value := DefaultRuntimePolicy()
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, RuntimePolicySetting{}, errors.New("资源与请求策略配置格式无效")
	}
	if err := validateRuntimePolicy(value); err != nil {
		return nil, RuntimePolicySetting{}, err
	}
	return setting, value, nil
}

func validateRuntimePolicy(value RuntimePolicySetting) error {
	resource := value.Resource
	for label, item := range map[string]int64{
		"普通资源单文件": resource.ResourceUploadMB,
		"单个生成资源":  resource.GeneratedFileMB,
	} {
		if item < 1 || item > maxRuntimeUploadMB {
			return kernel.BadAuthRequest(fmt.Sprintf("%s必须是 1-%d MB 的整数", label, maxRuntimeUploadMB))
		}
	}
	if resource.DailyUploadMB < 1 || resource.DailyUploadMB > maxRuntimeDataMB {
		return kernel.BadAuthRequest(fmt.Sprintf("每日上传量必须是 1-%d MB 的整数", maxRuntimeDataMB))
	}
	if resource.StoredFileGB < 1 || resource.StoredFileGB > maxRuntimeStorageGB || resource.TaskDataGB < 1 || resource.TaskDataGB > maxRuntimeStorageGB {
		return kernel.BadAuthRequest(fmt.Sprintf("账号文件与任务数据容量必须是 1-%d GB 的整数", maxRuntimeStorageGB))
	}
	if resource.StructuredDataMB < 1 || resource.StructuredDataMB > maxRuntimeDataMB {
		return kernel.BadAuthRequest(fmt.Sprintf("结构化数据容量必须是 1-%d MB 的整数", maxRuntimeDataMB))
	}
	storedMB := resource.StoredFileGB * 1024
	if resource.ResourceUploadMB > storedMB || resource.GeneratedFileMB > storedMB {
		return kernel.BadAuthRequest("单文件上限不能大于账号文件总容量")
	}
	for label, item := range map[string]int64{
		"素材数量": resource.AssetCount, "画布数量": resource.CanvasCount,
		"任务历史数量": resource.TaskCount, "请求日志数量": resource.APICallLogCount,
	} {
		if item < 1 || item > maxRuntimeCount {
			return kernel.BadAuthRequest(fmt.Sprintf("%s必须是 1-%d 的整数", label, maxRuntimeCount))
		}
	}
	if resource.RecycleBinRetentionDays < 0 || resource.RecycleBinRetentionDays > 365 {
		return kernel.BadAuthRequest("回收站保留天数必须是 0-365 的整数 (0 表示不自动清理)")
	}
	task := value.Task
	for label, item := range map[string]int{
		"Worker 并发数": task.WorkerConcurrency, "全局渠道并发数": task.ChannelConcurrency, "活动任务上限": task.ActiveTaskLimit,
	} {
		if item < 1 || item > maxRuntimeConcurrency {
			return kernel.BadAuthRequest(fmt.Sprintf("%s必须是 1-%d 的整数", label, maxRuntimeConcurrency))
		}
	}
	for label, item := range map[string]int{
		"图片任务超时": task.ImageTimeoutMinutes, "文本任务超时": task.TextTimeoutMinutes,
		"音频任务超时": task.AudioTimeoutMinutes, "视频任务超时": task.VideoTimeoutMinutes,
		"分镜任务超时": task.StoryboardTimeoutMinutes, "默认任务超时": task.DefaultTimeoutMinutes,
	} {
		if item < 1 || item > maxRuntimeTimeoutMinutes {
			return kernel.BadAuthRequest(fmt.Sprintf("%s必须是 1-%d 分钟的整数", label, maxRuntimeTimeoutMinutes))
		}
	}
	if task.AgentStepMaxOutputTokens != 0 && (task.AgentStepMaxOutputTokens < MinRuntimeAgentStepOutputTokens || task.AgentStepMaxOutputTokens > MaxRuntimeAgentStepOutputTokens) {
		return kernel.BadAuthRequest(fmt.Sprintf("Agent 单步输出上限必须是 0 或 %d-%d 的整数 (0 表示不限制)", MinRuntimeAgentStepOutputTokens, MaxRuntimeAgentStepOutputTokens))
	}
	if task.AgentStepTimeoutSeconds != 0 && (task.AgentStepTimeoutSeconds < MinRuntimeAgentStepTimeoutSeconds || task.AgentStepTimeoutSeconds > MaxRuntimeAgentStepTimeoutSeconds) {
		return kernel.BadAuthRequest(fmt.Sprintf("Agent 单步超时必须是 0 或 %d-%d 秒的整数 (0 表示沿用文本任务超时)", MinRuntimeAgentStepTimeoutSeconds, MaxRuntimeAgentStepTimeoutSeconds))
	}
	request := value.Request
	for label, item := range map[string]int{
		"任务创建频控": request.TaskCreatePerMinute,
		"资源上传频控": request.ResourceUploadPerMinute, "资源导入频控": request.ResourceImportPerMinute,
		"素材写入频控": request.AssetWritePerMinute,
		"画布写入频控": request.CanvasWritePerMinute, "注册频控": request.RegisterPerHour,
		"验证码频控": request.EmailCodePerHour, "登录 IP 频控": request.LoginIPPerTenMinutes,
		"登录账号频控": request.LoginAccountPerTenMinutes, "系统渠道频控": request.SystemRelayPerMinute,
		"自定义渠道频控": request.CustomRelayPerMinute,
	} {
		if item < 1 || item > maxRuntimeRate {
			return kernel.BadAuthRequest(fmt.Sprintf("%s必须是 1-%d 的整数", label, maxRuntimeRate))
		}
	}
	if request.CustomRelayConcurrency < 1 || request.CustomRelayConcurrency > maxRuntimeConcurrency {
		return kernel.BadAuthRequest(fmt.Sprintf("自定义渠道并发必须是 1-%d 的整数", maxRuntimeConcurrency))
	}
	for label, item := range map[string]int64{
		"自定义渠道请求体": request.CustomRelayRequestMB, "自定义渠道响应体": request.CustomRelayResponseMB,
		"系统渠道请求体": request.SystemRelayRequestMB, "系统渠道响应体": request.SystemRelayResponseMB,
	} {
		if item < 1 || item > maxRuntimeUploadMB {
			return kernel.BadAuthRequest(fmt.Sprintf("%s必须是 1-%d MB 的整数", label, maxRuntimeUploadMB))
		}
	}
	if request.CustomRelayTimeoutMinutes < 1 || request.CustomRelayTimeoutMinutes > maxRuntimeTimeoutMinutes {
		return kernel.BadAuthRequest(fmt.Sprintf("自定义渠道超时必须是 1-%d 分钟的整数", maxRuntimeTimeoutMinutes))
	}
	if request.ChannelCircuitFailureCount < 1 || request.ChannelCircuitFailureCount > maxRuntimeConcurrency {
		return kernel.BadAuthRequest(fmt.Sprintf("渠道熔断失败次数必须是 1-%d 的整数", maxRuntimeConcurrency))
	}
	if request.ChannelCircuitOpenSeconds < 1 || request.ChannelCircuitOpenSeconds > 86_400 {
		return kernel.BadAuthRequest("渠道熔断时长必须是 1-86400 秒的整数")
	}
	return nil
}

func ValidateRuntimePolicy(value RuntimePolicySetting) error { return validateRuntimePolicy(value) }

func publicRuntimePolicy(setting *model.SystemSetting, value RuntimePolicySetting) *PublicRuntimePolicySetting {
	result := &PublicRuntimePolicySetting{RuntimePolicySetting: value, Configured: setting != nil}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

func megabytes(value int64) int64 { return kernel.Megabytes(value) }
func gigabytes(value int64) int64 { return kernel.Gigabytes(value) }

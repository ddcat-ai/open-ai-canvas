package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const featureAvailabilitySettingKey = "feature_availability"

const (
	FeatureShortDrama     = "shortDrama"
	FeatureTaskCenter     = "taskCenter"
	FeatureCredits        = "credits"
	FeatureCustomChannels = "customChannels"
	FeatureFrontendModels = "frontendModels"
	FeaturePluginCenter   = "pluginCenter"
	FeatureSystemPlugins  = "systemPluginsVisibleToUsers"
)

type FeatureAvailability struct {
	ShortDramaEnabled           bool `json:"shortDramaEnabled"`
	TaskCenterEnabled           bool `json:"taskCenterEnabled"`
	CreditsEnabled              bool `json:"creditsEnabled"`
	CustomChannelsEnabled       bool `json:"customChannelsEnabled"`
	FrontendModelsEnabled       bool `json:"frontendModelsEnabled"`
	PluginCenterEnabled         bool `json:"pluginCenterEnabled"`
	SystemPluginsVisibleToUsers bool `json:"systemPluginsVisibleToUsers"`
}

type PublicFeatureAvailability struct {
	FeatureAvailability
	DesktopLocalChannelsEnabled bool      `json:"desktopLocalChannelsEnabled"`
	Configured                  bool      `json:"configured"`
	UpdatedBy                   string    `json:"updatedBy,omitempty"`
	UpdatedAt                   time.Time `json:"updatedAt,omitempty"`
}

func defaultFeatureAvailability() FeatureAvailability {
	// 缺少配置代表尚未由运维接管；前台模型需要明确配置后才开放。
	return FeatureAvailability{
		ShortDramaEnabled:           true,
		TaskCenterEnabled:           true,
		CreditsEnabled:              true,
		CustomChannelsEnabled:       true,
		FrontendModelsEnabled:       false,
		PluginCenterEnabled:         true,
		SystemPluginsVisibleToUsers: true,
	}
}

func (s *Service) FeatureAvailability() (*PublicFeatureAvailability, error) {
	setting, value, err := s.readFeatureAvailability()
	if err != nil {
		return nil, err
	}
	return s.withRuntimeCapabilities(publicFeatureAvailability(setting, value)), nil
}

func (s *Service) AdminFeatureAvailability(actor *model.User) (*PublicFeatureAvailability, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.FeatureAvailability()
}

func (s *Service) UpdateFeatureAvailability(actor *model.User, value FeatureAvailability) (*PublicFeatureAvailability, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	current, before, err := s.readFeatureAvailability()
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "feature_availability.update", "system_setting", featureAvailabilitySettingKey, "更新功能开放配置", map[string]any{"before": before, "after": value}); err != nil {
		return nil, err
	}
	return s.withRuntimeCapabilities(publicFeatureAvailability(&setting, value)), nil
}

func (s *Service) FeatureEnabled(feature string) (bool, error) {
	_, value, err := s.readFeatureAvailability()
	if err != nil {
		return false, err
	}
	switch feature {
	case FeatureShortDrama:
		return value.ShortDramaEnabled, nil
	case FeatureTaskCenter:
		return value.TaskCenterEnabled, nil
	case FeatureCredits:
		return value.CreditsEnabled, nil
	case FeatureCustomChannels:
		return value.CustomChannelsEnabled, nil
	case FeatureFrontendModels:
		return value.FrontendModelsEnabled, nil
	case FeaturePluginCenter:
		return value.PluginCenterEnabled, nil
	case FeatureSystemPlugins:
		return value.SystemPluginsVisibleToUsers, nil
	default:
		return false, errors.New("未知功能开放配置")
	}
}

func (s *Service) RequireFeature(feature string) error {
	enabled, err := s.FeatureEnabled(feature)
	if err != nil {
		return err
	}
	if enabled {
		return nil
	}
	switch feature {
	case FeatureShortDrama:
		return Forbidden("短剧创作暂未开放")
	case FeatureTaskCenter:
		return Forbidden("任务中心暂未开放")
	case FeatureCredits:
		return Forbidden("积分功能暂未开放")
	case FeatureCustomChannels:
		return Forbidden("自定义渠道暂未开放")
	case FeatureFrontendModels:
		return Forbidden("前台模型目录暂未开放")
	case FeaturePluginCenter:
		return Forbidden("插件中心暂未开放")
	case FeatureSystemPlugins:
		return Forbidden("系统插件暂未向普通用户展示")
	default:
		return Forbidden("该功能暂未开放")
	}
}

func (s *Service) readFeatureAvailability() (*model.SystemSetting, FeatureAvailability, error) {
	setting, err := s.repo.SystemSetting(featureAvailabilitySettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, defaultFeatureAvailability(), nil
	}
	if err != nil {
		return nil, FeatureAvailability{}, err
	}
	// 以全开放默认值为基底，避免已有三字段配置在升级后因缺少新字段而意外关闭功能。
	value := defaultFeatureAvailability()
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, FeatureAvailability{}, errors.New("功能开放配置格式无效")
	}
	return setting, value, nil
}

func (s *Service) withRuntimeCapabilities(result *PublicFeatureAvailability) *PublicFeatureAvailability {
	if result != nil {
		result.DesktopLocalChannelsEnabled = s.DesktopLocalChannelsEnabled()
	}
	return result
}

func publicFeatureAvailability(setting *model.SystemSetting, value FeatureAvailability) *PublicFeatureAvailability {
	result := &PublicFeatureAvailability{FeatureAvailability: value, Configured: setting != nil}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

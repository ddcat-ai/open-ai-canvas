package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"

	"gorm.io/gorm"
)

const pluginConfigurationKeyPrefix = "plugin_config:"

type PluginConfigurationView struct {
	PluginID string                   `json:"pluginId"`
	Fields   []protocol.ManifestField `json:"fields"`
	Values   map[string]string        `json:"values"`
}

func (s *Service) AdminPluginConfiguration(actor *model.User, pluginID string) (*PluginConfigurationView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	plugin, ok := runtimePluginByID(s.Plugins(), pluginID)
	if !ok {
		return nil, NotFound("插件不存在")
	}
	if len(plugin.Manifest.Contributes.WalletLinks) == 0 {
		return nil, BadAuthRequest("插件不支持购买链接配置")
	}
	values, err := s.readPluginConfiguration(pluginID)
	if err != nil {
		return nil, err
	}
	return &PluginConfigurationView{PluginID: pluginID, Fields: plugin.Manifest.Configuration.Fields, Values: values}, nil
}

func (s *Service) UpdateAdminPluginConfiguration(actor *model.User, pluginID string, values map[string]string) (*PluginConfigurationView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	plugin, ok := runtimePluginByID(s.Plugins(), pluginID)
	if !ok {
		return nil, NotFound("插件不存在")
	}
	if len(plugin.Manifest.Contributes.WalletLinks) == 0 {
		return nil, BadAuthRequest("插件不支持购买链接配置")
	}
	allowed := make(map[string]protocol.ManifestField, len(plugin.Manifest.Configuration.Fields))
	for _, field := range plugin.Manifest.Configuration.Fields {
		if field.Name == "links" && field.Type == "json" {
			allowed[field.Name] = field
		}
	}
	clean := make(map[string]string, len(values))
	for name, value := range values {
		field, exists := allowed[name]
		if !exists {
			return nil, BadAuthRequest("插件配置字段不受支持：" + name)
		}
		if len(value) > 128*1024 {
			return nil, BadAuthRequest("插件配置字段过长：" + name)
		}
		if field.Type == "json" && strings.TrimSpace(value) != "" {
			var raw any
			if err := json.Unmarshal([]byte(value), &raw); err != nil {
				return nil, BadAuthRequest("插件配置不是有效 JSON：" + name)
			}
			if name == "links" {
				var links []protocol.ManifestWalletLink
				if err := json.Unmarshal([]byte(value), &links); err != nil {
					return nil, BadAuthRequest("购买链接配置格式错误")
				}
				if err := protocol.ValidateWalletLinks(links); err != nil {
					return nil, BadAuthRequest(err.Error())
				}
			}
		}
		clean[name] = value
	}
	encoded, err := json.Marshal(clean)
	if err != nil {
		return nil, fmt.Errorf("编码插件配置：%w", err)
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: pluginConfigurationKeyPrefix + pluginID, ValueJSON: string(encoded), UpdatedBy: actor.ID}); err != nil {
		return nil, fmt.Errorf("保存插件配置：%w", err)
	}
	if err := s.appendAdminAudit(actor, "plugin.configuration.update", "plugin", pluginID, "更新插件配置", map[string]any{"fields": len(clean)}); err != nil {
		return nil, err
	}
	return &PluginConfigurationView{PluginID: pluginID, Fields: plugin.Manifest.Configuration.Fields, Values: clean}, nil
}

func (s *Service) readPluginConfiguration(pluginID string) (map[string]string, error) {
	setting, err := s.repo.SystemSetting(pluginConfigurationKeyPrefix + pluginID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("读取插件配置：%w", err)
	}
	values := map[string]string{}
	if strings.TrimSpace(setting.ValueJSON) == "" {
		return values, nil
	}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &values); err != nil {
		return nil, fmt.Errorf("插件配置损坏：%w", err)
	}
	return values, nil
}

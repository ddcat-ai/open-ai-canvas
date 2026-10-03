package app

import (
	"sort"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/protocol"
)

// SmartCreationPluginView 是创作页读取智能创作策略的最小投影：只包含当前用户已生效的插件。
type SmartCreationPluginView struct {
	ID            string                          `json:"id"`
	Name          string                          `json:"name"`
	Version       string                          `json:"version"`
	Permissions   []string                        `json:"permissions"`
	SmartCreation *protocol.ManifestSmartCreation `json:"smartCreation"`
}

// SmartCreationPluginsForUser 返回当前用户已生效、且声明了 contributes.smartCreation 的插件。
// 普通用户未开放插件中心时也能读取，因为这里只暴露创作页执行所需的声明式策略。
func (s *Service) SmartCreationPluginsForUser(actor *model.User) ([]SmartCreationPluginView, error) {
	items := s.Plugins()
	result := make([]SmartCreationPluginView, 0, 1)
	for _, item := range items {
		config := item.Manifest.Contributes.SmartCreation
		if config == nil || item.Status == "invalid" {
			continue
		}
		state, err := s.pluginStateForUser(actor, item.Manifest.ID, items)
		if err != nil {
			return nil, err
		}
		if !state.EffectiveEnabled {
			continue
		}
		result = append(result, SmartCreationPluginView{
			ID: item.Manifest.ID, Name: item.Manifest.Name, Version: item.Manifest.Version,
			Permissions: append([]string(nil), item.Manifest.Permissions...), SmartCreation: config,
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result, nil
}

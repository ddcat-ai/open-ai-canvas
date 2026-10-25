package app

import (
	"encoding/json"
	"fmt"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func (s *Service) WalletLinks(actor *model.User) ([]protocol.ManifestWalletLink, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	links := make([]protocol.ManifestWalletLink, 0)
	plugins := s.Plugins()
	for _, plugin := range plugins {
		if plugin.Status != "enabled" || len(plugin.Manifest.Contributes.WalletLinks) == 0 {
			continue
		}
		state, err := s.pluginStateForUser(actor, plugin.Manifest.ID, plugins)
		if err != nil {
			return nil, err
		}
		if !state.EffectiveEnabled {
			continue
		}
		values, err := s.readPluginConfiguration(plugin.Manifest.ID)
		if err != nil {
			return nil, err
		}
		configured := plugin.Manifest.Contributes.WalletLinks
		if raw := strings.TrimSpace(values["links"]); raw != "" {
			configured = nil
			if err := json.Unmarshal([]byte(raw), &configured); err != nil {
				return nil, fmt.Errorf("购买入口配置损坏：%w", err)
			}
		}
		if err := protocol.ValidateWalletLinks(configured); err != nil {
			return nil, err
		}
		for _, link := range configured {
			link.ID = plugin.Manifest.ID + ":" + link.ID
			links = append(links, link)
		}
	}
	return links, nil
}

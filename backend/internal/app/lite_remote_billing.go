package app

import (
	"fmt"
	"strings"

	"yingce/backend/internal/model"
)

func (s *Service) taskUsesLiteRemoteChannel(task *model.Task, input map[string]any) bool {
	if task == nil || s == nil || s.repo == nil {
		return false
	}
	channelID := ""
	if task.ChannelModelID != "" {
		if channelModel, err := s.repo.ChannelModel(task.ChannelModelID); err == nil {
			channelID = channelModel.ChannelID
		}
	}
	if channelID == "" {
		config, _ := input["config"].(map[string]any)
		if config != nil {
			channelID = strings.TrimSpace(fmt.Sprint(config["channelId"]))
			if channelID == "" {
				channelID = systemChannelIDFromBaseURL(fmt.Sprint(config["baseUrl"]))
			}
		}
	}
	if channelID == "" {
		return false
	}
	channel, err := s.repo.SystemChannel(channelID)
	return err == nil && isLiteRemoteProviderID(channel.CatalogProviderID)
}

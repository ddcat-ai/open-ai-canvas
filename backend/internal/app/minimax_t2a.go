package app

import (
	"errors"

	"infinite-canvas/backend/internal/model"
)

// SystemChannelForInterfaceType 查找指定协议（interfaceType）的系统渠道（会解密 API key）。
// 例如 MiniMax T2A 渠道的 channel_models 行 protocol = "minimax-t2a"。
func (s *Service) SystemChannelForInterfaceType(iface model.ChannelInterfaceType) (*model.ModelChannel, error) {
	channels, err := s.repo.SystemChannels(true)
	if err != nil {
		return nil, err
	}
	for i := range channels {
		models, err := s.repo.ChannelModels(channels[i].ID, false)
		if err != nil {
			continue
		}
		for _, m := range models {
			if m.Protocol == iface {
				return s.SystemChannel(channels[i].ID)
			}
		}
	}
	return nil, errors.New("未找到 MiniMax T2A 渠道，请先在后台「模型渠道」配置并启用 minimax-t2a")
}

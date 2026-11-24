package app

import "yingce/backend/internal/model"

type ChannelModelProtocolGroup struct {
	ModelIDs []string `json:"modelIds"`
	Protocol string   `json:"protocol"`
}

// ChannelModelBatchProtocolRequest accepts exactly one of the legacy single
// protocol request or the grouped request; both share one atomic write path.
type ChannelModelBatchProtocolRequest struct {
	ModelIDs []string                    `json:"modelIds,omitempty"`
	Protocol string                      `json:"protocol,omitempty"`
	Groups   []ChannelModelProtocolGroup `json:"groups,omitempty"`
}

func (r *ChannelModelBatchProtocolRequest) UnmarshalJSON(data []byte) error {
	type plain ChannelModelBatchProtocolRequest
	fields, err := decodeBatchObject(data, (*plain)(r))
	if err != nil {
		return err
	}
	for key := range fields {
		switch key {
		case "modelIds", "protocol", "groups":
		default:
			return BadAuthRequest("未知字段 " + key)
		}
	}
	_, hasGroups := fields["groups"]
	_, hasIDs := fields["modelIds"]
	_, hasProtocol := fields["protocol"]
	if hasGroups {
		if hasIDs || hasProtocol {
			return BadAuthRequest("分组协议与单一协议请求不能混用")
		}
		if len(r.Groups) == 0 {
			return BadAuthRequest("请选择需要修改协议的分组")
		}
	} else if !hasIDs || !hasProtocol {
		return BadAuthRequest("请选择模型和调用协议")
	}
	return nil
}

func (r *ChannelModelProtocolGroup) UnmarshalJSON(data []byte) error {
	type plain ChannelModelProtocolGroup
	fields, err := decodeBatchObject(data, (*plain)(r), "modelIds", "protocol")
	if err != nil {
		return err
	}
	for key := range fields {
		if key != "modelIds" && key != "protocol" {
			return BadAuthRequest("未知字段 " + key)
		}
	}
	return nil
}

func (s *Service) UpdateAdminChannelModelsProtocolGroups(actor *model.User, channelID string, groups []ChannelModelProtocolGroup) (int, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return 0, err
	}
	targets, err := normalizeChannelModelProtocolGroups(groups)
	if err != nil {
		return 0, err
	}
	if channelID == "" {
		return 0, BadAuthRequest("请选择系统渠道")
	}
	return s.updateChannelModelProtocolTargets(actor, channelID, targets)
}

func (s *Service) UpdateAdminAllChannelModelsProtocolGroups(actor *model.User, groups []ChannelModelProtocolGroup) (int, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return 0, err
	}
	targets, err := normalizeChannelModelProtocolGroups(groups)
	if err != nil {
		return 0, err
	}
	return s.updateChannelModelProtocolTargets(actor, "", targets)
}

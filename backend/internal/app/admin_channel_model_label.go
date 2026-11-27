package app

import (
	"strings"
	"time"

	"yingce/backend/internal/model"
)

// 名称修改仅携带展示字段，不允许顺带变更计费、能力、协议或可用状态。
type AdminChannelModelLabelRequest struct {
	ChannelLabel string  `json:"channelLabel"`
	DisplayName  *string `json:"displayName,omitempty"`
}

// 展示名称不影响计费或路由，按普通写操作授权，不提高为高风险命令。
func (s *Service) UpdateAdminChannelModelLabel(actor *model.User, channelID string, id string, req AdminChannelModelLabelRequest) (*model.ChannelModel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	item, err := s.repo.ChannelModelByID(channelID, id)
	if err != nil {
		return nil, err
	}
	after := *item
	label := strings.TrimSpace(req.ChannelLabel)
	if label == after.ProviderModelKey {
		label = ""
	}
	if len([]rune(label)) > 80 {
		return nil, BadAuthRequest("渠道展示名不能超过 80 字")
	}
	columns := map[string]any{"channel_label": label}
	after.ChannelLabel = label
	if req.DisplayName != nil {
		displayName := strings.TrimSpace(*req.DisplayName)
		if displayName == "" {
			displayName = "未分类"
		}
		if len([]rune(displayName)) > 160 {
			return nil, BadAuthRequest("模型展示名不能超过 160 字")
		}
		after.DisplayName = displayName
		columns["display_name"] = displayName
	}
	if err := s.repo.UpdateChannelModelBatch(item, &after, columns, false, false); err != nil {
		return nil, err
	}
	event, err := newAdminAuditEvent(actor, "channel_model.label_update", "model_channel", channelID, "修改渠道展示名", map[string]any{"modelId": id, "channelLabel": after.ChannelLabel, "displayName": after.DisplayName})
	if err == nil {
		err = s.repo.AppendAdminAudit(event)
	}
	if err != nil {
		return nil, err
	}
	if err := s.repo.SyncChannelModelNames(channelID, time.Now()); err != nil {
		return nil, err
	}
	return &after, nil
}

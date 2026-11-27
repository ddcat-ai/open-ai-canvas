package app

import (
	"encoding/json"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
)

// 一级目录排序只影响前台模型选择器的分组顺序，不改变模型归属、价格或调用方式。
const ModelGroupOrderKey = "model_group_order_v1"

type ModelGroupOrderRequest struct {
	Order []string `json:"order"`
}

type modelGroupOrderValue struct {
	Order []string `json:"order"`
}

func normalizeModelGroupOrder(order []string) ([]string, error) {
	if len(order) > 200 {
		return nil, BadAuthRequest("目录数量不能超过 200")
	}
	seen := map[string]bool{}
	normalized := make([]string, 0, len(order))
	for _, name := range order {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if utf8.RuneCountInString(name) > 160 {
			return nil, BadAuthRequest("目录名称不能超过 160 字")
		}
		if seen[name] {
			continue
		}
		seen[name] = true
		normalized = append(normalized, name)
	}
	return normalized, nil
}

func (s *Service) ModelGroupOrder(actor *model.User) ([]string, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.publicModelGroupOrder()
}

func (s *Service) publicModelGroupOrder() ([]string, error) {
	setting, err := s.repo.SystemSettingOptional(ModelGroupOrderKey)
	if err != nil || setting == nil || strings.TrimSpace(setting.ValueJSON) == "" {
		return []string{}, err
	}
	var value modelGroupOrderValue
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return []string{}, nil
	}
	return value.Order, nil
}

func (s *Service) SaveModelGroupOrder(actor *model.User, request ModelGroupOrderRequest) ([]string, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	order, err := normalizeModelGroupOrder(request.Order)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(modelGroupOrderValue{Order: order})
	if err != nil {
		return nil, err
	}
	previous, _ := s.publicModelGroupOrder()
	audit, err := newAdminAuditEvent(actor, "model_group_order.update", "system_setting", ModelGroupOrderKey, "调整模型一级目录顺序", map[string]any{"before": previous, "after": order})
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: ModelGroupOrderKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}); err != nil {
		return nil, err
	}
	if err := s.repo.AppendAdminAudit(audit); err != nil {
		return nil, err
	}
	s.invalidateRouteCatalog()
	return order, nil
}

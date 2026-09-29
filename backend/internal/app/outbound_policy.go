package app

import (
	"encoding/json"
	"errors"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/outbound"

	"gorm.io/gorm"
)

const (
	outboundPolicySettingKey = "outbound_policy"
	maxAllowedModelOrigins   = 256
)

// OutboundPolicySetting 是管理员维护的出站策略，与资源限制、存储凭据分开保存。
// AllowedModelOrigins 为空时不增加限制，系统渠道按原有 SSRF 规则出站。
type OutboundPolicySetting struct {
	AllowedModelOrigins []string `json:"allowedModelOrigins"`
}

func (s *Service) OutboundPolicy() (OutboundPolicySetting, error) {
	value := OutboundPolicySetting{AllowedModelOrigins: []string{}}
	setting, err := s.repo.SystemSetting(outboundPolicySettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return value, nil
	}
	if err != nil {
		return OutboundPolicySetting{}, err
	}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return OutboundPolicySetting{}, errors.New("出站策略配置格式无效")
	}
	if value.AllowedModelOrigins == nil {
		value.AllowedModelOrigins = []string{}
	}
	return value, nil
}

func (s *Service) AdminOutboundPolicy(actor *model.User) (OutboundPolicySetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return OutboundPolicySetting{}, err
	}
	return s.OutboundPolicy()
}

// EditableOutboundPolicy 是保存前合并用的基底。已保存的配置无法解析时以空策略为基底，
// 让管理员可以直接覆盖修复；出站检查本身仍按读取失败拒绝。
func (s *Service) EditableOutboundPolicy(actor *model.User) (OutboundPolicySetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return OutboundPolicySetting{}, err
	}
	value, err := s.OutboundPolicy()
	if err != nil {
		return OutboundPolicySetting{AllowedModelOrigins: []string{}}, nil
	}
	return value, nil
}

func (s *Service) UpdateOutboundPolicy(actor *model.User, value OutboundPolicySetting) (OutboundPolicySetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return OutboundPolicySetting{}, err
	}
	origins, err := normalizeAllowedModelOrigins(value.AllowedModelOrigins)
	if err != nil {
		return OutboundPolicySetting{}, err
	}
	audit := map[string]any{}
	if before, err := s.OutboundPolicy(); err == nil {
		audit["before"] = before
	} else {
		audit["beforeUnreadable"] = err.Error()
	}
	next := OutboundPolicySetting{AllowedModelOrigins: origins}
	audit["after"] = next
	encoded, err := json.Marshal(next)
	if err != nil {
		return OutboundPolicySetting{}, err
	}
	setting := model.SystemSetting{Key: outboundPolicySettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	current, err := s.repo.SystemSetting(outboundPolicySettingKey)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return OutboundPolicySetting{}, err
	}
	if current != nil {
		setting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return OutboundPolicySetting{}, err
	}
	if err := s.appendAdminAudit(actor, "outbound_policy.update", "system_setting", outboundPolicySettingKey, "更新出站策略", audit); err != nil {
		return OutboundPolicySetting{}, err
	}
	return next, nil
}

func normalizeAllowedModelOrigins(values []string) ([]string, error) {
	if len(values) > maxAllowedModelOrigins {
		return nil, BadAuthRequest("允许的模型服务地址最多 256 项")
	}
	origins := make([]string, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, raw := range values {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		origin, err := outbound.NormalizeOrigin(raw, false)
		if err != nil {
			return nil, mapOutboundError(err)
		}
		if !seen[origin] {
			seen[origin] = true
			origins = append(origins, origin)
		}
	}
	return origins, nil
}

// requireAllowedModelOrigin 限制系统渠道（携带平台密钥的请求）只连到管理员允许的模型服务地址。
// 列表为空时不增加限制；读取配置失败时拒绝，不按空白放行。
func (s *Service) requireAllowedModelOrigin(rawURL string) error {
	policy, err := s.OutboundPolicy()
	if err != nil {
		return err
	}
	if len(policy.AllowedModelOrigins) == 0 {
		return nil
	}
	origin, err := outbound.NormalizeOrigin(rawURL, true)
	if err != nil {
		return mapOutboundError(err)
	}
	for _, allowed := range policy.AllowedModelOrigins {
		if normalized, err := outbound.NormalizeOrigin(allowed, false); err == nil && normalized == origin {
			return nil
		}
	}
	return Forbidden("系统渠道地址不在允许的模型服务地址中")
}

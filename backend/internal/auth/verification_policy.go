package auth

import (
	"encoding/json"
	"errors"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

const authPolicyKey = "auth_verification_policy"

type VerificationPolicy struct {
	SMSLogin                bool `json:"smsLogin"`
	EmailLogin              bool `json:"emailLogin"`
	SMSRegistration         bool `json:"smsRegistration"`
	EmailRegistration       bool `json:"emailRegistration"`
	SMSAndEmailRegistration bool `json:"smsAndEmailRegistration"`
}

func (s *Service) verificationPolicy() (VerificationPolicy, error) {
	setting, err := s.repo.SystemSetting(authPolicyKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return VerificationPolicy{EmailRegistration: true}, nil
	}
	if err != nil {
		return VerificationPolicy{}, err
	}
	var p VerificationPolicy
	if json.Unmarshal([]byte(setting.ValueJSON), &p) != nil {
		return p, kernel.NewAppError(503, "登录注册策略格式无效")
	}
	return p, nil
}
func (s *Service) AdminVerificationPolicy(actor *model.User) (*VerificationPolicy, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	p, err := s.verificationPolicy()
	return &p, err
}
func (s *Service) UpdateVerificationPolicy(actor *model.User, p VerificationPolicy) (*VerificationPolicy, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if p.SMSAndEmailRegistration && (p.SMSRegistration || p.EmailRegistration) {
		return nil, kernel.BadAuthRequest("短信+邮箱同时验证不能与单一验证注册同时开启")
	}
	if p.EmailLogin || p.EmailRegistration || p.SMSAndEmailRegistration {
		enabled, err := s.EmailEnabled()
		if err != nil {
			return nil, err
		}
		if !enabled {
			return nil, kernel.BadAuthRequest("请先配置并开启邮件服务")
		}
	}
	for scene, required := range map[string]bool{"login": p.SMSLogin, "register": p.SMSRegistration || p.SMSAndEmailRegistration} {
		if !required {
			continue
		}
		enabled, err := s.smsAvailable(scene)
		if err != nil {
			return nil, err
		}
		if !enabled {
			return nil, kernel.BadAuthRequest("请先启用短信插件并配置对应场景的短信渠道：" + scene)
		}
	}
	encoded, _ := json.Marshal(p)
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: authPolicyKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}); err != nil {
		return nil, err
	}
	return &p, nil
}
func (s *Service) smsAvailable(scene string) (bool, error) {
	if s.sms == nil {
		return false, nil
	}
	return s.sms.Available(scene)
}
func (p VerificationPolicy) allows(purpose, method string) bool {
	if purpose == "bind" {
		return method == "sms" || method == "email"
	}
	if purpose == "login" {
		return (method == "sms" && p.SMSLogin) || (method == "email" && p.EmailLogin)
	}
	if purpose == "register" {
		if p.SMSAndEmailRegistration {
			return method == "sms_email"
		}
		return (method == "sms" && p.SMSRegistration) || (method == "email" && p.EmailRegistration)
	}
	return false
}
func (p VerificationPolicy) hash() string { raw, _ := json.Marshal(p); return HashToken(string(raw)) }

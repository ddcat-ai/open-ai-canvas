package app

import (
	"context"
	"crypto/rand"
	"fmt"
	"infinite-canvas/backend/internal/auth"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/sms"
	"math/big"
)

type SMSChannelRequest = sms.ChannelRequest
type VerificationPolicy = auth.VerificationPolicy
type VerificationRequest = auth.VerificationRequest
type VerificationConfirm = auth.VerificationConfirm

func (s *Service) newSMSDomain() *sms.Service {
	return sms.New(s.repo, authHost{svc: s}, func(id string) (bool, error) {
		items := s.Plugins()
		runtime, exists := runtimePluginByID(items, id)
		if !exists || runtime.Status != "enabled" {
			return false, nil
		}
		state, err := s.pluginStateForUser(nil, id, items)
		return state.EffectiveEnabled, err
	})
}
func (s *Service) smsDomain() *sms.Service {
	if s.sms != nil {
		return s.sms
	}
	return s.newSMSDomain()
}
func (s *Service) AdminSMSChannels(actor *model.User) ([]sms.ChannelView, error) {
	return s.smsDomain().Channels(actor)
}
func (s *Service) SaveSMSChannel(actor *model.User, id string, req SMSChannelRequest) (*sms.ChannelView, error) {
	result, err := s.smsDomain().SaveChannel(actor, id, req)
	if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "sms.channel.save", "sms_channel", result.ID, "保存短信渠道", map[string]any{"provider": result.Provider, "enabled": result.Enabled}); err != nil {
		return nil, err
	}
	return result, nil
}
func (s *Service) DeleteSMSChannel(actor *model.User, id string) error {
	if err := s.smsDomain().DeleteChannel(actor, id); err != nil {
		return err
	}
	return s.appendAdminAudit(actor, "sms.channel.delete", "sms_channel", id, "删除短信渠道", nil)
}
func (s *Service) AdminSMSRecords(actor *model.User, channel, state string, page, size int) (*sms.RecordPage, error) {
	return s.smsDomain().Records(actor, channel, state, page, size)
}
func (s *Service) TestSMSChannel(actor *model.User, ctx context.Context, id, purpose, phone string) (*model.SMSRecord, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	value, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return nil, err
	}
	return s.smsDomain().Test(actor, ctx, id, purpose, phone, fmt.Sprintf("%06d", value.Int64()))
}
func (s *Service) AdminVerificationPolicy(actor *model.User) (*VerificationPolicy, error) {
	return s.authDomain().AdminVerificationPolicy(actor)
}
func (s *Service) UpdateVerificationPolicy(actor *model.User, p VerificationPolicy) (*VerificationPolicy, error) {
	result, err := s.authDomain().UpdateVerificationPolicy(actor, p)
	if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "auth.policy.update", "setting", "auth_verification_policy", "更新验证码登录注册策略", nil); err != nil {
		return nil, err
	}
	return result, nil
}
func (s *Service) StartVerification(ctx context.Context, actor *model.User, req VerificationRequest) (*auth.VerificationTicket, error) {
	return s.authDomain().StartVerification(ctx, actor, req)
}
func (s *Service) LoginVerification(req VerificationConfirm) (*AuthSessionResult, error) {
	return s.authDomain().LoginVerification(req)
}
func (s *Service) BindVerification(actor *model.User, req VerificationConfirm) (*AuthUser, error) {
	return s.authDomain().BindVerification(actor, req)
}

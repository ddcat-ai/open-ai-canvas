package app

import (
	"context"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
)

type WechatSettingRequest = auth.WechatSettingRequest
type PublicWechatSetting = auth.PublicWechatSetting
type WechatRegistrationInfo = auth.WechatRegistrationInfo
type WechatCallbackResult = auth.WechatCallbackResult

func (s *Service) AdminWechatSetting(actor *model.User) (*PublicWechatSetting, error) {
	return s.authDomain().AdminWechatSetting(actor)
}
func (s *Service) UpdateWechatSetting(actor *model.User, req WechatSettingRequest) (*PublicWechatSetting, error) {
	return s.authDomain().UpdateWechatSetting(actor, req)
}
func (s *Service) BeginWechatAuthorization(actor *model.User, cookie, next, purpose string, acceptedTerms bool) (string, string, error) {
	return s.authDomain().BeginWechatAuthorization(actor, cookie, next, purpose, acceptedTerms)
}
func (s *Service) CompleteWechatLogin(ctx context.Context, state, code, cookie string, login LoginContext) (*WechatCallbackResult, error) {
	return s.authDomain().CompleteWechatLogin(ctx, state, code, cookie, login)
}
func (s *Service) WechatRegistration(ticket string) (*WechatRegistrationInfo, error) {
	return s.authDomain().WechatRegistration(ticket)
}
func (s *Service) CompleteWechatRegistration(ticket string, req RegisterRequest) (*AuthSessionResult, error) {
	return s.authDomain().CompleteWechatRegistration(ticket, req)
}

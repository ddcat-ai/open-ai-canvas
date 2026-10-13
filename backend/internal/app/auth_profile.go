package app

import (
	"context"
	"yingce/backend/internal/auth"
	"yingce/backend/internal/model"
)

type UserProfile = auth.UserProfile
type ProfilePasswordRequest = auth.ProfilePasswordRequest
type ProfileEmailCodeRequest = auth.ProfileEmailCodeRequest
type ProfileEmailChangeRequest = auth.ProfileEmailChangeRequest
type ProfileEmailChangeResult = auth.ProfileEmailChangeResult
type VerificationTicket = auth.VerificationTicket

func (s *Service) UserProfile(actor *model.User, cookie string) (*UserProfile, error) {
	return s.authDomain().UserProfile(actor, cookie)
}
func (s *Service) ChangeProfilePassword(actor *model.User, cookie string, req ProfilePasswordRequest) error {
	return s.authDomain().ChangeProfilePassword(actor, cookie, req)
}
func (s *Service) SendProfileEmailCode(ctx context.Context, actor *model.User, cookie string, req ProfileEmailCodeRequest) (*VerificationTicket, error) {
	return s.authDomain().SendProfileEmailCode(ctx, actor, cookie, req)
}
func (s *Service) ChangeProfileEmail(actor *model.User, cookie string, req ProfileEmailChangeRequest) (*ProfileEmailChangeResult, error) {
	return s.authDomain().ChangeProfileEmail(actor, cookie, req)
}
func (s *Service) BeginLinuxDOReauthentication(actor *model.User, cookie string) (string, error) {
	return s.authDomain().BeginLinuxDOReauthentication(actor, cookie)
}
func (s *Service) LinuxDOReauthenticationState(stateValue string) (bool, error) {
	return s.authDomain().LinuxDOReauthenticationState(stateValue)
}

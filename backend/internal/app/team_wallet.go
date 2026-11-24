package app

import (
	"errors"
	"net/http"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type TeamWalletLedgerPage struct {
	Entries []model.CreditLedgerEntry `json:"entries"`
	Total   int64                     `json:"total"`
	Page    int                       `json:"page"`
	Limit   int                       `json:"limit"`
}

func (s *Service) MySpaceCreditOverview(userID string) (*repository.SpaceCreditOverview, error) {
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	return s.repo.MySpaceCredits(userID)
}

func teamWalletError(err error) error {
	switch {
	case errors.Is(err, repository.ErrInsufficientCredits):
		return teamError(http.StatusConflict, "team_credits_insufficient", "可用积分不足，冻结中的积分不能划拨或回收")
	case errors.Is(err, repository.ErrTeamWalletConflict):
		return teamError(http.StatusConflict, "team_idempotency_conflict", err.Error())
	case errors.Is(err, repository.ErrTeamWalletForbidden):
		return teamError(http.StatusForbidden, "team_wallet_forbidden", err.Error())
	case errors.Is(err, repository.ErrTeamWalletAmount):
		return BadAuthRequest(err.Error())
	case errors.Is(err, repository.ErrActiveTaskLimit):
		return teamError(http.StatusConflict, "team_generation_limit", "当前团队正在生成的任务已达上限，请等待完成后再试")
	default:
		return teamNotFound(err)
	}
}

func (s *Service) GetTeamWallet(userID, teamID string) (*repository.TeamWalletView, error) {
	member, err := s.requireTeamMember(userID, teamID, false)
	if err != nil {
		return nil, err
	}
	return s.repo.TeamWallet(member, member.Role == model.TeamOwner)
}

func (s *Service) GetTeamWalletLedger(userID, teamID string, page, limit int) (*TeamWalletLedgerPage, error) {
	member, err := s.requireTeamMember(userID, teamID, false)
	if err != nil {
		return nil, err
	}
	page, limit = normalizeAdminPage(page, limit)
	membershipID := member.ID
	if member.Role == model.TeamOwner {
		membershipID = ""
	}
	entries, total, err := s.repo.TeamCreditLedger(teamID, membershipID, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &TeamWalletLedgerPage{Entries: entries, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) TransferTeamCredits(userID, teamID, membershipID, operation string, amount int64, idempotencyKey string) (*repository.TeamCreditTransferResult, error) {
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	key := strings.TrimSpace(idempotencyKey)
	if amount <= 0 || key == "" || len(key) > 128 {
		return nil, BadAuthRequest("请填写正整数微积分和有效的请求标识")
	}
	result, err := s.repo.TransferTeamCredits(userID, teamID, membershipID, operation, amount, key)
	return result, teamWalletError(err)
}

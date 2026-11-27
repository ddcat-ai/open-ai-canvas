package app

import (
	"errors"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

var membershipCards = map[string]struct {
	name string
	days int
}{
	"week": {"周卡", 7}, "month": {"月卡", 30}, "quarter": {"季卡", 90}, "year": {"年卡", 365},
}

type MembershipStatus struct {
	SalesEnabled bool                     `json:"salesEnabled"`
	BaseGroup    string                   `json:"baseGroup"`
	Periods      []model.MembershipPeriod `json:"periods"`
}

func (s *Service) membershipSalesEnabled() (bool, error) {
	row, err := s.repo.SystemSettingOptional(model.MembershipSalesKey)
	if err != nil || row == nil {
		return false, err
	}
	return strconv.ParseBool(row.ValueJSON)
}

func (s *Service) SetMembershipSales(actor *model.User, enabled bool) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if err := s.repo.SaveSystemSetting(&model.SystemSetting{Key: model.MembershipSalesKey, ValueJSON: strconv.FormatBool(enabled), UpdatedBy: actor.ID}); err != nil {
		return err
	}
	return s.appendAdminAudit(actor, "membership.sales", "membership", "sales", "修改会员销售开关", map[string]bool{"enabled": enabled})
}

func (s *Service) SaveMembershipCard(actor *model.User, term string, in model.MembershipCardInput) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	card, ok := membershipCards[term]
	if !ok {
		return BadAuthRequest("不支持的会员卡周期")
	}
	group := strings.TrimSpace(in.MembershipGroup)
	if group == "" || strings.TrimSpace(in.Currency) == "" || in.AmountFen <= 0 || in.AmountFen > 100_000_000 || in.CreditsMicrocredits < 0 || in.CreditsMicrocredits > maxTopupCreditsMicrocredits {
		return BadAuthRequest("请设置有效的售价、币种、用户组和赠送积分")
	}
	currency, err := normalizePaymentCurrency(in.Currency)
	if err != nil {
		return err
	}
	p := model.TopupProduct{ID: "membership-" + term, Kind: model.TopupProductKindMembership, Name: card.name, MembershipTerms: model.MembershipTerms{MembershipDays: card.days, MembershipGroup: group},
		Enabled: in.Enabled, AmountFen: in.AmountFen, Currency: currency, CreditsMicrocredits: in.CreditsMicrocredits, SaleStrategy: model.TopupSaleStrategyUnlimited, SortOrder: card.days, CreatedBy: actor.ID, UpdatedBy: actor.ID}
	if err := s.repo.SaveMembershipCard(&p); err != nil {
		if errors.Is(err, repository.ErrMembershipGroupMissing) {
			return BadAuthRequest("绑定的用户组不存在")
		}
		return err
	}
	return s.appendAdminAudit(actor, "membership.card", "topup_product", p.ID, "修改会员卡", in)
}

func (s *Service) MembershipStatus(user *model.User) (*MembershipStatus, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	enabled, err := s.membershipSalesEnabled()
	if err != nil {
		return nil, err
	}
	rows, err := s.repo.MembershipPeriods(user.ID, time.Now())
	if err != nil {
		return nil, err
	}
	return &MembershipStatus{SalesEnabled: enabled, BaseGroup: normalizeUserGroupCode(user.UserGroup), Periods: rows}, nil
}

func (s *Service) effectiveMembershipGroup(user *model.User, now time.Time) (*resolvedUserGroup, *time.Time, error) {
	code := user.UserGroup
	var end *time.Time
	if user.MembershipUntil != nil && now.Before(*user.MembershipUntil) {
		period, err := s.repo.ActiveMembershipPeriod(user.ID, now)
		if err != nil {
			return nil, nil, err
		}
		code, end = period.MembershipGroup, period.MembershipEndsAt
	}
	group, err := s.resolvedUserGroup(code)
	return group, end, err
}

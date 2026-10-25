package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type UserGroupRatesRequest struct {
	Rates   map[string]int64 `json:"rates"`
	Version int64            `json:"version"`
}
type UserGroupRateView struct {
	ID                           string `json:"id"`
	Name                         string `json:"name"`
	DefaultMultiplierBasisPoints *int64 `json:"defaultMultiplierBasisPoints"`
	MultiplierBasisPoints        *int64 `json:"multiplierBasisPoints"`
}
type UserGroupRatesView struct {
	Items   []UserGroupRateView `json:"items"`
	Version int64               `json:"version"`
}

func (s *Service) AdminUserGroupRates(actor *model.User, userID string) (*UserGroupRatesView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if _, err := s.repo.User(userID); err != nil {
		return nil, err
	}
	groups, err := s.AdminModelDisplayGroups(actor)
	if err != nil {
		return nil, err
	}
	row, err := s.repo.UserGroupRates(userID)
	if err != nil {
		return nil, err
	}
	rates := map[string]int64{}
	if err := json.Unmarshal([]byte(row.RatesJSON), &rates); err != nil {
		return nil, err
	}
	view := &UserGroupRatesView{Items: []UserGroupRateView{}, Version: row.Version}
	for _, group := range groups.Groups {
		base := int64(10000)
		item := UserGroupRateView{ID: group.ID, Name: group.Name}
		if base > 0 {
			item.DefaultMultiplierBasisPoints = &base
		}
		if value, ok := rates[group.ID]; ok {
			item.MultiplierBasisPoints = &value
		}
		view.Items = append(view.Items, item)
	}
	return view, nil
}

func (s *Service) SaveAdminUserGroupRates(actor *model.User, userID string, req UserGroupRatesRequest) error {
	view, err := s.AdminUserGroupRates(actor, userID)
	if err != nil {
		return err
	}
	if req.Version < 0 || req.Rates == nil || len(req.Rates) > 10000 {
		return BadAuthRequest("分组倍率配置无效")
	}
	allowed := map[string]bool{}
	for _, group := range view.Items {
		allowed[group.ID] = true
	}
	for id, value := range req.Rates {
		if !allowed[id] || value <= 0 || value > 10000 {
			return BadAuthRequest("分组不存在或倍率无效，请刷新后重试")
		}
	}
	data, err := json.Marshal(req.Rates)
	if err != nil {
		return err
	}
	audit, err := newAdminAuditEvent(actor, "user.group_rates", "user", userID, "更新用户分组倍率", map[string]any{"before": view, "after": req})
	if err != nil {
		return err
	}
	return userGroupRateWriteError(s.repo.SaveUserGroupRates(&model.UserGroupRates{UserID: userID, RatesJSON: string(data), Version: req.Version + 1}, req.Version, audit))
}

type displayGroupRate struct {
	multiplier int64
	snapshot   model.BillingGroupSnapshot
}

func (s *Service) displayGroupPricing(userID string) (map[string]displayGroupRate, bool, error) {
	config, _, err := s.readModelDisplayGroups()
	if err != nil || config == nil {
		return nil, false, err
	}
	rates := map[string]int64{}
	var version int64
	if userID != "" {
		row, err := s.repo.UserGroupRates(userID)
		if err != nil {
			return nil, true, err
		}
		if err := json.Unmarshal([]byte(row.RatesJSON), &rates); err != nil {
			return nil, true, err
		}
		version = row.Version
	}
	result := map[string]displayGroupRate{}
	for _, group := range config.Groups {
		// Group membership organizes models; only a personal rate discounts sale prices.
		value := int64(10000)
		snapshot := model.BillingGroupSnapshot{BillingGroupID: group.ID, BillingGroupName: group.Name, BillingGroupVersion: group.RateVersion, MultiplierSource: "sale"}
		if personal, ok := rates[group.ID]; ok {
			value = personal
			snapshot.MultiplierSource = "user"
			snapshot.BillingMemberVersion = version
		}
		if value <= 0 || value > 10000 {
			return nil, true, BadAuthRequest("分组倍率无效，请联系管理员")
		}
		for _, id := range group.ModelIDs {
			result[id] = displayGroupRate{value, snapshot}
		}
	}
	return result, true, nil
}

func userGroupRateWriteError(err error) error {
	if errors.Is(err, repository.ErrUserGroupRatesChanged) {
		return NewAppError(http.StatusConflict, err.Error())
	}
	return err
}

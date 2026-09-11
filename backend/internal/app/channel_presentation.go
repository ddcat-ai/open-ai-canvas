package app

import (
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

func (req ChannelRequest) presentationOnly() bool {
	return (req.PublicAlias != nil || req.SortOrder != nil) && req.Name == "" && req.BaseURL == "" && req.AllowLocalChannel == nil && req.APIKey == "" && req.SecretKey == "" && req.ConcurrencyLimit == nil && req.UseGlobalConcurrency == nil && req.Models == nil && req.Headers == nil && req.Enabled == nil
}

func (s *Service) updateChannelPresentation(id string, req ChannelRequest) (*PublicModelChannel, error) {
	if req.SortOrder != nil {
		if err := validateChannelSortOrder(*req.SortOrder); err != nil {
			return nil, err
		}
	}
	if req.PublicAlias != nil {
		alias := strings.TrimSpace(*req.PublicAlias)
		if len([]rune(alias)) > 80 {
			return nil, BadAuthRequest("前台别名不能超过 80 字")
		}
		req.PublicAlias = &alias
	}
	if err := s.repo.UpdateSystemChannelPresentation(id, req.PublicAlias, req.SortOrder, time.Now()); err != nil {
		return nil, err
	}
	s.invalidateRouteCatalog()
	channel, err := s.repo.AdminSystemChannel(id)
	if err != nil {
		return nil, err
	}
	items, err := s.repo.ChannelModels(id, true)
	if err != nil {
		return nil, err
	}
	public := publicChannel(*channel, true, items)
	return &public, nil
}

type ChannelModelSortRequest struct {
	SortOrder *int `json:"sortOrder"`
}

func validateChannelSortOrder(value int) error {
	if value < 0 || value > 999999 {
		return BadAuthRequest("排序值必须是 0-999999 的整数，数值越小越靠前")
	}
	return nil
}

func (s *Service) UpdateAdminChannelModelSort(actor *model.User, channelID, modelID string, req ChannelModelSortRequest) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if req.SortOrder == nil {
		return BadAuthRequest("请填写排序值")
	}
	if err := validateChannelSortOrder(*req.SortOrder); err != nil {
		return err
	}
	if _, err := s.repo.AdminSystemChannel(channelID); err != nil {
		return err
	}
	if err := s.repo.UpdateChannelModelSort(channelID, modelID, *req.SortOrder, time.Now()); err != nil {
		return err
	}
	s.invalidateRouteCatalog()
	return nil
}

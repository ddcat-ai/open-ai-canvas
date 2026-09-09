package service

import (
	"errors"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"net/http"
)

type ChannelOrderItem struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
}
type ChannelOrderRequest struct {
	IDs         []string `json:"ids"`
	ExpectedIDs []string `json:"expectedIds"`
}

func (s *Service) AdminChannelOrder(actor *model.User, channelID string) ([]ChannelOrderItem, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	result := []ChannelOrderItem{}
	if channelID == "" {
		rows, err := s.repo.SystemChannels(true)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			result = append(result, ChannelOrderItem{row.ID, row.Name, row.Enabled})
		}
	} else {
		if _, err := s.repo.AdminSystemChannel(channelID); err != nil {
			return nil, err
		}
		rows, err := s.repo.ChannelModels(channelID, true)
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			result = append(result, ChannelOrderItem{row.ID, firstNonEmpty(row.DisplayName, row.ModelKey), row.Enabled})
		}
	}
	return result, nil
}

func (s *Service) SaveAdminChannelOrder(actor *model.User, channelID string, req ChannelOrderRequest) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if req.IDs == nil || req.ExpectedIDs == nil || len(req.IDs) > 10000 {
		return BadAuthRequest("请重新加载完整排序列表")
	}
	err := s.repo.SaveChannelOrder(channelID, req.IDs, req.ExpectedIDs)
	if errors.Is(err, repository.ErrChannelOrderChanged) {
		return NewAppError(http.StatusConflict, err.Error())
	}
	if err == nil {
		s.invalidateRouteCatalog()
	}
	return err
}

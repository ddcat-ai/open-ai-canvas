package app

import (
	"yingce/backend/internal/canvas"
	"yingce/backend/internal/model"
)

type NodeToolbarPreferenceRequest = canvas.NodeToolbarPreferenceRequest

func (s *Service) UserNodeToolbarPreferences(user *model.User) (map[string][]string, error) {
	return s.canvasDomain().UserNodeToolbarPreferences(user)
}

func (s *Service) UpdateUserNodeToolbarPreference(user *model.User, nodeType string, req NodeToolbarPreferenceRequest) ([]string, error) {
	return s.canvasDomain().UpdateUserNodeToolbarPreference(user, nodeType, req)
}

func (s *Service) ResetUserNodeToolbarPreference(user *model.User, nodeType string) error {
	return s.canvasDomain().ResetUserNodeToolbarPreference(user, nodeType)
}

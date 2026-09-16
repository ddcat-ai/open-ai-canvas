package app

import (
	"infinite-canvas/backend/internal/tools"
)

type (
	ToolListRequest     = tools.ToolListRequest
	ToolList            = tools.ToolList
	ToolItem            = tools.ToolItem
	ToolMutationRequest = tools.ToolMutationRequest
)

func (s *Service) toolDomain() *tools.Service {
	if s == nil {
		return tools.New(nil)
	}
	if s.tools != nil {
		return s.tools
	}
	return tools.New(s.repo)
}

func (s *Service) Tools(userID string, req ToolListRequest) (*ToolList, error) {
	return s.toolDomain().List(userID, req)
}

func (s *Service) SetToolFavorite(userID string, toolID int64, favorite bool) (*ToolItem, error) {
	return s.toolDomain().SetFavorite(userID, toolID, favorite)
}

func (s *Service) CreateTool(userID string, req ToolMutationRequest) (*ToolItem, error) {
	return s.toolDomain().Create(userID, req)
}

func (s *Service) DeleteTool(userID string, toolID int64) error {
	return s.toolDomain().Delete(userID, toolID)
}

func (s *Service) EnsureBuiltinTools() error {
	return tools.EnsureBuiltinTools(s.repo)
}

package app

import (
	"infinite-canvas/backend/internal/tools"
)

func (s *Service) EnsureBuiltinTools() error {
	return tools.EnsureBuiltinTools(s.repo)
}

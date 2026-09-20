package canvas

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) scopedCanvasProject(actor *model.User, id string) (*model.CanvasProject, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	project, err := s.repo.CanvasProject(id)
	if err != nil {
		return nil, mapCanvasCollaborationTransactionError(err)
	}
	if project.UserID == actor.ID {
		return project, nil
	}
	if _, err := s.repo.CanvasCollaboratorForUser(id, actor.ID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NewAppError(http.StatusNotFound, "画布不存在或无权访问")
		}
		return nil, err
	}
	return project, nil
}

func normalizeDisplayName(displayName, username string) string {
	if name := strings.TrimSpace(displayName); name != "" {
		return name
	}
	return username
}

func mustJSON(value any) string { raw, _ := json.Marshal(value); return string(raw) }

func mergeCanvasProjects(primary, shared []model.CanvasProject) []model.CanvasProject {
	seen := make(map[string]bool)
	result := make([]model.CanvasProject, 0, len(primary)+len(shared))
	for _, group := range [][]model.CanvasProject{primary, shared} {
		for _, project := range group {
			if !seen[project.ID] {
				seen[project.ID] = true
				result = append(result, project)
			}
		}
	}
	return result
}

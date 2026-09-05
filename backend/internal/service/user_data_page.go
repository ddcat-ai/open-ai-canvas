package service

import (
	"encoding/json"
	"strings"
	"time"
)

func (s *Service) UserAssetsByIDs(userID string, ids []string) ([]json.RawMessage, error) {
	if len(ids) > 100 {
		return nil, BadAuthRequest("每次最多读取 100 个素材")
	}
	unique := make([]string, 0, len(ids))
	seen := make(map[string]bool, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" || len(id) > 80 {
			return nil, BadAuthRequest("素材 ID 无效")
		}
		if !seen[id] {
			seen[id] = true
			unique = append(unique, id)
		}
	}
	assets, err := s.repo.AssetsForUserIDs(userID, unique)
	if err != nil {
		return nil, err
	}
	result := make([]json.RawMessage, 0, len(assets))
	for _, asset := range assets {
		result = append(result, json.RawMessage(asset.PayloadJSON))
	}
	return result, nil
}

type CanvasLibrarySummary struct {
	ID           string           `json:"id"`
	ProjectID    string           `json:"projectId,omitempty"`
	Title        string           `json:"title"`
	CreatedAt    time.Time        `json:"createdAt"`
	UpdatedAt    time.Time        `json:"updatedAt"`
	NodeCount    int              `json:"nodeCount"`
	PreviewNodes []map[string]any `json:"previewNodes"`
}

type CanvasLibraryPage struct {
	Projects []CanvasLibrarySummary `json:"projects"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"pageSize"`
	Total    int64                  `json:"total"`
	HasMore  bool                   `json:"hasMore"`
}

func (s *Service) UserCanvasProjectsPage(userID string, page int, pageSize int, projectID string, search string, sort string) (CanvasLibraryPage, error) {
	if page < 1 {
		page = 1
	}
	if page > 1000000 {
		return CanvasLibraryPage{}, BadAuthRequest("页码超出范围")
	}
	if pageSize < 1 {
		pageSize = 40
	}
	if pageSize > 50 {
		pageSize = 50
	}
	projects, total, err := s.repo.UserCanvasProjectsPage(userID, page, pageSize, projectID, search, sort)
	if err != nil {
		return CanvasLibraryPage{}, err
	}
	result := CanvasLibraryPage{Projects: make([]CanvasLibrarySummary, 0, len(projects)), Page: page, PageSize: pageSize, Total: total, HasMore: int64(page)*int64(pageSize) < total}
	for _, project := range projects {
		var document struct {
			Nodes []map[string]any `json:"nodes"`
		}
		if err := json.Unmarshal([]byte(project.PayloadJSON), &document); err != nil {
			return CanvasLibraryPage{}, err
		}
		preview := make([]map[string]any, 0, 4)
		for _, node := range document.Nodes {
			if len(preview) == 4 {
				break
			}
			if node["type"] != "image" && node["type"] != "video" {
				continue
			}
			item := map[string]any{"position": map[string]int{"x": 0, "y": 0}}
			for _, key := range []string{"id", "type", "title"} {
				if value, ok := node[key].(string); ok {
					item[key] = string([]rune(value)[:min(len([]rune(value)), 256)])
				}
			}
			for _, key := range []string{"width", "height"} {
				if value, ok := node[key].(float64); ok {
					item[key] = value
				}
			}
			metadata := map[string]any{}
			if original, ok := node["metadata"].(map[string]any); ok {
				if key, ok := original["storageKey"].(string); ok && len(key) <= 512 {
					metadata["storageKey"] = key
				}
			}
			item["metadata"] = metadata
			preview = append(preview, item)
		}
		result.Projects = append(result.Projects, CanvasLibrarySummary{ID: project.ID, ProjectID: project.ProjectID, Title: project.Title, CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt, NodeCount: len(document.Nodes), PreviewNodes: preview})
	}
	return result, nil
}

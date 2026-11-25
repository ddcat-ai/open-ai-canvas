package canvas

import (
	"encoding/json"
	"regexp"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

type NodeToolbarPreferenceRequest struct {
	PinnedEntryIDs []string `json:"pinnedEntryIds"`
}

var toolbarEntryIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$`)

func (s *Service) UserNodeToolbarPreferences(user *model.User) (map[string][]string, error) {
	if user == nil || user.ID == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	rows, err := s.repo.UserNodeToolbarPreferences(user.ID)
	if err != nil {
		return nil, err
	}
	preferences := make(map[string][]string, len(rows))
	for _, row := range rows {
		var entries []string
		if err := json.Unmarshal([]byte(row.PinnedEntryIDsJSON), &entries); err != nil {
			return nil, err
		}
		preferences[row.NodeType] = entries
	}
	return preferences, nil
}

func (s *Service) UpdateUserNodeToolbarPreference(user *model.User, nodeType string, req NodeToolbarPreferenceRequest) ([]string, error) {
	if err := validateNodeToolbarOwner(user, nodeType); err != nil {
		return nil, err
	}
	if req.PinnedEntryIDs == nil || len(req.PinnedEntryIDs) > 256 {
		return nil, kernel.BadAuthRequest("固定入口必须为数组，最多 256 项")
	}
	seen := make(map[string]bool, len(req.PinnedEntryIDs))
	for _, id := range req.PinnedEntryIDs {
		if !toolbarEntryIDPattern.MatchString(id) || seen[id] {
			return nil, kernel.BadAuthRequest("固定入口标识无效或重复")
		}
		seen[id] = true
	}
	encoded, err := json.Marshal(req.PinnedEntryIDs)
	if err != nil {
		return nil, err
	}
	if err := s.repo.SaveUserNodeToolbarPreference(&model.UserNodeToolbarPreference{
		UserID: user.ID, NodeType: nodeType, PinnedEntryIDsJSON: string(encoded),
	}); err != nil {
		return nil, err
	}
	return req.PinnedEntryIDs, nil
}

func (s *Service) ResetUserNodeToolbarPreference(user *model.User, nodeType string) error {
	if err := validateNodeToolbarOwner(user, nodeType); err != nil {
		return err
	}
	return s.repo.DeleteUserNodeToolbarPreference(user.ID, nodeType)
}

func validateNodeToolbarOwner(user *model.User, nodeType string) error {
	if user == nil || user.ID == "" {
		return kernel.Unauthorized("请先登录")
	}
	switch nodeType {
	case "image", "video", "audio", "text":
		return nil
	default:
		return kernel.BadAuthRequest("不支持的节点类型")
	}
}

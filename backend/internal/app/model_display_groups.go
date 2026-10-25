package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type ModelDisplayGroup struct {
	RateVersion int64                    `json:"rateVersion,omitempty"`
	ID          string                   `json:"id"`
	Name        string                   `json:"name"`
	ModelIDs    []string                 `json:"modelIds"`
	Collections []ModelDisplayCollection `json:"collections,omitempty"`
}
type ModelDisplayCollectionMember struct {
	ModelID    string `json:"modelId"`
	Resolution string `json:"resolution"`
}
type ModelDisplayCollection struct {
	ID      string                         `json:"id"`
	Name    string                         `json:"name"`
	Members []ModelDisplayCollectionMember `json:"members"`
}
type PublicModelDisplayCollection struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	Resolution string `json:"resolution"`
}
type ModelDisplayGroups struct {
	Groups []ModelDisplayGroup `json:"groups"`
}
type ModelDisplayGroupsView struct {
	Groups      []ModelDisplayGroup             `json:"groups"`
	Models      []repository.ModelDisplayMember `json:"models"`
	Snapshot    string                          `json:"snapshot"`
	Initialized bool                            `json:"initialized"`
}
type ModelDisplayGroupsRequest struct {
	Groups           []ModelDisplayGroup `json:"groups"`
	ExpectedSnapshot string              `json:"expectedSnapshot"`
	MemberLabels     map[string]string   `json:"memberLabels,omitempty"`
}
type PublicModelDisplayGroup struct {
	ID          string                        `json:"id"`
	Name        string                        `json:"name"`
	Order       int                           `json:"order"`
	MemberOrder int                           `json:"memberOrder"`
	Collection  *PublicModelDisplayCollection `json:"collection,omitempty"`
}

func (s *Service) readModelDisplayGroups() (*ModelDisplayGroups, string, error) {
	setting, err := s.repo.SystemSettingOptional(repository.ModelDisplayGroupsKey)
	if err != nil {
		return nil, "", err
	}
	if setting == nil || setting.ValueJSON == "" {
		return nil, "", nil
	}
	var value ModelDisplayGroups
	if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
		return nil, "", err
	}
	if value.Groups == nil {
		return nil, "", errors.New("模型分组配置损坏")
	}
	return &value, setting.ValueJSON, nil
}

func (s *Service) AdminModelDisplayGroups(actor *model.User) (*ModelDisplayGroupsView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	config, raw, err := s.readModelDisplayGroups()
	if err != nil {
		return nil, err
	}
	members, err := s.repo.ModelDisplayMembers()
	if err != nil {
		return nil, err
	}
	view := &ModelDisplayGroupsView{Models: members, Groups: []ModelDisplayGroup{}, Snapshot: repository.ModelDisplaySnapshot(raw, members), Initialized: config != nil}
	if config != nil {
		existing := map[string]bool{}
		for _, member := range members {
			existing[member.ID] = true
		}
		for _, group := range config.Groups {
			ids := []string{}
			for _, id := range group.ModelIDs {
				if existing[id] {
					ids = append(ids, id)
				}
			}
			group.ModelIDs = ids
			group.filterCollectionMembers(existing)
			view.Groups = append(view.Groups, group)
		}
	}
	return view, nil
}

var modelDisplayGroupID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,80}$`)

func (s *Service) SaveAdminModelDisplayGroups(actor *model.User, request ModelDisplayGroupsRequest) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	if request.ExpectedSnapshot == "" || request.Groups == nil || len(request.Groups) > 10000 {
		return BadAuthRequest("分组配置无效，请重新加载")
	}
	members, err := s.repo.ModelDisplayMembers()
	if err != nil {
		return err
	}
	allowed := map[string]bool{}
	for _, member := range members {
		allowed[member.ID] = true
	}
	for id, label := range request.MemberLabels {
		label = strings.TrimSpace(label)
		if !allowed[id] || utf8.RuneCountInString(label) > 80 {
			return BadAuthRequest("模型不存在或二级名称超过80字，请重新加载后检查")
		}
		request.MemberLabels[id] = label
	}
	groupIDs, names, assigned := map[string]bool{}, map[string]bool{}, map[string]bool{}
	previous, _, err := s.readModelDisplayGroups()
	if err != nil {
		return err
	}
	previousGroups := map[string]ModelDisplayGroup{}
	if previous != nil {
		for _, group := range previous.Groups {
			previousGroups[group.ID] = group
		}
	}
	for index := range request.Groups {
		group := &request.Groups[index]
		old := previousGroups[group.ID]
		group.RateVersion = old.RateVersion
		if old.Name != strings.TrimSpace(group.Name) {
			group.RateVersion++
		}
		group.Name = strings.TrimSpace(group.Name)
		if !modelDisplayGroupID.MatchString(group.ID) || groupIDs[group.ID] || group.Name == "" || utf8.RuneCountInString(group.Name) > 160 || names[group.Name] {
			return BadAuthRequest("分组需要唯一标识和不重复的名称（最多160字）")
		}
		groupIDs[group.ID], names[group.Name] = true, true
		if group.ModelIDs == nil {
			group.ModelIDs = []string{}
		}
		for _, id := range group.ModelIDs {
			if !allowed[id] || assigned[id] {
				return BadAuthRequest("模型不存在或重复加入分组，请刷新后重试")
			}
			assigned[id] = true
		}
	}
	if err := s.validateModelDisplayCollections(request.Groups, members); err != nil {
		return err
	}
	encoded, err := json.Marshal(ModelDisplayGroups{Groups: request.Groups})
	if err != nil {
		return err
	}
	audit, err := newAdminAuditEvent(actor, "model_display_groups.update", "system_setting", repository.ModelDisplayGroupsKey, "更新模型分组", map[string]any{"before": previous, "after": request.Groups})
	if err != nil {
		return err
	}
	err = s.repo.SaveModelDisplayGroupsWithLabels(request.ExpectedSnapshot, string(encoded), actor.ID, audit, request.MemberLabels)
	if errors.Is(err, repository.ErrModelDisplayGroupsChanged) {
		return NewAppError(http.StatusConflict, err.Error())
	}
	if err != nil {
		return err
	}
	s.invalidateRouteCatalog()
	return nil
}

func (config *ModelDisplayGroups) publicAssignments() map[string]*PublicModelDisplayGroup {
	assignments := map[string]*PublicModelDisplayGroup{}
	for order, group := range config.Groups {
		for memberOrder, id := range group.ModelIDs {
			assignments[id] = &PublicModelDisplayGroup{ID: group.ID, Name: group.Name, Order: order, MemberOrder: memberOrder}
		}
		for _, collection := range group.Collections {
			for _, member := range collection.Members {
				if assignment := assignments[member.ModelID]; assignment != nil {
					assignment.Collection = &PublicModelDisplayCollection{ID: collection.ID, Name: collection.Name, Resolution: member.Resolution}
				}
			}
		}
	}
	return assignments
}

func (s *Service) saveChannelModelDisplayAssignment(actor *model.User, item *model.ChannelModel, tiers []model.ChannelModelPriceTier, req ChannelModelRequest) error {
	if req.DisplayGroupID == nil {
		return s.repo.SaveChannelModelWithPriceTiers(item, tiers)
	}
	view, err := s.AdminModelDisplayGroups(actor)
	if err != nil {
		return err
	}
	if req.DisplayGroupSnapshot == "" || view.Snapshot != req.DisplayGroupSnapshot {
		return NewAppError(http.StatusConflict, repository.ErrModelDisplayGroupsChanged.Error())
	}
	destination := *req.DisplayGroupID
	found := destination == ""
	for index := range view.Groups {
		group := &view.Groups[index]
		if group.ID == destination {
			found = true
			present := false
			for _, id := range group.ModelIDs {
				if id == item.ID {
					present = true
					break
				}
			}
			if !present {
				group.ModelIDs = append(group.ModelIDs, item.ID)
			}
		} else {
			ids := make([]string, 0, len(group.ModelIDs))
			for _, id := range group.ModelIDs {
				if id != item.ID {
					ids = append(ids, id)
				}
			}
			group.ModelIDs = ids
			remaining := map[string]bool{}
			for _, id := range ids {
				remaining[id] = true
			}
			group.filterCollectionMembers(remaining)
		}
	}
	if !found {
		return BadAuthRequest("目标分组不存在，请重新加载模型表单")
	}
	encoded, err := json.Marshal(ModelDisplayGroups{Groups: view.Groups})
	if err != nil {
		return err
	}
	audit, err := newAdminAuditEvent(actor, "model_display_groups.assign", "channel_model", item.ID, "更新模型所属分组", map[string]any{"groupId": destination})
	if err != nil {
		return err
	}
	err = s.repo.SaveChannelModelAndDisplayGroups(item, tiers, req.DisplayGroupSnapshot, string(encoded), actor.ID, audit)
	if errors.Is(err, repository.ErrModelDisplayGroupsChanged) {
		return NewAppError(http.StatusConflict, err.Error())
	}
	return err
}

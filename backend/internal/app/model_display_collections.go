package app

import (
	"strings"
	"unicode/utf8"
	"yingce/backend/internal/repository"
)

func (group *ModelDisplayGroup) filterCollectionMembers(existing map[string]bool) {
	for index := range group.Collections {
		members := []ModelDisplayCollectionMember{}
		for _, member := range group.Collections[index].Members {
			if existing[member.ModelID] {
				members = append(members, member)
			}
		}
		group.Collections[index].Members = members
	}
}

func (s *Service) validateModelDisplayCollections(groups []ModelDisplayGroup, catalog []repository.ModelDisplayMember) error {
	models := map[string]repository.ModelDisplayMember{}
	for _, member := range catalog {
		models[member.ID] = member
	}
	ids := map[string]bool{}
	for gi := range groups {
		group := &groups[gi]
		grouped := map[string]bool{}
		for _, id := range group.ModelIDs {
			grouped[id] = true
		}
		assigned, names := map[string]bool{}, map[string]bool{}
		for ci := range group.Collections {
			collection := &group.Collections[ci]
			collection.Name = strings.TrimSpace(collection.Name)
			if !modelDisplayGroupID.MatchString(collection.ID) || ids[collection.ID] || collection.Name == "" || utf8.RuneCountInString(collection.Name) > 160 || names[collection.Name] {
				return BadAuthRequest("模型集合需要唯一标识和不重复的名称（最多160字）")
			}
			ids[collection.ID], names[collection.Name] = true, true
			resolutions := map[string]bool{}
			if collection.Members == nil {
				collection.Members = []ModelDisplayCollectionMember{}
			}
			for mi := range collection.Members {
				member := &collection.Members[mi]
				source, ok := models[member.ModelID]
				if !ok || !grouped[member.ModelID] || assigned[member.ModelID] || source.Capability != "video" {
					return BadAuthRequest("集合成员必须是本组内不重复的视频模型")
				}
				member.Resolution = strings.ToLower(strings.TrimSpace(member.Resolution))
				if member.Resolution == "" || len(member.Resolution) > 20 {
					return BadAuthRequest("请为集合内每个模型指定分辨率")
				}
				resolution := normalizedScalar(normalizeModelRequestOption("vquality", member.Resolution))
				if resolutions[resolution] {
					return BadAuthRequest("一个集合不能为同一分辨率配置多个模型")
				}
				item, err := s.repo.ChannelModelByID(source.ChannelID, source.ID)
				if err != nil {
					return err
				}
				spec, err := channelModelCapabilitySpec(*item)
				if err != nil {
					return err
				}
				constraint, declared := spec.Options["vquality"]
				if !declared || !matchOptionConstraint("vquality", constraint, resolution) {
					return BadAuthRequest("集合分辨率不符合成员模型的能力或价格档，请检查配置")
				}
				assigned[member.ModelID], resolutions[resolution] = true, true
			}
		}
	}
	return nil
}

package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/ecommercecatalog"
	"yingce/backend/internal/ecommerceskills"
	"yingce/backend/internal/model"
)

func ecommerceManagedSkillKnowledge() []model.EcommerceKnowledgeEntry {
	var entries []model.EcommerceKnowledgeEntry
	for _, skill := range ecommerceskills.ManagedCatalog() {
		category := "general"
		if len(skill.Categories) == 1 {
			category = skill.Categories[0]
		}
		tags, _ := json.Marshal(append(append([]string{}, skill.Terms...), skill.Name, skill.ID))
		platforms, _ := json.Marshal(skill.Platforms)
		for _, part := range []struct{ domain, title, kind, guidance string }{
			{"KB15", "执行方法", "skill_method", skill.Method},
			{"KB16", "图片执行", "prompt_pattern", skill.ImageRule},
			{"KB17", "交付核对", "quality_rule", skill.Review},
		} {
			content, _ := json.Marshal(map[string]string{"guidance": part.guidance, "skillId": skill.ID, "sourceCommit": skill.SourceCommit, "scope": "reviewed creative method; not SKU facts or current platform policy"})
			entries = append(entries, model.EcommerceKnowledgeEntry{ID: strings.ToLower(part.domain) + "-" + skill.ID, SourceID: ecommerceBuiltinSourceID(part.domain), KnowledgeDomain: part.domain, KnowledgeType: part.kind, Title: skill.Name + " · " + part.title, ContentJSON: string(content), Category: category, PlatformsJSON: string(platforms), TagsJSON: string(tags), SourceURL: skill.SourceURL, SourceCommit: skill.SourceCommit, Version: strings.ToLower(part.domain) + "-v1-20261101", License: skill.License, TrustLevel: "first_party", ReviewStatus: "approved"})
		}
	}
	return entries
}

func ecommerceKnowledgeSkillEnabled(entry model.EcommerceKnowledgeEntry, policy map[string]bool, req EcommerceCreativeDirectionsRequest) bool {
	var data struct {
		SkillID string `json:"skillId"`
	}
	if json.Unmarshal([]byte(entry.ContentJSON), &data) != nil || data.SkillID == "" {
		return true
	}
	enabled, exists := policy[data.SkillID]
	if exists && !enabled {
		return false
	}
	for _, skill := range ecommerceskills.ManagedCatalog() {
		if skill.ID != data.SkillID {
			continue
		}
		if len(skill.RootIDs) > 0 {
			root := ecommercecatalog.ResolveProduct(req.Category, req.ProductName).Node.RootID
			matched := false
			for _, id := range skill.RootIDs {
				matched = matched || id == root
			}
			if !matched {
				return false
			}
		}
		has := func(values []string, value string) bool {
			for _, v := range values {
				if v == value {
					return true
				}
			}
			return false
		}
		if len(skill.Types) > 0 && req.ImageType != "" && !has(skill.Types, req.ImageType) {
			return false
		}
		if len(skill.Modes) > 0 && !has(skill.Modes, req.ReferenceMode) {
			return false
		}
		if skill.NeedsText && (req.ImageType == "white" || req.ImageType == "three-view") {
			return false
		}
		if skill.NeedsSpecs && strings.TrimSpace(req.Specifications) == "" {
			return false
		}
		if skill.RequireTerms {
			text := strings.ToLower(req.Category + " " + req.ProductName + " " + req.Description + " " + req.Instruction)
			matched := false
			for _, term := range skill.Terms {
				matched = matched || strings.Contains(text, strings.ToLower(term))
			}
			if !matched {
				return false
			}
		}
		return true
	}
	return false
}

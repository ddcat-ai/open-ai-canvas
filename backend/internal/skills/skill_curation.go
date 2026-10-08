package skills

import (
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
	"strings"
	"unicode/utf8"
)

type SkillCuration = repository.SkillCuration
type SkillCurationAssignmentInput struct {
	RootID      *string  `json:"rootId,omitempty"`
	SkillID     string   `json:"skillId"`
	CategoryIDs []string `json:"categoryIds"`
}
type SkillCurationUpdate struct {
	Root             *model.SkillCurationRoot      `json:"root,omitempty"`
	ExpectedRevision *int64                        `json:"expectedRevision"`
	Enabled          *bool                         `json:"enabled,omitempty"`
	Category         *model.SkillCurationCategory  `json:"category,omitempty"`
	Assignment       *SkillCurationAssignmentInput `json:"assignment,omitempty"`
}

func (s *Service) SkillCuration(actor *model.User, admin bool) (*SkillCuration, error) {
	if err := s.curationActor(actor, admin); err != nil {
		return nil, err
	}
	return s.repo.SkillCuration(admin)
}
func (s *Service) curationActor(actor *model.User, admin bool) error {
	if actor == nil || actor.ID == "" {
		return kernel.Unauthorized("请先登录")
	}
	if admin {
		current, err := s.repo.User(actor.ID)
		if err != nil {
			return err
		}
		if current.Role != model.UserRoleAdmin || current.Status != model.UserStatusActive {
			return kernel.Forbidden("需要管理员权限")
		}
	}
	return nil
}
func (s *Service) UpdateSkillCuration(actor *model.User, req SkillCurationUpdate, requestID string) (*SkillCuration, error) {
	if err := s.curationActor(actor, true); err != nil {
		return nil, err
	}
	count := 0
	if req.Root != nil {
		count++
	}
	if req.Enabled != nil {
		count++
	}
	if req.Category != nil {
		count++
	}
	if req.Assignment != nil {
		count++
	}
	if req.ExpectedRevision == nil || *req.ExpectedRevision < 0 || count != 1 {
		return nil, kernel.BadAuthRequest("需要版本号和一项修改")
	}
	err := s.repo.UpdateSkillCuration(actor.ID, *req.ExpectedRevision, requestID, func(repo *repository.Repository) error {
		if req.Enabled != nil {
			return repo.SetSkillCurationEnabled(*req.Enabled)
		}
		state, err := repo.SkillCuration(true)
		if err != nil {
			return err
		}
		if req.Root != nil {
			return saveCurationRoot(repo, state, *req.Root)
		}
		if req.Category != nil {
			c := *req.Category
			c.Name = strings.Join(strings.Fields(c.Name), " ")
			c.NormalizedName = strings.ToLower(c.Name)
			if utf8.RuneCountInString(c.Name) < 1 || utf8.RuneCountInString(c.Name) > 64 || !activeCurationRoot(state, c.RootTag) {
				return kernel.BadAuthRequest("分类名称或一级分类无效")
			}
			exists := c.ID == ""
			for _, old := range state.Categories {
				if old.ID == c.ID {
					exists = true
					if old.RootTag != c.RootTag {
						return kernel.BadAuthRequest("不能移动子分类")
					}
				}
				if old.ID != c.ID && old.RootTag == c.RootTag && old.NormalizedName == c.NormalizedName {
					return kernel.BadAuthRequest("同一级分类下名称不能重复")
				}
			}
			if !exists {
				return kernel.NotFound("分类不存在")
			}
			if c.ID == "" {
				c.ID = kernel.NewID()
			}
			return repo.SaveSkillCurationCategory(&c)
		}
		a := req.Assignment
		if a.CategoryIDs == nil || len(a.CategoryIDs) > 32 {
			return kernel.BadAuthRequest("需要完整分类集合，最多32项")
		}
		skill, err := repo.CurationSkill(a.SkillID)
		if err != nil {
			return kernel.NotFound("公开技能不存在")
		}
		rootID := state.EffectiveRoot(skill)
		if a.RootID != nil {
			if *a.RootID != "" && !activeCurationRoot(state, *a.RootID) {
				return kernel.BadAuthRequest("一级分类必须存在且启用")
			}
			rootID = *a.RootID
			if rootID == "" {
				rootID = skill.Tag
				if !activeCurationRoot(state, rootID) {
					rootID = repository.UnassignedSkillRoot
				}
			}
		}
		seen := map[string]bool{}
		for _, id := range a.CategoryIDs {
			valid := false
			for _, c := range state.Categories {
				if c.ID == id && c.Enabled && c.RootTag == rootID {
					valid = true
				}
			}
			if !valid || seen[id] {
				return kernel.BadAuthRequest("分类必须启用、同根且不能重复")
			}
			seen[id] = true
		}
		if a.RootID != nil {
			if err := repo.AssignSkillCurationRoot(a.SkillID, *a.RootID); err != nil {
				return err
			}
		}
		return repo.AssignSkillCuration(a.SkillID, a.CategoryIDs)
	})
	if err != nil {
		return nil, err
	}
	return s.repo.SkillCuration(true)
}

func (s *Service) curationFilter(req SkillListRequest) (string, bool, error) {
	if req.PlatformCategoryID == "" && !req.PlatformUncategorized {
		return "", false, nil
	}
	state, err := s.repo.SkillCuration(false)
	if err != nil {
		return "", false, err
	}
	if !state.Enabled {
		return "", false, nil
	}
	if req.PlatformCategoryID != "" && req.PlatformUncategorized {
		return "", false, kernel.BadAuthRequest("分类和未细分不能同时筛选")
	}
	if req.PlatformCategoryID != "" {
		for _, c := range state.Categories {
			if c.ID == req.PlatformCategoryID {
				return c.ID, false, nil
			}
		}
		return "", false, kernel.BadAuthRequest("分类已停用或不存在，请重新选择")
	}
	return "", req.PlatformUncategorized, nil
}

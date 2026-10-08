package skills

import (
	"errors"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const (
	skillLibraryCategoryPlatform = "platform"
	skillLibraryCategoryPersonal = "personal"
)

type SkillLibraryCategory struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Scope string `json:"scope"`
	Count int64  `json:"count"`
}

type SkillLibraryCategoryList struct {
	Categories         []SkillLibraryCategory `json:"categories"`
	TotalCount         int64                  `json:"totalCount"`
	UncategorizedCount int64                  `json:"uncategorizedCount"`
}

type SkillLibraryCategoryMutationRequest struct {
	Name  string `json:"name"`
	Scope string `json:"scope"`
}

type SkillLibraryCategoryAssignmentRequest struct {
	CategoryID string `json:"categoryId"`
}

func (s *Service) SkillLibraryCategories(userID string, scope string) (*SkillLibraryCategoryList, error) {
	scope = normalizeSkillLibraryCategoryListScope(scope)
	categories, err := s.repo.SkillLibraryCategories(userID)
	if err != nil {
		return nil, err
	}
	counts, err := s.repo.SkillLibraryCategoryCounts(userID, scope)
	if err != nil {
		return nil, err
	}
	result := &SkillLibraryCategoryList{
		Categories:         make([]SkillLibraryCategory, 0, len(categories)),
		UncategorizedCount: counts[""],
	}
	result.TotalCount = result.UncategorizedCount
	for _, category := range categories {
		count := counts[category.ID]
		result.Categories = append(result.Categories, SkillLibraryCategory{
			ID: category.ID, Name: category.Name, Scope: category.Scope, Count: count,
		})
		result.TotalCount += count
	}
	return result, nil
}

func (s *Service) CreateSkillLibraryCategory(actor *model.User, req SkillLibraryCategoryMutationRequest) (*SkillLibraryCategory, error) {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	name, normalizedName := normalizeSkillLibraryCategoryName(req.Name)
	if name == "" || utf8.RuneCountInString(name) > 64 {
		return nil, kernel.BadAuthRequest("分类名称必须为 1-64 个字符")
	}
	scope := strings.ToLower(strings.TrimSpace(req.Scope))
	if scope == "" {
		scope = skillLibraryCategoryPersonal
	}
	if scope != skillLibraryCategoryPersonal && scope != skillLibraryCategoryPlatform {
		return nil, kernel.BadAuthRequest("分类范围必须是 personal 或 platform")
	}
	if scope == skillLibraryCategoryPlatform && actor.Role != model.UserRoleAdmin {
		return nil, kernel.Forbidden("只有管理员可以创建平台分类")
	}
	category := &model.SkillLibraryCategory{
		ID: kernel.NewID(), Name: name, NormalizedName: normalizedName, Scope: scope,
	}
	if scope == skillLibraryCategoryPersonal {
		category.OwnerID = actor.ID
	}
	created, err := s.repo.CreateSkillLibraryCategoryIfAvailable(actor.ID, category)
	if err != nil {
		return nil, err
	}
	if !created {
		return nil, kernel.BadAuthRequest("当前技能库中已存在同名分类")
	}
	return &SkillLibraryCategory{ID: category.ID, Name: category.Name, Scope: category.Scope}, nil
}

func (s *Service) DeleteSkillLibraryCategory(actor *model.User, id string) error {
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return kernel.Unauthorized("请先登录")
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return kernel.BadAuthRequest("分类 ID 不能为空")
	}
	category, err := s.repo.SkillLibraryCategory(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NotFound("技能库分类不存在")
	}
	if err != nil {
		return err
	}
	if category.Scope == skillLibraryCategoryPlatform {
		if actor.Role != model.UserRoleAdmin {
			return kernel.Forbidden("只有管理员可以删除平台分类")
		}
	} else if category.Scope != skillLibraryCategoryPersonal || category.OwnerID != actor.ID {
		return kernel.Forbidden("无权删除该技能库分类")
	}
	return s.repo.DeleteSkillLibraryCategory(id)
}

func (s *Service) SetSkillLibraryCategory(userID string, skillID string, categoryID string) (*SkillItem, error) {
	skill, err := s.visibleSkill(userID, skillID)
	if err != nil {
		return nil, err
	}
	if skill.OwnerID != userID {
		state, err := s.repo.UserSkillState(userID, skill.ID)
		if err != nil {
			return nil, err
		}
		if state == nil || !state.Added {
			return nil, kernel.Forbidden("只能为已加入或自己创建的技能设置分类")
		}
	}
	categoryID = strings.TrimSpace(categoryID)
	if categoryID != "" {
		category, err := s.repo.SkillLibraryCategory(categoryID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("技能库分类不存在")
		}
		if err != nil {
			return nil, err
		}
		if !isSkillLibraryCategoryVisibleTo(category, userID) {
			return nil, kernel.Forbidden("无权使用该技能库分类")
		}
	}
	state, err := s.skillState(userID, skill.ID)
	if err != nil {
		return nil, err
	}
	state.LibraryCategoryID = categoryID
	if err := s.repo.SetUserSkillLibraryCategory(state); err != nil {
		return nil, err
	}
	return s.SkillDetail(userID, skill.ID)
}

func normalizeSkillLibraryCategoryName(value string) (string, string) {
	name := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	return name, strings.ToLower(name)
}

func normalizeSkillLibraryCategoryListScope(value string) string {
	switch strings.TrimSpace(value) {
	case "created":
		return "created"
	default:
		return "mine"
	}
}

func isSkillLibraryCategoryVisibleTo(category *model.SkillLibraryCategory, userID string) bool {
	if category == nil {
		return false
	}
	return category.Scope == skillLibraryCategoryPlatform ||
		(category.Scope == skillLibraryCategoryPersonal && category.OwnerID == userID)
}

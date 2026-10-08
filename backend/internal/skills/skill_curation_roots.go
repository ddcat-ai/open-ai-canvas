package skills

import (
	"strings"
	"unicode/utf8"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func activeCurationRoot(state *SkillCuration, id string) bool {
	if id == repository.UnassignedSkillRoot {
		return false
	}
	for _, root := range state.Roots {
		if root.ID == id && root.Enabled {
			return true
		}
	}
	return false
}

func saveCurationRoot(repo *repository.Repository, state *SkillCuration, root model.SkillCurationRoot) error {
	root.Name = strings.Join(strings.Fields(root.Name), " ")
	root.NormalizedName = strings.ToLower(root.Name)
	if utf8.RuneCountInString(root.Name) < 1 || utf8.RuneCountInString(root.Name) > 64 {
		return kernel.BadAuthRequest("一级分类名称必须为1-64个字符")
	}
	switch root.IconKey {
	case "", "shapes", "film", "shopping-bag", "megaphone", "landmark", "palette", "users", "wrench":
	default:
		return kernel.BadAuthRequest("图示键无效")
	}
	exists := root.ID == ""
	for _, old := range state.Roots {
		if old.ID == root.ID {
			exists = true
		}
		if old.ID != root.ID && old.NormalizedName == root.NormalizedName {
			return kernel.BadAuthRequest("一级分类名称不能重复")
		}
	}
	if !exists {
		return kernel.NotFound("一级分类不存在")
	}
	if root.ID == "" {
		root.ID = kernel.NewID()
	}
	return repo.SaveSkillCurationRoot(&root)
}

func (s *Service) curationRootFilter(id string) (string, error) {
	if id == "" {
		return "", nil
	}
	state, err := s.repo.SkillCuration(false)
	if err != nil {
		return "", err
	}
	if !state.Enabled {
		return "", nil
	}
	if id == repository.UnassignedSkillRoot || activeCurationRoot(state, id) {
		return id, nil
	}
	return "", kernel.BadAuthRequest("一级分类已停用或不存在，请重新选择")
}

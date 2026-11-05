// 后台技能管理：管理员可查看全部技能（含私有、已下架），修改基本信息、上架 / 下架、删除，
// 并编辑所有非 GitHub 技能的文件内容。GitHub 技能的文件以仓库为准，只允许改基本信息。
package skills

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const skillStatusDisabled = 0

type AdminSkillListRequest struct {
	Page       int
	PageSize   int
	Keyword    string
	Status     string
	SourceType string
	Tag        string
}

type AdminSkillItem struct {
	SkillItem
	Enabled              bool       `json:"enabled"`
	ContentEditable      bool       `json:"contentEditable"`
	AdminInfoEditedAt    *time.Time `json:"adminInfoEditedAt,omitempty"`
	AdminContentEditedAt *time.Time `json:"adminContentEditedAt,omitempty"`
}

type AdminSkillList struct {
	Skills     []AdminSkillItem `json:"skills"`
	Total      int64            `json:"total"`
	Page       int              `json:"page"`
	PageSize   int              `json:"pageSize"`
	Categories []SkillCategory  `json:"categories"`
}

// AdminSkillInfoRequest 是后台可改的基本信息。正文走文件编辑接口；公开状态属于作者的选择，后台不改。
type AdminSkillInfoRequest struct {
	SkillName     string               `json:"skillName"`
	Description   string               `json:"description"`
	Tag           string               `json:"tag"`
	MarkdownURL   string               `json:"markdownUrl"`
	ShowcaseMedia []SkillShowcaseMedia `json:"showcaseMedia"`
	ExtraInfo     string               `json:"extraInfo"`
}

type AdminSkillPackageEditResult struct {
	Skill   *AdminSkillItem        `json:"skill"`
	Files   []SkillPackageFileItem `json:"files"`
	Changed bool                   `json:"changed"`
}

func requireSkillAdmin(actor *model.User) error {
	if actor == nil {
		return kernel.Unauthorized("请先登录")
	}
	if actor.Role != model.UserRoleAdmin {
		return kernel.Forbidden("需要管理员权限")
	}
	return nil
}

func isBuiltinSkill(skill *model.Skill) bool {
	return skill.SourceType == "builtin" || skill.Source == 3
}

// adminSkill 读取任意状态、任意可见性的技能，只给管理员入口使用。
func (s *Service) adminSkill(actor *model.User, id string) (*model.Skill, error) {
	if err := requireSkillAdmin(actor); err != nil {
		return nil, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, kernel.BadAuthRequest("技能 ID 不能为空")
	}
	skill, err := s.repo.SkillAnyStatus(id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("技能不存在或已删除")
	}
	return skill, err
}

func (s *Service) adminSkillItems(actor *model.User, rows []model.Skill) ([]AdminSkillItem, error) {
	items, err := s.skillItems(actor.ID, rows, false)
	if err != nil {
		return nil, err
	}
	result := make([]AdminSkillItem, 0, len(items))
	for index, item := range items {
		row := rows[index]
		result = append(result, AdminSkillItem{
			SkillItem: item, Enabled: row.Status == skillStatusEnabled, ContentEditable: row.SourceType != "github",
			AdminInfoEditedAt: row.AdminInfoEditedAt, AdminContentEditedAt: row.AdminContentEditedAt,
		})
	}
	return result, nil
}

func (s *Service) adminSkillItem(actor *model.User, id string) (*AdminSkillItem, error) {
	skill, err := s.repo.SkillAnyStatus(id)
	if err != nil {
		return nil, err
	}
	items, err := s.adminSkillItems(actor, []model.Skill{*skill})
	if err != nil {
		return nil, err
	}
	return &items[0], nil
}

func (s *Service) AdminSkills(actor *model.User, req AdminSkillListRequest) (*AdminSkillList, error) {
	if err := requireSkillAdmin(actor); err != nil {
		return nil, err
	}
	if req.Page <= 0 {
		req.Page = 1
	}
	if req.PageSize <= 0 || req.PageSize > 100 {
		req.PageSize = 20
	}
	req.Keyword = strings.TrimSpace(req.Keyword)
	switch req.Status {
	case "", "enabled", "disabled":
	default:
		return nil, kernel.BadAuthRequest("状态筛选仅支持 enabled 或 disabled")
	}
	switch req.SourceType {
	case "", "builtin", "markdown", "zip", "github":
	default:
		return nil, kernel.BadAuthRequest("来源筛选无效")
	}
	if req.Tag != "" {
		if _, ok := skillCategoryLabels[req.Tag]; !ok {
			return nil, kernel.BadAuthRequest("技能分类筛选无效")
		}
	}
	rows, total, err := s.repo.AdminSkills(repository.AdminSkillListFilter{
		Keyword: req.Keyword, Status: req.Status, SourceType: req.SourceType, Tag: req.Tag,
		Limit: req.PageSize, Offset: (req.Page - 1) * req.PageSize,
	})
	if err != nil {
		return nil, err
	}
	items, err := s.adminSkillItems(actor, rows)
	if err != nil {
		return nil, err
	}
	return &AdminSkillList{Skills: items, Total: total, Page: req.Page, PageSize: req.PageSize, Categories: skillCategories()}, nil
}

func (s *Service) AdminSkillDetail(actor *model.User, id string) (*AdminSkillItem, error) {
	skill, err := s.adminSkill(actor, id)
	if err != nil {
		return nil, err
	}
	return s.adminSkillItem(actor, skill.ID)
}

// AdminUpdateSkillInfo 只改基本信息，不重建文件包；同时记录 admin_info_edited_at，
// 之后内置技能启动同步和 GitHub 同步都不再覆盖这些字段。
func (s *Service) AdminUpdateSkillInfo(actor *model.User, id string, req AdminSkillInfoRequest) (*AdminSkillItem, error) {
	skill, err := s.adminSkill(actor, id)
	if err != nil {
		return nil, err
	}
	markdownURL := strings.TrimSpace(req.MarkdownURL)
	// 内置技能的 markdownUrl 是包内相对路径；未改动时保留原值，不按外链校验。
	keepMarkdownURL := markdownURL == skill.MarkdownURL
	mutation := SkillMutationRequest{SkillName: req.SkillName, Description: req.Description, Tag: req.Tag, MarkdownURL: markdownURL, ShowcaseMedia: req.ShowcaseMedia, ExtraInfo: req.ExtraInfo}
	if keepMarkdownURL {
		mutation.MarkdownURL = ""
	}
	normalized, mediaJSON, err := normalizeSkillMutationRequest(mutation, false)
	if err != nil {
		return nil, err
	}
	if keepMarkdownURL {
		normalized.MarkdownURL = skill.MarkdownURL
	}
	now := time.Now()
	if err := s.repo.UpdateSkillFields(skill.ID, map[string]any{
		"name": normalized.SkillName, "description": normalized.Description, "tag": normalized.Tag,
		"markdown_url": normalized.MarkdownURL, "showcase_media_json": mediaJSON, "extra_info": normalized.ExtraInfo,
		"admin_info_edited_at": now, "updated_at": now,
	}); err != nil {
		return nil, err
	}
	return s.adminSkillItem(actor, skill.ID)
}

// AdminSetSkillEnabled 上架或下架技能。下架后技能从广场、用户技能库、Agent 目录和读取接口中消失，数据和用户关系保留。
func (s *Service) AdminSetSkillEnabled(actor *model.User, id string, enabled bool) (*AdminSkillItem, error) {
	skill, err := s.adminSkill(actor, id)
	if err != nil {
		return nil, err
	}
	status := skillStatusDisabled
	if enabled {
		status = skillStatusEnabled
	}
	if skill.Status != status {
		if err := s.repo.UpdateSkillStatus(skill.ID, status); err != nil {
			return nil, err
		}
	}
	return s.adminSkillItem(actor, skill.ID)
}

// AdminDeleteSkill 永久删除技能及其版本、文件索引和用户关系。内置技能写入 tombstone，启动同步不会重建。
// 返回删除前的技能行，供审计记录名称。
func (s *Service) AdminDeleteSkill(actor *model.User, id string) (*model.Skill, error) {
	skill, err := s.adminSkill(actor, id)
	if err != nil {
		return nil, err
	}
	if isBuiltinSkill(skill) {
		err = s.repo.DeleteBuiltinSkill(skill.ID, actor.ID)
	} else {
		err = s.repo.DeleteSkill(skill.ID)
	}
	if err != nil {
		return nil, err
	}
	if err := os.RemoveAll(filepath.Join(s.dataDir, "skill-packages", skill.ID)); err != nil {
		return nil, err
	}
	return skill, nil
}

func (s *Service) AdminSkillPackageFiles(actor *model.User, id string) ([]SkillPackageFileItem, error) {
	skill, err := s.adminSkill(actor, id)
	if err != nil {
		return nil, err
	}
	snapshot, err := s.skillPackageSnapshot(skill)
	if err != nil {
		return nil, err
	}
	return skillFileItems(snapshot), nil
}

func (s *Service) AdminSkillPackageFile(actor *model.User, id string, filePath string) (*SkillPackageFileContent, error) {
	skill, err := s.adminSkill(actor, id)
	if err != nil {
		return nil, err
	}
	snapshot, err := s.skillPackageSnapshot(skill)
	if err != nil {
		return nil, err
	}
	return s.skillPackageFileContent(snapshot, filePath)
}

func (s *Service) AdminSkillPackageRawFile(actor *model.User, id string, filePath string) ([]byte, string, string, error) {
	skill, err := s.adminSkill(actor, id)
	if err != nil {
		return nil, "", "", err
	}
	snapshot, err := s.skillPackageSnapshot(skill)
	if err != nil {
		return nil, "", "", err
	}
	return s.skillPackageRawFile(snapshot, filePath)
}

// AdminEditSkillPackageFiles 与作者编辑共用同一套校验和乐观锁；GitHub 技能仍返回 409。
// 内置技能被改过内容后，启动同步不再用内置文件包覆盖。
func (s *Service) AdminEditSkillPackageFiles(actor *model.User, id string, req SkillPackageEditRequest) (*AdminSkillPackageEditResult, error) {
	skill, err := s.adminSkill(actor, id)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	files, changed, err := s.editSkillPackage(skill, req, &now)
	if err != nil {
		return nil, err
	}
	item, err := s.adminSkillItem(actor, skill.ID)
	if err != nil {
		return nil, err
	}
	return &AdminSkillPackageEditResult{Skill: item, Files: files, Changed: changed}, nil
}

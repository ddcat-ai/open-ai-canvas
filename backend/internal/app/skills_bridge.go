package app

import (
	"context"
	"errors"
	"mime/multipart"

	"yingce/backend/internal/model"
	"yingce/backend/internal/skills"
)

const SkillPackageUploadMaxBytes = skills.SkillPackageUploadMaxBytes
const SkillPackageEditMaxBytes = skills.SkillPackageEditMaxBytes

var ErrNotBuiltinSkill = skills.ErrNotBuiltinSkill

type (
	SkillShowcaseMedia                    = skills.SkillShowcaseMedia
	SkillEffectiveUser                    = skills.SkillEffectiveUser
	SkillItem                             = skills.SkillItem
	AddedSkillReference                   = skills.AddedSkillReference
	SkillCategory                         = skills.SkillCategory
	SkillLibraryCategory                  = skills.SkillLibraryCategory
	SkillLibraryCategoryList              = skills.SkillLibraryCategoryList
	SkillLibraryCategoryMutationRequest   = skills.SkillLibraryCategoryMutationRequest
	SkillLibraryCategoryAssignmentRequest = skills.SkillLibraryCategoryAssignmentRequest
	SkillListRequest                      = skills.SkillListRequest
	SkillList                             = skills.SkillList
	SkillMutationRequest                  = skills.SkillMutationRequest
	SkillInstallRequest                   = skills.SkillInstallRequest
	SkillGitHubInstallRequest             = skills.SkillGitHubInstallRequest
	SkillPackageFileItem                  = skills.SkillPackageFileItem
	SkillPackageFileContent               = skills.SkillPackageFileContent
	SkillPackageBundleFile                = skills.SkillPackageBundleFile
	SkillPackageBundle                    = skills.SkillPackageBundle
	SkillFileSearchResult                 = skills.SkillFileSearchResult
	SkillPackageFileOperation             = skills.SkillPackageFileOperation
	SkillPackageEditRequest               = skills.SkillPackageEditRequest
	SkillPackageEditResult                = skills.SkillPackageEditResult
	SkillPreset                           = skills.SkillPreset
	SkillRecommendationList               = skills.SkillRecommendationList
	SkillRecommendationIndustry           = skills.SkillRecommendationIndustry
	SkillRecommendationItem               = skills.SkillRecommendationItem
	SkillRecommendationInstallRequest     = skills.SkillRecommendationInstallRequest
	SkillRecommendationInstallResult      = skills.SkillRecommendationInstallResult
)

// SkillRecommendations 返回按行业分组的推荐技能及当前用户的安装状态。
func (s *Service) SkillRecommendations(userID string) (*SkillRecommendationList, error) {
	return s.skillDomain().SkillRecommendations(userID)
}

// InstallSkillRecommendations 安装某个行业的推荐技能（未指定则全部）。
func (s *Service) InstallSkillRecommendations(userID, industryID string, req SkillRecommendationInstallRequest) (*SkillRecommendationInstallResult, error) {
	return s.skillDomain().InstallSkillRecommendations(userID, industryID, req)
}

// SetSkillAgentMode 设置已安装技能是否允许 Agent 自动发现（auto / manual）。
func (s *Service) SetSkillAgentMode(userID, id, mode string) (*SkillItem, error) {
	return s.skillDomain().SetSkillAgentMode(userID, id, mode)
}

func (s *Service) skillDomain() *skills.Service {
	if s == nil {
		return skills.New(nil, "", nil)
	}
	if s.skills != nil {
		return s.skills
	}
	return skills.New(s.repo, s.dataDir, s.runWorkerLoop)
}

func (s *Service) Skills(userID string, req SkillListRequest) (*SkillList, error) {
	return s.skillDomain().Skills(userID, req)
}

func (s *Service) AddedSkills(userID string) ([]AddedSkillReference, error) {
	return s.skillDomain().AddedSkills(userID)
}

func (s *Service) SkillLibraryCategories(userID string, scope string) (*SkillLibraryCategoryList, error) {
	return s.skillDomain().SkillLibraryCategories(userID, scope)
}

func (s *Service) CreateSkillLibraryCategory(actor *model.User, req SkillLibraryCategoryMutationRequest) (*SkillLibraryCategory, error) {
	return s.skillDomain().CreateSkillLibraryCategory(actor, req)
}

func (s *Service) DeleteSkillLibraryCategory(actor *model.User, id string) error {
	return s.skillDomain().DeleteSkillLibraryCategory(actor, id)
}

func (s *Service) SetSkillLibraryCategory(userID string, skillID string, categoryID string) (*SkillItem, error) {
	return s.skillDomain().SetSkillLibraryCategory(userID, skillID, categoryID)
}

// SkillPresets 返回场景预设目录（只读；数据随技能种子发布，无需用户上下文）。
func (s *Service) SkillPresets() ([]SkillPreset, error) {
	return s.skillDomain().SkillPresets()
}

func (s *Service) SkillDetail(userID string, id string) (*SkillItem, error) {
	return s.skillDomain().SkillDetail(userID, id)
}

func (s *Service) CreateSkill(userID string, req SkillMutationRequest) (*SkillItem, error) {
	return s.skillDomain().CreateSkill(userID, req)
}

func (s *Service) UpdateSkill(userID string, id string, req SkillMutationRequest) (*SkillItem, error) {
	return s.skillDomain().UpdateSkill(userID, id, req)
}

func (s *Service) DeleteSkill(userID string, id string) error {
	return s.skillDomain().DeleteSkill(userID, id)
}

func (s *Service) DeleteBuiltinSkill(actor *model.User, id string) error {
	return s.skillDomain().DeleteBuiltinSkill(actor, id)
}

func (s *Service) IsNotBuiltinSkill(err error) bool {
	return errors.Is(err, skills.ErrNotBuiltinSkill)
}

func (s *Service) SetSkillAdded(userID string, id string, added bool) (*SkillItem, error) {
	return s.skillDomain().SetSkillAdded(userID, id, added)
}

func (s *Service) SetSkillLiked(userID string, id string, liked bool) (*SkillItem, error) {
	return s.skillDomain().SetSkillLiked(userID, id, liked)
}

func (s *Service) EnsureBuiltinSkills() error {
	if err := s.skillDomain().EnsureBuiltinSkills(); err != nil {
		return err
	}
	// 在同步文件包之后校验预设与行业推荐，确保它们只引用当前启用的稳定技能 ID。
	if _, err := s.SkillPresets(); err != nil {
		return err
	}
	return skills.ValidateSkillRecommendations()
}

func (s *Service) EnsureSkillPackages() error {
	return s.skillDomain().EnsureSkillPackages()
}

func (s *Service) InstallSkillUpload(userID string, sourceType string, header *multipart.FileHeader, req SkillInstallRequest) (*SkillItem, error) {
	return s.skillDomain().InstallSkillUpload(userID, sourceType, header, req)
}

func (s *Service) InstallGitHubSkill(userID string, req SkillGitHubInstallRequest) (*SkillItem, error) {
	return s.skillDomain().InstallGitHubSkill(userID, req)
}

func (s *Service) SyncGitHubSkill(userID string, skillID string) (*SkillItem, error) {
	return s.skillDomain().SyncGitHubSkill(userID, skillID)
}

func (s *Service) SkillPackageFiles(userID string, skillID string) ([]SkillPackageFileItem, error) {
	return s.skillDomain().SkillPackageFiles(userID, skillID)
}

func (s *Service) SkillPackageFile(userID string, skillID string, filePath string) (*SkillPackageFileContent, error) {
	return s.skillDomain().SkillPackageFile(userID, skillID, filePath)
}

func (s *Service) SkillPackageRawFile(userID string, skillID string, filePath string) ([]byte, string, string, error) {
	return s.skillDomain().SkillPackageRawFile(userID, skillID, filePath)
}

func (s *Service) SkillPackageBundle(userID string, skillID string) (*SkillPackageBundle, error) {
	return s.skillDomain().SkillPackageBundle(userID, skillID)
}

// EditSkillPackageFiles 由作者批量修改技能包文本文件并生成新版本（乐观锁基于 baseVersionId）。
func (s *Service) EditSkillPackageFiles(userID string, skillID string, req SkillPackageEditRequest) (*SkillPackageEditResult, error) {
	return s.skillDomain().EditSkillPackageFiles(userID, skillID, req)
}
func (s *Service) SearchSkillPackage(userID string, skillID string, query string) ([]SkillFileSearchResult, error) {
	return s.skillDomain().SearchSkillPackage(userID, skillID, query)
}

func (s *Service) startSkillSyncWorker(ctx context.Context) {
	s.skillDomain().StartSyncWorker(ctx)
}

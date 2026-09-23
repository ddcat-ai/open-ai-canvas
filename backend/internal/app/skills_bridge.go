package app

import (
	"context"
	"mime/multipart"

	"infinite-canvas/backend/internal/skills"
)

const SkillPackageUploadMaxBytes = skills.SkillPackageUploadMaxBytes

type (
	SkillShowcaseMedia        = skills.SkillShowcaseMedia
	SkillEffectiveUser        = skills.SkillEffectiveUser
	SkillItem                 = skills.SkillItem
	SkillCategory             = skills.SkillCategory
	SkillListRequest          = skills.SkillListRequest
	SkillList                 = skills.SkillList
	SkillMutationRequest      = skills.SkillMutationRequest
	SkillInstallRequest       = skills.SkillInstallRequest
	SkillGitHubInstallRequest = skills.SkillGitHubInstallRequest
	SkillPackageFileItem      = skills.SkillPackageFileItem
	SkillPackageFileContent   = skills.SkillPackageFileContent
	SkillPackageBundleFile    = skills.SkillPackageBundleFile
	SkillPackageBundle        = skills.SkillPackageBundle
	SkillFileSearchResult     = skills.SkillFileSearchResult
	SkillPreset               = skills.SkillPreset
)

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

func (s *Service) AddedSkills(userID string) ([]SkillItem, error) {
	return s.skillDomain().AddedSkills(userID)
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

func (s *Service) SetSkillAdded(userID string, id string, added bool) (*SkillItem, error) {
	return s.skillDomain().SetSkillAdded(userID, id, added)
}

func (s *Service) SetSkillLiked(userID string, id string, liked bool) (*SkillItem, error) {
	return s.skillDomain().SetSkillLiked(userID, id, liked)
}

func (s *Service) EnsureBuiltinSkills() error {
	// 在同步种子之前校验同版本的预设，避免服务启动后才在公开目录暴露坏引用。
	if _, err := s.SkillPresets(); err != nil {
		return err
	}
	return s.skillDomain().EnsureBuiltinSkills()
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

func (s *Service) SearchSkillPackage(userID string, skillID string, query string) ([]SkillFileSearchResult, error) {
	return s.skillDomain().SearchSkillPackage(userID, skillID, query)
}

func (s *Service) startSkillSyncWorker(ctx context.Context) {
	s.skillDomain().StartSyncWorker(ctx)
}

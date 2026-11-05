package app

import (
	"yingce/backend/internal/model"
	"yingce/backend/internal/skills"
)

type (
	AdminSkillListRequest       = skills.AdminSkillListRequest
	AdminSkillItem              = skills.AdminSkillItem
	AdminSkillList              = skills.AdminSkillList
	AdminSkillInfoRequest       = skills.AdminSkillInfoRequest
	AdminSkillPackageEditResult = skills.AdminSkillPackageEditResult
)

// 后台技能管理：读取不写审计，所有写操作在成功后记录管理员审计事件。

func (s *Service) AdminSkills(actor *model.User, req AdminSkillListRequest) (*AdminSkillList, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.skillDomain().AdminSkills(actor, req)
}

func (s *Service) AdminSkillDetail(actor *model.User, id string) (*AdminSkillItem, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.skillDomain().AdminSkillDetail(actor, id)
}

func (s *Service) AdminUpdateSkillInfo(actor *model.User, id string, req AdminSkillInfoRequest) (*AdminSkillItem, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	item, err := s.skillDomain().AdminUpdateSkillInfo(actor, id, req)
	if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "skill.update_info", "skill", item.SkillID, "修改技能基本信息："+item.SkillName, map[string]any{"tag": item.Tag, "sourceType": item.SourceType}); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) AdminSetSkillEnabled(actor *model.User, id string, enabled bool) (*AdminSkillItem, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	item, err := s.skillDomain().AdminSetSkillEnabled(actor, id, enabled)
	if err != nil {
		return nil, err
	}
	action, summary := "skill.disable", "下架技能："
	if enabled {
		action, summary = "skill.enable", "上架技能："
	}
	if err := s.appendAdminAudit(actor, action, "skill", item.SkillID, summary+item.SkillName, map[string]any{"enabled": enabled}); err != nil {
		return nil, err
	}
	return item, nil
}

func (s *Service) AdminDeleteSkill(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	skill, err := s.skillDomain().AdminDeleteSkill(actor, id)
	if err != nil {
		return err
	}
	return s.appendAdminAudit(actor, "skill.delete", "skill", skill.ID, "删除技能："+skill.Name, map[string]any{"sourceType": skill.SourceType, "ownerId": skill.OwnerID})
}

func (s *Service) AdminSkillPackageFiles(actor *model.User, id string) ([]SkillPackageFileItem, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.skillDomain().AdminSkillPackageFiles(actor, id)
}

func (s *Service) AdminSkillPackageFile(actor *model.User, id string, filePath string) (*SkillPackageFileContent, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.skillDomain().AdminSkillPackageFile(actor, id, filePath)
}

func (s *Service) AdminSkillPackageRawFile(actor *model.User, id string, filePath string) ([]byte, string, string, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, "", "", err
	}
	return s.skillDomain().AdminSkillPackageRawFile(actor, id, filePath)
}

func (s *Service) AdminEditSkillPackageFiles(actor *model.User, id string, req SkillPackageEditRequest) (*AdminSkillPackageEditResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	result, err := s.skillDomain().AdminEditSkillPackageFiles(actor, id, req)
	if err != nil {
		return nil, err
	}
	if result.Changed {
		if err := s.appendAdminAudit(actor, "skill.edit_files", "skill", result.Skill.SkillID, "编辑技能文件："+result.Skill.SkillName, map[string]any{"versionId": result.Skill.VersionID, "operations": len(req.Operations)}); err != nil {
			return nil, err
		}
	}
	return result, nil
}

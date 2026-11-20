package app

import (
	"strings"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/skills"
)

// RequireSkillAccess shares the skill domain's current database-backed user authorization.
func (s *Service) RequireSkillAccess(userID string) error {
	return s.skillDomain().RequireSkillAccess(userID)
}

// RequireSkillAdministrator is the management boundary for skill administration.
func (s *Service) RequireSkillAdministrator(userID string) error {
	return s.skillDomain().RequireAdministrator(userID)
}

// CloudAgentSkillCapabilities never derives skill access from client flags or cached roles.
func (s *Service) CloudAgentSkillCapabilities(userID string) (bool, []string, error) {
	if err := s.RequireSkillAccess(userID); err != nil {
		return false, nil, err
	}
	return true, CloudAgentSupportedToolNames(), nil
}

func cloudAgentIsSkillTool(name string) bool {
	name = strings.TrimSpace(strings.TrimPrefix(name, "functions."))
	return strings.HasPrefix(name, "skill_") || name == "skills_load"
}

func cloudAgentRequireSkillToolAccess(repo *repository.Repository, userID, name string, services ...*Service) error {
	if !cloudAgentIsSkillTool(name) {
		return nil
	}
	if repo == nil {
		if service := cloudAgentToolService(services); service != nil {
			repo = service.repo
		}
	}
	if repo == nil {
		return kernel.Forbidden("无法确认技能使用权限")
	}
	return skills.New(repo, "", nil).RequireSkillAccess(userID)
}

func (s *Service) cloudAgentDecodeForExecution(run *model.CloudAgentExecution) (cloudAgentRuntime, error) {
	state, err := cloudAgentDecodeForExecution(run)
	if err != nil {
		return state, err
	}
	if err := s.RequireSkillAccess(run.UserID); err != nil {
		return state, err
	}
	return state, nil
}

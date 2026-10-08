package app

import (
	"yingce/backend/internal/model"
	"yingce/backend/internal/skills"
)

type SkillCuration = skills.SkillCuration
type SkillCurationUpdate = skills.SkillCurationUpdate

func (s *Service) SkillCuration(actor *model.User, admin bool) (*SkillCuration, error) {
	return s.skillDomain().SkillCuration(actor, admin)
}
func (s *Service) UpdateSkillCuration(actor *model.User, req SkillCurationUpdate, requestID string) (*SkillCuration, error) {
	return s.skillDomain().UpdateSkillCuration(actor, req, requestID)
}

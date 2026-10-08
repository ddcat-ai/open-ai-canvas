package repository

import (
	"infinite-canvas/backend/internal/model"
)

const UnassignedSkillRoot = "__unassigned__"

func (r *Repository) SkillCurationRoots() ([]model.SkillCurationRoot, error) {
	rows := []model.SkillCurationRoot{}
	if err := r.db.Order("sort_order, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return model.DefaultSkillCurationRoots(), nil
	}
	return rows, nil
}
func (r *Repository) SaveSkillCurationRoot(root *model.SkillCurationRoot) error {
	// Materialize the fallback before its first edit, keeping existing children
	// attached to their stable root IDs even after an empty-table fallback.
	var count int64
	if err := r.db.Model(&model.SkillCurationRoot{}).Count(&count).Error; err != nil {
		return err
	}
	if count == 0 {
		rows := model.DefaultSkillCurationRoots()
		if err := r.db.Create(&rows).Error; err != nil {
			return err
		}
	}
	return r.db.Save(root).Error
}
func (r *Repository) AssignSkillCurationRoot(skillID, rootID string) error {
	if err := r.db.Delete(&model.SkillCurationRootAssignment{}, "skill_id = ?", skillID).Error; err != nil {
		return err
	}
	if rootID == "" {
		return nil
	}
	return r.db.Create(&model.SkillCurationRootAssignment{SkillID: skillID, RootID: rootID}).Error
}

func (state *SkillCuration) EffectiveRoot(skill *model.Skill) string {
	id := skill.Tag
	if !skill.IsPrivate {
		for _, a := range state.RootAssignments {
			if a.SkillID == skill.ID {
				id = a.RootID
				break
			}
		}
	}
	for _, root := range state.Roots {
		if root.ID == id && root.Enabled {
			return id
		}
	}
	return UnassignedSkillRoot
}

// Explicit assignments override the source tag. A disabled/missing target is
// kept discoverable in the default bucket; it never falls into another root.
const curationRootID = `COALESCE((SELECT ra.root_id FROM skill_curation_root_assignments ra WHERE ra.skill_id = skills.id AND skills.is_private = false),skills.tag)`
const effectiveCurationRoot = `(CASE WHEN NOT EXISTS (SELECT 1 FROM skill_curation_roots) THEN CASE WHEN ` + curationRootID + ` IN ('drama','ecommerce','creative','social','others') THEN ` + curationRootID + ` ELSE '__unassigned__' END ELSE COALESCE((SELECT r.id FROM skill_curation_roots r WHERE r.enabled = true AND r.id = ` + curationRootID + `), '__unassigned__') END)`

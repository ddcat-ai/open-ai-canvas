package repository

import (
	"encoding/json"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

type SkillCuration struct {
	model.SkillCurationSetting
	Roots           []model.SkillCurationRoot           `json:"roots,omitempty"`
	RootAssignments []model.SkillCurationRootAssignment `json:"rootAssignments,omitempty"`
	Categories      []model.SkillCurationCategory       `json:"categories"`
	Assignments     []model.SkillCurationAssignment     `json:"assignments"`
}

// Read the version before and after the snapshot so concurrent edits cannot
// produce a mixed snapshot that a client could save with a newer revision.
func (r *Repository) SkillCuration(admin bool) (*SkillCuration, error) {
	for attempt := 0; attempt < 3; attempt++ {
		out := &SkillCuration{Categories: []model.SkillCurationCategory{}, Assignments: []model.SkillCurationAssignment{}}
		if err := r.db.First(&out.SkillCurationSetting, 1).Error; err != nil {
			return nil, err
		}
		if !admin && !out.Enabled {
			return out, nil
		}
		roots, err := r.SkillCurationRoots()
		if err != nil {
			return nil, err
		}
		for _, root := range roots {
			if admin || root.Enabled {
				out.Roots = append(out.Roots, root)
			}
		}
		if !admin {
			out.Roots = append(out.Roots, model.SkillCurationRoot{ID: UnassignedSkillRoot, Name: "未归入启用分类", IconKey: "shapes", Enabled: true})
		}
		if err := r.db.Model(&model.SkillCurationRootAssignment{}).Select("skill_curation_root_assignments.*").Joins("JOIN skills ON skills.id = skill_curation_root_assignments.skill_id").Where("skills.status = 1 AND skills.is_private = false").Order("skill_id").Find(&out.RootAssignments).Error; err != nil {
			return nil, err
		}
		query := r.db.Order("sort_order, id")
		if !admin {
			query = query.Where("enabled = ?", true)
		}
		if err := query.Find(&out.Categories).Error; err != nil {
			return nil, err
		}
		if !admin {
			visible := []model.SkillCurationCategory{}
			for _, c := range out.Categories {
				for _, root := range out.Roots {
					if root.ID == c.RootTag {
						visible = append(visible, c)
						break
					}
				}
			}
			out.Categories = visible
		}
		query = r.db.Model(&model.SkillCurationAssignment{}).Select("skill_curation_assignments.*").
			Joins("JOIN skills ON skills.id = skill_curation_assignments.skill_id").Where("skills.status = 1 AND skills.is_private = false")
		if !admin {
			query = query.Joins("JOIN skill_curation_categories c ON c.id = skill_curation_assignments.category_id").Where("c.enabled = true AND c.root_tag = " + effectiveCurationRoot)
		}
		if err := query.Order("skill_id, category_id").Find(&out.Assignments).Error; err != nil {
			return nil, err
		}
		var after model.SkillCurationSetting
		if err := r.db.First(&after, 1).Error; err != nil {
			return nil, err
		}
		if after.Revision == out.Revision {
			return out, nil
		}
	}
	return nil, kernel.NewAppError(409, "分类正在更新，请重新加载")
}

func (r *Repository) UpdateSkillCuration(actorID string, revision int64, requestID string, change func(*Repository) error) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&model.SkillCurationSetting{}).Where("id = 1 AND revision = ?", revision).Update("revision", revision+1)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return kernel.NewAppError(409, "分类版本已更新，请重新加载")
		}
		var actor model.User
		if err := tx.First(&actor, "id = ?", actorID).Error; err != nil {
			return err
		}
		if actor.Role != model.UserRoleAdmin || actor.Status != model.UserStatusActive {
			return kernel.Forbidden("需要管理员权限")
		}
		repo := New(tx)
		before, err := repo.SkillCuration(true)
		if err != nil {
			return err
		}
		if err := change(repo); err != nil {
			return err
		}
		after, err := repo.SkillCuration(true)
		if err != nil {
			return err
		}
		before.Revision = revision
		metadata, err := json.Marshal(map[string]any{"requestId": requestID, "before": before, "after": after})
		if err != nil {
			return err
		}
		return tx.Create(&model.AdminAuditEvent{ID: kernel.NewID(), ActorUserID: actorID, Action: "skill_curation.update", TargetType: "skill_curation", TargetID: "1", MetadataJSON: string(metadata)}).Error
	})
}

func (r *Repository) SetSkillCurationEnabled(enabled bool) error {
	return r.db.Model(&model.SkillCurationSetting{}).Where("id = 1").Update("enabled", enabled).Error
}
func (r *Repository) SaveSkillCurationCategory(category *model.SkillCurationCategory) error {
	return r.db.Save(category).Error
}
func (r *Repository) CurationSkill(id string) (*model.Skill, error) {
	var row model.Skill
	err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).First(&row, "id = ? AND status = 1 AND is_private = false", id).Error
	return &row, err
}
func (r *Repository) AssignSkillCuration(skillID string, ids []string) error {
	if err := r.db.Delete(&model.SkillCurationAssignment{}, "skill_id = ?", skillID).Error; err != nil {
		return err
	}
	for _, id := range ids {
		if err := r.db.Create(&model.SkillCurationAssignment{SkillID: skillID, CategoryID: id}).Error; err != nil {
			return err
		}
	}
	return nil
}

const effectiveCurationCategory = `SELECT 1 FROM skill_curation_assignments a JOIN skill_curation_categories c ON c.id = a.category_id WHERE a.skill_id = skills.id AND c.enabled = true AND c.root_tag = ` + effectiveCurationRoot + ` AND skills.is_private = false`

package repository

import (
	"errors"
	"strings"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type SkillListFilter struct {
	PlatformRootID        string
	PlatformCategoryID    string
	PlatformUncategorized bool
	UserID                string
	Scope                 string
	Search                string
	Tag                   string
	LibraryCategoryID     string
	LibraryUncategorized  bool
	Sort                  string
	Limit                 int
	Offset                int
}

type SkillMetrics struct {
	SkillID    string
	AddedCount int64
	LikeCount  int64
}

type SkillCategoryCount struct {
	Tag   string
	Count int64
}

// PublicSkillCategoryCounts 返回技能广场中已启用公开技能的共享分类数量。
func (r *Repository) PublicSkillCategoryCounts() (map[string]int64, error) {
	var rows []SkillCategoryCount
	err := r.db.Model(&model.Skill{}).
		Select("tag, COUNT(*) AS count").
		Where("status = ? AND is_private = ?", 1, false).
		Group("tag").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.Tag] = row.Count
	}
	return counts, nil
}

func (r *Repository) Skills(filter SkillListFilter) ([]model.Skill, int64, error) {
	query := r.db.Model(&model.Skill{}).Where("skills.status = ?", 1)
	switch filter.Scope {
	case "mine":
		query = query.Joins("LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ?", filter.UserID).
			Where("skills.owner_id = ? OR (user_skill_states.added = ? AND skills.is_private = ?)", filter.UserID, true, false)
	case "created":
		query = query.Where("skills.owner_id = ?", filter.UserID)
		if filter.LibraryCategoryID != "" || filter.LibraryUncategorized {
			query = query.Joins("LEFT JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ?", filter.UserID)
		}
	case "favorites":
		query = query.Joins("JOIN user_skill_states ON user_skill_states.skill_id = skills.id AND user_skill_states.user_id = ? AND user_skill_states.liked = ?", filter.UserID, true).
			Where("skills.owner_id = ? OR skills.is_private = ?", filter.UserID, false)
	default:
		query = query.Where("skills.is_private = ?", false)
	}
	if filter.Search != "" {
		pattern := "%" + strings.ToLower(filter.Search) + "%"
		query = query.Joins("LEFT JOIN users skill_owners ON skill_owners.id = skills.owner_id").
			Where("lower(skills.name) LIKE ? OR lower(skills.description) LIKE ? OR lower(skills.instruction) LIKE ? OR lower(skills.extra_info) LIKE ? OR lower(skills.author_name) LIKE ? OR lower(skill_owners.display_name) LIKE ? OR lower(skill_owners.username) LIKE ?", pattern, pattern, pattern, pattern, pattern, pattern, pattern)
	}
	if filter.Tag != "" {
		query = query.Where("skills.tag = ?", filter.Tag)
	}
	if filter.PlatformRootID != "" {
		query = query.Where(effectiveCurationRoot+" = ?", filter.PlatformRootID)
	}
	if filter.PlatformCategoryID != "" {
		query = query.Where("EXISTS ("+effectiveCurationCategory+" AND c.id = ?)", filter.PlatformCategoryID)
	}
	if filter.PlatformUncategorized {
		query = query.Where("NOT EXISTS (" + effectiveCurationCategory + ")")
	}
	if filter.LibraryCategoryID != "" {
		query = query.Where("user_skill_states.library_category_id = ?", filter.LibraryCategoryID)
	} else if filter.LibraryUncategorized {
		query = query.Where("COALESCE(user_skill_states.library_category_id, '') = ''")
	}
	// 用户状态按用户和技能唯一，列表 JOIN 不会重复；不要设置 DISTINCT，避免 GORM 将其带入 PostgreSQL 的热门排序查询。
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	order := "skills.sort_weight desc, skills.updated_at desc"
	switch filter.Sort {
	case "new":
		order = "skills.created_at desc"
	case "popular":
		order = "(skills.initial_added_count + (SELECT COUNT(*) FROM user_skill_states metric_states WHERE metric_states.skill_id = skills.id AND metric_states.added = true)) desc, skills.updated_at desc"
	}
	var skills []model.Skill
	err := query.Select("skills.*").Order(order).Limit(filter.Limit).Offset(filter.Offset).Find(&skills).Error
	return skills, total, err
}

// 内置技能使用稳定的外部技能 ID 幂等更新，用户加入和收藏关系保留在独立状态表中。
// columns 是冲突时覆盖的列，由调用方按管理员是否改过该技能决定；status 不应出现在其中，下架状态只由管理员修改。
func (r *Repository) UpsertBuiltinSkills(skills []model.Skill, columns []string) error {
	if len(skills) == 0 {
		return errors.New("builtin skills are empty")
	}
	if len(columns) == 0 {
		return r.db.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "id"}}, DoNothing: true}).Create(&skills).Error
	}
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "id"}},
		DoUpdates: clause.AssignmentColumns(columns),
	}).Create(&skills).Error
}

func (r *Repository) Skill(id string) (*model.Skill, error) {
	var skill model.Skill
	if err := r.db.First(&skill, "id = ? AND status = ?", id, 1).Error; err != nil {
		return nil, err
	}
	return &skill, nil
}

// SkillAnyStatus 读取技能而不过滤上架状态，只给管理员入口和内置技能同步使用。
func (r *Repository) SkillAnyStatus(id string) (*model.Skill, error) {
	var skill model.Skill
	if err := r.db.First(&skill, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &skill, nil
}

func (r *Repository) SkillsByIDsAnyStatus(ids []string) ([]model.Skill, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	var skills []model.Skill
	err := r.db.Where("id IN ?", ids).Find(&skills).Error
	return skills, err
}

type AdminSkillListFilter struct {
	Keyword    string
	Status     string
	SourceType string
	Tag        string
	Limit      int
	Offset     int
}

// AdminSkills 列出全部技能（含私有和已下架），按最近更新排序。
func (r *Repository) AdminSkills(filter AdminSkillListFilter) ([]model.Skill, int64, error) {
	query := r.db.Model(&model.Skill{})
	switch filter.Status {
	case "enabled":
		query = query.Where("skills.status = ?", 1)
	case "disabled":
		query = query.Where("COALESCE(skills.status, 0) <> ?", 1)
	}
	switch filter.SourceType {
	case "":
	case "markdown":
		query = query.Where("skills.source_type IN ?", []string{"markdown", ""})
	default:
		query = query.Where("skills.source_type = ?", filter.SourceType)
	}
	if filter.Tag != "" {
		query = query.Where("skills.tag = ?", filter.Tag)
	}
	if filter.Keyword != "" {
		pattern := "%" + strings.ToLower(filter.Keyword) + "%"
		query = query.Joins("LEFT JOIN users skill_owners ON skill_owners.id = skills.owner_id").
			Where("skills.id = ? OR lower(skills.name) LIKE ? OR lower(skills.description) LIKE ? OR lower(skills.author_name) LIKE ? OR lower(skill_owners.display_name) LIKE ? OR lower(skill_owners.username) LIKE ? OR lower(skills.source_url) LIKE ?",
				filter.Keyword, pattern, pattern, pattern, pattern, pattern, pattern)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var skills []model.Skill
	err := query.Select("skills.*").Order("skills.updated_at desc, skills.id asc").Limit(filter.Limit).Offset(filter.Offset).Find(&skills).Error
	return skills, total, err
}

// UpdateSkillStatus 只改上架状态，不刷新 updated_at，避免下架 / 上架改变技能广场的“最近更新”排序。
func (r *Repository) UpdateSkillStatus(id string, status int) error {
	return r.db.Model(&model.Skill{}).Where("id = ?", id).UpdateColumn("status", status).Error
}

// UpdateSkillFields 按列更新技能行，避免整行保存覆盖并发写入的状态或版本字段。
func (r *Repository) UpdateSkillFields(id string, fields map[string]any) error {
	return r.db.Model(&model.Skill{}).Where("id = ?", id).Updates(fields).Error
}

func (r *Repository) CreateSkill(skill *model.Skill, ownerState *model.UserSkillState) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(skill).Error; err != nil {
			return err
		}
		return tx.Create(ownerState).Error
	})
}

func (r *Repository) DeleteSkill(id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		var locked model.Skill
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&locked, "id = ?", id).Error; err != nil {
			return err
		}
		if err := tx.Delete(&model.SkillCurationAssignment{}, "skill_id = ?", id).Error; err != nil {
			return err
		}
		if err := tx.Delete(&model.SkillCurationRootAssignment{}, "skill_id = ?", id).Error; err != nil {
			return err
		}
		if err := tx.Delete(&model.UserSkillState{}, "skill_id = ?", id).Error; err != nil {
			return err
		}
		var versions []model.SkillVersion
		if err := tx.Where("skill_id = ?", id).Find(&versions).Error; err != nil {
			return err
		}
		versionIDs := make([]string, 0, len(versions))
		for _, version := range versions {
			versionIDs = append(versionIDs, version.ID)
		}
		if len(versionIDs) > 0 {
			if err := tx.Delete(&model.SkillFile{}, "skill_version_id IN ?", versionIDs).Error; err != nil {
				return err
			}
		}
		if err := tx.Delete(&model.SkillVersion{}, "skill_id = ?", id).Error; err != nil {
			return err
		}
		return tx.Delete(&model.Skill{}, "id = ?", id).Error
	})
}

func (r *Repository) UserSkillState(userID string, skillID string) (*model.UserSkillState, error) {
	var state model.UserSkillState
	if err := r.db.First(&state, "user_id = ? AND skill_id = ?", userID, skillID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &state, nil
}

func (r *Repository) UserSkillStatesBySkillIDs(userID string, skillIDs []string) ([]model.UserSkillState, error) {
	if len(skillIDs) == 0 {
		return nil, nil
	}
	var states []model.UserSkillState
	err := r.db.Find(&states, "user_id = ? AND skill_id IN ?", userID, skillIDs).Error
	return states, err
}

func (r *Repository) SetUserSkillAdded(state *model.UserSkillState) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "skill_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"added", "installed_version_id", "auto_update", "library_category_id", "updated_at"}),
	}).Create(state).Error
}

func (r *Repository) SetUserSkillLiked(state *model.UserSkillState) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "user_id"}, {Name: "skill_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"liked", "updated_at"}),
	}).Create(state).Error
}

func (r *Repository) SkillMetrics(skillIDs []string) (map[string]SkillMetrics, error) {
	metrics := make(map[string]SkillMetrics, len(skillIDs))
	if len(skillIDs) == 0 {
		return metrics, nil
	}
	var rows []SkillMetrics
	err := r.db.Model(&model.UserSkillState{}).
		Select("skill_id, SUM(CASE WHEN added THEN 1 ELSE 0 END) AS added_count, SUM(CASE WHEN liked THEN 1 ELSE 0 END) AS like_count").
		Where("skill_id IN ?", skillIDs).
		Group("skill_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, item := range rows {
		metrics[item.SkillID] = item
	}
	return metrics, nil
}

func (r *Repository) SkillOwners(ownerIDs []string) (map[string]model.User, error) {
	owners := make(map[string]model.User, len(ownerIDs))
	if len(ownerIDs) == 0 {
		return owners, nil
	}
	var users []model.User
	if err := r.db.Find(&users, "id IN ?", ownerIDs).Error; err != nil {
		return nil, err
	}
	for _, user := range users {
		owners[user.ID] = user
	}
	return owners, nil
}

func (r *Repository) SkillOwnerAvatars(ownerIDs []string) (map[string]string, error) {
	avatars := make(map[string]string, len(ownerIDs))
	if len(ownerIDs) == 0 {
		return avatars, nil
	}
	var identities []model.UserIdentity
	if err := r.db.Where("user_id IN ? AND avatar_url <> ''", ownerIDs).Order("updated_at desc").Find(&identities).Error; err != nil {
		return nil, err
	}
	for _, identity := range identities {
		if avatars[identity.UserID] == "" {
			avatars[identity.UserID] = identity.AvatarURL
		}
	}
	return avatars, nil
}

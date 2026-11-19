package repository

import (
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrCommunityWorkConflict = errors.New("作品状态已变化或该成品已有待审/已发布投稿，请刷新后重试")

func (r *Repository) CommunityWork(id string, lock bool) (*model.CommunityWork, error) {
	var work model.CommunityWork
	query := r.db
	if lock && r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.First(&work, "id = ?", id).Error
	return &work, err
}

func (r *Repository) CommunityWorks(userID, status string, public, featured bool) ([]model.CommunityWork, error) {
	result := []model.CommunityWork{}
	err := r.communityWorksQuery(userID, status, public, featured).Order("community_works.updated_at DESC, community_works.id").Limit(200).Find(&result).Error
	return result, err
}

func (r *Repository) CommunityWorksPage(userID, status string, page, pageSize int) ([]model.CommunityWork, int64, error) {
	query := r.communityWorksQuery(userID, status, false, false)
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	result := []model.CommunityWork{}
	err := query.Order("community_works.updated_at DESC, community_works.id").Offset((page - 1) * pageSize).Limit(pageSize).Find(&result).Error
	return result, total, err
}

func (r *Repository) communityWorksQuery(userID, status string, public, featured bool) *gorm.DB {
	query := r.db.Model(&model.CommunityWork{})
	if userID != "" {
		query = query.Where("community_works.user_id = ?", userID)
	}
	if status != "" {
		query = query.Where("community_works.status = ?", status)
	}
	if public {
		query = query.Joins("JOIN users ON users.id = community_works.user_id AND users.status = ?", model.UserStatusActive).Where("community_works.status = ?", model.CommunityWorkPublished)
	}
	if featured {
		query = query.Where("community_works.featured = ?", true)
	}
	return query
}

func (r *Repository) SaveCommunityWork(work *model.CommunityWork, creating bool, resourceIDs []string, review *model.CommunityWorkReview) error {
	if work.ActiveKey != nil {
		var count int64
		if err := r.db.Model(&model.CommunityWork{}).Where("active_key = ? AND id <> ?", *work.ActiveKey, work.ID).Count(&count).Error; err != nil {
			return err
		}
		if count > 0 {
			return ErrCommunityWorkConflict
		}
	}
	if creating {
		if err := r.db.Create(work).Error; err != nil {
			return r.communityWorkWriteError(err)
		}
	} else {
		prior := work.Revision
		work.Revision++
		result := r.db.Model(&model.CommunityWork{}).Where("id = ? AND revision = ?", work.ID, prior).Select("*").Omit("id", "created_at").Updates(work)
		if result.Error != nil {
			return r.communityWorkWriteError(result.Error)
		}
		if result.RowsAffected != 1 {
			return ErrCommunityWorkConflict
		}
	}
	if resourceIDs != nil {
		if err := r.db.Where("work_id = ?", work.ID).Delete(&model.CommunityWorkResource{}).Error; err != nil {
			return err
		}
		for _, id := range resourceIDs {
			link := model.CommunityWorkResource{WorkID: work.ID, ResourceID: id, UserID: work.UserID}
			if err := r.db.Omit(clause.Associations).Create(&link).Error; err != nil {
				return err
			}
		}
	}
	if review != nil {
		return r.db.Create(review).Error
	}
	return nil
}

func (r *Repository) communityWorkWriteError(err error) error {
	// Translate explicitly because production does not enable GORM TranslateError.
	if translator, ok := r.db.Dialector.(gorm.ErrorTranslator); ok {
		if errors.Is(translator.Translate(err), gorm.ErrDuplicatedKey) {
			return ErrCommunityWorkConflict
		}
	}
	if errors.Is(err, gorm.ErrDuplicatedKey) {
		return ErrCommunityWorkConflict
	}
	return err
}

func (r *Repository) CommunityWorkResourceIDs(workID string) ([]string, error) {
	var ids []string
	err := r.db.Model(&model.CommunityWorkResource{}).Where("work_id = ?", workID).Order("resource_id").Pluck("resource_id", &ids).Error
	return ids, err
}

func (r *Repository) CommunityWorkResource(workID, resourceID string) (*model.Resource, error) {
	var resource model.Resource
	err := r.db.Model(&model.Resource{}).Joins("JOIN community_work_resources ON community_work_resources.resource_id = resources.id AND community_work_resources.user_id = resources.user_id").Where("community_work_resources.work_id = ? AND resources.id = ?", workID, resourceID).First(&resource).Error
	return &resource, err
}

func (r *Repository) CommunityResourceForSubmission(userID, resourceID string) (*model.Resource, error) {
	var resource model.Resource
	query := r.db.Where("id = ? AND user_id = ?", resourceID, userID)
	if r.Dialect() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	err := query.First(&resource).Error
	return &resource, err
}

func (r *Repository) CommunityWorkResourceReferences(userID string, resourceIDs []string) ([]ResourceDirectReference, error) {
	result := []ResourceDirectReference{}
	if len(resourceIDs) == 0 {
		return result, nil
	}
	err := r.db.Table("community_work_resources AS refs").Select("refs.work_id AS id, refs.resource_id, community_works.title").Joins("JOIN community_works ON community_works.id = refs.work_id").Where("refs.user_id = ? AND refs.resource_id IN ?", userID, resourceIDs).Scan(&result).Error
	for i := range result {
		result[i].Kind = "投稿作品"
	}
	return result, err
}

func (r *Repository) CommunityWorkReaction(workID, userID string) (count int64, liked bool, err error) {
	var result struct {
		Count int64
		Mine  int64
	}
	err = r.db.Model(&model.CommunityWorkLike{}).
		Select("COUNT(*) AS count, COALESCE(SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END), 0) AS mine", userID).
		Where("work_id = ?", workID).Scan(&result).Error
	return result.Count, result.Mine != 0, err
}

func (r *Repository) SetCommunityWorkLiked(workID, userID string, liked bool) error {
	if liked {
		return r.db.Omit(clause.Associations).Clauses(clause.OnConflict{DoNothing: true}).
			Create(&model.CommunityWorkLike{WorkID: workID, UserID: userID}).Error
	}
	return r.db.Where("work_id = ? AND user_id = ?", workID, userID).Delete(&model.CommunityWorkLike{}).Error
}

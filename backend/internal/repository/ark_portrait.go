package repository

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"yingce/backend/internal/model"
)

func (r *Repository) CreateArkPortraitSession(session *model.ArkPortraitSession) error {
	return r.db.Create(session).Error
}

func (r *Repository) ArkPortraitSessionByState(state string) (*model.ArkPortraitSession, error) {
	var session model.ArkPortraitSession
	if err := r.db.Where("state = ?", state).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) ArkPortraitSessionForUser(userID, id string) (*model.ArkPortraitSession, error) {
	var session model.ArkPortraitSession
	if err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&session).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

// PendingArkPortraitSessions 返回用户尚未过期的待认证会话，按创建时间倒序。
func (r *Repository) PendingArkPortraitSessions(userID string, now time.Time, limit int) ([]model.ArkPortraitSession, error) {
	var sessions []model.ArkPortraitSession
	err := r.db.Where("user_id = ? AND status = ? AND expires_at > ?", userID, "pending", now).Order("created_at desc").Limit(limit).Find(&sessions).Error
	return sessions, err
}

func (r *Repository) CountRecentArkPortraitSessions(userID string, since time.Time) (int64, error) {
	var count int64
	err := r.db.Model(&model.ArkPortraitSession{}).Where("user_id = ? AND created_at > ?", userID, since).Count(&count).Error
	return count, err
}

// FinishArkPortraitSession 只更新仍为 pending 的会话，回调与轮询并发时只有一方生效。
func (r *Repository) FinishArkPortraitSession(id, status, resultCode, groupID, message string) (bool, error) {
	result := r.db.Model(&model.ArkPortraitSession{}).Where("id = ? AND status = ?", id, "pending").Updates(map[string]any{
		"status": status, "result_code": resultCode, "group_id": groupID, "error": message, "updated_at": time.Now(),
	})
	return result.RowsAffected == 1, result.Error
}

// CreateArkPortraitGroup 以 (ProjectName, GroupID) 去重；已被登记时返回已有记录和 false。
func (r *Repository) CreateArkPortraitGroup(group *model.ArkPortraitGroup) (*model.ArkPortraitGroup, bool, error) {
	result := r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "project_name"}, {Name: "group_id"}},
		DoNothing: true,
	}).Create(group)
	if result.Error != nil {
		return nil, false, result.Error
	}
	if result.RowsAffected == 1 {
		return group, true, nil
	}
	var existing model.ArkPortraitGroup
	if err := r.db.Where("project_name = ? AND group_id = ?", group.ProjectName, group.GroupID).First(&existing).Error; err != nil {
		return nil, false, err
	}
	return &existing, false, nil
}

func (r *Repository) ArkPortraitGroups(userID string) ([]model.ArkPortraitGroup, error) {
	var groups []model.ArkPortraitGroup
	err := r.db.Where("user_id = ?", userID).Order("created_at asc").Find(&groups).Error
	return groups, err
}

func (r *Repository) ArkPortraitGroupForUser(userID, id string) (*model.ArkPortraitGroup, error) {
	var group model.ArkPortraitGroup
	if err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&group).Error; err != nil {
		return nil, err
	}
	return &group, nil
}

func (r *Repository) SaveArkPortraitGroup(group *model.ArkPortraitGroup) error {
	return r.db.Save(group).Error
}

// DeleteArkPortraitGroup 删除组及其素材记录；调用方须已在方舟侧删除成功。
func (r *Repository) DeleteArkPortraitGroup(userID, id string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("group_id = ? AND user_id = ?", id, userID).Delete(&model.ArkPortraitAsset{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND user_id = ?", id, userID).Delete(&model.ArkPortraitGroup{}).Error
	})
}

func (r *Repository) CreateArkPortraitAsset(asset *model.ArkPortraitAsset) error {
	return r.db.Create(asset).Error
}

func (r *Repository) SaveArkPortraitAsset(asset *model.ArkPortraitAsset) error {
	return r.db.Save(asset).Error
}

func (r *Repository) ArkPortraitAssets(userID string) ([]model.ArkPortraitAsset, error) {
	var assets []model.ArkPortraitAsset
	err := r.db.Where("user_id = ?", userID).Order("created_at asc").Find(&assets).Error
	return assets, err
}

func (r *Repository) ArkPortraitAssetForUser(userID, id string) (*model.ArkPortraitAsset, error) {
	var asset model.ArkPortraitAsset
	if err := r.db.Where("id = ? AND user_id = ?", id, userID).First(&asset).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func (r *Repository) CountArkPortraitGroupAssets(groupID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.ArkPortraitAsset{}).Where("group_id = ?", groupID).Count(&count).Error
	return count, err
}

func (r *Repository) DeleteArkPortraitAsset(userID, id string) error {
	return r.db.Where("id = ? AND user_id = ?", id, userID).Delete(&model.ArkPortraitAsset{}).Error
}

// ArkPortraitAssetOwners 返回已登记真人素材 ID 的所属用户。未登记的 ID（例如方舟公共数字人、
// 用户自有账号的素材）不在结果中。可信素材同步的绑定按共享资源建立，不参与这里的归属判断。
func (r *Repository) ArkPortraitAssetOwners(assetIDs []string) (map[string][]string, error) {
	owners := make(map[string][]string, len(assetIDs))
	if len(assetIDs) == 0 {
		return owners, nil
	}
	var rows []struct {
		ArkAssetID string
		UserID     string
	}
	if err := r.db.Model(&model.ArkPortraitAsset{}).Select("ark_asset_id, user_id").Where("ark_asset_id IN ?", assetIDs).Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, item := range rows {
		owners[item.ArkAssetID] = append(owners[item.ArkAssetID], item.UserID)
	}
	return owners, nil
}

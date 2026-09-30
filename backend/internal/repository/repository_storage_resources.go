// 对象存储配置、存储位置、上传配额与资源（Resource）记录。
//
// 资源的物理删除不在这里做：业务删除写入 resource_deletion_jobs（Outbox），
// 由后台 worker 幂等清理，见 resource_deletion.go。

package repository

import (
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) LatestUserOSSSetting(userID string) (*model.UserOSSSetting, error) {
	var setting model.UserOSSSetting
	if err := r.db.Where("user_id = ?", userID).Order("created_at desc, id desc").First(&setting).Error; err != nil {
		return nil, err
	}
	return &setting, nil
}

func (r *Repository) UserOSSSettingsForUser(userID string) ([]model.UserOSSSetting, error) {
	var settings []model.UserOSSSetting
	err := r.db.Where("user_id = ?", userID).Order("created_at desc, id desc").Find(&settings).Error
	return settings, err
}

func (r *Repository) UserOSSSettingForUser(userID string, id string) (*model.UserOSSSetting, error) {
	var setting model.UserOSSSetting
	if err := r.db.First(&setting, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &setting, nil
}

func (r *Repository) CreateUserOSSSetting(setting *model.UserOSSSetting) error {
	return r.db.Create(setting).Error
}

func (r *Repository) StorageLocation(id string) (*model.StorageLocation, error) {
	var location model.StorageLocation
	if err := r.db.First(&location, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &location, nil
}

func (r *Repository) StorageLocationByDigest(scope string, ownerID string, provider string, digest string) (*model.StorageLocation, error) {
	var location model.StorageLocation
	if err := r.db.First(&location, "scope = ? AND owner_id = ? AND provider = ? AND location_digest = ?", scope, ownerID, provider, digest).Error; err != nil {
		return nil, err
	}
	return &location, nil
}

func (r *Repository) StorageLocationHistoryCount(scope string, ownerID string) (int64, error) {
	var count int64
	err := r.db.Model(&model.StorageLocation{}).Where("scope = ? AND owner_id = ?", scope, ownerID).Count(&count).Error
	return count, err
}

func (r *Repository) StorageLocationResourceCount(id string) (int64, error) {
	var count int64
	err := r.db.Model(&model.Resource{}).Where("storage_setting_id = ?", id).Count(&count).Error
	return count, err
}

func (r *Repository) CreateStorageLocation(location *model.StorageLocation) error {
	return r.db.Create(location).Error
}

func (r *Repository) SaveStorageLocation(location *model.StorageLocation) error {
	return r.db.Save(location).Error
}

func (r *Repository) ActivateStorageLocation(scope string, ownerID string, id string, active bool) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.StorageLocation{}).Where("scope = ? AND owner_id = ? AND active = ?", scope, ownerID, true).Update("active", false).Error; err != nil {
			return err
		}
		if !active {
			return nil
		}
		result := tx.Model(&model.StorageLocation{}).Where("id = ? AND scope = ? AND owner_id = ?", id, scope, ownerID).Update("active", true)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		return nil
	})
}

func (r *Repository) ReserveDailyUpload(userID string, day string, size int64, limit int64) error {
	usage := model.UserDailyUploadUsage{ID: userID + ":" + day, UserID: userID, Day: day}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&usage).Error; err != nil {
			return err
		}
		result := tx.Model(&model.UserDailyUploadUsage{}).
			Where("id = ? AND bytes + ? < ?", usage.ID, size, limit).
			Updates(map[string]any{"bytes": gorm.Expr("bytes + ?", size), "updated_at": time.Now()})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return ErrDailyUploadLimitExceeded
		}
		return nil
	})
}

func (r *Repository) ReleaseDailyUpload(userID string, day string, size int64) error {
	id := userID + ":" + day
	return r.db.Model(&model.UserDailyUploadUsage{}).
		Where("id = ?", id).
		Updates(map[string]any{
			"bytes":      gorm.Expr("CASE WHEN bytes >= ? THEN bytes - ? ELSE 0 END", size, size),
			"updated_at": time.Now(),
		}).Error
}

func (r *Repository) UserStoredFileBytes(userID string) (int64, error) {
	var total int64
	err := r.db.Raw(`
		SELECT
			COALESCE((
				SELECT SUM(physical_resources.size)
				FROM (
					SELECT MAX(size) AS size
					FROM resources
					WHERE user_id = ? AND status = ?
					GROUP BY COALESCE(NULLIF(provider, ''), 'local'), endpoint, bucket, object_key
				) AS physical_resources
			), 0)
	`, userID, model.ResourceStatusReady).Scan(&total).Error
	return total, err
}

func (r *Repository) DailyUploadBytes(userID string, day string) (int64, error) {
	var total int64
	err := r.db.Model(&model.UserDailyUploadUsage{}).Select("COALESCE(bytes, 0)").Where("user_id = ? AND day = ?", userID, day).Scan(&total).Error
	return total, err
}

func (r *Repository) CreateResource(resource *model.Resource) error {
	return r.db.Create(resource).Error
}

func (r *Repository) SaveResource(resource *model.Resource) error {
	return r.db.Save(resource).Error
}

// UpdateResourceThumbnail only updates a still-ready row and cannot resurrect a deleted resource.
func (r *Repository) UpdateResourceThumbnail(userID string, id string, values map[string]any) (bool, error) {
	result := r.db.Model(&model.Resource{}).
		Where("id = ? AND user_id = ? AND status = ?", id, userID, model.ResourceStatusReady).
		Updates(values)
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) ResourceByUploadKey(userID string, uploadKey string) (*model.Resource, error) {
	var resource model.Resource
	if err := r.db.First(&resource, "user_id = ? AND upload_key = ?", userID, uploadKey).Error; err != nil {
		return nil, err
	}
	return &resource, nil
}

func (r *Repository) ClaimFailedResourceUpload(userID string, id string) (bool, error) {
	result := r.db.Model(&model.Resource{}).
		Where("id = ? AND user_id = ? AND status = ?", id, userID, model.ResourceStatusFailed).
		Updates(map[string]any{"status": model.ResourceStatusPending, "error": "", "updated_at": time.Now()})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) DeleteResource(userID string, id string) error {
	return r.db.Delete(&model.Resource{}, "id = ? AND user_id = ?", id, userID).Error
}

func (r *Repository) Resource(id string) (*model.Resource, error) {
	var resource model.Resource
	if err := r.db.First(&resource, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &resource, nil
}

func (r *Repository) ResourceForUser(userID string, id string) (*model.Resource, error) {
	var resource model.Resource
	if err := r.db.First(&resource, "id = ? AND user_id = ?", id, userID).Error; err != nil {
		return nil, err
	}
	return &resource, nil
}

func (r *Repository) Resources(userID string, limit int) ([]model.Resource, error) {
	var resources []model.Resource
	if limit <= 0 || limit > 500 {
		limit = 200
	}
	err := r.db.Order("created_at desc").Limit(limit).Find(&resources, "user_id = ?", userID).Error
	return resources, err
}

// PlaybackPendingVideos 返回本地存储、就绪但尚无播放副本判定结果的视频
// （H.264 需标记 none、H.265 需触发转码）。
func (r *Repository) PlaybackPendingVideos(limit int) ([]model.Resource, error) {
	var resources []model.Resource
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	err := r.db.Where("kind = ? AND status = ? AND provider = ? AND (playback_status = ? OR playback_status IS NULL)",
		"video", model.ResourceStatusReady, "local", "").Order("created_at asc").Limit(limit).Find(&resources).Error
	return resources, err
}

// PlaybackNoneVideos 返回存量本地视频中旧逻辑遗留、停在 none 的行
// （规则变更前 H.265/MPEG-4 Part 2 曾被误判为浏览器可播并落 none）。
// 服务启动回填时对它们重新按 codec 判定，让判定规则变更覆盖规则变更前已导入的文件。
func (r *Repository) PlaybackNoneVideos(limit int) ([]model.Resource, error) {
	var resources []model.Resource
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	err := r.db.Where("kind = ? AND status = ? AND provider = ? AND playback_status = ?",
		"video", model.ResourceStatusReady, "local", model.PlaybackStatusNone).
		Order("created_at asc").Limit(limit).Find(&resources).Error
	return resources, err
}

// ClaimPlaybackTranscode 原子地把待判定（空/none）视频置为 processing，返回是否抢占成功。
// 多实例或多 goroutine 并发转同一资源时仅一个能成功置位，其余返回 false 直接放弃，
// 避免重复转码同一份文件。
func (r *Repository) ClaimPlaybackTranscode(id string) (bool, error) {
	res := r.db.Model(&model.Resource{}).
		Where("id = ? AND (playback_status = ? OR playback_status IS NULL OR playback_status = ?)",
			id, "", model.PlaybackStatusNone).
		Updates(map[string]any{"playback_status": model.PlaybackStatusProcessing, "playback_error": ""})
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

// ResetStuckPlaybackTranscodes 服务重启时把卡在 processing 的转码记录重置回待判定
// （进程崩溃后转码 goroutine 随进程消亡，状态永远停在 processing）。
func (r *Repository) ResetStuckPlaybackTranscodes() error {
	return r.db.Model(&model.Resource{}).
		Where("playback_status = ?", model.PlaybackStatusProcessing).
		Updates(map[string]any{"playback_status": "", "playback_error": ""}).Error
}

func (r *Repository) ResourceCleanupCandidates(incompleteBefore time.Time, readyBefore time.Time, limit int) ([]model.Resource, error) {
	var resources []model.Resource
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	err := r.db.Where(
		"(status IN ? AND updated_at <= ?) OR (status = ? AND created_at <= ?)",
		[]model.ResourceStatus{model.ResourceStatusPending, model.ResourceStatusFailed}, incompleteBefore,
		model.ResourceStatusReady, readyBefore,
	).Order("created_at asc, id asc").Limit(limit).Find(&resources).Error
	return resources, err
}

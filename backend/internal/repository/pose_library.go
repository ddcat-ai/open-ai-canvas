package repository

import (
	"strings"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// PoseLibraryFilter 是姿势库列表的筛选条件。VisibleOnly 只返回已启用且图片已同步的条目。
type PoseLibraryFilter struct {
	Keyword     string
	SourceKey   string
	System      string
	Category    string
	Angle       string
	Status      string
	VisibleOnly bool
}

type PoseLibraryFacet struct {
	Name  string `json:"name"`
	Count int64  `json:"count"`
}

type PoseLibraryStatusCount struct {
	Status  string
	Enabled bool
	Count   int64
}

type PoseLibrarySystemSummary struct {
	SourceKey string `json:"sourceKey"`
	System    string `json:"system"`
	Total     int64  `json:"total"`
	Ready     int64  `json:"ready"`
	Enabled   int64  `json:"enabled"`
}

const poseLibraryBatchSize = 400

func (r *Repository) poseLibraryQuery(filter PoseLibraryFilter) *gorm.DB {
	query := r.db.Model(&model.PoseLibraryItem{})
	if filter.VisibleOnly {
		query = query.Where("enabled = ? AND status = ?", true, model.PoseLibraryStatusReady)
	}
	if filter.SourceKey != "" {
		query = query.Where("source_key = ?", filter.SourceKey)
	}
	if filter.System != "" {
		query = query.Where("system = ?", filter.System)
	}
	if filter.Category != "" {
		query = query.Where("category = ?", filter.Category)
	}
	if filter.Angle != "" {
		query = query.Where("angle = ?", filter.Angle)
	}
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if keyword := strings.TrimSpace(filter.Keyword); keyword != "" {
		query = query.Where("search_text LIKE ? ESCAPE '\\'", "%"+strings.ToLower(escapeLike(keyword))+"%")
	}
	return query
}

func (r *Repository) UpsertPoseLibrarySource(source *model.PoseLibrarySource) error {
	return r.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"name", "attribution", "homepage", "base_url", "updated_at"}),
	}).Create(source).Error
}

func (r *Repository) PoseLibrarySources() ([]model.PoseLibrarySource, error) {
	sources := []model.PoseLibrarySource{}
	err := r.db.Order("created_at asc, key asc").Find(&sources).Error
	return sources, err
}

// PoseLibraryItemsByExternalKeys 按来源内的外部 ID 读取已有条目，用于导入时判断新增还是更新。
func (r *Repository) PoseLibraryItemsByExternalKeys(sourceKey string, keys []string) (map[string]model.PoseLibraryItem, error) {
	existing := make(map[string]model.PoseLibraryItem, len(keys))
	for start := 0; start < len(keys); start += poseLibraryBatchSize {
		end := min(start+poseLibraryBatchSize, len(keys))
		var items []model.PoseLibraryItem
		if err := r.db.Where("source_key = ? AND external_key IN ?", sourceKey, keys[start:end]).Find(&items).Error; err != nil {
			return nil, err
		}
		for _, item := range items {
			existing[item.ExternalKey] = item
		}
	}
	return existing, nil
}

// SavePoseLibraryImport 在一个事务里写入来源、新增条目和元数据更新，导入要么整体生效要么不生效。
func (r *Repository) SavePoseLibraryImport(source *model.PoseLibrarySource, created []model.PoseLibraryItem, updated []model.PoseLibraryItem) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "key"}},
			DoUpdates: clause.AssignmentColumns([]string{"name", "attribution", "homepage", "base_url", "updated_at"}),
		}).Create(source).Error; err != nil {
			return err
		}
		if len(created) > 0 {
			if err := tx.CreateInBatches(created, 200).Error; err != nil {
				return err
			}
		}
		// 只改元数据列：Save 会把并发删除的条目重新插回，也会覆盖同步刚写入的图片字段。
		for index := range updated {
			item := &updated[index]
			if err := tx.Model(&model.PoseLibraryItem{ID: item.ID}).
				Select("group_key", "code", "system", "category", "name", "angle", "search_text", "sort_order", "status", "error", "remote_thumb", "remote_image", "updated_at").
				Updates(item).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *Repository) PoseLibraryItem(id string) (*model.PoseLibraryItem, error) {
	var item model.PoseLibraryItem
	if err := r.db.First(&item, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &item, nil
}

func (r *Repository) PoseLibraryItemsByIDs(ids []string) ([]model.PoseLibraryItem, error) {
	var items []model.PoseLibraryItem
	if len(ids) == 0 {
		return items, nil
	}
	err := r.db.Where("id IN ?", ids).Find(&items).Error
	return items, err
}

func (r *Repository) CreatePoseLibraryItem(item *model.PoseLibraryItem) error {
	return r.db.Create(item).Error
}

// UpdatePoseLibraryItem 只更新给定列；返回受影响行数，0 表示条目已被删除。
func (r *Repository) UpdatePoseLibraryItem(id string, fields map[string]any) (int64, error) {
	result := r.db.Model(&model.PoseLibraryItem{}).Where("id = ?", id).Updates(fields)
	return result.RowsAffected, result.Error
}

// PoseLibraryItemsForSync 返回等待下载图片的条目；只有带远程地址的条目才需要同步。
func (r *Repository) PoseLibraryItemsForSync(limit int) ([]model.PoseLibraryItem, error) {
	var items []model.PoseLibraryItem
	err := r.db.Where("status = ? AND remote_image <> ''", model.PoseLibraryStatusPending).Order("sort_order asc, id asc").Limit(limit).Find(&items).Error
	return items, err
}

// RequeuePoseLibraryItems 把带来源地址的条目放回待同步，已有文件在重新下载成功前继续可用路径不变。
func (r *Repository) RequeuePoseLibraryItems(ids []string) (int64, error) {
	var affected int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		for start := 0; start < len(ids); start += poseLibraryBatchSize {
			end := min(start+poseLibraryBatchSize, len(ids))
			result := tx.Model(&model.PoseLibraryItem{}).Where("id IN ? AND remote_image <> ''", ids[start:end]).
				Updates(map[string]any{"status": model.PoseLibraryStatusPending, "error": "", "updated_at": time.Now()})
			if result.Error != nil {
				return result.Error
			}
			affected += result.RowsAffected
		}
		return nil
	})
	return affected, err
}

func (r *Repository) RequeueFailedPoseLibraryItems() (int64, error) {
	result := r.db.Model(&model.PoseLibraryItem{}).Where("status = ? AND remote_image <> ''", model.PoseLibraryStatusFailed).
		Updates(map[string]any{"status": model.PoseLibraryStatusPending, "error": "", "updated_at": time.Now()})
	return result.RowsAffected, result.Error
}

func (r *Repository) PoseLibraryItemIDs(filter PoseLibraryFilter) ([]string, error) {
	var ids []string
	err := r.poseLibraryQuery(filter).Order("sort_order asc, id asc").Pluck("id", &ids).Error
	return ids, err
}

func (r *Repository) DeletePoseLibraryItems(ids []string) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		for start := 0; start < len(ids); start += poseLibraryBatchSize {
			end := min(start+poseLibraryBatchSize, len(ids))
			if err := tx.Where("id IN ?", ids[start:end]).Delete(&model.PoseLibraryItem{}).Error; err != nil {
				return err
			}
		}
		// 来源下已没有条目时一并移除来源署名，避免模态框继续展示空来源。
		return tx.Where("key NOT IN (?)", tx.Model(&model.PoseLibraryItem{}).Distinct("source_key")).Delete(&model.PoseLibrarySource{}).Error
	})
}

func (r *Repository) SetPoseLibraryItemsEnabled(ids []string, enabled bool) (int64, error) {
	var affected int64
	err := r.db.Transaction(func(tx *gorm.DB) error {
		for start := 0; start < len(ids); start += poseLibraryBatchSize {
			end := min(start+poseLibraryBatchSize, len(ids))
			result := tx.Model(&model.PoseLibraryItem{}).Where("id IN ?", ids[start:end]).Updates(map[string]any{"enabled": enabled, "updated_at": time.Now()})
			if result.Error != nil {
				return result.Error
			}
			affected += result.RowsAffected
		}
		return nil
	})
	return affected, err
}

func (r *Repository) AdminPoseLibraryItems(filter PoseLibraryFilter, limit int, offset int) ([]model.PoseLibraryItem, int64, error) {
	var total int64
	if err := r.poseLibraryQuery(filter).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var items []model.PoseLibraryItem
	err := r.poseLibraryQuery(filter).Order("sort_order asc, id asc").Limit(limit).Offset(offset).Find(&items).Error
	return items, total, err
}

func (r *Repository) PoseLibraryStatusCounts() ([]PoseLibraryStatusCount, error) {
	var rows []PoseLibraryStatusCount
	err := r.db.Model(&model.PoseLibraryItem{}).Select("status, enabled, COUNT(*) AS count").Group("status, enabled").Scan(&rows).Error
	return rows, err
}

func (r *Repository) PoseLibrarySystemSummaries() ([]PoseLibrarySystemSummary, error) {
	rows := []PoseLibrarySystemSummary{}
	err := r.db.Model(&model.PoseLibraryItem{}).
		Select("source_key, system, COUNT(*) AS total, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS ready, SUM(CASE WHEN enabled THEN 1 ELSE 0 END) AS enabled", model.PoseLibraryStatusReady).
		Group("source_key, system").Order("MIN(sort_order) asc").Scan(&rows).Error
	return rows, err
}

func (r *Repository) MaxPoseLibrarySortOrder() (int, error) {
	var value int
	err := r.db.Model(&model.PoseLibraryItem{}).Select("COALESCE(MAX(sort_order), 0)").Scan(&value).Error
	return value, err
}

// PoseLibraryGroupPage 按姿势分组分页：一个姿势的多个视角算一项，顺序沿用导入顺序。
func (r *Repository) PoseLibraryGroupPage(filter PoseLibraryFilter, limit int, offset int) ([]string, int64, error) {
	var total int64
	if err := r.poseLibraryQuery(filter).Distinct("group_key").Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var rows []struct {
		GroupKey string
		SortKey  int
	}
	err := r.poseLibraryQuery(filter).Select("group_key, MIN(sort_order) AS sort_key").Group("group_key").Order("sort_key asc, group_key asc").Limit(limit).Offset(offset).Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	keys := make([]string, 0, len(rows))
	for _, row := range rows {
		keys = append(keys, row.GroupKey)
	}
	return keys, total, nil
}

func (r *Repository) PoseLibraryVisibleItemsByGroups(groupKeys []string) ([]model.PoseLibraryItem, error) {
	var items []model.PoseLibraryItem
	if len(groupKeys) == 0 {
		return items, nil
	}
	err := r.poseLibraryQuery(PoseLibraryFilter{VisibleOnly: true}).Where("group_key IN ?", groupKeys).Order("sort_order asc, id asc").Find(&items).Error
	return items, err
}

// PoseLibraryGroupFacets 统计每个取值下的姿势数（按分组去重），用于筛选项计数。
func (r *Repository) PoseLibraryGroupFacets(column string, filter PoseLibraryFilter) ([]PoseLibraryFacet, error) {
	switch column {
	case "system", "category", "angle":
	default:
		return nil, gorm.ErrInvalidField
	}
	rows := []PoseLibraryFacet{}
	err := r.poseLibraryQuery(filter).Select(column + " AS name, COUNT(DISTINCT group_key) AS count").Group(column).Order("MIN(sort_order) asc").Scan(&rows).Error
	return rows, err
}

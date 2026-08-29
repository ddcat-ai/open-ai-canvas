package repository

import (
	"strings"

	"infinite-canvas/backend/internal/model"
)

type AdminResourceFilter struct {
	Kind     string
	Status   string
	Provider string
	UserID   string
	Keyword  string
	Limit    int
	Offset   int
}

type ResourceKindStat struct {
	Kind          string `json:"kind" gorm:"column:kind"`
	Count         int64  `json:"count" gorm:"column:count"`
	LogicalBytes  int64  `json:"logicalBytes" gorm:"column:logical_bytes"`
	PhysicalBytes int64  `json:"physicalBytes" gorm:"column:physical_bytes"`
}

type ResourceProviderStat struct {
	Provider      string `json:"provider" gorm:"column:provider"`
	Count         int64  `json:"count" gorm:"column:count"`
	LogicalBytes  int64  `json:"logicalBytes" gorm:"column:logical_bytes"`
	PhysicalBytes int64  `json:"physicalBytes" gorm:"column:physical_bytes"`
}

type ResourceStorageSummary struct {
	ResourceCount int64 `json:"resourceCount" gorm:"column:resource_count"`
	ReadyCount    int64 `json:"readyCount" gorm:"column:ready_count"`
	LogicalBytes  int64 `json:"logicalBytes" gorm:"column:logical_bytes"`
	PhysicalBytes int64 `json:"physicalBytes" gorm:"column:physical_bytes"`
	LocalBytes    int64 `json:"localBytes" gorm:"column:local_bytes"`
	RemoteBytes   int64 `json:"remoteBytes" gorm:"column:remote_bytes"`
}

func (r *Repository) AdminResources(filter AdminResourceFilter) ([]model.Resource, int64, error) {
	var resources []model.Resource
	var total int64
	query := r.db.Model(&model.Resource{})
	if filter.Kind != "" {
		query = query.Where("kind = ?", filter.Kind)
	}
	if filter.Status != "" {
		query = query.Where("status = ?", filter.Status)
	}
	if filter.Provider != "" {
		query = query.Where(resourceProviderExpression()+" = ?", filter.Provider)
	}
	if filter.UserID != "" {
		query = query.Where("user_id = ?", filter.UserID)
	}
	if filter.Keyword != "" {
		pattern := "%" + strings.ToLower(filter.Keyword) + "%"
		query = query.Where("lower(id) LIKE ? OR lower(object_key) LIKE ?", pattern, pattern)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("created_at desc, id desc").Limit(filter.Limit).Offset(filter.Offset).Find(&resources).Error; err != nil {
		return nil, 0, err
	}
	return resources, total, nil
}

func (r *Repository) UsersByIDs(ids []string) (map[string]model.User, error) {
	if len(ids) == 0 {
		return map[string]model.User{}, nil
	}
	var users []model.User
	if err := r.db.Select("id", "username", "display_name").Where("id IN ?", ids).Find(&users).Error; err != nil {
		return nil, err
	}
	result := make(map[string]model.User, len(users))
	for _, user := range users {
		result[user.ID] = user
	}
	return result, nil
}

func (r *Repository) ResourceStorageSummary() (ResourceStorageSummary, error) {
	var summary ResourceStorageSummary
	err := r.db.Model(&model.Resource{}).Select(`
		COUNT(*) AS resource_count,
		COALESCE(SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END), 0) AS ready_count,
		COALESCE(SUM(size), 0) AS logical_bytes
	`).Scan(&summary).Error
	if err != nil {
		return summary, err
	}
	physicalBytes, err := r.resourcePhysicalBytes("")
	if err != nil {
		return summary, err
	}
	localBytes, err := r.resourcePhysicalBytes(resourceProviderExpression()+" = ?", "local")
	if err != nil {
		return summary, err
	}
	summary.PhysicalBytes = physicalBytes
	summary.LocalBytes = localBytes
	summary.RemoteBytes = physicalBytes - localBytes
	return summary, nil
}

func (r *Repository) resourcePhysicalBytes(where string, args ...any) (int64, error) {
	query := r.db.Model(&model.Resource{}).
		Select("MAX(size) AS size").
		Where("status = ?", model.ResourceStatusReady)
	if where != "" {
		query = query.Where(where, args...)
	}
	query = query.Group(resourceProviderExpression() + ", endpoint, bucket, object_key")
	var total struct {
		Bytes int64 `gorm:"column:bytes"`
	}
	err := r.db.Table("(?) AS physical_resources", query).
		Select("COALESCE(SUM(size), 0) AS bytes").
		Scan(&total).Error
	return total.Bytes, err
}

func (r *Repository) ResourceKindStats() ([]ResourceKindStat, error) {
	var stats []ResourceKindStat
	err := r.db.Model(&model.Resource{}).
		Select("kind, COUNT(*) AS count, COALESCE(SUM(size), 0) AS logical_bytes").
		Group("kind").
		Order("logical_bytes desc, kind asc").
		Scan(&stats).Error
	if err != nil {
		return nil, err
	}
	physical, err := r.resourcePhysicalStats("kind")
	if err != nil {
		return nil, err
	}
	for index := range stats {
		stats[index].PhysicalBytes = physical[stats[index].Kind]
	}
	return stats, err
}

func (r *Repository) ResourceProviderStats() ([]ResourceProviderStat, error) {
	var stats []ResourceProviderStat
	provider := resourceProviderExpression()
	err := r.db.Model(&model.Resource{}).
		Select(provider + " AS provider, COUNT(*) AS count, COALESCE(SUM(size), 0) AS logical_bytes").
		Group(provider).
		Order("logical_bytes desc, provider asc").
		Scan(&stats).Error
	if err != nil {
		return nil, err
	}
	physical, err := r.resourcePhysicalStats(provider)
	if err != nil {
		return nil, err
	}
	for index := range stats {
		stats[index].PhysicalBytes = physical[stats[index].Provider]
	}
	return stats, err
}

func (r *Repository) resourcePhysicalStats(dimensionExpression string) (map[string]int64, error) {
	query := r.db.Model(&model.Resource{}).
		Select(dimensionExpression+" AS dimension, MAX(size) AS size").
		Where("status = ?", model.ResourceStatusReady).
		Group(dimensionExpression + ", " + resourceProviderExpression() + ", endpoint, bucket, object_key")
	var rows []struct {
		Dimension string `gorm:"column:dimension"`
		Bytes     int64  `gorm:"column:bytes"`
	}
	err := r.db.Table("(?) AS physical_resources", query).
		Select("dimension, COALESCE(SUM(size), 0) AS bytes").
		Group("dimension").
		Scan(&rows).Error
	result := make(map[string]int64, len(rows))
	for _, row := range rows {
		result[row.Dimension] = row.Bytes
	}
	return result, err
}

func resourceProviderExpression() string {
	return "COALESCE(NULLIF(provider, ''), 'local')"
}

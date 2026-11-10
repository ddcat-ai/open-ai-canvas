package repository

import (
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 在调用方事务内串行化同一目标作品的导入。SQLite 也需先取得写锁再读取匹配快照。
func (r *Repository) LockDramaCastImportTarget(userID, projectID string) error {
	result := r.db.Model(&model.Project{}).Where("id = ? AND user_id = ?", projectID, userID).UpdateColumn("id", gorm.Expr("id"))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) DramaCastsForUpdate(projectID string) ([]model.DramaCast, error) {
	var casts []model.DramaCast
	err := r.db.Clauses(clause.Locking{Strength: "UPDATE"}).Where("project_id = ?", projectID).Order("kind asc, position asc, id asc").Find(&casts).Error
	return casts, err
}

// 早期设定可能只有当前图片而没有 take；替换前补齐，继续使用资源引用保护合同。
func (r *Repository) PreserveDramaCastImage(cast model.DramaCast) error {
	if cast.ImageResourceID == "" {
		return nil
	}
	var count int64
	if err := r.db.Model(&model.DramaTake{}).Where("project_id = ? AND owner_id = ? AND kind = ? AND resource_id = ?", cast.ProjectID, cast.ID, "cast", cast.ImageResourceID).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	return r.CreateDramaTake(&model.DramaTake{ID: kernel.NewID(), ProjectID: cast.ProjectID, OwnerID: cast.ID, Kind: "cast", ResourceID: cast.ImageResourceID, Prompt: "导入前保留的参考图", CreatedAt: time.Now()})
}

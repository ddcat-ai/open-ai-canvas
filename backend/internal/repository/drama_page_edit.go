package repository

import (
	"errors"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

var ErrDramaEpisodeRevisionConflict = errors.New("本集镜头已被修改，请重新读取后再提交")

// WithDramaEpisodeRevision 将版本校验与镜头修改包在同一个事务内。
// 无变化的 UPDATE 在 SQLite 和 PostgreSQL 都取得写锁；不能先读版本再另起事务保存。
func (r *Repository) WithDramaEpisodeRevision(projectID, episodeID string, revision int64, fn func(*Repository) error) error {
	return r.Transaction(func(repo *Repository) error {
		result := repo.db.Model(&model.DramaEpisode{}).
			Where("id = ? AND project_id = ? AND revision = ?", episodeID, projectID, revision).
			UpdateColumn("revision", gorm.Expr("revision"))
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrDramaEpisodeRevisionConflict
		}
		return fn(repo)
	})
}

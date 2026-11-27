package database

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func migrateResourceContentSHA256(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&model.Resource{}) || tx.Migrator().HasColumn(&model.Resource{}, "ContentSHA256") {
		return nil
	}
	// 历史资源没有可核验的原始摘要，保留空值，不用大小或对象存储 ETag 代替内容哈希。
	return tx.Migrator().AddColumn(&model.Resource{}, "ContentSHA256")
}

package database

import (
	"fmt"

	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

// Existing databases do not rerun the baseline AutoMigrate when model indexes change.
func migrateArkPrivateAssetBindingIdentity(tx *gorm.DB) error {
	binding := &model.ArkPrivateAssetBinding{}
	if !tx.Migrator().HasTable(binding) {
		return tx.AutoMigrate(binding)
	}
	const index = "idx_ark_private_asset_binding_resource_project"
	if tx.Migrator().HasIndex(binding, index) {
		indexes, err := tx.Migrator().GetIndexes(binding)
		if err != nil {
			return fmt.Errorf("读取方舟可信素材绑定索引：%w", err)
		}
		for _, existing := range indexes {
			if existing.Name() != index {
				continue
			}
			unique, known := existing.Unique()
			columns := existing.Columns()
			if !known || !unique || len(columns) != 2 ||
				!((columns[0] == "resource_id" && columns[1] == "project_name") || (columns[0] == "project_name" && columns[1] == "resource_id")) {
				break
			}
			// GetIndexes omits predicates and PostgreSQL validity/immediacy; those
			// also determine whether an index can arbitrate this ON CONFLICT.
			var usable bool
			var query string
			switch tx.Dialector.Name() {
			case "sqlite":
				query = `SELECT "partial" = 0 FROM pragma_index_list('ark_private_asset_bindings') WHERE name = ?`
			case "postgres":
				query = `SELECT i.indisvalid AND i.indisready AND i.indimmediate
					AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts = 2
					FROM pg_index i JOIN pg_class idx ON idx.oid = i.indexrelid
					JOIN pg_namespace ns ON ns.oid = idx.relnamespace
					WHERE idx.relname = ? AND ns.nspname = current_schema()`
			default:
				return fmt.Errorf("不支持校验方舟可信素材绑定索引的数据库：%s", tx.Dialector.Name())
			}
			if err := tx.Raw(query, index).Scan(&usable).Error; err != nil {
				return fmt.Errorf("检查方舟可信素材绑定索引仲裁条件：%w", err)
			}
			if usable {
				return nil
			}
			break
		}
		return fmt.Errorf("索引 %s 定义不匹配：必须是完整、有效、可立即仲裁的 (resource_id, project_name) 复合唯一索引；请核对并修复索引后重试迁移，未修改已有索引或绑定", index)
	}
	var duplicates int64
	if err := tx.Raw(`SELECT COUNT(*) FROM (
		SELECT resource_id, project_name FROM ark_private_asset_bindings
		GROUP BY resource_id, project_name HAVING COUNT(*) > 1
	) AS duplicate_bindings`).Scan(&duplicates).Error; err != nil {
		return fmt.Errorf("检查方舟可信素材重复绑定：%w", err)
	}
	if duplicates > 0 {
		return fmt.Errorf("ark_private_asset_bindings 存在 %d 组重复的 (resource_id, project_name)，请先核对方舟素材 ID 与审核状态并处理重复绑定后重试迁移；未删除任何绑定", duplicates)
	}
	return tx.Migrator().CreateIndex(binding, index)
}

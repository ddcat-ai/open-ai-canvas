package repository

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"strings"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
)

// SnapshotDatabase includes every table, including extension/plugin tables.
func (r *Repository) SnapshotDatabase(ctx context.Context, destination string) error {
	if r.Dialect() == "sqlite" {
		return r.WithContext(ctx).BackupSQLite(destination)
	}
	dialector, ok := r.db.Dialector.(*postgres.Dialector)
	if !ok || dialector.Config.DSN == "" {
		return errors.New("无法读取当前 PostgreSQL 连接配置")
	}
	cmd := exec.CommandContext(ctx, "pg_dump", "--format=custom", "--no-owner", "--no-acl", "--file="+destination)
	// Credentials stay out of process arguments and diagnostic responses.
	for _, item := range os.Environ() {
		if !strings.HasPrefix(item, "PGDATABASE=") {
			cmd.Env = append(cmd.Env, item)
		}
	}
	cmd.Env = append(cmd.Env, "PGDATABASE="+dialector.Config.DSN)
	if err := database.WithBackupMigrationLock(ctx, r.db, cmd.Run); err != nil {
		return errors.New("PostgreSQL 快照失败，请检查 pg_dump 是否已安装、版本是否兼容及数据库连接权限")
	}
	return nil
}

func (r *Repository) DatabaseBackupTables() ([]string, error) { return r.db.Migrator().GetTables() }

func (r *Repository) DatabaseBackupRecords() ([]model.SystemSetting, error) {
	var records []model.SystemSetting
	err := r.db.Where("key LIKE ?", "database-backup.record.%").Order("created_at DESC").Find(&records).Error
	return records, err
}

// A database-backed lease also excludes other server instances. Runtime is
// bounded to 25 minutes; a crashed process releases its lease after 30 minutes.
func (r *Repository) ClaimDatabaseBackup(token string, now time.Time) (bool, error) {
	row := model.SystemSetting{Key: "database-backup.lock", ValueJSON: token, CreatedAt: now, UpdatedAt: now}
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
	if result.Error != nil || result.RowsAffected == 1 {
		return result.RowsAffected == 1, result.Error
	}
	result = r.db.Model(&model.SystemSetting{}).Where("key = ? AND updated_at < ?", row.Key, now.Add(-30*time.Minute)).Updates(map[string]any{"value_json": token, "updated_at": now})
	return result.RowsAffected == 1, result.Error
}

func (r *Repository) ReleaseDatabaseBackup(token string) error {
	return r.db.Where("key = ? AND value_json = ?", "database-backup.lock", token).Delete(&model.SystemSetting{}).Error
}

func (r *Repository) ClaimDatabaseBackupDay(day string) (bool, error) {
	row := model.SystemSetting{Key: "database-backup.day." + day, ValueJSON: "{}"}
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&row)
	return result.RowsAffected == 1, result.Error
}

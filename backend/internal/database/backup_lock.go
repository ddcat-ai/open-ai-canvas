package database

import (
	"context"
	"gorm.io/gorm"
)

// Share the migration lock while pg_dump takes its consistent snapshot. Normal
// business transactions remain writable; schema migrations wait for the dump.
func WithBackupMigrationLock(ctx context.Context, db *gorm.DB, dump func() error) error {
	return db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock_shared(?)", postgresSchemaMigrationLockID).Error; err != nil {
			return err
		}
		return dump()
	})
}

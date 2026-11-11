package repository

import (
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func nextChannelEditVersion(now, expected time.Time) time.Time {
	nextVersion := now.UTC().Truncate(time.Microsecond)
	if !nextVersion.After(expected) {
		nextVersion = expected.UTC().Truncate(time.Microsecond).Add(time.Microsecond)
	}
	return nextVersion
}

// Reject a stale editor after a website or batch update has committed.
func (r *Repository) SaveSystemChannelVersion(channel *model.ModelChannel, expected time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := New(tx).LockSystemChannelConfiguration([]string{channel.ID}); err != nil {
			return err
		}
		// Every successful CAS must consume its version, even within one clock
		// tick or after clock rollback. Microseconds also survive PostgreSQL's
		// timestamp precision, so a stale editor cannot reuse the old version.
		nextVersion := nextChannelEditVersion(tx.NowFunc(), expected)
		tx = tx.Session(&gorm.Session{NowFunc: func() time.Time { return nextVersion }})
		result := tx.Model(channel).Where("id = ? AND scope = ? AND updated_at = ?", channel.ID, model.ChannelScopeSystem, expected).Select("*").Updates(channel)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrTaskStateConflict
		}
		return nil
	})
}

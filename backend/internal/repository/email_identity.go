package repository

import (
	"infinite-canvas/backend/internal/emailidentity"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

// CheckEmailAvailable compares legacy rows without rewriting their login address.
func (r *Repository) CheckEmailAvailable(email, ownID string) error {
	if email == "" {
		return nil
	}
	value := "lower(trim(email))"
	local := "split_part(" + value + ",'@',1)"
	if r.Dialect() == "sqlite" {
		local = "substr(" + value + ",1,instr(" + value + ",'@')-1)"
	}
	untagged := "split_part(" + local + ",'+',1)"
	if r.Dialect() == "sqlite" {
		untagged = "CASE WHEN instr(" + local + ",'+') > 0 THEN substr(" + local + ",1,instr(" + local + ",'+')-1) ELSE " + local + " END"
	}
	canonical := "CASE WHEN " + value + " LIKE '%@gmail.com' OR " + value + " LIKE '%@googlemail.com' THEN replace((" + untagged + "),'.','') || '@gmail.com' ELSE " + value + " END"
	var count int64
	if err := r.db.Model(&model.User{}).Where("id <> ? AND ("+canonical+") = ?", ownID, emailidentity.Canonical(email)).Count(&count).Error; err != nil {
		return err
	}
	if count > 0 {
		return kernel.BadAuthRequest("邮箱已被注册")
	}
	return nil
}

// All public registration paths lock before checking and writing, including
// registrations using different verification codes on different instances.
func lockRegistrationEmail(tx *gorm.DB, email string) error {
	if tx.Dialector.Name() == "postgres" {
		return tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?)::bigint)", "registration-email:"+emailidentity.Canonical(email)).Error
	}
	if tx.Dialector.Name() == "sqlite" {
		return tx.Exec("UPDATE users SET updated_at = updated_at WHERE 1 = 0").Error
	}
	return gorm.ErrInvalidData
}

func (r *Repository) CreateRegisteredUser(user *model.User) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockRegistrationEmail(tx, user.Email); err != nil {
			return err
		}
		if err := New(tx).CheckEmailAvailable(user.Email, ""); err != nil {
			return err
		}
		return tx.Create(user).Error
	})
}

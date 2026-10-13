package repository

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

var ErrProfileAuthorization = errors.New("账号或身份验证状态已变化，请重新登录或验证")

const ProfileReauthenticationTTL = 5 * time.Minute

func ProfileCredentialHash(passwordHash string) string {
	v := sha256.Sum256([]byte(passwordHash))
	return hex.EncodeToString(v[:])
}

func lockProfileUser(tx *gorm.DB, userID string) error {
	if tx.Dialector.Name() == "sqlite" {
		return tx.Model(&model.User{}).Where("id = ?", userID).UpdateColumn("updated_at", gorm.Expr("updated_at")).Error
	}
	return nil
}

// Serialize session issuance with credential changes so a login validated
// before revocation cannot insert an authenticated session afterwards.
func (r *Repository) CreateAuthSessionForUser(expected *model.User, session *model.AuthSession, events ...*model.LoginLog) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if session.UserID != expected.ID {
			return ErrProfileAuthorization
		}
		if err := lockProfileUser(tx, expected.ID); err != nil {
			return err
		}
		var current model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id = ?", expected.ID).Error; err != nil {
			return err
		}
		if current.Status != model.UserStatusActive || current.PasswordHash != expected.PasswordHash || current.Email != expected.Email {
			return ErrProfileAuthorization
		}
		if err := tx.Create(session).Error; err != nil {
			return err
		}
		for _, event := range events {
			if event.UserID == nil || *event.UserID != expected.ID || event.Event != "login" || event.Result != "success" {
				return ErrProfileAuthorization
			}
			if err := tx.Create(event).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func profileAuthorization(tx *gorm.DB, expected *model.User, session *model.AuthSession, now time.Time, requireReauth bool) error {
	var current model.User
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&current, "id = ?", expected.ID).Error; err != nil {
		return err
	}
	if current.Status != model.UserStatusActive || current.PasswordHash != expected.PasswordHash || current.Email != expected.Email {
		return ErrProfileAuthorization
	}
	var stored model.AuthSession
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&stored, "id = ? AND user_id = ?", session.ID, expected.ID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrProfileAuthorization
		}
		return err
	}
	// A transaction may wait for another account write; expiry is checked after
	// taking the locks rather than against the request's earlier timestamp.
	now = time.Now()
	if stored.TokenHash != session.TokenHash || !stored.ExpiresAt.After(now) {
		return ErrProfileAuthorization
	}
	if requireReauth && (stored.ReauthenticatedAt == nil || stored.ReauthenticatedAt.After(now) || !stored.ReauthenticatedAt.Add(ProfileReauthenticationTTL).After(now)) {
		return ErrProfileAuthorization
	}
	return nil
}

func (r *Repository) ChangeProfilePassword(expected *model.User, session *model.AuthSession, newHash string, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockProfileUser(tx, expected.ID); err != nil {
			return err
		}
		if err := profileAuthorization(tx, expected, session, now, expected.PasswordHash == ""); err != nil {
			return err
		}
		result := tx.Model(&model.User{}).Where("id = ? AND password_hash = ? AND status = ?", expected.ID, expected.PasswordHash, model.UserStatusActive).Updates(map[string]any{"password_hash": newHash, "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrProfileAuthorization
		}
		return tx.Where("user_id = ?", expected.ID).Delete(&model.AuthSession{}).Error
	})
}

func (r *Repository) ChangeProfileEmail(expected *model.User, session *model.AuthSession, v *model.AuthVerification, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockRegistrationEmail(tx, v.Email); err != nil {
			return err
		}
		if err := profileAuthorization(tx, expected, session, now, expected.PasswordHash == ""); err != nil {
			return err
		}
		now = time.Now()
		if err := New(tx).CheckEmailAvailable(v.Email, expected.ID); err != nil {
			return err
		}
		result := tx.Model(&model.AuthVerification{}).Where("id = ? AND user_id = ? AND session_id = ? AND purpose = ? AND credential_hash = ? AND email = ? AND ready = ? AND used_at IS NULL AND expires_at > ? AND attempts <= 5", v.ID, expected.ID, session.ID, "profile_email", ProfileCredentialHash(expected.PasswordHash), v.Email, true, now).Update("used_at", now)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrVerificationInvalid
		}
		result = tx.Model(&model.User{}).Where("id = ? AND password_hash = ? AND status = ?", expected.ID, expected.PasswordHash, model.UserStatusActive).Updates(map[string]any{"email": v.Email, "email_verified_at": now, "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrProfileAuthorization
		}
		return tx.Where("user_id = ?", expected.ID).Delete(&model.AuthSession{}).Error
	})
}

func (r *Repository) ReauthenticateLinuxDOSession(expected *model.User, session *model.AuthSession, subject string, now time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockProfileUser(tx, expected.ID); err != nil {
			return err
		}
		if err := profileAuthorization(tx, expected, session, now, false); err != nil {
			return err
		}
		var count int64
		if err := tx.Model(&model.UserIdentity{}).Where("provider = ? AND subject = ? AND user_id = ?", "linuxdo", subject, expected.ID).Count(&count).Error; err != nil {
			return err
		}
		if count != 1 {
			return ErrProfileAuthorization
		}
		result := tx.Model(&model.AuthSession{}).Where("id = ? AND user_id = ? AND token_hash = ?", session.ID, expected.ID, session.TokenHash).Updates(map[string]any{"reauthenticated_at": now, "updated_at": now})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrProfileAuthorization
		}
		return nil
	})
}

func (r *Repository) LinuxDOReauthenticationState(stateHash string) (bool, error) {
	var state model.OAuthState
	err := r.db.First(&state, "provider = ? AND state_hash = ?", "linuxdo", stateHash).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return state.ReauthUserID != "" && state.ReauthSessionID != "", nil
}

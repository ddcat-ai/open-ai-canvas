package repository

import (
	"time"

	"yingce/backend/internal/model"

	"gorm.io/gorm/clause"
	"gorm.io/gorm"
)

func (r *Repository) CreateDesktopAuthorizationCodeForUser(expected *model.User, code *model.DesktopAuthorizationCode) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
	if expected == nil || code.UserID != expected.ID {
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
		stale := time.Now().Add(-24 * time.Hour)
		if err := tx.Where("expires_at <= ? OR used_at <= ?", stale, stale).Delete(&model.DesktopAuthorizationCode{}).Error; err != nil {
			return err
		}
		return tx.Create(code).Error
	})
}

func (r *Repository) DesktopAuthorizationCode(codeHash string, now time.Time) (*model.DesktopAuthorizationCode, error) {
	var code model.DesktopAuthorizationCode
	if err := r.db.First(&code, "code_hash = ? AND used_at IS NULL AND expires_at > ?", codeHash, now).Error; err != nil {
		return nil, err
	}
	return &code, nil
}

func (r *Repository) ConsumeDesktopAuthorizationCode(id string, now time.Time) error {
	result := r.db.Model(&model.DesktopAuthorizationCode{}).
		Where("id = ? AND used_at IS NULL AND expires_at > ?", id, now).
		Update("used_at", now)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) UserIdentity(provider string, subject string) (*model.UserIdentity, error) {
	var identity model.UserIdentity
	if err := r.db.First(&identity, "provider = ? AND subject = ?", provider, subject).Error; err != nil {
		return nil, err
	}
	return &identity, nil
}

func (r *Repository) UserIdentityForUser(userID string, provider string) (*model.UserIdentity, error) {
	var identity model.UserIdentity
	if err := r.db.First(&identity, "user_id = ? AND provider = ?", userID, provider).Error; err != nil {
		return nil, err
	}
	return &identity, nil
}

func (r *Repository) CreateOAuthState(state *model.OAuthState) error {
	return r.db.Create(state).Error
}

func (r *Repository) PendingOAuthState(provider, stateHash string) (*model.OAuthState, error) {
	var state model.OAuthState
	err := r.db.First(&state, "provider = ? AND state_hash = ? AND used_at IS NULL AND expires_at > ?", provider, stateHash, time.Now()).Error
	return &state, err
}

func (r *Repository) CreateUserIdentity(identity *model.UserIdentity) error {
	return r.db.Create(identity).Error
}

func (r *Repository) ConsumeOAuthState(provider string, stateHash string) (*model.OAuthState, error) {
	var state model.OAuthState
	err := r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&state, "provider = ? AND state_hash = ? AND used_at IS NULL AND expires_at > ?", provider, stateHash, time.Now()).Error; err != nil {
			return err
		}
		now := time.Now()
		updates := map[string]any{"used_at": &now}
		if state.ProfileJSON != "" {
			updates["profile_json"] = ""
		}
		updated := tx.Model(&model.OAuthState{}).Where("id = ? AND used_at IS NULL", state.ID).Updates(updates)
		if updated.Error != nil {
			return updated.Error
		}
		if updated.RowsAffected != 1 {
			return gorm.ErrRecordNotFound
		}
		state.UsedAt = &now
		return nil
	})
	return &state, err
}

func (r *Repository) CreateOAuthUser(user *model.User, identity *model.UserIdentity) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockRegistrationEmail(tx, user.Email); err != nil {
			return err
		}
		if err := New(tx).CheckEmailAvailable(user.Email, ""); err != nil {
			return err
		}
		if err := tx.Create(user).Error; err != nil {
			return err
		}
		if err := tx.Create(identity).Error; err != nil {
			return err
		}
		return tx.Create(&model.CreditAccount{UserID: user.ID}).Error
	})
}

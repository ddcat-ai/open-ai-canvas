// 用户、登录会话与邮箱验证码的持久化。
//
// 注册与重置密码必须在同一事务内消费验证码，防止并发请求重复使用同一个码。

package repository

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func (r *Repository) UserCount() (int64, error) {
	var count int64
	err := r.db.Model(&model.User{}).Count(&count).Error
	return count, err
}

func (r *Repository) User(id string) (*model.User, error) {
	var user model.User
	if err := r.db.First(&user, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

// UpdateUserLoginTime preserves concurrent changes to status and profile fields.
func (r *Repository) UpdateUserLoginTime(userID string, now time.Time) error {
	return r.db.Model(&model.User{}).Where("id = ?", userID).
		Updates(map[string]any{"last_login_at": now, "updated_at": now}).Error
}

func (r *Repository) UserByAccount(account string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("lower(username) = lower(?) OR lower(email) = lower(?)", account, account).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) UserByUsername(username string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("lower(username) = lower(?)", username).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) UserByEmail(email string) (*model.User, error) {
	var user model.User
	if err := r.db.Where("email <> '' AND lower(email) = lower(?)", email).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *Repository) Users() ([]model.User, error) {
	var users []model.User
	err := r.db.Order("created_at desc").Find(&users).Error
	return users, err
}

func (r *Repository) AdminUsers(keyword string, role model.UserRole, status model.UserStatus, limit int, offset int) ([]model.User, int64, error) {
	var users []model.User
	var total int64
	query := r.db.Model(&model.User{})
	if value := strings.TrimSpace(keyword); value != "" {
		pattern := "%" + strings.ToLower(value) + "%"
		query = query.Where("lower(username) LIKE ? OR lower(display_name) LIKE ? OR lower(email) LIKE ?", pattern, pattern, pattern)
	}
	if role == model.UserRoleAdmin || role == model.UserRoleUser {
		query = query.Where("role = ?", role)
	}
	if status == model.UserStatusActive || status == model.UserStatusDisabled {
		query = query.Where("status = ?", status)
	}
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := query.Order("created_at desc").Limit(limit).Offset(offset).Find(&users).Error; err != nil {
		return nil, 0, err
	}
	return users, total, nil
}

func (r *Repository) AdminUserReferences() ([]model.User, error) {
	var users []model.User
	err := r.db.Select("id", "username", "display_name").Order("created_at desc").Limit(100).Find(&users).Error
	return users, err
}

func (r *Repository) ActiveAdminCountExcluding(userID string) (int64, error) {
	var count int64
	query := r.db.Model(&model.User{}).Where("role = ? AND status = ?", model.UserRoleAdmin, model.UserStatusActive)
	if userID != "" {
		query = query.Where("id <> ?", userID)
	}
	err := query.Count(&count).Error
	return count, err
}

func (r *Repository) AuthSession(id string) (*model.AuthSession, error) {
	var session model.AuthSession
	if err := r.db.First(&session, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &session, nil
}

func (r *Repository) DeleteAuthSession(id string) error {
	return r.db.Delete(&model.AuthSession{}, "id = ?", id).Error
}

func (r *Repository) DeleteExpiredAuthSessions() error {
	return r.db.Delete(&model.AuthSession{}, "expires_at <= ?", time.Now()).Error
}

func (r *Repository) DeleteUserAuthSessions(userID string) error {
	return r.db.Delete(&model.AuthSession{}, "user_id = ?", userID).Error
}

func (r *Repository) LatestEmailVerificationCode(email string, purpose string) (*model.EmailVerificationCode, error) {
	var code model.EmailVerificationCode
	if err := r.db.Where("email = ? AND purpose = ? AND used_at IS NULL", email, purpose).Order("created_at desc").First(&code).Error; err != nil {
		return nil, err
	}
	return &code, nil
}

func (r *Repository) MarkEmailVerificationCodeUsed(id string, usedAt time.Time) error {
	return r.db.Model(&model.EmailVerificationCode{}).Where("id = ? AND used_at IS NULL", id).Update("used_at", usedAt).Error
}

func (r *Repository) DeleteEmailVerificationCode(id string) error {
	return r.db.Delete(&model.EmailVerificationCode{}, "id = ?", id).Error
}

func (r *Repository) CreateUserWithEmailVerification(user *model.User, verificationCodeID string, usedAt time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := lockRegistrationEmail(tx, user.Email); err != nil {
			return err
		}
		if err := New(tx).CheckEmailAvailable(user.Email, ""); err != nil {
			return err
		}
		result := tx.Model(&model.EmailVerificationCode{}).Where("id = ? AND used_at IS NULL AND expires_at > ?", verificationCodeID, usedAt).Update("used_at", usedAt)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errors.New("邮箱验证码已失效，请重新获取")
		}
		return tx.Create(user).Error
	})
}

func (r *Repository) ResetUserPasswordWithEmailVerification(userID string, email string, purpose string, verificationCodeID string, passwordHash string, usedAt time.Time) error {
	return r.db.Transaction(func(tx *gorm.DB) error {
		codeResult := tx.Model(&model.EmailVerificationCode{}).
			Where("id = ? AND email = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?", verificationCodeID, email, purpose, usedAt).
			Update("used_at", usedAt)
		if codeResult.Error != nil {
			return codeResult.Error
		}
		if codeResult.RowsAffected != 1 {
			return ErrEmailVerificationCodeInvalid
		}

		userResult := tx.Model(&model.User{}).
			Where("id = ? AND email <> '' AND lower(email) = lower(?) AND status = ? AND password_hash <> ''", userID, email, model.UserStatusActive).
			Updates(map[string]any{"password_hash": passwordHash, "updated_at": usedAt})
		if userResult.Error != nil {
			return userResult.Error
		}
		if userResult.RowsAffected != 1 {
			return ErrEmailVerificationCodeInvalid
		}
		if err := tx.Delete(&model.AuthSession{}, "user_id = ?", userID).Error; err != nil {
			return err
		}
		return tx.Model(&model.EmailVerificationCode{}).
			Where("email = ? AND purpose = ? AND used_at IS NULL", email, purpose).
			Update("used_at", usedAt).Error
	})
}

func (r *Repository) DeleteExpiredEmailVerificationCodes(now time.Time) error {
	return r.db.Delete(&model.EmailVerificationCode{}, "expires_at <= ? OR used_at IS NOT NULL", now).Error
}

package app

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

type CreateAPIKeyRequest struct {
	Name      string     `json:"name"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

type CreatedAPIKey struct {
	model.APIKey
	Key string `json:"key"`
}

func (s *Service) activeAPIKeyUser(userID string) (*model.User, error) {
	user, err := s.repo.User(userID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.Unauthorized("API Key 无效")
	}
	if err != nil {
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("该账号已被禁用")
	}
	return user, nil
}

func (s *Service) CreateAPIKey(userID string, req CreateAPIKeyRequest) (*CreatedAPIKey, error) {
	if _, err := s.activeAPIKeyUser(userID); err != nil {
		return nil, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || utf8.RuneCountInString(name) > 80 {
		return nil, BadAuthRequest("名称须为 1 至 80 个字符")
	}
	if req.ExpiresAt != nil && !req.ExpiresAt.After(time.Now()) {
		return nil, BadAuthRequest("到期时间必须晚于当前时间")
	}
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	raw := "yc_" + base64.RawURLEncoding.EncodeToString(secret)
	digest := sha256.Sum256([]byte(raw))
	key := model.APIKey{ID: newID(), UserID: userID, Name: name, Prefix: raw[:11], TokenHash: hex.EncodeToString(digest[:]), ExpiresAt: req.ExpiresAt}
	if err := s.repo.Create(&key); err != nil {
		return nil, err
	}
	return &CreatedAPIKey{APIKey: key, Key: raw}, nil
}

func (s *Service) APIKeys(userID string) ([]model.APIKey, error) {
	if _, err := s.activeAPIKeyUser(userID); err != nil {
		return nil, err
	}
	return s.repo.APIKeysForUser(userID)
}

func (s *Service) RevokeAPIKey(userID, id string) error {
	if _, err := s.activeAPIKeyUser(userID); err != nil {
		return err
	}
	if _, err := s.repo.APIKeyForUser(userID, id); errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("API Key 不存在")
	} else if err != nil {
		return err
	}
	return s.repo.RevokeAPIKey(userID, id, time.Now())
}

func (s *Service) AuthenticateAPIKey(raw string) (*model.User, error) {
	if len(raw) != 46 || !strings.HasPrefix(raw, "yc_") {
		return nil, kernel.Unauthorized("API Key 无效")
	}
	digest := sha256.Sum256([]byte(raw))
	key, err := s.repo.APIKeyByHash(hex.EncodeToString(digest[:]))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.Unauthorized("API Key 无效")
	}
	if err != nil {
		return nil, err
	}
	if key.RevokedAt != nil || (key.ExpiresAt != nil && !key.ExpiresAt.After(time.Now())) {
		return nil, kernel.Unauthorized("API Key 无效")
	}
	return s.activeAPIKeyUser(key.UserID)
}

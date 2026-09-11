package auth

import (
	"context"
	"strings"
	"sync"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const DefaultBrandName = "影策"

// Host 由组合根注入，避免 auth → service 回环。
type Host interface {
	RequireAdmin(user *model.User) error
	EncryptSecret(value string) (string, error)
	DecryptSecret(value string) (string, error)
	SettingsEncryptionKey() ([]byte, error)
	BrandName() string
	EnsureSignupBonus(userID string) error
	RecordActivity(userID string, event string, count int)
	AllowRequest(ctx context.Context, key string, limit int, window time.Duration) (bool, error)
	RequestRetryAfter(ctx context.Context, key string, window time.Duration) time.Duration
}

type nopHost struct{}

func (nopHost) RequireAdmin(user *model.User) error { return nil }
func (nopHost) EncryptSecret(value string) (string, error) {
	return value, nil
}
func (nopHost) DecryptSecret(value string) (string, error) {
	return value, nil
}
func (nopHost) SettingsEncryptionKey() ([]byte, error) { return nil, nil }
func (nopHost) BrandName() string                      { return DefaultBrandName }
func (nopHost) EnsureSignupBonus(string) error         { return nil }
func (nopHost) RecordActivity(string, string, int)     {}
func (nopHost) AllowRequest(context.Context, string, int, time.Duration) (bool, error) {
	return true, nil
}
func (nopHost) RequestRetryAfter(context.Context, string, time.Duration) time.Duration {
	return 0
}

type Service struct {
	repo           *repository.Repository
	host           Host
	mailSender     func(EmailSettingValue, string, string, string) error
	emailCodeMu    sync.Mutex
	registrationMu sync.Mutex
}

func New(repo *repository.Repository, host Host, mailSender func(EmailSettingValue, string, string, string) error) *Service {
	if host == nil {
		host = nopHost{}
	}
	return &Service{repo: repo, host: host, mailSender: mailSender}
}

func (s *Service) SetMailSender(fn func(EmailSettingValue, string, string, string) error) {
	if s == nil {
		return
	}
	s.mailSender = fn
}

type brandHost struct {
	nopHost
	name string
}

func (h brandHost) BrandName() string {
	if strings.TrimSpace(h.name) == "" {
		return DefaultBrandName
	}
	return h.name
}

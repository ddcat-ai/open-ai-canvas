package auth

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
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
	// BindReferral 记录注册来源推广码；推广码无效或写入失败不影响注册。
	BindReferral(inviteeID string, code string)
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
func (nopHost) BindReferral(string, string)            {}
func (nopHost) RecordActivity(string, string, int)     {}
func (nopHost) AllowRequest(context.Context, string, int, time.Duration) (bool, error) {
	return true, nil
}
func (nopHost) RequestRetryAfter(context.Context, string, time.Duration) time.Duration {
	return 0
}

type Service struct {
	repo             *repository.Repository
	host             Host
	mailSender       func(EmailSettingValue, string, string, string) error
	emailCodeMu      sync.Mutex
	registrationMu   sync.Mutex
	libtvMu          sync.Mutex
	libtv            *libTVRuntime
	sms              SMSDelivery
	wechatHTTPClient *http.Client
}

type SMSDelivery interface {
	Available(string) (bool, error)
	SendCode(context.Context, string, string, string) error
}

func (s *Service) SetSMSDelivery(delivery SMSDelivery) { s.sms = delivery }

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

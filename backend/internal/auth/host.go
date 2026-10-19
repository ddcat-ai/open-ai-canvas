package auth

import (
	"context"
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
	// PublicBaseURL 是站点对外可访问的根地址（不含尾斜杠），用于拼装第三方回调 URL。
	// 为空表示部署方未配置，此时调用方应退化为相对路径。
	PublicBaseURL() string
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
func (nopHost) PublicBaseURL() string                  { return "" }
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
	sms            SMSDelivery
	// wechatToken 缓存微信服务端 access_token。微信同一 AppID 的 token 是全局单例，
	// 重复获取会让旧 token 失效，因此必须串行化并复用。
	wechatToken wechatTokenState
	// googleKeys 缓存 Google id_token 验签所需的公钥（JWKS）。
	googleKeys googleKeyCache
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

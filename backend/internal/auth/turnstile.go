package auth

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const turnstileSettingKey = "turnstile"

// Cloudflare documents this endpoint as the only endpoint for validating a
// Turnstile response. Keep it fixed so this check cannot become an arbitrary
// outbound request configured by an administrator.
const turnstileSiteVerifyURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

const turnstileVerifyTimeout = 5 * time.Second

type TurnstileSettingRequest struct {
	Enabled   bool   `json:"enabled"`
	SiteKey   string `json:"siteKey"`
	SecretKey string `json:"secretKey"`
}

type PublicTurnstileSetting struct {
	Enabled      bool      `json:"enabled"`
	SiteKey      string    `json:"siteKey"`
	HasSecretKey bool      `json:"hasSecretKey"`
	UpdatedBy    string    `json:"updatedBy"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type turnstileSettingValue struct {
	Enabled   bool   `json:"enabled"`
	SiteKey   string `json:"siteKey"`
	SecretKey string `json:"secretKey"`
}

type turnstileSiteVerifyResponse struct {
	Success    bool     `json:"success"`
	ErrorCodes []string `json:"error-codes,omitempty"`
}

func (s *Service) AdminTurnstileSetting(actor *model.User) (*PublicTurnstileSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readTurnstileSetting()
	if err != nil {
		return nil, err
	}
	return publicTurnstileSetting(setting, value), nil
}

func (s *Service) UpdateTurnstileSetting(actor *model.User, req TurnstileSettingRequest) (*PublicTurnstileSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	current, currentValue, err := s.readTurnstileSetting()
	if err != nil {
		return nil, err
	}
	next := turnstileSettingValue{
		Enabled:   req.Enabled,
		SiteKey:   strings.TrimSpace(req.SiteKey),
		SecretKey: strings.TrimSpace(req.SecretKey),
	}
	// The UI leaves the secret input blank after reading settings. An empty
	// value means "keep the existing secret" rather than clearing it.
	if next.SecretKey == "" {
		next.SecretKey = currentValue.SecretKey
	}
	if next.Enabled {
		if next.SiteKey == "" {
			return nil, kernel.BadAuthRequest("启用机器人保护前请输入 Turnstile 站点密钥")
		}
		if next.SecretKey == "" {
			return nil, kernel.BadAuthRequest("启用机器人保护前请输入 Turnstile 密钥")
		}
	}
	if len(next.SiteKey) > 256 || strings.ContainsAny(next.SiteKey, "\r\n") {
		return nil, kernel.BadAuthRequest("Turnstile 站点密钥无效")
	}
	if len(next.SecretKey) > 512 || strings.ContainsAny(next.SecretKey, "\r\n") {
		return nil, kernel.BadAuthRequest("Turnstile 密钥无效")
	}
	stored := next
	stored.SecretKey, err = s.host.EncryptSecret(next.SecretKey)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	systemSetting := model.SystemSetting{Key: turnstileSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if current != nil {
		systemSetting.CreatedAt = current.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&systemSetting); err != nil {
		return nil, err
	}
	return publicTurnstileSetting(&systemSetting, next), nil
}

func (s *Service) readTurnstileSetting() (*model.SystemSetting, turnstileSettingValue, error) {
	setting, err := s.repo.SystemSetting(turnstileSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, turnstileSettingValue{}, nil
	}
	if err != nil {
		return nil, turnstileSettingValue{}, err
	}
	value := turnstileSettingValue{}
	if strings.TrimSpace(setting.ValueJSON) == "" || json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return nil, turnstileSettingValue{}, errors.New("机器人保护配置格式无效")
	}
	if value.SecretKey != "" {
		value.SecretKey, err = s.host.DecryptSecret(value.SecretKey)
		if err != nil {
			return nil, turnstileSettingValue{}, err
		}
	}
	return setting, value, nil
}

func publicTurnstileSetting(setting *model.SystemSetting, value turnstileSettingValue) *PublicTurnstileSetting {
	result := &PublicTurnstileSetting{Enabled: value.Enabled, SiteKey: value.SiteKey, HasSecretKey: value.SecretKey != ""}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

func (s *Service) publicTurnstileSetting() (*PublicTurnstileSetting, error) {
	setting, value, err := s.readTurnstileSetting()
	if err != nil {
		return nil, err
	}
	return publicTurnstileSetting(setting, value), nil
}

// VerifyTurnstile validates a browser token when the administrator enabled the
// protection. It fails closed on missing configuration, invalid responses and
// Cloudflare/network errors.
func (s *Service) VerifyTurnstile(ctx context.Context, token string, remoteIP string) error {
	setting, err := s.publicTurnstileSetting()
	if err != nil {
		return kernel.WrapAppError(503, "机器人验证服务暂时不可用，请稍后重试", err)
	}
	if !setting.Enabled {
		return nil
	}
	_, value, err := s.readTurnstileSetting()
	if err != nil || value.SiteKey == "" || value.SecretKey == "" {
		if err == nil {
			err = errors.New("机器人保护未配置完整")
		}
		return kernel.WrapAppError(503, "机器人验证服务暂时不可用，请联系管理员", err)
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return kernel.BadAuthRequest("请完成安全验证")
	}
	if len(token) > 4096 || strings.ContainsAny(token, "\r\n") {
		return kernel.BadAuthRequest("安全验证无效，请重试")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	verifyCtx, cancel := context.WithTimeout(ctx, turnstileVerifyTimeout)
	defer cancel()
	form := url.Values{}
	form.Set("secret", value.SecretKey)
	form.Set("response", token)
	if remoteIP = strings.TrimSpace(remoteIP); remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	req, err := http.NewRequestWithContext(verifyCtx, http.MethodPost, turnstileSiteVerifyURL, strings.NewReader(form.Encode()))
	if err != nil {
		return kernel.WrapAppError(503, "机器人验证服务暂时不可用，请稍后重试", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := s.turnstileHTTPClient
	if client == nil {
		client = &http.Client{Timeout: turnstileVerifyTimeout}
	}
	resp, err := client.Do(req)
	if err != nil {
		return kernel.WrapAppError(503, "机器人验证服务暂时不可用，请稍后重试", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return kernel.WrapAppError(503, "机器人验证服务暂时不可用，请稍后重试", errors.New("turnstile siteverify returned non-success status"))
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return kernel.WrapAppError(503, "机器人验证服务暂时不可用，请稍后重试", err)
	}
	result := turnstileSiteVerifyResponse{}
	if json.Unmarshal(body, &result) != nil {
		return kernel.WrapAppError(503, "机器人验证服务暂时不可用，请稍后重试", errors.New("invalid turnstile siteverify response"))
	}
	if !result.Success {
		return kernel.BadAuthRequest("安全验证无效，请重试")
	}
	return nil
}

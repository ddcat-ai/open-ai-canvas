package auth

// Google 登录。
//
// 采用标准 OAuth 2.0 授权码流程，与 Linux.do 同构，因此复用 OAuthState 的
// state 防重放机制。区别在于 Google 的 id_token 是 JWT，必须验签：
// 不验签就等于让前端随便伪造一个 email 就能登录任意账号。
//
// 验签要点（缺一不可）：
//   - 从 https://www.googleapis.com/oauth2/v3/certs 取 JWKS，按 kid 选公钥
//   - 校验 RS256 签名
//   - 校验 iss ∈ {accounts.google.com, https://accounts.google.com}
//   - 校验 aud == clientId
//   - 校验 exp 未过期
//   - 校验 email_verified == true（未验证邮箱不能作为账号标识）

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"

	"gorm.io/gorm"
)

const googleSettingKey = "google_oauth"

const (
	googleProvider = "google"
	// Google 官方 JWKS 地址。抽成变量便于测试替换。
	googleCertsURL = "https://www.googleapis.com/oauth2/v3/certs"
	googleTokenURL = "https://oauth2.googleapis.com/token"
	// 公钥缓存时长。Google 轮换密钥时会提前在响应头给出 Cache-Control，
	// 这里取保守值；验签失败时会强制刷新一次。
	googleKeyCacheTTL = 30 * time.Minute
)

var googleIssuers = map[string]bool{
	"accounts.google.com":         true,
	"https://accounts.google.com": true,
}

// ---------- 配置 ----------

type GoogleSettingRequest struct {
	Enabled      bool   `json:"enabled"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	RedirectURL  string `json:"redirectUrl"`
	HostedDomain string `json:"hostedDomain"`
}

type PublicGoogleSetting struct {
	Enabled         bool      `json:"enabled"`
	ClientID        string    `json:"clientId"`
	HasClientSecret bool      `json:"hasClientSecret"`
	RedirectURL     string    `json:"redirectUrl"`
	HostedDomain    string    `json:"hostedDomain"`
	UpdatedBy       string    `json:"updatedBy"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
}

type googleSettingValue struct {
	Enabled      bool   `json:"enabled"`
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
	RedirectURL  string `json:"redirectUrl"`
	HostedDomain string `json:"hostedDomain"`
}

func normalizeGoogleSetting(value googleSettingValue) googleSettingValue {
	value.ClientID = strings.TrimSpace(value.ClientID)
	value.ClientSecret = strings.TrimSpace(value.ClientSecret)
	value.RedirectURL = strings.TrimSpace(value.RedirectURL)
	value.HostedDomain = strings.TrimSpace(value.HostedDomain)
	return value
}

func validateGoogleSetting(value googleSettingValue) error {
	if !value.Enabled {
		return nil
	}
	if value.ClientID == "" || value.ClientSecret == "" || value.RedirectURL == "" {
		return kernel.BadAuthRequest("启用 Google 登录前请完整填写 Client ID、Client Secret 和回调地址")
	}
	parsed, err := url.Parse(value.RedirectURL)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && !(parsed.Scheme == "http" && isLoopbackHost(parsed.Hostname()))) {
		return kernel.BadAuthRequest("Google 回调地址必须使用 HTTPS，本地回环地址可使用 HTTP")
	}
	return nil
}

func isLoopbackHost(host string) bool {
	switch strings.ToLower(strings.TrimSpace(host)) {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}

func (s *Service) readGoogleSetting() (*model.SystemSetting, googleSettingValue, error) {
	setting, err := s.repo.SystemSetting(googleSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, normalizeGoogleSetting(googleSettingValue{}), nil
	}
	if err != nil {
		return nil, googleSettingValue{}, err
	}
	value := googleSettingValue{}
	if strings.TrimSpace(setting.ValueJSON) != "" {
		if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
			return nil, googleSettingValue{}, errors.New("Google 登录配置格式无效")
		}
	}
	value.ClientSecret, err = s.host.DecryptSecret(value.ClientSecret)
	if err != nil {
		return nil, googleSettingValue{}, err
	}
	return setting, normalizeGoogleSetting(value), nil
}

func publicGoogleSetting(setting *model.SystemSetting, value googleSettingValue) *PublicGoogleSetting {
	result := &PublicGoogleSetting{
		Enabled: value.Enabled, ClientID: value.ClientID, HasClientSecret: value.ClientSecret != "",
		RedirectURL: value.RedirectURL, HostedDomain: value.HostedDomain,
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

func (s *Service) AdminGoogleSetting(actor *model.User) (*PublicGoogleSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readGoogleSetting()
	if err != nil {
		return nil, err
	}
	return publicGoogleSetting(setting, value), nil
}

func (s *Service) UpdateGoogleSetting(actor *model.User, req GoogleSettingRequest) (*PublicGoogleSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	currentSetting, current, err := s.readGoogleSetting()
	if err != nil {
		return nil, err
	}
	next := normalizeGoogleSetting(googleSettingValue{
		Enabled: req.Enabled, ClientID: req.ClientID, ClientSecret: req.ClientSecret,
		RedirectURL: req.RedirectURL, HostedDomain: req.HostedDomain,
	})
	if next.ClientSecret == "" {
		next.ClientSecret = current.ClientSecret
	}
	if err := validateGoogleSetting(next); err != nil {
		return nil, err
	}
	stored := next
	stored.ClientSecret, err = s.host.EncryptSecret(next.ClientSecret)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: googleSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if currentSetting != nil {
		setting.CreatedAt = currentSetting.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	// clientId 变更后旧公钥缓存仍然有效（JWKS 与 clientId 无关），无需清理。
	return publicGoogleSetting(&setting, next), nil
}

func (s *Service) GoogleEnabled() bool {
	_, setting, err := s.readGoogleSetting()
	return err == nil && setting.Enabled && setting.ClientID != "" && setting.ClientSecret != ""
}

// GoogleCallbackURL 返回需要在 Google Cloud Console 登记的授权回调地址。
func (s *Service) GoogleCallbackURL() string {
	_, setting, err := s.readGoogleSetting()
	if err == nil && setting.RedirectURL != "" {
		return setting.RedirectURL
	}
	base := strings.TrimRight(strings.TrimSpace(s.host.PublicBaseURL()), "/")
	if base == "" {
		return "/auth/google/callback"
	}
	return base + "/auth/google/callback"
}

// ---------- 授权跳转 ----------

func (s *Service) BeginGoogleLogin(nextPath string, acceptedTerms bool) (string, error) {
	count, err := s.repo.UserCount()
	if err != nil {
		return "", err
	}
	if count == 0 {
		return "", kernel.Forbidden("请先创建本地管理员账号，再开放 Google 登录")
	}
	_, setting, err := s.readGoogleSetting()
	if err != nil {
		return "", err
	}
	if !setting.Enabled {
		return "", kernel.Forbidden("Google 登录尚未启用")
	}
	state := RandomToken()
	record := &model.OAuthState{
		ID: kernel.NewID(), Provider: googleProvider, StateHash: HashToken(state),
		NextPath: safeOAuthNext(nextPath), AcceptedTerms: acceptedTerms,
		ExpiresAt: time.Now().Add(10 * time.Minute),
	}
	if err := s.repo.CreateOAuthState(record); err != nil {
		return "", err
	}
	query := url.Values{}
	query.Set("client_id", setting.ClientID)
	query.Set("redirect_uri", setting.RedirectURL)
	query.Set("response_type", "code")
	query.Set("scope", "openid email profile")
	query.Set("state", state)
	query.Set("access_type", "online")
	query.Set("prompt", "select_account")
	if setting.HostedDomain != "" {
		query.Set("hd", setting.HostedDomain)
	}
	return "https://accounts.google.com/o/oauth2/v2/auth?" + query.Encode(), nil
}

// ---------- 回调 ----------

type GoogleCallbackResult struct {
	Session *AuthSessionResult
	Next    string
}

func (s *Service) CompleteGoogleLogin(ctx context.Context, stateValue, code string, contexts ...LoginContext) (result *GoogleCallbackResult, err error) {
	var context LoginContext
	if len(contexts) > 0 {
		context = contexts[0]
	}
	event := NewLoginLog(googleProvider, "login", context)
	defer func() {
		if err != nil {
			err = s.recordLoginFailure(event, err)
		}
	}()
	if strings.TrimSpace(stateValue) == "" || strings.TrimSpace(code) == "" {
		return nil, kernel.BadAuthRequest("Google 登录回调缺少必要参数")
	}
	state, err := s.repo.ConsumeOAuthState(googleProvider, HashToken(stateValue))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.BadAuthRequest("Google 登录状态无效或已过期")
	}
	if err != nil {
		return nil, err
	}
	_, setting, err := s.readGoogleSetting()
	if err != nil {
		return nil, err
	}
	if !setting.Enabled {
		return nil, kernel.Forbidden("Google 登录尚未启用")
	}
	tokenPayload, err := exchangeGoogleCode(ctx, setting, code)
	if err != nil {
		return nil, err
	}
	claims, err := s.verifyGoogleIDToken(ctx, tokenPayload.IDToken, setting.ClientID)
	if err != nil {
		return nil, err
	}
	subject := strings.TrimSpace(claims.Subject)
	if subject == "" {
		return nil, errors.New("Google 返回的身份标识为空")
	}
	email := NormalizeEmail(claims.Email)
	if email != "" && ValidateEmail(email) != nil {
		email = ""
	}
	identity, err := s.repo.UserIdentity(googleProvider, subject)
	var user *model.User
	if err == nil {
		user, err = s.repo.User(identity.UserID)
		if err != nil {
			return nil, err
		}
		identity.ProviderUsername = email
		identity.AvatarURL = claims.Picture
		identity.UpdatedAt = time.Now()
		if err := s.repo.Save(identity); err != nil {
			return nil, err
		}
	} else if errors.Is(err, gorm.ErrRecordNotFound) {
		event.Source = "registration"
		policy, policyErr := s.verificationPolicy()
		if policyErr != nil {
			return nil, policyErr
		}
		if policy.SMSAndEmailRegistration {
			return nil, kernel.Forbidden("平台要求短信和邮箱验证，请先通过注册页面创建账号；第三方登录不能绕过双重验证")
		}
		registrationEnabled, settingErr := s.RegistrationEnabled()
		if settingErr != nil {
			return nil, settingErr
		}
		if !registrationEnabled {
			return nil, kernel.Forbidden("管理员未开放新用户注册")
		}
		if !state.AcceptedTerms {
			return nil, kernel.BadAuthRequest("请先同意" + s.AgreementTitleForMessage())
		}
		user, identity, err = s.createGoogleUser(subject, *claims, email)
		if err != nil {
			return nil, err
		}
		if err := s.repo.CreateOAuthUser(user, identity); err != nil {
			return nil, err
		}
	} else {
		return nil, err
	}
	loginLogUser(event, user)
	if user.Status != model.UserStatusActive {
		return nil, kernel.Forbidden("该账号已被禁用")
	}
	if err := s.host.EnsureSignupBonus(user.ID); err != nil {
		return nil, err
	}
	now := time.Now()
	if err := s.repo.UpdateUserLoginTime(user.ID, now); err != nil {
		return nil, err
	}
	session, err := s.createAuthSession(user, event)
	if err != nil {
		return nil, err
	}
	return &GoogleCallbackResult{Session: session, Next: safeOAuthNext(state.NextPath)}, nil
}

func (s *Service) createGoogleUser(subject string, claims googleIDTokenClaims, email string) (*model.User, *model.UserIdentity, error) {
	base := oauthUsernameSanitizer.ReplaceAllString(strings.TrimSpace(claims.Name), "_")
	base = strings.Trim(base, "_-")
	if len(base) < 3 && email != "" {
		base = oauthUsernameSanitizer.ReplaceAllString(strings.SplitN(email, "@", 2)[0], "_")
		base = strings.Trim(base, "_-")
	}
	if len(base) < 3 {
		base = "google_" + shortSubject(subject)
	}
	if len(base) > 24 {
		base = base[:24]
	}
	username := base
	if existing, err := s.repo.UserByUsername(username); err == nil && existing != nil {
		username = kernel.TruncateRunes(base, 23) + "_" + shortSubject(subject)
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, err
	}
	// 相同邮箱不自动合并身份，避免第三方邮箱状态不明导致账号接管。
	if email != "" {
		if existing, err := s.repo.UserByEmail(email); err == nil && existing != nil {
			email = ""
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, err
		}
	}
	displayName := claims.Name
	if strings.TrimSpace(displayName) == "" {
		displayName = username
	}
	user := &model.User{
		ID: kernel.NewID(), Username: username, Email: email,
		DisplayName: NormalizeDisplayName(displayName, username),
		Role:        model.UserRoleUser, Status: model.UserStatusActive,
	}
	identity := &model.UserIdentity{
		ID: kernel.NewID(), UserID: user.ID, Provider: googleProvider, Subject: subject,
		ProviderUsername: email, AvatarURL: claims.Picture,
	}
	return user, identity, nil
}

// ---------- 令牌交换与验签 ----------

type googleTokenPayload struct {
	IDToken      string `json:"id_token"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

func exchangeGoogleCode(ctx context.Context, setting googleSettingValue, code string) (*googleTokenPayload, error) {
	if _, err := outbound.ValidateOutboundURL(googleTokenURL); err != nil {
		return nil, err
	}
	form := url.Values{}
	form.Set("code", code)
	form.Set("client_id", setting.ClientID)
	form.Set("client_secret", setting.ClientSecret)
	form.Set("redirect_uri", setting.RedirectURL)
	form.Set("grant_type", "authorization_code")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, googleTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := outbound.OutboundHTTPClient(20 * time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("Google Token 请求失败：%w", err)
	}
	defer resp.Body.Close()
	var payload googleTokenPayload
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, errors.New("Google Token 响应格式无效")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || payload.IDToken == "" {
		message := payload.Error
		if message == "" {
			message = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		return nil, fmt.Errorf("Google Token 交换失败：%s", message)
	}
	return &payload, nil
}

type googleIDTokenClaims struct {
	Subject       string `json:"sub"`
	Email         string `json:"email"`
	EmailVerified bool   `json:"email_verified"`
	Name          string `json:"name"`
	Picture       string `json:"picture"`
	Audience      string `json:"aud"`
	Issuer        string `json:"iss"`
	ExpiresAt     int64  `json:"exp"`
	IssuedAt      int64  `json:"iat"`
	HostedDomain  string `json:"hd"`
}

// googleKeyCache 缓存 Google JWKS 公钥。验签失败时会强制刷新一次，
// 以应对 Google 轮换密钥。
type googleKeyCache struct {
	mu        sync.RWMutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

func (c *googleKeyCache) snapshot() (map[string]*rsa.PublicKey, time.Time) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.keys, c.fetchedAt
}

func (c *googleKeyCache) store(keys map[string]*rsa.PublicKey) {
	c.mu.Lock()
	c.keys = keys
	c.fetchedAt = time.Now()
	c.mu.Unlock()
}

func (s *Service) verifyGoogleIDToken(ctx context.Context, idToken string, clientID string) (*googleIDTokenClaims, error) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return nil, kernel.BadAuthRequest("Google 身份令牌格式无效")
	}
	headerBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return nil, kernel.BadAuthRequest("Google 身份令牌头无效")
	}
	var header struct {
		Alg string `json:"alg"`
		Kid string `json:"kid"`
	}
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, kernel.BadAuthRequest("Google 身份令牌头无效")
	}
	// 只接受 RS256。alg=none 或 HS256 是经典的 JWT 混淆攻击面。
	if header.Alg != "RS256" || header.Kid == "" {
		return nil, kernel.BadAuthRequest("不支持的 Google 身份令牌算法")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return nil, kernel.BadAuthRequest("Google 身份令牌签名无效")
	}
	signed := []byte(parts[0] + "." + parts[1])
	digest := sha256.Sum256(signed)

	key, err := s.googlePublicKey(ctx, header.Kid, false)
	if err != nil {
		return nil, err
	}
	if err := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); err != nil {
		// 可能是密钥轮换，强制刷新后重试一次。
		key, refreshErr := s.googlePublicKey(ctx, header.Kid, true)
		if refreshErr != nil {
			return nil, refreshErr
		}
		if retryErr := rsa.VerifyPKCS1v15(key, crypto.SHA256, digest[:], signature); retryErr != nil {
			return nil, kernel.BadAuthRequest("Google 身份令牌签名校验失败")
		}
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return nil, kernel.BadAuthRequest("Google 身份令牌载荷无效")
	}
	var claims googleIDTokenClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return nil, kernel.BadAuthRequest("Google 身份令牌载荷无效")
	}
	if !googleIssuers[claims.Issuer] {
		return nil, kernel.BadAuthRequest("Google 身份令牌签发方不匹配")
	}
	if claims.Audience != clientID {
		return nil, kernel.BadAuthRequest("Google 身份令牌受众不匹配")
	}
	if claims.ExpiresAt == 0 || time.Now().Unix() >= claims.ExpiresAt {
		return nil, kernel.BadAuthRequest("Google 身份令牌已过期")
	}
	// 未验证邮箱的账号不能作为身份依据：否则任何人可以注册一个假邮箱冒充他人。
	if !claims.EmailVerified {
		return nil, kernel.Forbidden("该 Google 账号的邮箱尚未验证，无法登录")
	}
	return &claims, nil
}

func (s *Service) googlePublicKey(ctx context.Context, kid string, forceRefresh bool) (*rsa.PublicKey, error) {
	keys, fetchedAt := s.googleKeys.snapshot()
	if !forceRefresh && keys != nil && time.Since(fetchedAt) < googleKeyCacheTTL {
		if key, ok := keys[kid]; ok {
			return key, nil
		}
	}
	fetched, err := fetchGoogleKeys(ctx)
	if err != nil {
		// 刷新失败时，如果手上还有未过期的旧公钥，允许继续使用。
		if keys != nil && time.Since(fetchedAt) < googleKeyCacheTTL {
			if key, ok := keys[kid]; ok {
				return key, nil
			}
		}
		return nil, err
	}
	s.googleKeys.store(fetched)
	key, ok := fetched[kid]
	if !ok {
		return nil, kernel.BadAuthRequest("Google 公钥集中不存在该密钥标识")
	}
	return key, nil
}

func fetchGoogleKeys(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	if _, err := outbound.ValidateOutboundURL(googleCertsURL); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, googleCertsURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	resp, err := outbound.OutboundHTTPClient(15 * time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("获取 Google 公钥失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("获取 Google 公钥失败：HTTP %d", resp.StatusCode)
	}
	var payload struct {
		Keys []struct {
			Kid string `json:"kid"`
			N   string `json:"n"`
			E   string `json:"e"`
			Kty string `json:"kty"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, errors.New("Google 公钥响应格式无效")
	}
	result := make(map[string]*rsa.PublicKey, len(payload.Keys))
	for _, item := range payload.Keys {
		if item.Kty != "RSA" || item.Kid == "" {
			continue
		}
		modulus, err := base64.RawURLEncoding.DecodeString(item.N)
		if err != nil {
			continue
		}
		exponentBytes, err := base64.RawURLEncoding.DecodeString(item.E)
		if err != nil {
			continue
		}
		exponent := 0
		for _, b := range exponentBytes {
			exponent = exponent<<8 | int(b)
		}
		if exponent == 0 {
			continue
		}
		result[item.Kid] = &rsa.PublicKey{N: new(big.Int).SetBytes(modulus), E: exponent}
	}
	if len(result) == 0 {
		return nil, errors.New("Google 公钥集为空")
	}
	return result, nil
}

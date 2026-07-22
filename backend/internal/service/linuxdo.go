package service

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const linuxDOSettingKey = "linuxdo_oauth"

var oauthUsernameSanitizer = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

type LinuxDOSettingRequest struct {
	Enabled          bool     `json:"enabled"`
	ClientID         string   `json:"clientId"`
	ClientSecret     string   `json:"clientSecret"`
	AuthorizationURL string   `json:"authorizationUrl"`
	TokenURL         string   `json:"tokenUrl"`
	UserInfoURL      string   `json:"userInfoUrl"`
	RedirectURL      string   `json:"redirectUrl"`
	Scopes           []string `json:"scopes"`
	ClientAuthMethod string   `json:"clientAuthMethod"`
	SubjectField     string   `json:"subjectField"`
	UsernameField    string   `json:"usernameField"`
	DisplayNameField string   `json:"displayNameField"`
	EmailField       string   `json:"emailField"`
	AvatarField      string   `json:"avatarField"`
}

type PublicLinuxDOSetting struct {
	Enabled          bool      `json:"enabled"`
	ClientID         string    `json:"clientId"`
	HasClientSecret  bool      `json:"hasClientSecret"`
	AuthorizationURL string    `json:"authorizationUrl"`
	TokenURL         string    `json:"tokenUrl"`
	UserInfoURL      string    `json:"userInfoUrl"`
	RedirectURL      string    `json:"redirectUrl"`
	Scopes           []string  `json:"scopes"`
	ClientAuthMethod string    `json:"clientAuthMethod"`
	SubjectField     string    `json:"subjectField"`
	UsernameField    string    `json:"usernameField"`
	DisplayNameField string    `json:"displayNameField"`
	EmailField       string    `json:"emailField"`
	AvatarField      string    `json:"avatarField"`
	UpdatedBy        string    `json:"updatedBy"`
	CreatedAt        time.Time `json:"createdAt"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type linuxDOSettingValue struct {
	Enabled          bool     `json:"enabled"`
	ClientID         string   `json:"clientId"`
	ClientSecret     string   `json:"clientSecret"`
	AuthorizationURL string   `json:"authorizationUrl"`
	TokenURL         string   `json:"tokenUrl"`
	UserInfoURL      string   `json:"userInfoUrl"`
	RedirectURL      string   `json:"redirectUrl"`
	Scopes           []string `json:"scopes"`
	ClientAuthMethod string   `json:"clientAuthMethod"`
	SubjectField     string   `json:"subjectField"`
	UsernameField    string   `json:"usernameField"`
	DisplayNameField string   `json:"displayNameField"`
	EmailField       string   `json:"emailField"`
	AvatarField      string   `json:"avatarField"`
}

type LinuxDOCallbackResult struct {
	Session *AuthSessionResult
	Next    string
}

func (s *Service) AdminLinuxDOSetting(actor *model.User) (*PublicLinuxDOSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, value, err := s.readLinuxDOSetting()
	if err != nil {
		return nil, err
	}
	return publicLinuxDOSetting(setting, value), nil
}

func (s *Service) UpdateLinuxDOSetting(actor *model.User, req LinuxDOSettingRequest) (*PublicLinuxDOSetting, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	currentSetting, current, err := s.readLinuxDOSetting()
	if err != nil {
		return nil, err
	}
	next := normalizeLinuxDOSetting(linuxDOSettingValue{
		Enabled: req.Enabled, ClientID: req.ClientID, ClientSecret: req.ClientSecret,
		AuthorizationURL: req.AuthorizationURL, TokenURL: req.TokenURL, UserInfoURL: req.UserInfoURL,
		RedirectURL: req.RedirectURL, Scopes: req.Scopes, ClientAuthMethod: req.ClientAuthMethod,
		SubjectField: req.SubjectField, UsernameField: req.UsernameField, DisplayNameField: req.DisplayNameField,
		EmailField: req.EmailField, AvatarField: req.AvatarField,
	})
	if next.ClientSecret == "" {
		next.ClientSecret = current.ClientSecret
	}
	if err := validateLinuxDOSetting(next); err != nil {
		return nil, err
	}
	stored := next
	stored.ClientSecret, err = s.encryptSettingSecret(next.ClientSecret)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: linuxDOSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if currentSetting != nil {
		setting.CreatedAt = currentSetting.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return nil, err
	}
	return publicLinuxDOSetting(&setting, next), nil
}

func (s *Service) LinuxDOEnabled() bool {
	_, setting, err := s.readLinuxDOSetting()
	return err == nil && setting.Enabled
}

func (s *Service) BeginLinuxDOLogin(nextPath string) (string, error) {
	count, err := s.repo.UserCount()
	if err != nil {
		return "", err
	}
	if count == 0 {
		return "", Forbidden("请先创建本地管理员账号，再开放 Linux.do 登录")
	}
	_, setting, err := s.readLinuxDOSetting()
	if err != nil {
		return "", err
	}
	if !setting.Enabled {
		return "", Forbidden("Linux.do 登录尚未启用")
	}
	state := randomToken()
	verifier := randomToken()
	challengeBytes := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(challengeBytes[:])
	if err := s.repo.CreateOAuthState(&model.OAuthState{
		ID: newID(), Provider: "linuxdo", StateHash: hashToken(state), CodeVerifier: verifier,
		NextPath: safeOAuthNext(nextPath), ExpiresAt: time.Now().Add(10 * time.Minute),
	}); err != nil {
		return "", err
	}
	authorizeURL, err := url.Parse(setting.AuthorizationURL)
	if err != nil {
		return "", err
	}
	query := authorizeURL.Query()
	query.Set("client_id", setting.ClientID)
	query.Set("redirect_uri", setting.RedirectURL)
	query.Set("response_type", "code")
	if len(setting.Scopes) > 0 {
		query.Set("scope", strings.Join(setting.Scopes, " "))
	}
	query.Set("state", state)
	query.Set("code_challenge", challenge)
	query.Set("code_challenge_method", "S256")
	authorizeURL.RawQuery = query.Encode()
	return authorizeURL.String(), nil
}

func (s *Service) CompleteLinuxDOLogin(stateValue string, code string) (*LinuxDOCallbackResult, error) {
	if strings.TrimSpace(stateValue) == "" || strings.TrimSpace(code) == "" {
		return nil, BadAuthRequest("Linux.do 登录回调缺少必要参数")
	}
	state, err := s.repo.ConsumeOAuthState("linuxdo", hashToken(stateValue))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, BadAuthRequest("Linux.do 登录状态无效或已过期")
	}
	if err != nil {
		return nil, err
	}
	_, setting, err := s.readLinuxDOSetting()
	if err != nil {
		return nil, err
	}
	accessToken, err := exchangeLinuxDOCode(setting, code, state.CodeVerifier)
	if err != nil {
		return nil, err
	}
	profile, err := fetchLinuxDOProfile(setting, accessToken)
	if err != nil {
		return nil, err
	}
	subject := profileString(profile, setting.SubjectField)
	if subject == "" {
		return nil, errors.New("Linux.do 用户信息缺少稳定用户 ID")
	}
	providerUsername := profileString(profile, setting.UsernameField)
	displayName := firstNonEmpty(profileString(profile, setting.DisplayNameField), providerUsername, "Linux.do 用户")
	avatarURL := profileString(profile, setting.AvatarField)
	identity, err := s.repo.UserIdentity("linuxdo", subject)
	var user *model.User
	if err == nil {
		user, err = s.repo.User(identity.UserID)
		if err != nil {
			return nil, err
		}
		identity.ProviderUsername = providerUsername
		identity.AvatarURL = avatarURL
		identity.UpdatedAt = time.Now()
		if err := s.repo.Save(identity); err != nil {
			return nil, err
		}
	} else if errors.Is(err, gorm.ErrRecordNotFound) {
		registrationEnabled, settingErr := s.RegistrationEnabled()
		if settingErr != nil {
			return nil, settingErr
		}
		if !registrationEnabled {
			return nil, Forbidden("管理员未开放新用户注册")
		}
		user, identity, err = s.createLinuxDOUser(subject, providerUsername, displayName, profileString(profile, setting.EmailField), avatarURL)
		if err != nil {
			return nil, err
		}
		if err := s.repo.CreateOAuthUser(user, identity); err != nil {
			return nil, err
		}
	} else {
		return nil, err
	}
	if user.Status != model.UserStatusActive {
		return nil, Forbidden("该账号已被禁用")
	}
	if err := s.ensureSignupBonus(user.ID); err != nil {
		return nil, err
	}
	now := time.Now()
	user.LastLoginAt = &now
	user.UpdatedAt = now
	if err := s.repo.Save(user); err != nil {
		return nil, err
	}
	s.recordActivity(user.ID, "login", 1)
	session, err := s.createAuthSession(user)
	if err != nil {
		return nil, err
	}
	return &LinuxDOCallbackResult{Session: session, Next: safeOAuthNext(state.NextPath)}, nil
}

func (s *Service) createLinuxDOUser(subject string, providerUsername string, displayName string, email string, avatarURL string) (*model.User, *model.UserIdentity, error) {
	base := oauthUsernameSanitizer.ReplaceAllString(strings.TrimSpace(providerUsername), "_")
	base = strings.Trim(base, "_-")
	if len(base) < 3 {
		base = "linuxdo_" + shortSubject(subject)
	}
	if len(base) > 24 {
		base = base[:24]
	}
	username := base
	if existing, err := s.repo.UserByUsername(username); err == nil && existing != nil {
		username = truncateRunes(base, 23) + "_" + shortSubject(subject)
	} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil, err
	}
	email = normalizeEmail(email)
	if email != "" {
		if validateEmail(email) != nil {
			email = ""
		} else if existing, err := s.repo.UserByEmail(email); err == nil && existing != nil {
			// 相同邮箱不自动合并身份，避免第三方邮箱状态不明导致账号接管。
			email = ""
		} else if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil, err
		}
	}
	user := &model.User{ID: newID(), Username: username, Email: email, DisplayName: normalizeDisplayName(displayName, username), Role: model.UserRoleUser, Status: model.UserStatusActive}
	identity := &model.UserIdentity{ID: newID(), UserID: user.ID, Provider: "linuxdo", Subject: subject, ProviderUsername: providerUsername, AvatarURL: avatarURL}
	return user, identity, nil
}

func (s *Service) readLinuxDOSetting() (*model.SystemSetting, linuxDOSettingValue, error) {
	setting, err := s.repo.SystemSetting(linuxDOSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, defaultLinuxDOSetting(), nil
	}
	if err != nil {
		return nil, linuxDOSettingValue{}, err
	}
	value := defaultLinuxDOSetting()
	if strings.TrimSpace(setting.ValueJSON) != "" {
		if err := json.Unmarshal([]byte(setting.ValueJSON), &value); err != nil {
			return nil, linuxDOSettingValue{}, errors.New("Linux.do OAuth 配置格式无效")
		}
	}
	value.ClientSecret, err = s.decryptSettingSecret(value.ClientSecret)
	if err != nil {
		return nil, linuxDOSettingValue{}, err
	}
	return setting, normalizeLinuxDOSetting(value), nil
}

func validateLinuxDOSetting(value linuxDOSettingValue) error {
	if !value.Enabled {
		return nil
	}
	if value.ClientID == "" || value.ClientSecret == "" || value.AuthorizationURL == "" || value.TokenURL == "" || value.UserInfoURL == "" || value.RedirectURL == "" {
		return BadAuthRequest("启用 Linux.do 登录前请完整填写 Client、端点和回调配置")
	}
	for _, rawURL := range []string{value.AuthorizationURL, value.TokenURL, value.UserInfoURL} {
		parsed, err := url.Parse(rawURL)
		if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
			return BadAuthRequest("Linux.do 授权、Token 和用户信息地址必须是有效的 HTTPS URL")
		}
	}
	redirectURL, err := url.Parse(value.RedirectURL)
	if err != nil || redirectURL.Host == "" || (redirectURL.Scheme != "https" && !(redirectURL.Scheme == "http" && isLoopbackOAuthHost(redirectURL.Hostname()))) {
		return BadAuthRequest("Linux.do 回调地址必须使用 HTTPS，本地回环地址可使用 HTTP")
	}
	if value.ClientAuthMethod != "client_secret_post" && value.ClientAuthMethod != "client_secret_basic" {
		return BadAuthRequest("请选择有效的 OAuth 客户端鉴权方式")
	}
	return nil
}

func isLoopbackOAuthHost(host string) bool {
	host = strings.ToLower(strings.TrimSpace(host))
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func normalizeLinuxDOSetting(value linuxDOSettingValue) linuxDOSettingValue {
	value.ClientID = strings.TrimSpace(value.ClientID)
	value.ClientSecret = strings.TrimSpace(value.ClientSecret)
	value.AuthorizationURL = strings.TrimSpace(value.AuthorizationURL)
	value.TokenURL = strings.TrimSpace(value.TokenURL)
	value.UserInfoURL = strings.TrimSpace(value.UserInfoURL)
	value.RedirectURL = strings.TrimSpace(value.RedirectURL)
	value.Scopes = uniqueNonEmpty(value.Scopes)
	value.ClientAuthMethod = strings.TrimSpace(value.ClientAuthMethod)
	value.SubjectField = strings.TrimSpace(value.SubjectField)
	value.UsernameField = strings.TrimSpace(value.UsernameField)
	value.DisplayNameField = strings.TrimSpace(value.DisplayNameField)
	value.EmailField = strings.TrimSpace(value.EmailField)
	value.AvatarField = strings.TrimSpace(value.AvatarField)
	if value.ClientAuthMethod == "" {
		value.ClientAuthMethod = "client_secret_post"
	}
	if value.SubjectField == "" {
		value.SubjectField = "id"
	}
	if value.UsernameField == "" {
		value.UsernameField = "username"
	}
	if value.DisplayNameField == "" {
		value.DisplayNameField = "name"
	}
	if value.EmailField == "" {
		value.EmailField = "email"
	}
	if value.AvatarField == "" {
		value.AvatarField = "avatar_url"
	}
	return value
}

func defaultLinuxDOSetting() linuxDOSettingValue {
	return normalizeLinuxDOSetting(linuxDOSettingValue{})
}

func publicLinuxDOSetting(setting *model.SystemSetting, value linuxDOSettingValue) *PublicLinuxDOSetting {
	result := &PublicLinuxDOSetting{
		Enabled: value.Enabled, ClientID: value.ClientID, HasClientSecret: value.ClientSecret != "",
		AuthorizationURL: value.AuthorizationURL, TokenURL: value.TokenURL, UserInfoURL: value.UserInfoURL,
		RedirectURL: value.RedirectURL, Scopes: value.Scopes, ClientAuthMethod: value.ClientAuthMethod,
		SubjectField: value.SubjectField, UsernameField: value.UsernameField, DisplayNameField: value.DisplayNameField,
		EmailField: value.EmailField, AvatarField: value.AvatarField,
	}
	if setting != nil {
		result.UpdatedBy = setting.UpdatedBy
		result.CreatedAt = setting.CreatedAt
		result.UpdatedAt = setting.UpdatedAt
	}
	return result
}

func exchangeLinuxDOCode(setting linuxDOSettingValue, code string, verifier string) (string, error) {
	if _, err := ValidateOutboundURL(setting.TokenURL); err != nil {
		return "", err
	}
	form := url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"client_id":     {setting.ClientID},
		"redirect_uri":  {setting.RedirectURL},
		"code_verifier": {verifier},
	}
	if setting.ClientAuthMethod == "client_secret_post" {
		form.Set("client_secret", setting.ClientSecret)
	}
	req, err := http.NewRequest(http.MethodPost, setting.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if setting.ClientAuthMethod == "client_secret_basic" {
		req.SetBasicAuth(setting.ClientID, setting.ClientSecret)
	}
	resp, err := OutboundHTTPClient(20 * time.Second).Do(req)
	if err != nil {
		return "", fmt.Errorf("Linux.do Token 请求失败：%w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("Linux.do Token 请求失败：HTTP %d", resp.StatusCode)
	}
	var payload struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.AccessToken == "" {
		return "", errors.New("Linux.do Token 响应无效")
	}
	return payload.AccessToken, nil
}

func fetchLinuxDOProfile(setting linuxDOSettingValue, accessToken string) (map[string]any, error) {
	if _, err := ValidateOutboundURL(setting.UserInfoURL); err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, setting.UserInfoURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := OutboundHTTPClient(20 * time.Second).Do(req)
	if err != nil {
		return nil, fmt.Errorf("Linux.do 用户信息请求失败：%w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("Linux.do 用户信息请求失败：HTTP %d", resp.StatusCode)
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var profile map[string]any
	if err := decoder.Decode(&profile); err != nil {
		return nil, errors.New("Linux.do 用户信息响应无效")
	}
	return profile, nil
}

func profileString(profile map[string]any, field string) string {
	var value any = profile
	for _, segment := range strings.Split(field, ".") {
		object, ok := value.(map[string]any)
		if !ok {
			return ""
		}
		value, ok = object[segment]
		if !ok || value == nil {
			return ""
		}
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func safeOAuthNext(value string) string {
	value = strings.TrimSpace(value)
	parsed, err := url.Parse(value)
	if value == "" || err != nil || parsed.IsAbs() || parsed.Host != "" || !strings.HasPrefix(parsed.Path, "/") || strings.HasPrefix(value, "//") || strings.Contains(value, "\\") {
		return "/canvas"
	}
	return parsed.RequestURI()
}

func shortSubject(value string) string {
	sum := sha256.Sum256([]byte(value))
	return fmt.Sprintf("%x", sum[:4])
}

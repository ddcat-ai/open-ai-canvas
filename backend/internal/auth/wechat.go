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

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
	"yingce/backend/internal/repository"
)

const wechatSettingKey = "wechat_oauth"
const wechatRegistrationProvider = "wechat_registration"

type WechatSettingRequest struct {
	Enabled     bool   `json:"enabled"`
	AppID       string `json:"appId"`
	AppSecret   string `json:"appSecret"`
	RedirectURL string `json:"redirectUrl"`
}

type PublicWechatSetting struct {
	Enabled      bool      `json:"enabled"`
	AppID        string    `json:"appId"`
	HasAppSecret bool      `json:"hasAppSecret"`
	RedirectURL  string    `json:"redirectUrl"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

func (s *Service) readWechatSetting() (*model.SystemSetting, WechatSettingRequest, error) {
	row, err := s.repo.SystemSetting(wechatSettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, WechatSettingRequest{}, nil
	}
	if err != nil {
		return nil, WechatSettingRequest{}, err
	}
	var value WechatSettingRequest
	if err := json.Unmarshal([]byte(row.ValueJSON), &value); err != nil {
		return nil, value, kernel.NewAppError(503, "微信登录配置格式无效")
	}
	value.AppSecret, err = s.host.DecryptSecret(value.AppSecret)
	return row, value, err
}

func publicWechatSetting(row *model.SystemSetting, value WechatSettingRequest) *PublicWechatSetting {
	result := &PublicWechatSetting{Enabled: value.Enabled, AppID: value.AppID, HasAppSecret: value.AppSecret != "", RedirectURL: value.RedirectURL}
	if row != nil {
		result.UpdatedAt = row.UpdatedAt
	}
	return result
}

func (s *Service) AdminWechatSetting(actor *model.User) (*PublicWechatSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	row, value, err := s.readWechatSetting()
	if err != nil {
		return nil, err
	}
	return publicWechatSetting(row, value), nil
}

func validateWechatSetting(value WechatSettingRequest) error {
	if !value.Enabled {
		return nil
	}
	if !strings.HasPrefix(value.AppID, "wx") || len(value.AppID) > 80 || strings.ContainsAny(value.AppID, " \t\r\n") || value.AppSecret == "" {
		return kernel.BadAuthRequest("请填写网站应用的 AppID 和 AppSecret")
	}
	u, err := url.Parse(value.RedirectURL)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" || u.Path != "/api/auth/wechat/callback" {
		return kernel.BadAuthRequest("微信回调地址须为 HTTPS，路径为 /api/auth/wechat/callback，且不包含查询参数")
	}
	return nil
}

func (s *Service) UpdateWechatSetting(actor *model.User, value WechatSettingRequest) (*PublicWechatSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	row, current, err := s.readWechatSetting()
	if err != nil {
		return nil, err
	}
	value.AppID, value.AppSecret, value.RedirectURL = strings.TrimSpace(value.AppID), strings.TrimSpace(value.AppSecret), strings.TrimSpace(value.RedirectURL)
	if value.AppSecret == "" {
		value.AppSecret = current.AppSecret
	}
	if value.Enabled && current.AppID != "" && value.AppID != current.AppID && strings.TrimSpace(value.AppSecret) == current.AppSecret {
		return nil, kernel.BadAuthRequest("更换 AppID 时请同时填写对应的新 AppSecret")
	}
	if err := validateWechatSetting(value); err != nil {
		return nil, err
	}
	stored := value
	stored.AppSecret, err = s.host.EncryptSecret(value.AppSecret)
	if err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	next := &model.SystemSetting{Key: wechatSettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	if row != nil {
		next.CreatedAt = row.CreatedAt
	}
	if err := s.repo.SaveSystemSetting(next); err != nil {
		return nil, err
	}
	return publicWechatSetting(next, value), nil
}

func (s *Service) WechatEnabled() bool {
	_, value, err := s.readWechatSetting()
	return err == nil && value.Enabled && validateWechatSetting(value) == nil
}

type WechatCallbackResult struct {
	Session           *AuthSessionResult
	Next              string
	ProfileOperation  string
	RegistrationToken string
}

func (s *Service) BeginWechatAuthorization(actor *model.User, cookie, next, purpose string, acceptedTerms bool) (string, string, error) {
	_, setting, err := s.readWechatSetting()
	if err != nil {
		return "", "", err
	}
	if !setting.Enabled {
		return "", "", kernel.Forbidden("微信登录尚未启用")
	}
	if err := validateWechatSetting(setting); err != nil {
		return "", "", err
	}
	record := &model.OAuthState{ID: kernel.NewID(), Provider: "wechat", Purpose: purpose, ClientID: setting.AppID, NextPath: safeOAuthNext(next), AcceptedTerms: acceptedTerms, ExpiresAt: time.Now().Add(10 * time.Minute)}
	switch purpose {
	case "login":
		count, err := s.repo.UserCount()
		if err != nil {
			return "", "", err
		}
		if count == 0 {
			return "", "", kernel.Forbidden("请先创建本地管理员账号，再开放微信登录")
		}
	case "bind", "reauth":
		user, session, err := s.profileSession(actor, cookie)
		if err != nil {
			return "", "", err
		}
		identity, err := s.repo.UserIdentityForUser(user.ID, "wechat")
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return "", "", err
		}
		if purpose == "bind" && identity != nil {
			return "", "", kernel.BadAuthRequest("当前账号已绑定微信")
		}
		if purpose == "reauth" && (identity == nil || !strings.HasPrefix(identity.Subject, setting.AppID+":")) {
			return "", "", kernel.Forbidden("当前账号未绑定此网站应用的微信身份")
		}
		record.ReauthUserID, record.ReauthSessionID = user.ID, session.ID
	default:
		return "", "", kernel.BadAuthRequest("微信授权用途无效")
	}
	state := RandomToken()
	record.StateHash = HashToken(state)
	if err := s.repo.CreateOAuthState(record); err != nil {
		return "", "", err
	}
	query := url.Values{"appid": {setting.AppID}, "redirect_uri": {setting.RedirectURL}, "response_type": {"code"}, "scope": {"snsapi_login"}, "state": {state}}
	return "https://open.weixin.qq.com/connect/qrconnect?" + query.Encode() + "#wechat_redirect", state, nil
}

type wechatProfile struct {
	Subject   string `json:"subject"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatarUrl"`
}

// 微信要求将密钥放在服务端查询参数中；网络错误和响应不得原样进入日志或重定向。
func (s *Service) wechatGet(ctx context.Context, path string, query url.Values, output any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.weixin.qq.com"+path+"?"+query.Encode(), nil)
	if err != nil {
		return kernel.NewAppError(502, "微信授权请求失败")
	}
	client := s.wechatHTTPClient
	if client == nil {
		client = outbound.OutboundHTTPClient(15 * time.Second)
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	}
	resp, err := client.Do(req)
	if err != nil {
		return kernel.NewAppError(502, "微信授权服务暂时不可用，请重试")
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, (1<<20)+1))
	if err != nil || len(data) > 1<<20 || resp.StatusCode != http.StatusOK {
		return kernel.NewAppError(502, "微信授权响应异常，请重试")
	}
	var failure struct {
		ErrorCode int `json:"errcode"`
	}
	if json.Unmarshal(data, &failure) != nil || failure.ErrorCode != 0 {
		return kernel.BadAuthRequest("微信授权失败或授权码已过期，请重新登录")
	}
	if json.Unmarshal(data, output) != nil {
		return kernel.NewAppError(502, "微信授权响应格式无效")
	}
	return nil
}

func (s *Service) fetchWechatProfile(ctx context.Context, setting WechatSettingRequest, code string) (wechatProfile, error) {
	var token struct {
		AccessToken string `json:"access_token"`
		OpenID      string `json:"openid"`
	}
	if err := s.wechatGet(ctx, "/sns/oauth2/access_token", url.Values{"appid": {setting.AppID}, "secret": {setting.AppSecret}, "code": {code}, "grant_type": {"authorization_code"}}, &token); err != nil {
		return wechatProfile{}, err
	}
	if token.AccessToken == "" || token.OpenID == "" || len(setting.AppID)+len(token.OpenID)+1 > 160 {
		return wechatProfile{}, kernel.NewAppError(502, "微信未返回有效的用户身份")
	}
	var profile struct {
		OpenID   string `json:"openid"`
		Nickname string `json:"nickname"`
		Avatar   string `json:"headimgurl"`
	}
	if err := s.wechatGet(ctx, "/sns/userinfo", url.Values{"access_token": {token.AccessToken}, "openid": {token.OpenID}, "lang": {"zh_CN"}}, &profile); err != nil {
		return wechatProfile{}, err
	}
	if profile.OpenID != token.OpenID {
		return wechatProfile{}, kernel.BadAuthRequest("微信用户身份不匹配")
	}
	avatar, err := url.Parse(profile.Avatar)
	if err != nil || avatar.Scheme != "https" || avatar.Hostname() == "" || avatar.User != nil || len(profile.Avatar) > 2048 {
		profile.Avatar = ""
	}
	return wechatProfile{Subject: setting.AppID + ":" + token.OpenID, Name: NormalizeDisplayName(profile.Nickname, "微信用户"), AvatarURL: profile.Avatar}, nil
}

func (s *Service) CompleteWechatLogin(ctx context.Context, stateValue, code, cookie string, login LoginContext) (result *WechatCallbackResult, err error) {
	result = &WechatCallbackResult{Next: "/login"}
	event := NewLoginLog("wechat", "login", login)
	defer func() {
		if err != nil && result.ProfileOperation == "" {
			err = s.recordLoginFailure(event, err)
		}
	}()
	if stateValue == "" || strings.TrimSpace(code) == "" {
		return result, kernel.BadAuthRequest("微信授权未完成，请重新登录")
	}
	state, err := s.repo.ConsumeOAuthState("wechat", HashToken(stateValue))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return result, kernel.BadAuthRequest("微信登录状态无效或已过期")
	}
	if err != nil {
		return result, err
	}
	if state.Purpose == "bind" || state.Purpose == "reauth" {
		result.ProfileOperation = state.Purpose
		result.Next = "/settings?section=profile&" + state.Purpose + "=success"
	} else if state.Purpose != "login" {
		return result, kernel.BadAuthRequest("微信授权用途无效")
	}
	_, setting, err := s.readWechatSetting()
	if err != nil {
		return result, err
	}
	if !setting.Enabled || state.ClientID != setting.AppID {
		return result, kernel.Forbidden("微信登录配置已变化，请重新发起授权")
	}
	var user *model.User
	var session *model.AuthSession
	if result.ProfileOperation != "" {
		user, session, err = s.profileSession(&model.User{ID: state.ReauthUserID}, cookie)
		if err != nil {
			return result, err
		}
		if session.ID != state.ReauthSessionID {
			return result, kernel.Unauthorized("微信授权与当前会话不匹配")
		}
	}
	profile, err := s.fetchWechatProfile(ctx, setting, code)
	if err != nil {
		return result, err
	}
	if result.ProfileOperation == "bind" {
		identity := &model.UserIdentity{ID: kernel.NewID(), UserID: user.ID, Provider: "wechat", Subject: profile.Subject, ProviderUsername: profile.Name, AvatarURL: profile.AvatarURL}
		err = s.repo.BindOAuthIdentity(user, session, identity)
		if errors.Is(err, repository.ErrOAuthIdentityBound) {
			err = kernel.BadAuthRequest("该微信已绑定账号，或当前账号已经绑定微信")
		}
		return result, err
	}
	if result.ProfileOperation == "reauth" {
		return result, profileWriteError(s.repo.ReauthenticateOAuthSession(user, session, "wechat", profile.Subject, time.Now()))
	}
	_, err = s.repo.UserIdentity("wechat", profile.Subject)
	if err == nil {
		completed, err := s.finishOAuthLogin(state, event, oauthProfile{provider: "wechat", subject: profile.Subject, name: profile.Name, username: profile.Name, avatarURL: profile.AvatarURL}, false)
		if err != nil {
			return result, err
		}
		result.Session, result.Next = completed.Session, completed.Next
		return result, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return result, err
	}
	enabled, err := s.RegistrationEnabled()
	if err != nil {
		return result, err
	}
	if !enabled {
		return result, kernel.Forbidden("管理员未开放新用户注册，请使用已有账号登录后绑定微信")
	}
	payload, err := json.Marshal(profile)
	if err != nil {
		return result, err
	}
	ticket := RandomToken()
	pending := &model.OAuthState{ID: kernel.NewID(), Provider: wechatRegistrationProvider, StateHash: HashToken(ticket), ClientID: setting.AppID, ProfileJSON: string(payload), NextPath: state.NextPath, AcceptedTerms: state.AcceptedTerms, ExpiresAt: time.Now().Add(10 * time.Minute)}
	if err := s.repo.CreateOAuthState(pending); err != nil {
		return result, err
	}
	result.RegistrationToken = ticket
	result.Next = "/login?wechat_register=1&next=" + url.QueryEscape(safeOAuthNext(state.NextPath))
	return result, nil
}

type WechatRegistrationInfo struct {
	DisplayName   string `json:"displayName"`
	Next          string `json:"next"`
	AcceptedTerms bool   `json:"acceptedTerms"`
}

func (s *Service) pendingWechatRegistration(ticket string) (*model.OAuthState, wechatProfile, error) {
	if ticket == "" {
		return nil, wechatProfile{}, kernel.BadAuthRequest("微信注册已过期，请重新授权")
	}
	state, err := s.repo.PendingOAuthState(wechatRegistrationProvider, HashToken(ticket))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, wechatProfile{}, kernel.BadAuthRequest("微信注册已过期，请重新授权")
	}
	if err != nil {
		return nil, wechatProfile{}, err
	}
	_, setting, err := s.readWechatSetting()
	if err != nil {
		return nil, wechatProfile{}, err
	}
	if !setting.Enabled || setting.AppID != state.ClientID {
		return nil, wechatProfile{}, kernel.Forbidden("微信登录配置已变化，请重新授权")
	}
	var profile wechatProfile
	if json.Unmarshal([]byte(state.ProfileJSON), &profile) != nil || profile.Subject == "" {
		return nil, profile, kernel.BadAuthRequest("微信注册身份无效，请重新授权")
	}
	return state, profile, nil
}

func (s *Service) WechatRegistration(ticket string) (*WechatRegistrationInfo, error) {
	state, profile, err := s.pendingWechatRegistration(ticket)
	if err != nil {
		return nil, err
	}
	return &WechatRegistrationInfo{DisplayName: profile.Name, Next: safeOAuthNext(state.NextPath), AcceptedTerms: state.AcceptedTerms}, nil
}

func (s *Service) CompleteWechatRegistration(ticket string, req RegisterRequest) (*AuthSessionResult, error) {
	state, profile, err := s.pendingWechatRegistration(ticket)
	if err != nil {
		return nil, err
	}
	user, _, err := s.newOAuthUser(oauthProfile{provider: "wechat", subject: profile.Subject, name: profile.Name})
	if err != nil {
		return nil, err
	}
	req.Username, req.DisplayName = user.Username, profile.Name
	req.wechatRegistration = state
	return s.Register(req)
}

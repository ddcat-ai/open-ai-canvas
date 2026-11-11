package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
	"gorm.io/gorm"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
)

const oidcProvider = "oidc"

type oidcConfig struct {
	issuer       string
	clientID     string
	clientSecret string
	redirectURL  string
	allowedGroup string
}

func readOIDCConfig() oidcConfig {
	return oidcConfig{
		issuer:       strings.TrimSpace(os.Getenv("CANVAS_OIDC_ISSUER")),
		clientID:     strings.TrimSpace(os.Getenv("CANVAS_OIDC_CLIENT_ID")),
		clientSecret: os.Getenv("CANVAS_OIDC_CLIENT_SECRET"),
		redirectURL:  strings.TrimSpace(os.Getenv("CANVAS_OIDC_REDIRECT_URL")),
		allowedGroup: strings.TrimSpace(os.Getenv("CANVAS_OIDC_ALLOWED_GROUP")),
	}
}

func (cfg oidcConfig) enabled() bool {
	return cfg.clientID != "" && cfg.clientSecret != "" && validOIDCURL(cfg.issuer) && validOIDCURL(cfg.redirectURL)
}

func validOIDCURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.RawQuery == "" && !u.ForceQuery && u.Fragment == ""
}

func (cfg oidcConfig) discover(ctx context.Context) (*oidc.Provider, oauth2.Config, error) {
	if !cfg.enabled() {
		return nil, oauth2.Config{}, kernel.Forbidden("OIDC 登录尚未配置")
	}
	provider, err := oidc.NewProvider(ctx, cfg.issuer)
	if err != nil {
		return nil, oauth2.Config{}, kernel.NewAppError(http.StatusBadGateway, "无法读取 OIDC 提供方配置")
	}
	return provider, oauth2.Config{
		ClientID: cfg.clientID, ClientSecret: cfg.clientSecret, Endpoint: provider.Endpoint(),
		RedirectURL: cfg.redirectURL, Scopes: []string{oidc.ScopeOpenID, "profile", "email"},
	}, nil
}

// 发现、令牌和公钥请求均沿用出站地址限制。禁止重定向，避免把客户端密钥转发到其他地址。
type oidcTransport struct{ base http.RoundTripper }

func (t oidcTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" {
		return nil, errors.New("OIDC 提供方必须使用 HTTPS")
	}
	if _, err := outbound.ValidateOutboundURL(req.URL.String()); err != nil {
		return nil, err
	}
	resp, err := t.base.RoundTrip(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	const limit = 1 << 20
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if len(body) > limit {
		return nil, errors.New("OIDC 响应过大")
	}
	resp.Body = io.NopCloser(bytes.NewReader(body))
	return resp, nil
}

func oidcRequestContext(ctx context.Context) (context.Context, context.CancelFunc) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	client := outbound.OutboundHTTPClient(15 * time.Second)
	client.Transport = oidcTransport{base: client.Transport}
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return oidc.ClientContext(ctx, client), cancel
}

func (s *Service) BeginOIDCLogin(ctx context.Context, next string, acceptedTerms bool) (target, state string, err error) {
	count, err := s.repo.UserCount()
	if err != nil {
		return "", "", err
	}
	if count == 0 {
		return "", "", kernel.Forbidden("请先创建本地管理员账号，再开放 OIDC 登录")
	}
	ctx, cancel := oidcRequestContext(ctx)
	defer cancel()
	_, oauth, err := readOIDCConfig().discover(ctx)
	if err != nil {
		return "", "", err
	}
	if !validOIDCURL(oauth.Endpoint.AuthURL) {
		return "", "", kernel.NewAppError(http.StatusBadGateway, "OIDC 授权地址无效")
	}
	state, verifier := RandomToken(), oauth2.GenerateVerifier()
	record := model.OAuthState{
		ID: kernel.NewID(), Provider: oidcProvider, StateHash: HashToken(state), CodeVerifier: verifier,
		NextPath: safeOAuthNext(next), AcceptedTerms: acceptedTerms, ExpiresAt: time.Now().Add(10 * time.Minute),
	}
	if err := s.repo.CreateOAuthState(&record); err != nil {
		return "", "", err
	}
	return oauth.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier), oidc.Nonce(oidcNonce(verifier))), state, nil
}

// 单次 PKCE verifier 用不同用途的哈希派生 nonce，无需增加状态表字段。
func oidcNonce(verifier string) string { return HashToken("oidc-nonce:" + verifier) }

type oidcClaims struct {
	Nonce             string          `json:"nonce"`
	AuthorizedParty   string          `json:"azp"`
	PreferredUsername string          `json:"preferred_username"`
	Name              string          `json:"name"`
	Email             string          `json:"email"`
	EmailVerified     bool            `json:"email_verified"`
	Groups            json.RawMessage `json:"groups"`
}

func (s *Service) CompleteOIDCLogin(ctx context.Context, stateValue, code string, login LoginContext) (result *OAuthCallbackResult, err error) {
	event := NewLoginLog(oidcProvider, "login", login)
	defer func() {
		if err != nil {
			err = s.recordLoginFailure(event, err)
		}
	}()
	if stateValue == "" || code == "" {
		return nil, kernel.BadAuthRequest("OIDC 登录回调缺少必要参数")
	}
	state, err := s.repo.ConsumeOAuthState(oidcProvider, HashToken(stateValue))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.BadAuthRequest("OIDC 登录状态无效或已过期")
	}
	if err != nil {
		return nil, err
	}
	ctx, cancel := oidcRequestContext(ctx)
	defer cancel()
	cfg := readOIDCConfig()
	provider, oauth, err := cfg.discover(ctx)
	if err != nil {
		return nil, err
	}
	token, err := oauth.Exchange(ctx, code, oauth2.VerifierOption(state.CodeVerifier))
	if err != nil {
		return nil, kernel.NewAppError(http.StatusBadGateway, "OIDC 授权码交换失败")
	}
	rawIDToken, _ := token.Extra("id_token").(string)
	idToken, err := provider.VerifierContext(ctx, &oidc.Config{ClientID: cfg.clientID}).Verify(ctx, rawIDToken)
	if err != nil || idToken.Issuer != cfg.issuer || idToken.Subject == "" {
		return nil, kernel.Unauthorized("OIDC 身份令牌无效")
	}
	var claims oidcClaims
	if err := idToken.Claims(&claims); err != nil || claims.Nonce != oidcNonce(state.CodeVerifier) {
		return nil, kernel.Unauthorized("OIDC 身份令牌与登录请求不匹配")
	}
	if (len(idToken.Audience) > 1 || claims.AuthorizedParty != "") && claims.AuthorizedParty != cfg.clientID {
		return nil, kernel.Unauthorized("OIDC 身份令牌的授权客户端不匹配")
	}
	if cfg.allowedGroup != "" {
		var groups []string
		if err := json.Unmarshal(claims.Groups, &groups); err != nil || !slices.Contains(groups, cfg.allowedGroup) {
			return nil, kernel.Forbidden("当前身份没有 OIDC 登录权限")
		}
	}
	email := ""
	if claims.EmailVerified {
		email = claims.Email
	}
	// sub 只在签发方内唯一。固定长度摘要复用现有身份字段，切换签发方也不会串号。
	subject := HashToken(cfg.issuer + "\x00" + idToken.Subject)
	return s.finishOAuthLogin(state, event, oauthProfile{
		provider: oidcProvider, subject: subject, username: kernel.TruncateRunes(claims.PreferredUsername, 160),
		name: kernel.FirstNonEmpty(claims.Name, claims.PreferredUsername, "OIDC 用户"), email: email,
	}, cfg.allowedGroup != "")
}

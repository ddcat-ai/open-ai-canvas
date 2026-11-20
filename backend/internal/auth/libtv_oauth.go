package auth

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"

	"gorm.io/gorm"
)

const (
	libTVIssuerDefault          = "https://mcp.liblib.tv"
	libTVMCPURLDefault          = "https://mcp.liblib.tv/mcp"
	libTVResourceDefault        = "https://mcp.liblib.tv/mcp"
	libTVCallbackPath           = "/api/admin/settings/libtv/oauth/callback"
	libTVPasteRedirectURI       = "http://127.0.0.1:8765/callback"
	libTVOAuthStateTTL          = 10 * time.Minute
	libTVAccessTokenRefreshSkew = time.Minute
	libTVOAuthMaxResponseBytes  = 1 << 20
	libTVProvider               = "libtv"
	libTVCallbackModeRedirect   = "redirect"
	libTVCallbackModePaste      = "paste"
)

var libTVImportScopes = []string{"libtv:account:read", "libtv:project:read"}

type libTVRuntime struct {
	issuer   string
	mcpURL   string
	resource string
	client   *http.Client
	now      func() time.Time
}

type libTVOAuthMetadata struct {
	Issuer                        string   `json:"issuer"`
	AuthorizationEndpoint         string   `json:"authorization_endpoint"`
	TokenEndpoint                 string   `json:"token_endpoint"`
	RegistrationEndpoint          string   `json:"registration_endpoint"`
	CodeChallengeMethodsSupported []string `json:"code_challenge_methods_supported"`
}

type libTVTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
	Error        string `json:"error"`
	ErrorDesc    string `json:"error_description"`
}

func (s *Service) libTVRuntime() libTVRuntime {
	rt := libTVRuntime{
		issuer:   libTVIssuerDefault,
		mcpURL:   libTVMCPURLDefault,
		resource: libTVResourceDefault,
		now:      time.Now,
	}
	if s != nil && s.libtv != nil {
		if s.libtv.issuer != "" {
			rt.issuer = strings.TrimRight(s.libtv.issuer, "/")
		}
		if s.libtv.mcpURL != "" {
			rt.mcpURL = s.libtv.mcpURL
		}
		if s.libtv.resource != "" {
			rt.resource = s.libtv.resource
		}
		if s.libtv.client != nil {
			rt.client = s.libtv.client
		}
		if s.libtv.now != nil {
			rt.now = s.libtv.now
		}
	}
	if rt.client == nil {
		rt.client = outbound.OutboundHTTPClient(30 * time.Second)
		rt.client.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
			return errors.New("LibTV 授权接口不允许重定向")
		}
	}
	return rt
}

func (s *Service) StartLibTVOAuth(actor *model.User, req LibTVConnectStartRequest) (*LibTVConnectStartResult, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if actor == nil || strings.TrimSpace(actor.ID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	rt := s.libTVRuntime()
	meta, err := rt.discoverOAuth()
	if err != nil {
		return nil, err
	}
	if !supportsPKCES256(meta.CodeChallengeMethodsSupported) {
		return nil, errors.New("LibTV 授权服务器未声明 PKCE S256，已拒绝继续")
	}
	redirectURI, mode, err := s.ensureLibTVClient(actor, req.Origin, rt, meta)
	if err != nil {
		return nil, err
	}
	_, value, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	state := RandomToken()
	verifier := RandomToken()
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])
	pending, err := json.Marshal(libTVOAuthPending{RedirectURI: redirectURI, ClientID: value.ClientID, ActorID: actor.ID})
	if err != nil {
		return nil, err
	}
	expiresAt := rt.now().Add(libTVOAuthStateTTL)
	record := &model.OAuthState{
		ID:           kernel.NewID(),
		Provider:     libTVProvider,
		StateHash:    HashToken(state),
		CodeVerifier: verifier,
		NextPath:     string(pending),
		ReauthUserID: actor.ID,
		ExpiresAt:    expiresAt,
	}
	if err := s.repo.CreateOAuthState(record); err != nil {
		return nil, err
	}
	authorizeURL, err := url.Parse(meta.AuthorizationEndpoint)
	if err != nil {
		return nil, err
	}
	query := authorizeURL.Query()
	query.Set("response_type", "code")
	query.Set("client_id", value.ClientID)
	query.Set("redirect_uri", redirectURI)
	query.Set("scope", strings.Join(libTVImportScopes, " "))
	query.Set("state", state)
	query.Set("code_challenge", challenge)
	query.Set("code_challenge_method", "S256")
	query.Set("resource", rt.resource)
	authorizeURL.RawQuery = query.Encode()
	return &LibTVConnectStartResult{
		AuthorizeURL: authorizeURL.String(),
		RedirectURI:  redirectURI,
		CallbackMode: mode,
		ExpiresAt:    expiresAt,
		Hint:         libTVCallbackHint(mode, redirectURI),
	}, nil
}

func (s *Service) CompleteLibTVOAuth(actor *model.User, req LibTVConnectCompleteRequest) (*PublicLibTVSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	code, state, err := libTVCallbackCredentials(req)
	if err != nil {
		return nil, err
	}
	setting, err := s.finishLibTVOAuth(code, state, actor)
	if err != nil {
		return nil, err
	}
	return setting, nil
}

func (s *Service) CompleteLibTVOAuthCallback(code, state, errorCode, errorDescription string) (string, int, error) {
	if strings.TrimSpace(errorCode) != "" {
		msg := "LibTV 授权未完成"
		if desc := strings.TrimSpace(errorDescription); desc != "" {
			msg = msg + "：" + desc
		} else {
			msg = msg + "：" + strings.TrimSpace(errorCode)
		}
		return libTVOAuthHTML(false, msg), http.StatusBadRequest, nil
	}
	if _, err := s.finishLibTVOAuth(code, state, nil); err != nil {
		status := http.StatusBadRequest
		var appErr *kernel.AppError
		if errors.As(err, &appErr) && appErr.Status >= 400 && appErr.Status < 600 {
			status = appErr.Status
		}
		return libTVOAuthHTML(false, err.Error()), status, nil
	}
	return libTVOAuthHTML(true, "已连接 LibTV 账号，可以关闭此页面，返回影策继续。"), http.StatusOK, nil
}

func (s *Service) DisconnectLibTV(actor *model.User) (*PublicLibTVSetting, error) {
	if err := s.host.RequireAdmin(actor); err != nil {
		return nil, err
	}
	s.libtvMu.Lock()
	defer s.libtvMu.Unlock()
	_, value, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	value.Enabled = false
	value.AccessToken = ""
	value.RefreshToken = ""
	value.TokenType = ""
	value.Scope = ""
	value.ExpiresAt = time.Time{}
	value.AccountName = ""
	value.AccountID = ""
	value.Token = ""
	setting, err := s.persistLibTVSetting(actor.ID, value)
	if err != nil {
		return nil, err
	}
	return s.publicLibTVSetting(setting, value, ""), nil
}

func (s *Service) finishLibTVOAuth(code, state string, actor *model.User) (*PublicLibTVSetting, error) {
	code = strings.TrimSpace(code)
	state = strings.TrimSpace(state)
	if code == "" || state == "" {
		return nil, kernel.BadAuthRequest("LibTV 授权回调缺少必要参数")
	}
	record, err := s.repo.ConsumeOAuthState(libTVProvider, HashToken(state))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.BadAuthRequest("LibTV 授权状态无效或已过期")
	}
	if err != nil {
		return nil, err
	}
	if record.ExpiresAt.Before(s.libTVRuntime().now()) {
		return nil, kernel.BadAuthRequest("LibTV 授权状态无效或已过期")
	}
	var pending libTVOAuthPending
	if err := json.Unmarshal([]byte(record.NextPath), &pending); err != nil || strings.TrimSpace(pending.ClientID) == "" || strings.TrimSpace(pending.RedirectURI) == "" {
		return nil, errors.New("LibTV 授权会话数据无效")
	}
	if actor != nil && pending.ActorID != "" && actor.ID != pending.ActorID {
		return nil, kernel.Forbidden("请使用发起连接的管理员账号完成授权")
	}
	rt := s.libTVRuntime()
	meta, err := rt.discoverOAuth()
	if err != nil {
		return nil, err
	}
	s.libtvMu.Lock()
	defer s.libtvMu.Unlock()
	_, value, err := s.readLibTVSetting()
	if err != nil {
		return nil, err
	}
	tokens, err := rt.exchangeToken(meta, url.Values{
		"grant_type":    {"authorization_code"},
		"code":          {code},
		"redirect_uri":  {pending.RedirectURI},
		"client_id":     {pending.ClientID},
		"code_verifier": {record.CodeVerifier},
		"resource":      {rt.resource},
	}, value.ClientSecret)
	if err != nil {
		return nil, err
	}
	value.ClientID = pending.ClientID
	value.RedirectURI = pending.RedirectURI
	value.Issuer = meta.Issuer
	applyLibTVTokens(&value, tokens, rt.now())
	updatedBy := pending.ActorID
	if actor != nil {
		updatedBy = actor.ID
	}
	accountName, accountID := s.lookupLibTVAccount(value.AccessToken)
	if accountName != "" {
		value.AccountName = accountName
	}
	if accountID != "" {
		value.AccountID = accountID
	}
	setting, err := s.persistLibTVSetting(updatedBy, value)
	if err != nil {
		return nil, err
	}
	return s.publicLibTVSetting(setting, value, ""), nil
}

func (s *Service) ensureLibTVClient(actor *model.User, originHint string, rt libTVRuntime, meta libTVOAuthMetadata) (string, string, error) {
	s.libtvMu.Lock()
	defer s.libtvMu.Unlock()
	_, value, err := s.readLibTVSetting()
	if err != nil {
		return "", "", err
	}
	candidates := libTVRedirectCandidates(originHint)
	var lastErr error
	for _, candidate := range candidates {
		if value.ClientID != "" && value.RedirectURI == candidate.URI && strings.TrimRight(value.Issuer, "/") == strings.TrimRight(meta.Issuer, "/") {
			return candidate.URI, candidate.Mode, nil
		}
		registration, err := rt.registerClient(meta, candidate.URI)
		if err != nil {
			lastErr = err
			if isLibTVDisallowedRedirect(err) {
				continue
			}
			return "", "", err
		}
		value.ClientID = registration.ClientID
		value.ClientSecret = registration.ClientSecret
		value.RedirectURI = candidate.URI
		value.Issuer = kernel.FirstNonEmpty(registration.Issuer, meta.Issuer)
		if _, err := s.persistLibTVSetting(actor.ID, value); err != nil {
			return "", "", err
		}
		return candidate.URI, candidate.Mode, nil
	}
	if lastErr != nil {
		return "", "", lastErr
	}
	return "", "", errors.New("无法向 LibTV 注册授权回调地址")
}

type libTVRegisteredClient struct {
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	Issuer       string `json:"issuer"`
}

func (rt libTVRuntime) registerClient(meta libTVOAuthMetadata, redirectURI string) (libTVRegisteredClient, error) {
	endpoint := strings.TrimSpace(meta.RegistrationEndpoint)
	if endpoint == "" {
		return libTVRegisteredClient{}, errors.New("LibTV 授权服务器未提供动态注册端点")
	}
	payload, err := json.Marshal(map[string]any{
		"client_name":                "影策 LibTV 画布导入",
		"redirect_uris":              []string{redirectURI},
		"grant_types":                []string{"authorization_code", "refresh_token"},
		"response_types":             []string{"code"},
		"token_endpoint_auth_method": "none",
		"scope":                      strings.Join(libTVImportScopes, " "),
		"application_type":           libTVApplicationType(redirectURI),
	})
	if err != nil {
		return libTVRegisteredClient{}, err
	}
	req, err := http.NewRequest(http.MethodPost, endpoint, strings.NewReader(string(payload)))
	if err != nil {
		return libTVRegisteredClient{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	outbound.ApplyDefaultOutboundHeaders(req)
	body, status, err := rt.doJSON(req, libTVOAuthMaxResponseBytes)
	if err != nil {
		return libTVRegisteredClient{}, errors.New("向 LibTV 注册授权客户端失败")
	}
	if status < 200 || status >= 300 {
		return libTVRegisteredClient{}, libTVOAuthError("动态注册客户端失败", status, body)
	}
	var registered libTVRegisteredClient
	if err := json.Unmarshal(body, &registered); err != nil || strings.TrimSpace(registered.ClientID) == "" {
		return libTVRegisteredClient{}, errors.New("LibTV 客户端注册响应无效")
	}
	return registered, nil
}

func (rt libTVRuntime) discoverOAuth() (libTVOAuthMetadata, error) {
	endpoint := strings.TrimRight(rt.issuer, "/") + "/.well-known/oauth-authorization-server"
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return libTVOAuthMetadata{}, err
	}
	req.Header.Set("Accept", "application/json")
	outbound.ApplyDefaultOutboundHeaders(req)
	body, status, err := rt.doJSON(req, libTVOAuthMaxResponseBytes)
	if err != nil {
		return libTVOAuthMetadata{}, errors.New("读取 LibTV 授权服务器元数据失败")
	}
	if status < 200 || status >= 300 {
		return libTVOAuthMetadata{}, fmt.Errorf("读取 LibTV 授权服务器元数据失败（HTTP %d）", status)
	}
	var meta libTVOAuthMetadata
	if err := json.Unmarshal(body, &meta); err != nil {
		return libTVOAuthMetadata{}, errors.New("LibTV 授权服务器元数据格式无效")
	}
	if strings.TrimSpace(meta.AuthorizationEndpoint) == "" || strings.TrimSpace(meta.TokenEndpoint) == "" || strings.TrimSpace(meta.RegistrationEndpoint) == "" {
		return libTVOAuthMetadata{}, errors.New("LibTV 授权服务器元数据缺少必要端点")
	}
	return meta, nil
}

func (rt libTVRuntime) exchangeToken(meta libTVOAuthMetadata, form url.Values, clientSecret string) (*libTVTokenResponse, error) {
	if strings.TrimSpace(clientSecret) != "" {
		form.Set("client_secret", clientSecret)
	}
	req, err := http.NewRequest(http.MethodPost, meta.TokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	outbound.ApplyDefaultOutboundHeaders(req)
	body, status, err := rt.doJSON(req, libTVOAuthMaxResponseBytes)
	if err != nil {
		return nil, errors.New("向 LibTV 换取授权令牌失败")
	}
	var token libTVTokenResponse
	_ = json.Unmarshal(body, &token)
	if status < 200 || status >= 300 || token.Error != "" || strings.TrimSpace(token.AccessToken) == "" {
		msg := kernel.FirstNonEmpty(token.ErrorDesc, token.Error, fmt.Sprintf("换取 token 失败（HTTP %d）", status))
		return nil, errors.New("LibTV " + msg)
	}
	return &token, nil
}

func (s *Service) libTVAccessToken(force bool) (string, error) {
	s.libtvMu.Lock()
	defer s.libtvMu.Unlock()
	_, value, err := s.readLibTVSetting()
	if err != nil {
		return "", err
	}
	if !libTVSettingConnected(value) {
		return "", kernel.BadAuthRequest("尚未连接 LibTV 账号")
	}
	rt := s.libTVRuntime()
	fresh := !force && strings.TrimSpace(value.AccessToken) != "" && (value.ExpiresAt.IsZero() || value.ExpiresAt.After(rt.now().Add(libTVAccessTokenRefreshSkew)))
	if fresh {
		return value.AccessToken, nil
	}
	if strings.TrimSpace(value.RefreshToken) == "" {
		return "", kernel.BadAuthRequest("LibTV 授权已失效，请重新连接账号")
	}
	meta, err := rt.discoverOAuth()
	if err != nil {
		return "", err
	}
	tokens, err := rt.exchangeToken(meta, url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {value.RefreshToken},
		"client_id":     {value.ClientID},
		"resource":      {rt.resource},
	}, value.ClientSecret)
	if err != nil {
		value.AccessToken = ""
		value.RefreshToken = ""
		value.Enabled = false
		value.ExpiresAt = time.Time{}
		_, _ = s.persistLibTVSetting(value.AccountID, value)
		return "", kernel.BadAuthRequest("LibTV 授权已失效，请重新连接账号")
	}
	applyLibTVTokens(&value, tokens, rt.now())
	if _, err := s.persistLibTVSetting("", value); err != nil {
		return "", err
	}
	return value.AccessToken, nil
}

func applyLibTVTokens(value *libTVSettingValue, tokens *libTVTokenResponse, now time.Time) {
	if value == nil || tokens == nil {
		return
	}
	value.AccessToken = strings.TrimSpace(tokens.AccessToken)
	if refresh := strings.TrimSpace(tokens.RefreshToken); refresh != "" {
		value.RefreshToken = refresh
	}
	value.TokenType = kernel.FirstNonEmpty(strings.TrimSpace(tokens.TokenType), "Bearer")
	if scope := strings.TrimSpace(tokens.Scope); scope != "" {
		value.Scope = scope
	}
	if tokens.ExpiresIn > 0 {
		value.ExpiresAt = now.Add(time.Duration(tokens.ExpiresIn) * time.Second)
	} else {
		value.ExpiresAt = now.Add(time.Hour)
	}
}

type libTVRedirectCandidate struct {
	URI  string
	Mode string
}

func libTVRedirectCandidates(originHint string) []libTVRedirectCandidate {
	var candidates []libTVRedirectCandidate
	seen := map[string]struct{}{}
	add := func(uri, mode string) {
		uri = strings.TrimSpace(uri)
		if uri == "" {
			return
		}
		if _, ok := seen[uri]; ok {
			return
		}
		seen[uri] = struct{}{}
		candidates = append(candidates, libTVRedirectCandidate{URI: uri, Mode: mode})
	}
	if base := libTVPublicBaseURL(); base != "" {
		mode := libTVCallbackModePaste
		if isLibTVLoopbackHTTPBase(base) {
			mode = libTVCallbackModeRedirect
		}
		add(base+libTVCallbackPath, mode)
	}
	if origin := normalizeLibTVLoopbackOrigin(originHint); origin != "" {
		add(origin+libTVCallbackPath, libTVCallbackModeRedirect)
	}
	add(libTVPasteRedirectURI, libTVCallbackModePaste)
	return candidates
}

func preferredLibTVRedirectURI(originHint string) (string, string) {
	candidates := libTVRedirectCandidates(originHint)
	if len(candidates) == 0 {
		return libTVPasteRedirectURI, libTVCallbackModePaste
	}
	for _, candidate := range candidates {
		if candidate.Mode == libTVCallbackModeRedirect {
			return candidate.URI, candidate.Mode
		}
	}
	return candidates[0].URI, candidates[0].Mode
}

func libTVPublicBaseURL() string {
	return strings.TrimRight(strings.TrimSpace(os.Getenv("CANVAS_PUBLIC_BASE_URL")), "/")
}

func normalizeLibTVLoopbackOrigin(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	if parsed.Scheme != "http" {
		return ""
	}
	host, port, err := net.SplitHostPort(parsed.Host)
	if err != nil || port == "" {
		return ""
	}
	if !isLibTVLoopbackHost(host) {
		return ""
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return ""
	}
	return "http://" + net.JoinHostPort(host, port)
}

func isLibTVLoopbackHTTPBase(raw string) bool {
	return normalizeLibTVLoopbackOrigin(raw) != ""
}

func isLibTVLoopbackHost(host string) bool {
	host = strings.TrimSpace(strings.ToLower(host))
	switch host {
	case "127.0.0.1", "localhost", "::1", "[::1]":
		return true
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && ip.IsLoopback()
}

func libTVApplicationType(redirectURI string) string {
	if isLibTVLoopbackHTTPBase(strings.TrimSuffix(redirectURI, libTVCallbackPath)) || strings.HasPrefix(redirectURI, "http://127.0.0.1:") || strings.HasPrefix(redirectURI, "http://localhost:") || strings.HasPrefix(redirectURI, "http://[::1]:") {
		return "native"
	}
	return "web"
}

func supportsPKCES256(methods []string) bool {
	for _, method := range methods {
		if strings.EqualFold(strings.TrimSpace(method), "S256") {
			return true
		}
	}
	return false
}

func isLibTVDisallowedRedirect(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "invalid_redirect_uri") || strings.Contains(msg, "redirect uri is not allowed")
}

func libTVOAuthError(prefix string, status int, body []byte) error {
	var payload struct {
		Error     string `json:"error"`
		ErrorDesc string `json:"error_description"`
	}
	_ = json.Unmarshal(body, &payload)
	detail := kernel.FirstNonEmpty(payload.ErrorDesc, payload.Error, fmt.Sprintf("HTTP %d", status))
	if payload.Error != "" && payload.ErrorDesc != "" && !strings.Contains(strings.ToLower(payload.ErrorDesc), strings.ToLower(payload.Error)) {
		detail = payload.Error + ": " + payload.ErrorDesc
	}
	return fmt.Errorf("%s（%s）", prefix, detail)
}

func (rt libTVRuntime) doJSON(req *http.Request, limit int64) ([]byte, int, error) {
	resp, err := rt.client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return nil, resp.StatusCode, err
	}
	if int64(len(body)) > limit {
		return nil, resp.StatusCode, errors.New("LibTV 响应过大")
	}
	return body, resp.StatusCode, nil
}

func libTVCallbackCredentials(req LibTVConnectCompleteRequest) (string, string, error) {
	code := strings.TrimSpace(req.Code)
	state := strings.TrimSpace(req.State)
	if raw := strings.TrimSpace(req.CallbackURL); raw != "" {
		parsedCode, parsedState, err := parseLibTVCallbackURL(raw)
		if err != nil {
			return "", "", err
		}
		if code == "" {
			code = parsedCode
		}
		if state == "" {
			state = parsedState
		}
	}
	if code == "" || state == "" {
		return "", "", kernel.BadAuthRequest("请粘贴包含 code 与 state 的完整回调地址")
	}
	return code, state, nil
}

func parseLibTVCallbackURL(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "?") {
		raw = "http://127.0.0.1/callback" + raw
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.RawQuery == "" {
		return "", "", kernel.BadAuthRequest("回调地址格式无效，请粘贴浏览器地址栏中的完整地址")
	}
	query := parsed.Query()
	if errCode := strings.TrimSpace(query.Get("error")); errCode != "" {
		desc := strings.TrimSpace(query.Get("error_description"))
		if desc == "" {
			desc = errCode
		}
		return "", "", kernel.BadAuthRequest("LibTV 授权未完成：" + desc)
	}
	code := strings.TrimSpace(query.Get("code"))
	state := strings.TrimSpace(query.Get("state"))
	if code == "" || state == "" {
		return "", "", kernel.BadAuthRequest("回调地址缺少 code 或 state")
	}
	return code, state, nil
}

func libTVCallbackHint(mode, redirectURI string) string {
	if mode == libTVCallbackModeRedirect {
		return "将打开 LibTV 授权页，请用微信扫码。完成后会自动回到影策。"
	}
	return "LibTV 目前只接受本机回环地址（http://127.0.0.1 或 localhost）作为 OAuth 回调，不接受公网 IP 或域名。请在微信扫码后，把浏览器地址栏中以 " + redirectURI + " 开头的完整地址粘贴回来。"
}

func libTVOAuthHTML(ok bool, message string) string {
	title := "LibTV 授权失败"
	color := "#c33"
	if ok {
		title = "LibTV 授权完成"
		color = "#1677ff"
	}
	status := "error"
	if ok {
		status = "success"
	}
	return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>` + html.EscapeString(title) + `</title>` +
		`<body style="font:16px/1.7 system-ui,sans-serif;padding:48px;color:#111;background:#fff">` +
		`<h2 style="color:` + color + `">` + html.EscapeString(title) + `</h2>` +
		`<p>` + html.EscapeString(message) + `</p>` +
		`<script>try{if(window.opener){window.opener.postMessage({source:"yingce-libtv-oauth",status:` + fmt.Sprintf("%q", status) + `},window.location.origin);} }catch(e){} setTimeout(function(){window.close();},800);</script>` +
		`</body></html>`
}

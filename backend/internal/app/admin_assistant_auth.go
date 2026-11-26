package app

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const AssistantAPIPath = "/api/admin-assistant"

const AssistantFullAccess = "full_access"
const AssistantRequestApproval = "request_approval"

func assistantApprovalMode(mode string) (string, error) {
	if mode == "" {
		return AssistantRequestApproval, nil
	}
	if mode != AssistantFullAccess && mode != AssistantRequestApproval {
		return "", BadAuthRequest("未知授权模式")
	}
	return mode, nil
}

type AssistantPrincipal struct {
	User       *model.User
	Credential *model.AssistantCredential
	Scopes     []string
}
type AssistantTokenRequest struct {
	ApprovalMode string   `json:"approvalMode"`
	Name         string   `json:"name"`
	Scopes       []string `json:"scopes"`
	Days         int      `json:"days"`
}
type AssistantTokenView struct {
	model.AssistantCredential
	Scopes []string `json:"scopes"`
}
type AssistantGrantView struct {
	model.AssistantGrant
	Scopes []string `json:"scopes"`
}
type AssistantOAuthRequest struct {
	ApprovalMode    string `json:"approvalMode,omitempty"`
	ClientID        string `json:"client_id"`
	RedirectURI     string `json:"redirect_uri"`
	ResponseType    string `json:"response_type"`
	Resource        string `json:"resource"`
	Scope           string `json:"scope"`
	State           string `json:"state"`
	Challenge       string `json:"code_challenge"`
	ChallengeMethod string `json:"code_challenge_method"`
}
type AssistantOAuthTokenRequest struct {
	GrantType    string `json:"grant_type"`
	ClientID     string `json:"client_id"`
	Code         string `json:"code"`
	RedirectURI  string `json:"redirect_uri"`
	Verifier     string `json:"code_verifier"`
	Resource     string `json:"resource"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}
type AssistantOAuthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
}

func assistantSecret() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}
func assistantHash(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func assistantJSON(v any) string    { b, _ := json.Marshal(v); return string(b) }
func assistantScopes(raw string) []string {
	var s []string
	_ = json.Unmarshal([]byte(raw), &s)
	return s
}

// A configured canonical origin prevents Host-header poisoning of OAuth metadata.
func AssistantBaseURL() (string, error) {
	raw := strings.TrimRight(strings.TrimSpace(os.Getenv("CANVAS_PUBLIC_BASE_URL")), "/")
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Path != "" || u.Opaque != "" {
		return "", NewAppError(503, "请配置 CANVAS_PUBLIC_BASE_URL 为站点公网地址")
	}
	if u.Scheme != "https" && (u.Scheme != "http" || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1" && u.Hostname() != "[::1]" && u.Hostname() != "::1")) {
		return "", NewAppError(503, "Agent 接入要求 HTTPS 公网地址")
	}
	return raw, nil
}
func AssistantResource() (string, error) {
	base, err := AssistantBaseURL()
	return base + AssistantAPIPath + "/mcp", err
}

func assistantOAuthResource(requested string) (string, error) {
	resource, err := AssistantResource()
	if err != nil {
		return "", err
	}
	// Clients without RFC 8707 support are bound to this server's only resource.
	if requested != "" && requested != resource {
		return "", BadAuthRequest("resource 不匹配")
	}
	return resource, nil
}

func (s *Service) assistantAdmin(user *model.User) (*model.User, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	u, err := s.repo.User(user.ID)
	if err != nil {
		return nil, Unauthorized("账号不可用")
	}
	if u.Status != model.UserStatusActive {
		return nil, Forbidden("账号已停用")
	}
	if err = s.RequireAdmin(u); err != nil {
		return nil, err
	}
	return u, nil
}
func (s *Service) AssistantScopeOptions() []string {
	set := map[string]bool{}
	for _, op := range assistantCatalog() {
		set[op.Module+":read"] = true
		set[op.Module+":write"] = true
	}
	list := []string{}
	for scope := range set {
		list = append(list, scope)
	}
	sort.Strings(list)
	return list
}
func (s *Service) validateAssistantScopes(scopes []string, defaultRead bool) ([]string, error) {
	allowed := map[string]bool{}
	for _, v := range s.AssistantScopeOptions() {
		allowed[v] = true
	}
	if len(scopes) == 0 && defaultRead {
		for v := range allowed {
			if strings.HasSuffix(v, ":read") {
				scopes = append(scopes, v)
			}
		}
	}
	if len(scopes) == 0 {
		return nil, BadAuthRequest("请选择权限")
	}
	set := map[string]bool{}
	for _, v := range scopes {
		if !allowed[v] {
			return nil, BadAuthRequest("未知权限")
		}
		set[v] = true
	}
	out := []string{}
	for v := range set {
		out = append(out, v)
	}
	sort.Strings(out)
	return out, nil
}
func (s *Service) CreateAssistantToken(actor *model.User, req AssistantTokenRequest) (*AssistantTokenView, string, error) {
	u, err := s.assistantAdmin(actor)
	if err != nil {
		return nil, "", err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || len(name) > 120 {
		return nil, "", BadAuthRequest("名称应为 1–120 字节")
	}
	mode, err := assistantApprovalMode(req.ApprovalMode)
	if err != nil {
		return nil, "", err
	}
	requestedScopes := req.Scopes
	if mode == AssistantFullAccess {
		requestedScopes = s.AssistantScopeOptions()
	}
	scopes, err := s.validateAssistantScopes(requestedScopes, true)
	if err != nil {
		return nil, "", err
	}
	if req.Days == 0 {
		req.Days = 30
	}
	if req.Days < 1 || req.Days > 365 {
		return nil, "", BadAuthRequest("有效期应为 1–365 天")
	}
	active, err := s.repo.AssistantActiveCredentialCount(u.ID)
	if err != nil {
		return nil, "", err
	}
	if active >= 100 {
		return nil, "", BadAuthRequest("请先撤销不再使用的 Token")
	}
	secret := "cat_" + assistantSecret()
	now := time.Now()
	row := &model.AssistantCredential{ID: newID(), UserID: u.ID, Name: name, TokenHash: assistantHash(secret), ScopesJSON: assistantJSON(scopes), ApprovalMode: mode, CreatedAt: now, ExpiresAt: now.Add(time.Duration(req.Days) * 24 * time.Hour)}
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		if e := tx.CreateAssistantRecord(row); e != nil {
			return e
		}
		event, e := newAdminAuditEvent(u, "assistant.token.create", "assistant_credential", row.ID, "创建管理 Token", map[string]any{"scopes": scopes, "approvalMode": mode, "expiresAt": row.ExpiresAt})
		if e != nil {
			return e
		}
		return tx.AppendAdminAudit(event)
	})
	if err != nil {
		return nil, "", err
	}
	return &AssistantTokenView{AssistantCredential: *row, Scopes: scopes}, secret, nil
}
func assistantAccessPage(page int) (int, error) {
	if page < 1 {
		page = 1
	}
	if page > 10000 {
		return 0, BadAuthRequest("页码过大")
	}
	return page, nil
}
func (s *Service) AssistantTokens(actor *model.User, page int) ([]AssistantTokenView, bool, error) {
	u, err := s.assistantAdmin(actor)
	if err != nil {
		return nil, false, err
	}
	page, err = assistantAccessPage(page)
	if err != nil {
		return nil, false, err
	}
	rows, more, err := s.repo.AssistantCredentials(u.ID, page)
	out := []AssistantTokenView{}
	for _, r := range rows {
		r.ApprovalMode, _ = assistantApprovalMode(r.ApprovalMode)
		out = append(out, AssistantTokenView{r, assistantScopes(r.ScopesJSON)})
	}
	return out, more, err
}
func (s *Service) AssistantGrants(actor *model.User, page int) ([]AssistantGrantView, bool, error) {
	u, err := s.assistantAdmin(actor)
	if err != nil {
		return nil, false, err
	}
	page, err = assistantAccessPage(page)
	if err != nil {
		return nil, false, err
	}
	rows, more, err := s.repo.AssistantGrants(u.ID, page)
	out := []AssistantGrantView{}
	for _, r := range rows {
		r.ApprovalMode, _ = assistantApprovalMode(r.ApprovalMode)
		out = append(out, AssistantGrantView{r, assistantScopes(r.ScopesJSON)})
	}
	return out, more, err
}
func (s *Service) RevokeAssistantAccess(actor *model.User, id string, grant bool) error {
	u, err := s.assistantAdmin(actor)
	if err != nil {
		return err
	}
	return s.repo.Transaction(func(tx *repository.Repository) error {
		if grant {
			err = tx.RevokeAssistantGrant(u.ID, id)
		} else {
			err = tx.RevokeAssistantCredential(u.ID, id)
		}
		if err != nil {
			return err
		}
		event, e := newAdminAuditEvent(u, "assistant.access.revoke", "assistant_access", id, "撤销 Agent 访问", nil)
		if e != nil {
			return e
		}
		return tx.AppendAdminAudit(event)
	})
}

func (s *Service) UpdateAssistantAuthorization(actor *model.User, id, mode string, grant bool) error {
	u, err := s.assistantAdmin(actor)
	if err != nil {
		return err
	}
	if mode != AssistantFullAccess && mode != AssistantRequestApproval {
		return BadAuthRequest("请选择有效授权模式")
	}
	scopes := ""
	if mode == AssistantFullAccess {
		scopes = assistantJSON(s.AssistantScopeOptions())
	}
	return s.repo.Transaction(func(tx *repository.Repository) error {
		if err := tx.UpdateAssistantAuthorization(u.ID, id, mode, scopes, grant); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return NotFound("有效授权不存在")
			}
			return err
		}
		event, err := newAdminAuditEvent(u, "assistant.authorization.update", "assistant_access", id, "修改 Agent 授权模式", map[string]any{"approvalMode": mode, "grant": grant})
		if err != nil {
			return err
		}
		return tx.AppendAdminAudit(event)
	})
}
func (s *Service) AuthenticateAssistant(token string) (*AssistantPrincipal, error) {
	if len(token) < 30 || len(token) > 256 {
		return nil, Unauthorized("无效的管理 Token")
	}
	row, err := s.repo.AssistantCredential(assistantHash(token))
	if err != nil || row.RevokedAt != nil || !row.ExpiresAt.After(time.Now()) {
		return nil, Unauthorized("管理 Token 已失效")
	}
	u, err := s.assistantAdmin(&model.User{ID: row.UserID})
	if err != nil {
		return nil, err
	}
	if row.GrantID != "" {
		g, e := s.repo.AssistantGrant(row.GrantID)
		if e != nil || g.RevokedAt != nil || !g.ExpiresAt.After(time.Now()) {
			return nil, Unauthorized("授权已撤销")
		}
		row.ApprovalMode, row.ScopesJSON = g.ApprovalMode, g.ScopesJSON
	}
	return &AssistantPrincipal{u, row, assistantScopes(row.ScopesJSON)}, nil
}

func validAssistantRedirect(raw string) bool {
	if len(raw) > 2048 {
		return false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.Fragment != "" || u.Opaque != "" {
		return false
	}
	return u.Scheme == "https" || (u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost" || u.Hostname() == "::1"))
}
func (s *Service) RegisterAssistantClient(name string, redirects []string) (*model.AssistantOAuthClient, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 120 || len(redirects) == 0 || len(redirects) > 10 {
		return nil, BadAuthRequest("无效的 OAuth 客户端")
	}
	for _, uri := range redirects {
		if !validAssistantRedirect(uri) {
			return nil, BadAuthRequest("redirect_uri 必须是 HTTPS 或本机回环 HTTP 地址")
		}
	}
	row := &model.AssistantOAuthClient{ID: "canvas_" + assistantSecret(), Name: name, RedirectURIsJSON: assistantJSON(redirects), CreatedAt: time.Now()}
	return row, s.repo.CreateAssistantRecord(row)
}
func (s *Service) assistantClient(id string) (*model.AssistantOAuthClient, error) {
	// Static clients use the same validation and are never overwritten by DCR.
	var configured []struct {
		ID        string   `json:"client_id"`
		Name      string   `json:"client_name"`
		Redirects []string `json:"redirect_uris"`
	}
	if raw := os.Getenv("CANVAS_ADMIN_ASSISTANT_OAUTH_CLIENTS"); raw != "" {
		if json.Unmarshal([]byte(raw), &configured) != nil {
			return nil, NewAppError(503, "预注册 OAuth 客户端配置无效")
		}
	}
	for _, c := range configured {
		if c.ID == id {
			if len(c.Redirects) == 0 {
				return nil, BadAuthRequest("客户端未配置回调")
			}
			for _, uri := range c.Redirects {
				if !validAssistantRedirect(uri) {
					return nil, BadAuthRequest("客户端回调无效")
				}
			}
			return &model.AssistantOAuthClient{ID: c.ID, Name: c.Name, RedirectURIsJSON: assistantJSON(c.Redirects)}, nil
		}
	}
	return s.repo.AssistantClient(id)
}

var assistantPKCE = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var assistantVerifier = regexp.MustCompile(`^[A-Za-z0-9._~-]{43,128}$`)

func (s *Service) PreviewAssistantAuthorization(actor *model.User, req AssistantOAuthRequest) (map[string]any, error) {
	if _, err := s.assistantAdmin(actor); err != nil {
		return nil, err
	}
	client, scopes, err := s.validateAssistantAuthorization(&req)
	if err != nil {
		return nil, err
	}
	return map[string]any{"clientId": client.ID, "clientName": client.Name, "redirectUri": req.RedirectURI, "scopes": scopes, "scopeOptions": s.AssistantScopeOptions(), "resource": req.Resource, "approvalMode": AssistantRequestApproval}, nil
}
func (s *Service) validateAssistantAuthorization(req *AssistantOAuthRequest) (*model.AssistantOAuthClient, []string, error) {
	resource, err := assistantOAuthResource(req.Resource)
	if err != nil {
		return nil, nil, err
	}
	req.Resource = resource
	if req.ResponseType != "code" || req.ChallengeMethod != "S256" || !assistantPKCE.MatchString(req.Challenge) || len(req.State) > 2048 {
		return nil, nil, BadAuthRequest("无效的 OAuth 授权参数")
	}
	client, err := s.assistantClient(req.ClientID)
	if err != nil {
		return nil, nil, BadAuthRequest("未知 OAuth 客户端")
	}
	allowed := false
	for _, uri := range assistantScopes(client.RedirectURIsJSON) {
		if uri == req.RedirectURI {
			allowed = true
		}
	}
	if !allowed {
		return nil, nil, BadAuthRequest("回调地址未注册")
	}
	scopes, err := s.validateAssistantScopes(strings.Fields(req.Scope), true)
	return client, scopes, err
}
func (s *Service) AuthorizeAssistant(actor *model.User, req AssistantOAuthRequest, approve bool) (string, error) {
	u, err := s.assistantAdmin(actor)
	if err != nil {
		return "", err
	}
	_, scopes, err := s.validateAssistantAuthorization(&req)
	if err != nil {
		return "", err
	}
	callback, _ := url.Parse(req.RedirectURI)
	q := callback.Query()
	q.Set("state", req.State)
	if !approve {
		q.Set("error", "access_denied")
		callback.RawQuery = q.Encode()
		return callback.String(), nil
	}
	mode, err := assistantApprovalMode(req.ApprovalMode)
	if err != nil {
		return "", err
	}
	if mode == AssistantFullAccess {
		scopes = s.AssistantScopeOptions()
	}
	code := assistantSecret()
	row := &model.AssistantOAuthCode{ID: assistantHash(code), ClientID: req.ClientID, UserID: u.ID, RedirectURI: req.RedirectURI, Resource: req.Resource, Challenge: req.Challenge, ScopesJSON: assistantJSON(scopes), ApprovalMode: mode, ExpiresAt: time.Now().Add(5 * time.Minute)}
	if err = s.repo.CreateAssistantRecord(row); err != nil {
		return "", err
	}
	q.Set("code", code)
	callback.RawQuery = q.Encode()
	return callback.String(), nil
}
func (s *Service) ExchangeAssistantToken(req AssistantOAuthTokenRequest) (*AssistantOAuthTokenResponse, error) {
	resource, err := assistantOAuthResource(req.Resource)
	if err != nil {
		return nil, err
	}
	req.Resource = resource
	if _, err = s.assistantClient(req.ClientID); err != nil {
		return nil, BadAuthRequest("未知 OAuth 客户端")
	}
	if req.GrantType == "refresh_token" {
		return s.refreshAssistantToken(req)
	}
	if req.GrantType != "authorization_code" || !assistantVerifier.MatchString(req.Verifier) {
		return nil, BadAuthRequest("无效的授权码或 PKCE")
	}
	code, err := s.repo.AssistantCode(assistantHash(req.Code))
	if err != nil || code.ConsumedAt != nil || !code.ExpiresAt.After(time.Now()) || code.ClientID != req.ClientID || code.RedirectURI != req.RedirectURI || code.Resource != req.Resource {
		return nil, BadAuthRequest("授权码已失效")
	}
	h := sha256.Sum256([]byte(req.Verifier))
	if base64.RawURLEncoding.EncodeToString(h[:]) != code.Challenge {
		return nil, BadAuthRequest("PKCE 校验失败")
	}
	u, err := s.assistantAdmin(&model.User{ID: code.UserID})
	if err != nil {
		return nil, err
	}
	now := time.Now()
	refresh := "car_" + assistantSecret()
	grant := &model.AssistantGrant{ID: newID(), UserID: u.ID, ClientID: req.ClientID, ScopesJSON: code.ScopesJSON, ApprovalMode: code.ApprovalMode, CreatedAt: now, ExpiresAt: now.Add(30 * 24 * time.Hour), RefreshHash: assistantHash(refresh)}
	access, row := assistantAccessToken(grant, now)
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		if e := tx.ConsumeAssistantCode(code.ID, now); e != nil {
			return e
		}
		if e := tx.CreateAssistantRecord(grant); e != nil {
			return e
		}
		if e := tx.CreateAssistantRecord(row); e != nil {
			return e
		}
		event, e := newAdminAuditEvent(u, "assistant.oauth.authorize", "assistant_grant", grant.ID, "授权 Agent 客户端", map[string]any{"clientId": req.ClientID, "approvalMode": grant.ApprovalMode, "scopes": assistantScopes(grant.ScopesJSON)})
		if e != nil {
			return e
		}
		return tx.AppendAdminAudit(event)
	})
	if err != nil {
		return nil, BadAuthRequest("授权码已使用或授权失败")
	}
	return &AssistantOAuthTokenResponse{access, "Bearer", 3600, refresh, strings.Join(assistantScopes(grant.ScopesJSON), " ")}, nil
}
func assistantAccessToken(grant *model.AssistantGrant, now time.Time) (string, *model.AssistantCredential) {
	access := "caa_" + assistantSecret()
	expires := now.Add(time.Hour)
	if grant.ExpiresAt.Before(expires) {
		expires = grant.ExpiresAt
	}
	return access, &model.AssistantCredential{ID: newID(), UserID: grant.UserID, Name: "OAuth: " + grant.ClientID, TokenHash: assistantHash(access), GrantID: grant.ID, ScopesJSON: grant.ScopesJSON, ApprovalMode: grant.ApprovalMode, CreatedAt: now, ExpiresAt: expires}
}
func (s *Service) refreshAssistantToken(req AssistantOAuthTokenRequest) (*AssistantOAuthTokenResponse, error) {
	old := assistantHash(req.RefreshToken)
	grant, err := s.repo.AssistantGrantByRefresh(old)
	if err != nil {
		if used, e := s.repo.AssistantRefreshUse(old); e == nil {
			if g, e := s.repo.AssistantGrant(used.GrantID); e == nil && g.ClientID == req.ClientID {
				_ = s.repo.RevokeAssistantGrant(g.UserID, g.ID)
			}
		}
		return nil, BadAuthRequest("refresh token 已失效")
	}
	if grant.ClientID != req.ClientID || grant.RevokedAt != nil || !grant.ExpiresAt.After(time.Now()) {
		return nil, BadAuthRequest("授权已失效")
	}
	if req.Scope != "" && req.Scope != strings.Join(assistantScopes(grant.ScopesJSON), " ") {
		// 用户在网页升级授权后，客户端可能仍携带旧的只读 scope；不得因此强制重新登录。
		// 只接受当前 grant 已有范围的子集；切回逐次确认后也兼容客户端缓存，不能自行扩大授权。
		allowed := map[string]bool{}
		for _, scope := range assistantScopes(grant.ScopesJSON) {
			allowed[scope] = true
		}
		for _, scope := range strings.Fields(req.Scope) {
			if !allowed[scope] {
				return nil, BadAuthRequest("刷新时不可更改权限")
			}
		}
	}
	if _, err = s.assistantAdmin(&model.User{ID: grant.UserID}); err != nil {
		return nil, err
	}
	now := time.Now()
	refresh := "car_" + assistantSecret()
	var access string
	var row *model.AssistantCredential
	err = s.repo.Transaction(func(tx *repository.Repository) error {
		if e := tx.RotateAssistantRefresh(grant.ID, old, assistantHash(refresh), now); e != nil {
			return e
		}
		// 轮换 UPDATE 持有授权行锁后重新读取，避免模式修改与刷新交错产生旧权限凭证。
		var e error
		grant, e = tx.AssistantGrant(grant.ID)
		if e != nil {
			return e
		}
		access, row = assistantAccessToken(grant, now)
		return tx.CreateAssistantRecord(row)
	})
	if err != nil {
		if errors.Is(err, repository.ErrAssistantConflict) || errors.Is(err, gorm.ErrDuplicatedKey) {
			_ = s.repo.RevokeAssistantGrant(grant.UserID, grant.ID)
		}
		return nil, BadAuthRequest("刷新失败，请重新授权")
	}
	return &AssistantOAuthTokenResponse{access, "Bearer", int(time.Until(row.ExpiresAt).Seconds()), refresh, strings.Join(assistantScopes(grant.ScopesJSON), " ")}, nil
}

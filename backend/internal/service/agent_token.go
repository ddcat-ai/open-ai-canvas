package service

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

// ---------------------------------------------------------------------------
// D-057A：Agent Service Token
//
// 定位：**安全基础设施，不是业务事实源**。它只回答"这个请求是谁、能碰哪些接口"，
// 不承载任何生产语义，也不参与影策的业务事实判定（那是 Domain Tool / nxf / 生产服务的事）。
//
// 与 x-canvas-agent-token 的关系（裁决硬约束）：
//
//	Runtime token  = canvas-agent ↔ runtime 内部信任（现有 x-canvas-agent-token）
//	Service token  = canvas-agent → 影策生产 API（本文件实现的 Agent Service Token）
//
// 两者不复用、不共享 scope、不互换用途、不进日志。
// ---------------------------------------------------------------------------

// 作用域目录。命名按裁决：yingce.<domain>.<action>。
const (
	AgentScopeShotRead             = "yingce.shot.read"
	AgentScopeShotWrite            = "yingce.shot.write"
	AgentScopeGenerationSubmit     = "yingce.generation.submit"
	AgentScopeGenerationRetry      = "yingce.generation.retry"
	AgentScopeGenerationRegenerate = "yingce.generation.regenerate"
	AgentScopeArtifactSelect       = "yingce.artifact.select"
	AgentScopeShotReview           = "yingce.shot.review"
)

// AgentScopeCatalog 是允许签发的全部作用域。**没有 admin scope**（裁决：不给 admin scope）。
var AgentScopeCatalog = []string{
	AgentScopeShotRead,
	AgentScopeShotWrite,
	AgentScopeGenerationSubmit,
	AgentScopeGenerationRetry,
	AgentScopeGenerationRegenerate,
	AgentScopeArtifactSelect,
	AgentScopeShotReview,
}

func isKnownAgentScope(scope string) bool {
	for _, item := range AgentScopeCatalog {
		if item == scope {
			return true
		}
	}
	return false
}

// AgentTokenSecretPrefix 仅用于肉眼识别"这是个影策 Agent 令牌"，不含任何语义。
const AgentTokenSecretPrefix = "ycat_"

var (
	ErrAgentTokenInvalid = &AppError{Status: 401, Code: 401, Message: "Agent 服务令牌无效"}
	ErrAgentTokenExpired = &AppError{Status: 401, Code: 401, Message: "Agent 服务令牌已过期"}
	ErrAgentTokenRevoked = &AppError{Status: 401, Code: 401, Message: "Agent 服务令牌已被吊销"}
	// Scope 缺失是"身份有效但权限不足"→ 403，与"身份不可用"的 401 严格区分。
	ErrAgentTokenScopeMissing = &AppError{Status: 403, Code: 403, Message: "Agent 服务令牌缺少所需作用域"}
	ErrAgentTokenAdminDenied  = &AppError{Status: 403, Code: 403, Message: "Agent 服务令牌不得访问管理端接口"}
)

// AgentTokenView 是签发/列举时返回给调用方的视图，**不含 hash，也不含明文**。
type AgentTokenView struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	TokenPrefix string     `json:"tokenPrefix"`
	Scopes      []string   `json:"scopes"`
	ExpiresAt   *time.Time `json:"expiresAt"`
	RevokedAt   *time.Time `json:"revokedAt"`
	LastUsedAt  *time.Time `json:"lastUsedAt"`
	CreatedAt   time.Time  `json:"createdAt"`
}

func agentTokenView(token model.AgentToken) AgentTokenView {
	return AgentTokenView{
		ID:          token.ID,
		Name:        token.Name,
		TokenPrefix: token.TokenPrefix,
		Scopes:      AgentTokenScopes(&token),
		ExpiresAt:   token.ExpiresAt,
		RevokedAt:   token.RevokedAt,
		LastUsedAt:  token.LastUsedAt,
		CreatedAt:   token.CreatedAt,
	}
}

// AgentTokenScopes 解析持久化的 scope JSON。坏数据按"无作用域"处理（宁可少给，不可多给）。
func AgentTokenScopes(token *model.AgentToken) []string {
	if token == nil || strings.TrimSpace(token.ScopesJSON) == "" {
		return nil
	}
	var scopes []string
	if err := json.Unmarshal([]byte(token.ScopesJSON), &scopes); err != nil {
		return nil
	}
	clean := make([]string, 0, len(scopes))
	seen := map[string]struct{}{}
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if !isKnownAgentScope(scope) {
			continue
		}
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		clean = append(clean, scope)
	}
	sort.Strings(clean)
	return clean
}

// AgentTokenHasScope 判定令牌是否持有指定作用域。
func AgentTokenHasScope(token *model.AgentToken, scope string) bool {
	for _, item := range AgentTokenScopes(token) {
		if item == scope {
			return true
		}
	}
	return false
}

func newAgentTokenSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return AgentTokenSecretPrefix + base64.RawURLEncoding.EncodeToString(buf), nil
}

// IssueAgentToken 签发一枚服务令牌。
// 返回的明文 secret **只此一次**，数据库只落 hash(secret)。
func (s *Service) IssueAgentToken(userID string, name string, scopes []string, ttl time.Duration) (AgentTokenView, string, error) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return AgentTokenView{}, "", &AppError{Status: 400, Code: 400, Message: "缺少用户身份"}
	}
	clean := make([]string, 0, len(scopes))
	seen := map[string]struct{}{}
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if scope == "" {
			continue
		}
		if !isKnownAgentScope(scope) {
			return AgentTokenView{}, "", &AppError{Status: 400, Code: 400, Message: "未知作用域：" + scope}
		}
		if _, ok := seen[scope]; ok {
			continue
		}
		seen[scope] = struct{}{}
		clean = append(clean, scope)
	}
	if len(clean) == 0 {
		return AgentTokenView{}, "", &AppError{Status: 400, Code: 400, Message: "至少需要一个作用域"}
	}
	sort.Strings(clean)
	encoded, err := json.Marshal(clean)
	if err != nil {
		return AgentTokenView{}, "", &AppError{Status: 500, Code: 500, Message: "作用域序列化失败：" + err.Error()}
	}
	secret, err := newAgentTokenSecret()
	if err != nil {
		return AgentTokenView{}, "", &AppError{Status: 500, Code: 500, Message: "令牌生成失败（熵源不可用）"}
	}
	now := time.Now()
	record := &model.AgentToken{
		ID:          newID(),
		UserID:      userID,
		Name:        strings.TrimSpace(name),
		TokenHash:   hashToken(secret),
		TokenPrefix: secret[:12],
		ScopesJSON:  string(encoded),
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if ttl > 0 {
		expires := now.Add(ttl)
		record.ExpiresAt = &expires
	}
	if err := s.repo.CreateAgentToken(record); err != nil {
		return AgentTokenView{}, "", &AppError{Status: 500, Code: 500, Message: "令牌落库失败"}
	}
	return agentTokenView(*record), secret, nil
}

func (s *Service) ListAgentTokens(userID string) ([]AgentTokenView, error) {
	tokens, err := s.repo.AgentTokensByUser(userID)
	if err != nil {
		return nil, &AppError{Status: 500, Code: 500, Message: "读取令牌列表失败"}
	}
	views := make([]AgentTokenView, 0, len(tokens))
	for _, token := range tokens {
		views = append(views, agentTokenView(token))
	}
	return views, nil
}

func (s *Service) RevokeAgentToken(userID string, id string) error {
	ok, err := s.repo.RevokeAgentToken(id, userID, time.Now())
	if err != nil {
		return &AppError{Status: 500, Code: 500, Message: "吊销令牌失败"}
	}
	if !ok {
		return &AppError{Status: 404, Code: 404, Message: "令牌不存在或已被吊销"}
	}
	return nil
}

// ResolveAgentToken 校验明文令牌：hash 查找 → 吊销检查 → 过期检查。
// 只做凭据判定，不做任何业务语义判断。
func (s *Service) ResolveAgentToken(secret string) (*model.AgentToken, error) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, ErrAgentTokenInvalid
	}
	record, err := s.repo.AgentTokenByHash(hashToken(secret))
	if err != nil {
		return nil, &AppError{Status: 500, Code: 500, Message: "令牌校验失败"}
	}
	if record == nil {
		return nil, ErrAgentTokenInvalid
	}
	if record.RevokedAt != nil {
		return nil, ErrAgentTokenRevoked
	}
	if record.ExpiresAt != nil && !record.ExpiresAt.After(time.Now()) {
		return nil, ErrAgentTokenExpired
	}
	return record, nil
}

// AgentTokenPrincipal 取回令牌绑定的用户；用户被禁用则令牌立即失效。
func (s *Service) AgentTokenPrincipal(token *model.AgentToken) (*model.User, error) {
	user, err := s.repo.AgentTokenUserByID(token.UserID)
	if err != nil {
		return nil, &AppError{Status: 500, Code: 500, Message: "解析令牌归属失败"}
	}
	if user == nil {
		return nil, ErrAgentTokenInvalid
	}
	if user.Status != model.UserStatusActive {
		return nil, ErrAgentTokenInvalid
	}
	return user, nil
}

// TouchAgentToken 记录最近使用时间。审计用途，失败不影响主流程（不因写审计而拒绝请求）。
func (s *Service) TouchAgentToken(token *model.AgentToken) {
	_ = s.repo.MarkAgentTokenUsed(token.ID, time.Now())
}

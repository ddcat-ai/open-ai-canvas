package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// D-057A：Agent Service Token 管理接口 + Bearer 鉴权通道
//
// 管理接口（签发/列举/吊销）只能用**会话登录态**访问：
// 令牌不能自己给自己发令牌，避免凭据自我增殖。
// ---------------------------------------------------------------------------

const (
	ctxKeyAgentUser  = "agentUser"
	ctxKeyAgentToken = "agentToken"
)

type issueAgentTokenRequest struct {
	Name     string   `json:"name"`
	Scopes   []string `json:"scopes"`
	TTLHours int      `json:"ttlHours"`
}

func RegisterAgentTokenRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/agent-tokens", func(c *gin.Context) {
		user, err := sessionUserOnly(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req issueAgentTokenRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ttl := time.Duration(0)
		if req.TTLHours > 0 {
			ttl = time.Duration(req.TTLHours) * time.Hour
		}
		view, secret, err := svc.IssueAgentToken(user.ID, req.Name, req.Scopes, ttl)
		if err != nil {
			failService(c, err)
			return
		}
		// 明文 secret 只在签发响应里出现一次，之后任何接口都拿不到。
		ok(c, gin.H{"token": view, "secret": secret})
	})

	r.GET("/agent-tokens", func(c *gin.Context) {
		user, err := sessionUserOnly(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		views, err := svc.ListAgentTokens(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"tokens": views, "availableScopes": service.AgentScopeCatalog})
	})

	r.DELETE("/agent-tokens/:id", func(c *gin.Context) {
		user, err := sessionUserOnly(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RevokeAgentToken(user.ID, strings.TrimSpace(c.Param("id"))); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"revoked": true})
	})
}

// sessionUserOnly 只允许会话登录态；Agent 服务令牌不得触碰令牌管理接口。
func sessionUserOnly(c *gin.Context, svc *service.Service) (*model.User, error) {
	if _, ok := agentUserFromContext(c); ok {
		return nil, service.ErrAgentTokenAdminDenied
	}
	return svc.CurrentUser(sessionCookie(c))
}

// AgentTokenMiddleware 解析 `Authorization: Bearer <agent service token>`。
//
// 触发条件刻意保守——只有「没有会话 cookie + 带 Bearer + 前缀是影策 Agent 令牌」才接管，
// 其余请求原样放行，确保不改变任何既有鉴权行为。
func AgentTokenMiddleware(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		if strings.TrimSpace(sessionCookie(c)) != "" {
			c.Next()
			return
		}
		header := strings.TrimSpace(c.GetHeader("Authorization"))
		if len(header) < 7 || !strings.EqualFold(header[:7], "bearer ") {
			c.Next()
			return
		}
		secret := strings.TrimSpace(header[7:])
		if !strings.HasPrefix(secret, service.AgentTokenSecretPrefix) {
			c.Next()
			return
		}
		token, err := svc.ResolveAgentToken(secret)
		if err != nil {
			fail(c, http.StatusUnauthorized, err)
			c.Abort()
			return
		}
		user, err := svc.AgentTokenPrincipal(token)
		if err != nil {
			fail(c, http.StatusUnauthorized, err)
			c.Abort()
			return
		}
		c.Set(ctxKeyAgentUser, user)
		c.Set(ctxKeyAgentToken, token)
		svc.TouchAgentToken(token)
		c.Next()
	}
}

func agentUserFromContext(c *gin.Context) (*model.User, bool) {
	value, exists := c.Get(ctxKeyAgentUser)
	if !exists {
		return nil, false
	}
	user, ok := value.(*model.User)
	return user, ok
}

func agentTokenFromContext(c *gin.Context) (*model.AgentToken, bool) {
	value, exists := c.Get(ctxKeyAgentToken)
	if !exists {
		return nil, false
	}
	token, ok := value.(*model.AgentToken)
	return token, ok
}

// RequireAgentScope 校验 Agent 通道的作用域。
// 会话（浏览器）通道不校验——沿用既有权限模型，避免扩大改动面。
// 返回 nil 表示放行；非 nil 交给 failService 输出（缺失作用域=403）。
func RequireAgentScope(c *gin.Context, scope string) error {
	token, ok := agentTokenFromContext(c)
	if !ok {
		return nil
	}
	if !service.AgentTokenHasScope(token, scope) {
		return service.ErrAgentTokenScopeMissing
	}
	return nil
}

// AgentScopeGuard 供 D-057B 起的新增生产端点挂载作用域门禁。
func AgentScopeGuard(scope string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := RequireAgentScope(c, scope); err != nil {
			failService(c, err)
			c.Abort()
			return
		}
		c.Next()
	}
}

// agentTokenDebugLabel 仅用于日志排障：只输出前缀，绝不输出令牌本体。
func agentTokenDebugLabel(c *gin.Context) string {
	token, ok := agentTokenFromContext(c)
	if !ok {
		return ""
	}
	return token.TokenPrefix + "…(" + strconv.Itoa(len(token.TokenHash)) + ")"
}

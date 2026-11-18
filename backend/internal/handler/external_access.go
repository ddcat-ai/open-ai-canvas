package handler

import (
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func mcpPublicOrigin(c *gin.Context) string {
	configured := strings.TrimRight(strings.TrimSpace(os.Getenv("CANVAS_MCP_PUBLIC_ORIGIN")), "/")
	if configured != "" {
		if parsed, err := url.Parse(configured); err == nil && parsed.Host != "" && parsed.User == nil && parsed.Path == "" && parsed.RawQuery == "" && parsed.Fragment == "" && (parsed.Scheme == "https" || parsed.Scheme == "http") {
			return parsed.Scheme + "://" + parsed.Host
		}
		return ""
	}
	requestURL, err := url.Parse("http://" + c.Request.Host)
	if err != nil || !isMCPLoopback(requestURL.Hostname()) {
		return ""
	}
	scheme := "http"
	if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
		scheme = "https"
	}
	host := c.Request.Host
	if forwarded := c.GetHeader("X-Forwarded-Host"); forwarded != "" {
		if peer := net.ParseIP(c.RemoteIP()); peer != nil && (peer.IsPrivate() || peer.IsLoopback()) {
			parsed, err := url.Parse("http://" + forwarded)
			if err != nil || !isMCPLoopback(parsed.Hostname()) {
				return ""
			}
			host = forwarded
		}
	}
	if strings.ContainsAny(host, " /\\\r\n") {
		return ""
	}
	return scheme + "://" + host
}

func isMCPLoopback(host string) bool {
	ip := net.ParseIP(host)
	return strings.EqualFold(host, "localhost") || ip != nil && ip.IsLoopback()
}

func RegisterMCPDiscoveryRoutes(r *gin.Engine) {
	r.GET("/.well-known/oauth-protected-resource/api/mcp", func(c *gin.Context) {
		origin := mcpPublicOrigin(c)
		if origin == "" {
			c.Status(http.StatusServiceUnavailable)
			return
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, gin.H{"resource": origin + "/api/mcp", "authorization_servers": []string{origin}, "bearer_methods_supported": []string{"header"}, "scopes_supported": []string{"mcp:tools"}})
	})
	r.GET("/.well-known/oauth-authorization-server", func(c *gin.Context) {
		origin := mcpPublicOrigin(c)
		if origin == "" {
			c.Status(http.StatusServiceUnavailable)
			return
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, gin.H{"issuer": origin, "authorization_endpoint": origin + "/mcp/authorize", "token_endpoint": origin + "/api/mcp/oauth/token", "registration_endpoint": origin + "/api/mcp/oauth/register", "response_types_supported": []string{"code"}, "grant_types_supported": []string{"authorization_code"}, "token_endpoint_auth_methods_supported": []string{"none"}, "code_challenge_methods_supported": []string{"S256"}, "scopes_supported": []string{"mcp:tools"}})
	})
}

func oauthFailure(c *gin.Context, status int, code, description string) {
	c.Header("Cache-Control", "no-store")
	c.JSON(status, gin.H{"error": code, "error_description": description})
}

func RegisterExternalAccessRoutes(api *gin.RouterGroup, svc *service.Service) {
	api.GET("/auth/api-keys", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		keys, err := svc.UserAPIKeys(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"keys": keys})
	})
	api.POST("/auth/api-keys", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "api-key-create:"+user.ID, 10, time.Hour) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
		var req struct {
			Name string `json:"name"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		issued, err := svc.CreateUserAPIKey(user.ID, req.Name)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, issued)
	})
	api.POST("/auth/api-keys/:id/revoke", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RevokeUserAPIKey(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"revoked": true})
	})
	api.POST("/mcp/oauth/register", func(c *gin.Context) {
		if !enforceRateLimit(c, "mcp-register:"+c.ClientIP(), 20, time.Hour) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			Name         string   `json:"client_name"`
			RedirectURIs []string `json:"redirect_uris"`
			AuthMethod   string   `json:"token_endpoint_auth_method"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || (req.AuthMethod != "" && req.AuthMethod != "none") {
			oauthFailure(c, 400, "invalid_client_metadata", "客户端信息无效")
			return
		}
		client, err := svc.RegisterMCPClient(req.Name, req.RedirectURIs)
		if err != nil {
			oauthFailure(c, 400, "invalid_redirect_uri", err.Error())
			return
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusCreated, gin.H{"client_id": client.ClientID, "client_name": client.Name, "redirect_uris": req.RedirectURIs, "token_endpoint_auth_method": "none", "grant_types": []string{"authorization_code"}, "response_types": []string{"code"}})
	})
	api.GET("/mcp/oauth/clients/:id", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		client, err := svc.MCPClient(c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"name": client.Name})
	})
	api.POST("/mcp/oauth/consent", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		origin := mcpPublicOrigin(c)
		if origin == "" {
			oauthFailure(c, 503, "temporarily_unavailable", "MCP 公网地址未配置")
			return
		}
		if c.GetHeader("Origin") != origin {
			oauthFailure(c, 403, "access_denied", "授权请求来源无效")
			return
		}
		if !enforceRateLimit(c, "mcp-consent:"+user.ID, 20, time.Hour) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			ClientID        string `json:"client_id"`
			RedirectURI     string `json:"redirect_uri"`
			Challenge       string `json:"code_challenge"`
			ChallengeMethod string `json:"code_challenge_method"`
			Resource        string `json:"resource"`
			State           string `json:"state"`
			ResponseType    string `json:"response_type"`
			Scope           string `json:"scope"`
			Decision        string `json:"decision"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.ResponseType != "code" || req.ChallengeMethod != "S256" || req.Resource != origin+"/api/mcp" || (req.Scope != "" && req.Scope != "mcp:tools") || len(req.State) > 2048 || (req.Decision != "" && req.Decision != "allow" && req.Decision != "deny") {
			oauthFailure(c, 400, "invalid_request", "授权参数无效")
			return
		}
		if req.Decision == "deny" {
			if err := svc.ValidateMCPRedirect(req.ClientID, req.RedirectURI); err != nil {
				oauthFailure(c, 400, "invalid_request", err.Error())
				return
			}
			redirect, _ := url.Parse(req.RedirectURI)
			query := redirect.Query()
			query.Set("error", "access_denied")
			if req.State != "" {
				query.Set("state", req.State)
			}
			redirect.RawQuery = query.Encode()
			c.Header("Cache-Control", "no-store")
			ok(c, gin.H{"redirectUrl": redirect.String()})
			return
		}
		code, err := svc.AuthorizeMCP(user.ID, req.ClientID, req.RedirectURI, req.Challenge, req.Resource)
		if err != nil {
			oauthFailure(c, 400, "invalid_request", err.Error())
			return
		}
		redirect, _ := url.Parse(req.RedirectURI)
		query := redirect.Query()
		query.Set("code", code)
		if req.State != "" {
			query.Set("state", req.State)
		}
		redirect.RawQuery = query.Encode()
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"redirectUrl": redirect.String()})
	})
	api.POST("/mcp/oauth/token", func(c *gin.Context) {
		if !enforceRateLimit(c, "mcp-token:"+c.ClientIP(), 60, time.Hour) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		if err := c.Request.ParseForm(); err != nil || c.PostForm("grant_type") != "authorization_code" {
			oauthFailure(c, 400, "unsupported_grant_type", "仅支持授权码登录")
			return
		}
		origin := mcpPublicOrigin(c)
		if origin == "" {
			oauthFailure(c, 503, "temporarily_unavailable", "MCP 公网地址未配置")
			return
		}
		resource := origin + "/api/mcp"
		if c.PostForm("resource") != resource {
			oauthFailure(c, 400, "invalid_target", "资源地址不匹配")
			return
		}
		issued, err := svc.ExchangeMCPCode(c.PostForm("code"), c.PostForm("client_id"), c.PostForm("redirect_uri"), c.PostForm("code_verifier"), resource)
		if err != nil {
			oauthFailure(c, 400, "invalid_grant", "授权码无效或已过期")
			return
		}
		c.Header("Cache-Control", "no-store")
		c.JSON(http.StatusOK, gin.H{"access_token": issued.Token, "token_type": "Bearer", "scope": "mcp:tools"})
	})
}

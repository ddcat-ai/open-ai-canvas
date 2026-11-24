package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/auth"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"yingce/backend/internal/buildinfo"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func assistantBrowserUser(c *gin.Context, svc *service.Service, write bool) (*model.User, error) {
	if c.GetHeader("Authorization") != "" {
		return nil, service.Forbidden("此操作仅支持浏览器登录确认")
	}
	u, err := currentUser(c, svc)
	if err != nil {
		return nil, err
	}
	if err = svc.RequireAdmin(u); err != nil {
		return nil, err
	}
	if write {
		base, e := service.AssistantBaseURL()
		if e != nil {
			return nil, e
		}
		if c.GetHeader("Origin") != base {
			return nil, service.Forbidden("需要同源浏览器操作")
		}
		if site := c.GetHeader("Sec-Fetch-Site"); site != "" && site != "same-origin" {
			return nil, service.Forbidden("不允许跨站操作")
		}
	}
	return u, nil
}
func assistantBearer(c *gin.Context, svc *service.Service) (*service.AssistantPrincipal, error) {
	fields := strings.Fields(c.GetHeader("Authorization"))
	if len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") {
		return nil, service.Unauthorized("需要 Bearer 管理 Token")
	}
	return svc.AuthenticateAssistant(fields[1])
}
func assistantDecode(c *gin.Context, v any) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	d := json.NewDecoder(c.Request.Body)
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		failService(c, service.BadAuthRequest("无效的 JSON 参数"))
		return false
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		failService(c, service.BadAuthRequest("只允许一个 JSON 对象"))
		return false
	}
	return true
}
func assistantAuthRequest(q url.Values) service.AssistantOAuthRequest {
	return service.AssistantOAuthRequest{ClientID: q.Get("client_id"), RedirectURI: q.Get("redirect_uri"), ResponseType: q.Get("response_type"), Resource: q.Get("resource"), Scope: q.Get("scope"), State: q.Get("state"), Challenge: q.Get("code_challenge"), ChallengeMethod: q.Get("code_challenge_method")}
}

func RegisterAdminAssistantRoutes(api *gin.RouterGroup, svc *service.Service) {
	g := api.Group("/admin-assistant")
	g.Use(func(c *gin.Context) {
		c.Header("Cache-Control", "no-store")
		c.Header("Referrer-Policy", "no-referrer")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Next()
	})
	g.GET("/setup", func(c *gin.Context) {
		u, err := assistantBrowserUser(c, svc, false)
		if err != nil {
			failService(c, err)
			return
		}
		_ = u
		base, err := service.AssistantBaseURL()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"mcpUrl": base + service.AssistantAPIPath + "/mcp", "scopes": svc.AssistantScopeOptions(), "skillUrl": base + service.AssistantAPIPath + "/skill/latest"})
	})
	g.GET("/tokens", func(c *gin.Context) {
		u, err := assistantBrowserUser(c, svc, false)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.Query("page"))
		rows, more, err := svc.AssistantTokens(u, page)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": rows, "hasMore": more})
	})
	g.POST("/tokens", func(c *gin.Context) {
		u, err := assistantBrowserUser(c, svc, true)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "assistant-token:"+u.ID, 20, time.Hour) {
			return
		}
		var req service.AssistantTokenRequest
		if !assistantDecode(c, &req) {
			return
		}
		row, secret, err := svc.CreateAssistantToken(u, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"token": secret, "credential": row})
	})
	g.DELETE("/tokens/:id", func(c *gin.Context) {
		u, err := assistantBrowserUser(c, svc, true)
		if err == nil {
			err = svc.RevokeAssistantAccess(u, c.Param("id"), false)
		}
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	g.GET("/grants", func(c *gin.Context) {
		u, err := assistantBrowserUser(c, svc, false)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.Query("page"))
		rows, more, err := svc.AssistantGrants(u, page)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": rows, "hasMore": more})
	})
	g.DELETE("/grants/:id", func(c *gin.Context) {
		u, err := assistantBrowserUser(c, svc, true)
		if err == nil {
			err = svc.RevokeAssistantAccess(u, c.Param("id"), true)
		}
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	g.GET("/calls", func(c *gin.Context) {
		u, err := assistantBrowserUser(c, svc, false)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.Query("page"))
		rows, err := svc.AssistantCalls(u, page)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"items": rows})
	})
	g.POST("/calls/:id/confirm", func(c *gin.Context) {
		u, err := assistantBrowserUser(c, svc, true)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			Approve *bool `json:"approve"`
		}
		if !assistantDecode(c, &req) {
			return
		}
		if req.Approve == nil {
			failService(c, service.BadAuthRequest("请选择确认或拒绝"))
			return
		}
		if err = svc.ConfirmAssistantCall(u, c.Param("id"), *req.Approve); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	g.GET("/operations", func(c *gin.Context) {
		p, err := assistantBearer(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.Query("page"))
		rows, err := svc.ListAssistantOperations(p, c.Query("module"), c.Query("keyword"), page)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, rows)
	})
	g.GET("/operations/:operation", func(c *gin.Context) {
		p, err := assistantBearer(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		op, err := svc.DescribeAssistantOperation(p, c.Param("operation"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, op)
	})
	g.POST("/operations/:operation/execute", func(c *gin.Context) {
		p, err := assistantBearer(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "assistant-execute:"+p.User.ID, 120, time.Minute) {
			return
		}
		var req service.AssistantExecuteRequest
		if !assistantDecode(c, &req) {
			return
		}
		if req.Operation != "" && req.Operation != c.Param("operation") {
			failService(c, service.BadAuthRequest("操作 ID 不匹配"))
			return
		}
		req.Operation = c.Param("operation")
		result, err := svc.ExecuteAssistantOperation(c.Request.Context(), p, req, "skill")
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	g.POST("/attachments", func(c *gin.Context) {
		p, err := assistantBearer(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "assistant-upload:"+p.User.ID, 20, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, service.AssistantAttachmentLimit+1)
		data, err := io.ReadAll(c.Request.Body)
		if err != nil {
			failService(c, service.BadAuthRequest("附件超过 32 MiB"))
			return
		}
		name, err := url.PathUnescape(c.GetHeader("X-Filename"))
		if err != nil {
			failService(c, service.BadAuthRequest("文件名编码无效"))
			return
		}
		row, err := svc.StoreAssistantAttachment(p, name, c.GetHeader("Content-Type"), data)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, row)
	})
	g.GET("/attachments/:id", func(c *gin.Context) {
		p, err := assistantBearer(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		row, err := svc.ReadAssistantAttachment(p, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": row.Name}))
		c.Data(http.StatusOK, row.MediaType, row.Data)
	})
	registerAssistantOAuth(g, svc)
	g.GET("/calls/:id", func(c *gin.Context) {
		u, err := assistantBrowserUser(c, svc, false)
		if err != nil {
			failService(c, err)
			return
		}
		row, err := svc.AssistantCall(u, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, row)
	})
	registerAssistantSkill(g)
	stream := assistantMCPHandler(svc)
	g.Any("/mcp", func(c *gin.Context) {
		if !enforceRateLimit(c, "assistant-mcp:"+c.ClientIP(), 240, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		if origin := c.GetHeader("Origin"); origin != "" {
			base, err := service.AssistantBaseURL()
			if err != nil || origin != base {
				c.AbortWithStatus(http.StatusForbidden)
				return
			}
		}
		stream.ServeHTTP(c.Writer, c.Request)
	})
}

func registerAssistantOAuth(g *gin.RouterGroup, svc *service.Service) {
	g.GET("/oauth/resource-metadata", func(c *gin.Context) { assistantResourceMetadata(c, svc) })
	g.GET("/oauth/metadata", func(c *gin.Context) { assistantAuthorizationMetadata(c, svc) })
	g.POST("/oauth/register", func(c *gin.Context) {
		if !enforceRateLimit(c, "assistant-register:"+c.ClientIP(), 10, time.Hour) {
			return
		}
		var req struct {
			Name          string   `json:"client_name"`
			Redirects     []string `json:"redirect_uris"`
			GrantTypes    []string `json:"grant_types"`
			ResponseTypes []string `json:"response_types"`
			AuthMethod    string   `json:"token_endpoint_auth_method"`
			Scope         string   `json:"scope,omitempty"`
		}
		if !assistantDecode(c, &req) {
			return
		}
		if req.AuthMethod != "" && req.AuthMethod != "none" {
			c.JSON(400, gin.H{"error": "invalid_client_metadata"})
			return
		}
		for _, v := range req.GrantTypes {
			if v != "authorization_code" && v != "refresh_token" {
				c.JSON(400, gin.H{"error": "invalid_client_metadata"})
				return
			}
		}
		for _, v := range req.ResponseTypes {
			if v != "code" {
				c.JSON(400, gin.H{"error": "invalid_client_metadata"})
				return
			}
		}
		row, err := svc.RegisterAssistantClient(req.Name, req.Redirects)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid_client_metadata"})
			return
		}
		c.JSON(201, gin.H{"client_id": row.ID, "client_name": row.Name, "redirect_uris": req.Redirects, "grant_types": []string{"authorization_code", "refresh_token"}, "response_types": []string{"code"}, "token_endpoint_auth_method": "none"})
	})
	g.GET("/oauth/authorize", func(c *gin.Context) {
		base, err := service.AssistantBaseURL()
		if err != nil {
			failService(c, err)
			return
		}
		if len(c.Request.URL.RawQuery) > 8192 {
			failService(c, service.BadAuthRequest("授权请求过大"))
			return
		}
		req := assistantAuthRequest(c.Request.URL.Query())
		query := url.Values{"client_id": {req.ClientID}, "redirect_uri": {req.RedirectURI}, "response_type": {req.ResponseType}, "resource": {req.Resource}, "scope": {req.Scope}, "state": {req.State}, "code_challenge": {req.Challenge}, "code_challenge_method": {req.ChallengeMethod}}
		c.Redirect(http.StatusFound, base+"/admin/agent-access/authorize?"+query.Encode())
	})
	g.GET("/oauth/consent", func(c *gin.Context) {
		u, err := assistantBrowserUser(c, svc, false)
		if err != nil {
			failService(c, err)
			return
		}
		preview, err := svc.PreviewAssistantAuthorization(u, assistantAuthRequest(c.Request.URL.Query()))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, preview)
	})
	g.POST("/oauth/consent", func(c *gin.Context) {
		u, err := assistantBrowserUser(c, svc, true)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			service.AssistantOAuthRequest
			Approve *bool `json:"approve"`
		}
		if !assistantDecode(c, &req) {
			return
		}
		if req.Approve == nil {
			failService(c, service.BadAuthRequest("请选择授权或拒绝"))
			return
		}
		target, err := svc.AuthorizeAssistant(u, req.AssistantOAuthRequest, *req.Approve)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"redirectUrl": target})
	})
	g.POST("/oauth/token", func(c *gin.Context) {
		if !enforceRateLimit(c, "assistant-oauth-token:"+c.ClientIP(), 60, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		if err := c.Request.ParseForm(); err != nil {
			c.JSON(400, gin.H{"error": "invalid_request"})
			return
		}
		req := service.AssistantOAuthTokenRequest{GrantType: c.PostForm("grant_type"), ClientID: c.PostForm("client_id"), Code: c.PostForm("code"), RedirectURI: c.PostForm("redirect_uri"), Verifier: c.PostForm("code_verifier"), Resource: c.PostForm("resource"), RefreshToken: c.PostForm("refresh_token"), Scope: c.PostForm("scope")}
		token, err := svc.ExchangeAssistantToken(req)
		if err != nil {
			c.JSON(400, gin.H{"error": "invalid_grant", "error_description": "授权无效，请重新登录授权"})
			return
		}
		c.JSON(200, token)
	})
}
func RegisterAdminAssistantMetadata(r *gin.Engine, svc *service.Service) {
	r.GET("/.well-known/oauth-protected-resource/api/admin-assistant/mcp", func(c *gin.Context) { assistantResourceMetadata(c, svc) })
	r.GET("/.well-known/oauth-authorization-server/api/admin-assistant/oauth", func(c *gin.Context) { assistantAuthorizationMetadata(c, svc) })
}
func assistantResourceMetadata(c *gin.Context, svc *service.Service) {
	base, err := service.AssistantBaseURL()
	if err != nil {
		failService(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"resource": base + service.AssistantAPIPath + "/mcp", "authorization_servers": []string{base + service.AssistantAPIPath + "/oauth"}, "scopes_supported": svc.AssistantScopeOptions(), "bearer_methods_supported": []string{"header"}})
}
func assistantAuthorizationMetadata(c *gin.Context, svc *service.Service) {
	base, err := service.AssistantBaseURL()
	if err != nil {
		failService(c, err)
		return
	}
	prefix := base + service.AssistantAPIPath + "/oauth"
	c.Header("Cache-Control", "no-store")
	c.JSON(200, gin.H{"issuer": prefix, "authorization_endpoint": prefix + "/authorize", "token_endpoint": prefix + "/token", "registration_endpoint": prefix + "/register", "response_types_supported": []string{"code"}, "grant_types_supported": []string{"authorization_code", "refresh_token"}, "code_challenge_methods_supported": []string{"S256"}, "token_endpoint_auth_methods_supported": []string{"none"}, "scopes_supported": svc.AssistantScopeOptions()})
}

func assistantMCPPrincipal(req *mcp.CallToolRequest) *service.AssistantPrincipal {
	if req.Extra == nil || req.Extra.TokenInfo == nil {
		return nil
	}
	p, _ := req.Extra.TokenInfo.Extra["principal"].(*service.AssistantPrincipal)
	return p
}
func assistantMCPHandler(svc *service.Service) http.Handler {
	server := mcp.NewServer(&mcp.Implementation{Name: "canvas-admin", Version: buildinfo.Current().Version}, nil)
	type listInput struct {
		Module  string `json:"module,omitempty"`
		Keyword string `json:"keyword,omitempty"`
		Page    int    `json:"page,omitempty"`
	}
	mcp.AddTool(server, &mcp.Tool{Name: "admin_list_operations", Description: "发现已获授权的后台操作，按模块或关键词筛选，每页 40 项。"}, func(ctx context.Context, req *mcp.CallToolRequest, in listInput) (*mcp.CallToolResult, any, error) {
		out, err := svc.ListAssistantOperations(assistantMCPPrincipal(req), in.Module, in.Keyword, in.Page)
		return nil, out, err
	})
	type describeInput struct {
		Operation string `json:"operation"`
	}
	mcp.AddTool(server, &mcp.Tool{Name: "admin_describe_operation", Description: "查看操作输入 Schema、风险等级和权限。执行前应先查看参数。"}, func(ctx context.Context, req *mcp.CallToolRequest, in describeInput) (*mcp.CallToolResult, any, error) {
		out, err := svc.DescribeAssistantOperation(assistantMCPPrincipal(req), in.Operation)
		return nil, out, err
	})
	type executeInput struct {
		Operation      string          `json:"operation"`
		Arguments      json.RawMessage `json:"arguments"`
		IdempotencyKey string          `json:"idempotencyKey,omitempty"`
	}
	// 原始处理器避免 SDK 的 Schema/default 与 map 解码把 int64 转为 float64。
	server.AddTool(&mcp.Tool{Name: "admin_execute_operation", Description: "执行明确的后台操作。写入必须使用稳定幂等键；危险操作返回网页确认地址，确认后原参数重试。unknown 状态需人工核实，禁止换键重试。", InputSchema: map[string]any{
		"type": "object", "required": []string{"operation", "arguments"}, "additionalProperties": false,
		"properties": map[string]any{"operation": map[string]any{"type": "string"}, "arguments": map[string]any{"type": "object"}, "idempotencyKey": map[string]any{"type": "string"}},
	}}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		toolError := func(err error) (*mcp.CallToolResult, error) {
			return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}}}, nil
		}
		var in executeInput
		decoder := json.NewDecoder(bytes.NewReader(req.Params.Arguments))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&in); err != nil {
			return toolError(service.BadAuthRequest("无效的工具参数"))
		}
		if in.Operation == "" || len(in.Arguments) == 0 || bytes.TrimSpace(in.Arguments)[0] != '{' {
			return toolError(service.BadAuthRequest("需要 operation 和 arguments 对象"))
		}
		out, err := svc.ExecuteAssistantOperation(ctx, assistantMCPPrincipal(req), service.AssistantExecuteRequest{Operation: in.Operation, Arguments: in.Arguments, IdempotencyKey: in.IdempotencyKey}, "mcp")
		if err != nil {
			return toolError(err)
		}
		encoded, err := json.Marshal(out)
		if err != nil {
			return toolError(service.NewAppError(500, "无法编码操作结果"))
		}
		return &mcp.CallToolResult{StructuredContent: out, Content: []mcp.Content{&mcp.TextContent{Text: string(encoded)}}}, nil
	})
	stream := mcp.NewStreamableHTTPHandler(func(_ *http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{Stateless: true})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		base, _ := service.AssistantBaseURL()
		auth.RequireBearerToken(func(ctx context.Context, token string, r *http.Request) (*auth.TokenInfo, error) {
			p, err := svc.AuthenticateAssistant(token)
			if err != nil {
				return nil, auth.ErrInvalidToken
			}
			return &auth.TokenInfo{UserID: p.User.ID, Scopes: p.Scopes, Expiration: p.Credential.ExpiresAt, Extra: map[string]any{"principal": p}}, nil
		}, &auth.RequireBearerTokenOptions{ResourceMetadataURL: base + service.AssistantAPIPath + "/oauth/resource-metadata"})(stream).ServeHTTP(w, r)
	})
}

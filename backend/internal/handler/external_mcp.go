package handler

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

type mcpRequestUserKey struct{}

func externalMCPTool[In any](server *mcp.Server, name, description string, fn func(context.Context, In) (any, error)) {
	mcp.AddTool(server, &mcp.Tool{Name: name, Description: description}, func(ctx context.Context, _ *mcp.CallToolRequest, input In) (*mcp.CallToolResult, any, error) {
		value, err := fn(ctx, input)
		return nil, value, err
	})
}

func externalMCPAllow(ctx context.Context, svc *service.Service, subject string, limit int) error {
	allowed, err := svc.AllowRequest(ctx, subject, limit, time.Minute)
	if err != nil {
		return err
	}
	if !allowed {
		return service.RateLimited("请求过于频繁，请稍后重试")
	}
	return nil
}

func externalMCPServer(svc *service.Service, user *model.User) *mcp.Server {
	server := mcp.NewServer(&mcp.Implementation{Name: "yingce-video-creation", Version: "1.0.0"}, nil)
	userID := user.ID
	externalMCPTool(server, "list_models", "列出当前用户可用的创作模型及能力", func(_ context.Context, _ struct{}) (any, error) {
		return svc.ModelCatalogForUser(user, nil)
	})
	externalMCPTool(server, "quote_model", "按创作意图报价，生成前先调用", func(_ context.Context, input struct {
		ModelID string                     `json:"modelId" jsonschema:"模型 ID"`
		Intent  service.ModelRequestIntent `json:"intent"`
	}) (any, error) {
		return svc.QuoteLogicalModel(userID, input.ModelID, input.Intent)
	})
	externalMCPTool(server, "list_resources", "列出当前用户已上传的素材资源", func(_ context.Context, input struct {
		Limit int `json:"limit"`
	}) (any, error) {
		limit := input.Limit
		if limit <= 0 || limit > 100 {
			limit = 50
		}
		return svc.Resources(userID, limit)
	})
	externalMCPTool(server, "import_resource", "从 HTTPS 地址导入图片、音频或视频，返回资源 ID；服务端检查地址与配额", func(ctx context.Context, input struct {
		URL            string `json:"url"`
		Kind           string `json:"kind"`
		IdempotencyKey string `json:"idempotencyKey"`
	}) (any, error) {
		if input.IdempotencyKey == "" {
			return nil, service.BadAuthRequest("导入素材需要幂等键")
		}
		policy, err := svc.RuntimePolicy()
		if err != nil {
			return nil, err
		}
		if err := externalMCPAllow(ctx, svc, "resources-import:"+userID, policy.Request.ResourceImportPerMinute); err != nil {
			return nil, err
		}
		return svc.ImportResourceURL(userID, input.URL, input.Kind, 0, 0, 0, input.IdempotencyKey)
	})
	externalMCPTool(server, "get_resource_access", "签发当前用户素材的临时下载或模型输入地址", func(_ context.Context, input struct {
		Items []service.ResourceAccessRequest `json:"items"`
	}) (any, error) {
		return svc.ResourceAccessBatch(userID, input.Items)
	})
	externalMCPTool(server, "create_video", "创建异步视频任务；支持文生视频、首尾帧、参考图、参考视频和音频。必须提供幂等键", func(ctx context.Context, input service.WorkbenchTaskInput) (any, error) {
		if input.Kind != "video" || strings.TrimSpace(input.IdempotencyKey) == "" {
			return nil, service.BadAuthRequest("视频任务需要 kind=video 和 idempotencyKey")
		}
		policy, err := svc.RuntimePolicy()
		if err != nil {
			return nil, err
		}
		if err := externalMCPAllow(ctx, svc, "tasks:"+userID, policy.Request.TaskCreatePerMinute); err != nil {
			return nil, err
		}
		return svc.CreateWorkbenchTask(userID, input, "", "")
	})
	externalMCPTool(server, "get_task", "查询生成任务状态、结果资源 ID 和账单", func(_ context.Context, input struct {
		TaskID string `json:"taskId"`
	}) (any, error) {
		return svc.Task(userID, input.TaskID)
	})
	externalMCPTool(server, "cancel_task", "取消当前用户的生成任务", func(ctx context.Context, input struct {
		TaskID string `json:"taskId"`
	}) (any, error) {
		return svc.CancelTask(ctx, userID, input.TaskID)
	})
	externalMCPTool(server, "drama_models", "列出短剧自动制作可用的模型与默认配置", func(_ context.Context, _ struct{}) (any, error) {
		return svc.DramaModelCatalog(userID)
	})
	externalMCPTool(server, "estimate_drama", "估算短剧作品的生成任务与费用", func(_ context.Context, input service.DramaEstimateRequest) (any, error) {
		return svc.EstimateDrama(userID, input)
	})
	externalMCPTool(server, "create_drama", "从小说、剧本或分镜章节创建完整短剧作品；可先保存草稿，确认预算后启动。必须提供幂等键", func(_ context.Context, input struct {
		IdempotencyKey string                     `json:"idempotencyKey"`
		Drama          service.CreateDramaRequest `json:"drama"`
	}) (any, error) {
		return svc.CreateExternalDrama(userID, input.IdempotencyKey, input.Drama)
	})
	externalMCPTool(server, "list_dramas", "列出当前用户的短剧作品", func(_ context.Context, input struct {
		Page     int `json:"page"`
		PageSize int `json:"pageSize"`
	}) (any, error) {
		if input.Page <= 0 {
			input.Page = 1
		}
		if input.PageSize <= 0 || input.PageSize > 100 {
			input.PageSize = 24
		}
		return svc.ListDramas(userID, service.DramaListRequest{Page: input.Page, PageSize: input.PageSize})
	})
	externalMCPTool(server, "get_drama", "读取短剧作品和制作状态", func(_ context.Context, input struct {
		DramaID string `json:"dramaId"`
	}) (any, error) {
		return svc.DramaSummary(userID, input.DramaID)
	})
	externalMCPTool(server, "start_drama", "启动短剧自动制作；会按作品设置发起计费生成", func(_ context.Context, input struct {
		DramaID string `json:"dramaId"`
	}) (any, error) {
		return svc.SetDramaRunning(userID, input.DramaID, true)
	})
	externalMCPTool(server, "pause_drama", "暂停短剧作品后续调度", func(_ context.Context, input struct {
		DramaID string `json:"dramaId"`
	}) (any, error) {
		return svc.SetDramaRunning(userID, input.DramaID, false)
	})
	externalMCPTool(server, "get_drama_jobs", "查询短剧制作队列和失败原因", func(_ context.Context, input struct {
		DramaID string `json:"dramaId"`
	}) (any, error) {
		return svc.DramaJobs(userID, input.DramaID, 60)
	})
	externalMCPTool(server, "get_episode", "读取剧集、剧情段和已生成视频", func(_ context.Context, input struct {
		DramaID   string `json:"dramaId"`
		EpisodeID string `json:"episodeId"`
	}) (any, error) {
		return svc.DramaEpisodeDetail(userID, input.DramaID, input.EpisodeID)
	})
	externalMCPTool(server, "approve_episode", "批准剧集继续制作；仅在用户明确要求时调用", func(_ context.Context, input struct {
		DramaID   string `json:"dramaId"`
		EpisodeID string `json:"episodeId"`
	}) (any, error) {
		return svc.ApproveDramaEpisode(userID, input.DramaID, input.EpisodeID)
	})
	externalMCPTool(server, "generate_segments", "按剧情段编号生成或重生成视频", func(_ context.Context, input struct {
		DramaID   string                               `json:"dramaId"`
		EpisodeID string                               `json:"episodeId"`
		Request   service.GenerateDramaSegmentsRequest `json:"request"`
	}) (any, error) {
		return svc.GenerateDramaSegments(userID, input.DramaID, input.EpisodeID, input.Request)
	})
	externalMCPTool(server, "compose_episode", "合成当前剧集已有的剧情段视频", func(_ context.Context, input struct {
		DramaID   string `json:"dramaId"`
		EpisodeID string `json:"episodeId"`
	}) (any, error) {
		return svc.ComposeDramaEpisode(userID, input.DramaID, input.EpisodeID)
	})
	return server
}

func RegisterExternalMCPRoutes(api *gin.RouterGroup, svc *service.Service) {
	handler := mcp.NewStreamableHTTPHandler(func(r *http.Request) *mcp.Server {
		user, _ := r.Context().Value(mcpRequestUserKey{}).(*model.User)
		if user == nil {
			return nil
		}
		return externalMCPServer(svc, user)
	}, &mcp.StreamableHTTPOptions{Stateless: true, MaxRequestBodyBytes: 4 << 20})
	serve := func(c *gin.Context) {
		origin := mcpPublicOrigin(c)
		if origin == "" {
			c.Status(http.StatusServiceUnavailable)
			return
		}
		if requestOrigin := c.GetHeader("Origin"); requestOrigin != "" && requestOrigin != origin {
			c.Status(http.StatusForbidden)
			return
		}
		challenge := `Bearer resource_metadata="` + origin + `/.well-known/oauth-protected-resource/api/mcp"`
		token := strings.TrimSpace(strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer "))
		if !strings.HasPrefix(c.GetHeader("Authorization"), "Bearer ") || token == "" {
			c.Header("WWW-Authenticate", challenge)
			c.Status(http.StatusUnauthorized)
			return
		}
		user, _, err := svc.UserForAPIKey(token)
		if err != nil {
			c.Header("WWW-Authenticate", challenge)
			c.Status(http.StatusUnauthorized)
			return
		}
		if !enforceRateLimit(c, "external-mcp:"+user.ID, 120, time.Minute) {
			return
		}
		c.Request = c.Request.WithContext(context.WithValue(c.Request.Context(), mcpRequestUserKey{}, user))
		c.Header("Cache-Control", "no-store")
		handler.ServeHTTP(c.Writer, c.Request)
	}
	api.GET("/mcp", serve)
	api.POST("/mcp", serve)
}

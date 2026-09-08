package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// ---------------------------------------------------------------------------
// D-057B：Server Executor 端点（Agent 自主生产通道）
//
// 设计约束（D-056 / D-057A 专家裁决）：
//   - 作用域门禁：只有带 yingce.generation.submit 的 Agent 服务令牌才能调用。
//     会话登录态同样可用（currentUser 兼容两种通道），但**确认门不得绕过**——
//     Server Executor 只解决"没有浏览器时能否生产"，不等于 bypassPermissions。
//   - 复用 currentUser：Agent 通道与会话通道共用同一套用户解析与 admin 拦截。
//   - request body 只允许业务参数；渠道凭据与供应链字段全部留在生产域。
// ---------------------------------------------------------------------------

type agentShotGenerateRequest struct {
	VideoSeconds       *int     `json:"videoSeconds"`
	Resolution         string   `json:"resolution"`
	ReferenceImageURLs []string `json:"referenceImageUrls"`
	WorkflowStepID     string   `json:"workflowStepId"`
}

func RegisterAgentShotRoutes(r *gin.RouterGroup, svc *service.Service) {
	// projectId / shotId 放在路径上：projectId 必填由路由结构本身保证，
	// 避免 Agent 侧漏传导致任务挂到错误项目。
	r.POST("/agent/projects/:projectId/shots/:shotId/generate", AgentScopeGuard(service.AgentScopeGenerationSubmit), func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		projectID := c.Param("projectId")
		shotID := c.Param("shotId")
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		var req agentShotGenerateRequest
		if c.Request.Body != nil && c.ContentType() != "" {
			if err := c.ShouldBindJSON(&req); err != nil && err.Error() != "EOF" {
				fail(c, http.StatusBadRequest, err)
				return
			}
		}
		result, err := svc.AgentGenerateShot(user.ID, projectID, service.AgentShotGenerateRequest{
			ShotID:             shotID,
			VideoSeconds:       req.VideoSeconds,
			Resolution:         req.Resolution,
			ReferenceImageURLs: req.ReferenceImageURLs,
			WorkflowStepID:     req.WorkflowStepID,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

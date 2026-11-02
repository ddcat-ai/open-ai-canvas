package handler

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

// 每个端点绑定固定协议：worker 与后端对协议头任一不一致都会收到显式 426，
// 不做多版本兼容推断，避免不同版本 worker 混跑同一批运行。
const (
	internalAgentWireVersion      = "canvas-pi-wire/v4"
	internalAgentPiSDKVersion     = "0.87.1"
	internalAgentSessionFormat    = "3"
	internalAgentProtocolMismatch = "Pi Agent worker protocol version mismatch"
)

// RegisterInternalAgentRoutes is mounted outside /api so the public web proxy
// cannot expose the worker protocol. Mounting is opt-in: without a strong
// internal token no route is registered and deployment behavior is today's
// (RFC #943 P2). The token is verified again on every request; ownership of a
// leased run is validated per request by the service.
func RegisterInternalAgentRoutes(r *gin.Engine, svc *service.Service) {
	secret := strings.TrimSpace(os.Getenv("CANVAS_AGENT_INTERNAL_TOKEN"))
	if len(secret) < 32 {
		return
	}
	group := r.Group("/internal-agent")
	group.Use(internalAgentAuth(svc))
	registerInternalAgentWorkerRoutes(group, svc)
}

// internalAgentAuth 校验每个请求的 Worker 身份与协议版本。运行级接口（/runs/:id）
// 在 P3 叠加短时运行授权（HMAC grant + 数据库租约复核），复用同一组 Worker 身份头。
func internalAgentAuth(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		workerID := c.GetHeader("X-Agent-Identity")
		provided := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if _, err := svc.AuthenticateAgentWorker(workerID, provided); err != nil {
			// 故意裸 401：不回显原因或内部 ID，凭据本身就是秘密。
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		c.Set("agentWorkerID", workerID)
		if c.GetHeader("X-Agent-Protocol-Version") != internalAgentWireVersion ||
			c.GetHeader("X-Pi-SDK-Version") != internalAgentPiSDKVersion ||
			c.GetHeader("X-Pi-Session-Format") != internalAgentSessionFormat {
			c.AbortWithStatusJSON(http.StatusUpgradeRequired, gin.H{
				"code": http.StatusUpgradeRequired, "data": nil,
				"msg": internalAgentProtocolMismatch, "reason": "agent_protocol_mismatch",
			})
			return
		}
		c.Next()
	}
}

// registerInternalAgentWorkerRoutes Worker 级接口。P2 只提供只读探活；容量上报、
// 调度配置与运行领取在 P3 随第一条迁移一起进入。
func registerInternalAgentWorkerRoutes(group *gin.RouterGroup, svc *service.Service) {
	group.GET("/health", func(c *gin.Context) {
		// 只读、幂等的探活点：冒烟与运维用它验证挂载与协议。按仓库约定，
		// 健康检查只证明入口可用，业务链路必须用端到端验收另行覆盖。
		ok(c, gin.H{"ok": true, "wireVersion": internalAgentWireVersion, "piSdkVersion": internalAgentPiSDKVersion, "sessionFormat": internalAgentSessionFormat})
	})
}

package handler

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
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
// (RFC #943). The token is verified again on every request; ownership of a
// leased run is validated per request by the service.
func RegisterInternalAgentRoutes(r *gin.Engine, svc *service.Service) {
	secret := strings.TrimSpace(os.Getenv("CANVAS_AGENT_INTERNAL_TOKEN"))
	if len(secret) < 32 {
		return
	}
	// insert-only 种子：重启不能覆盖吊销或把管理员下发的凭据回退成旧值。
	if err := svc.SeedAgentWorker(); err != nil {
		panic("agent worker bootstrap failed: " + err.Error())
	}
	group := r.Group("/internal-agent")
	group.Use(internalAgentAuth(svc))
	registerInternalAgentWorkerRoutes(group, svc)
	registerInternalAgentRunRoutes(group, svc)
}

// internalAgentAuth 校验每个请求的身份与协议版本：运行级接口要求短时运行授权
// （HMAC grant + 数据库租约与 fencing epoch 复核），Worker 级接口要求 Worker
// 身份（worker 身份 secret 的常量时间摘要比较）。
func internalAgentAuth(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		provided := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		isRunLevel := c.Param("id") != "" || strings.HasPrefix(c.Request.URL.Path, "/internal-agent/runs/")
		if isRunLevel {
			epoch, parseErr := strconv.ParseInt(c.GetHeader("X-Agent-Session-Epoch"), 10, 64)
			workerID, grantErr := svc.AgentRunGrantWorker(provided)
			// 运行级三重校验：grant 签名/有效期与声明一致、身份头与 grant 一致、
			// 数据库租约在线且 epoch 相等（吊销与租约丢失即时生效）。
			if parseErr != nil || grantErr != nil || workerID != c.GetHeader("X-Agent-Identity") || !svc.ValidateAgentRunGrant(provided, c.GetHeader("X-Agent-User-ID"), c.Param("id"), c.GetHeader("X-Agent-Worker-ID"), epoch) {
				c.AbortWithStatus(http.StatusUnauthorized)
				return
			}
		} else {
			workerID := c.GetHeader("X-Agent-Identity")
			worker, err := svc.AuthenticateAgentWorker(workerID, provided)
			if err != nil {
				// 故意裸 401：不回显原因或内部 ID，凭据本身就是秘密。
				c.AbortWithStatus(http.StatusUnauthorized)
				return
			}
			c.Set("agentWorkerID", worker.ID)
			// 非空 UserID 限定单租户领取；空 UserID 是显式的全局 Worker。
			c.Set("agentWorkerUserID", worker.UserID)
		}
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

// registerInternalAgentWorkerRoutes Worker 级接口：探活、调度配置读取与容量上报。
func registerInternalAgentWorkerRoutes(group *gin.RouterGroup, svc *service.Service) {
	group.GET("/health", func(c *gin.Context) {
		// 只读、幂等的探活点：冒烟与运维用它验证挂载与协议。按仓库约定，
		// 健康检查只证明入口可用，业务链路必须用端到端验收另行覆盖。
		workers, err := svc.AgentWorkersView()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true, "wireVersion": internalAgentWireVersion, "piSdkVersion": internalAgentPiSDKVersion, "sessionFormat": internalAgentSessionFormat, "workers": workers})
	})
	group.GET("/config", func(c *gin.Context) {
		setting, err := svc.AgentSchedulerConfig()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"setting": setting})
	})
	group.POST("/capacity", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var input struct {
			Owner string `json:"owner"`
			model.AgentCapacityReport
		}
		if err := c.ShouldBindJSON(&input); err != nil {
			c.AbortWithStatus(http.StatusBadRequest)
			return
		}
		if !svc.AgentWorkerOwnsOwner(c.GetString("agentWorkerID"), input.Owner) {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		if err := svc.PiCapacityReport(input.Owner, input.AgentCapacityReport); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"updated": true})
	})
	group.POST("/claim", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var input struct {
			Owner string `json:"owner" binding:"required"`
		}
		if err := c.ShouldBindJSON(&input); err != nil || len(input.Owner) > 80 {
			c.AbortWithStatus(http.StatusBadRequest)
			return
		}
		if !svc.AgentWorkerOwnsOwner(c.GetString("agentWorkerID"), input.Owner) {
			c.AbortWithStatus(http.StatusForbidden)
			return
		}
		claimed, err := svc.ClaimPiAgentForWorker(input.Owner, c.GetString("agentWorkerUserID"))
		if err != nil {
			failService(c, err)
			return
		}
		if claimed == nil {
			ok(c, gin.H{"run": nil})
			return
		}
		// 运行授权与票据同回：worker 续租/释放之外的运行级请求都吃这一枚。
		token, err := svc.IssueAgentRunGrant(c.GetString("agentWorkerID"), input.Owner, claimed.UserID, claimed.RunID, claimed.LeaseEpoch)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"run": claimed, "runAuthorization": token})
	})
}

// registerInternalAgentRunRoutes 已领取运行的租约维护。快照、模型步与工具批次
// 在后续阶段进入；本阶段只暴露租约生命周期端点。
func registerInternalAgentRunRoutes(group *gin.RouterGroup, svc *service.Service) {
	group.POST("/runs/:id/renew", func(c *gin.Context) {
		if err := svc.RenewPiAgentLease(c.GetHeader("X-Agent-User-ID"), c.Param("id"), internalAgentOwner(c)); err != nil {
			failService(c, err)
			return
		}
		provided := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		workerID, err := svc.AgentRunGrantWorker(provided)
		if err != nil {
			c.AbortWithStatus(http.StatusUnauthorized)
			return
		}
		epoch, _ := strconv.ParseInt(c.GetHeader("X-Agent-Session-Epoch"), 10, 64)
		token, err := svc.IssueAgentRunGrant(workerID, c.GetHeader("X-Agent-Worker-ID"), c.GetHeader("X-Agent-User-ID"), c.Param("id"), epoch)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"renewed": true, "runAuthorization": token})
	})
	group.POST("/runs/:id/phase", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var input service.PiRuntimePhaseRequest
		decoder := json.NewDecoder(c.Request.Body)
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF {
			c.AbortWithStatus(http.StatusBadRequest)
			return
		}
		if err := svc.PiRuntimePhase(c.GetHeader("X-Agent-User-ID"), c.Param("id"), internalAgentOwner(c), input); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"updated": true})
	})
	group.GET("/runs/:id/control", func(c *gin.Context) {
		control, err := svc.PiAgentInspection(c.GetHeader("X-Agent-User-ID"), c.Param("id"), internalAgentOwner(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, control)
	})
	group.GET("/runs/:id", func(c *gin.Context) {
		inspection, err := svc.PiAgentInspection(c.GetHeader("X-Agent-User-ID"), c.Param("id"), internalAgentOwner(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"run": inspection})
	})
	group.POST("/runs/:id/tool-calls/:callId/advance", func(c *gin.Context) {
		// 同步推进：复用 push 桥同一执行器（权限/审批/计费/画布写入治理都在那里）。
		// worker 的请求体重用 push 桥 /tool 形态；pause/终态语义原样传回。
		// fork 的异步操作台账（op queue + SSE 唤醒 + 重放）随会话条目树迁移进入
		// 下一阶段 —— 在那之前本端点提供同步推进语义（与 fork 桥等价）。
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var payload map[string]json.RawMessage
		decoder := json.NewDecoder(c.Request.Body)
		if decoder.Decode(&payload) != nil || decoder.Decode(&struct{}{}) != io.EOF {
			c.AbortWithStatus(http.StatusBadRequest)
			return
		}
		if _, ok := payload["callId"]; !ok {
			payload["callId"] = json.RawMessage(`"` + c.Param("callId") + `"`)
		}
		result, err := svc.PiToolAdvanceSync(c.Request.Context(), c.GetHeader("X-Agent-User-ID"), c.Param("id"), internalAgentOwner(c), payload)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	group.POST("/runs/:id/fail", func(c *gin.Context) {
		var input struct {
			Reason string `json:"reason"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		if err := c.ShouldBindJSON(&input); err != nil {
			c.AbortWithStatus(http.StatusBadRequest)
			return
		}
		if err := svc.PiFailRun(c.GetHeader("X-Agent-User-ID"), c.Param("id"), internalAgentOwner(c), input.Reason); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"failed": true})
	})
	group.POST("/runs/:id/release", func(c *gin.Context) {
		if err := svc.PiRelease(c.GetHeader("X-Agent-User-ID"), c.Param("id"), internalAgentOwner(c)); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"released": true})
	})
}

// internalAgentOwner 把三组身份数据头拼成租约 owner（"workerID@epoch"）。
func internalAgentOwner(c *gin.Context) string {
	workerID := strings.TrimSpace(c.GetHeader("X-Agent-Worker-ID"))
	epoch := strings.TrimSpace(c.GetHeader("X-Agent-Session-Epoch"))
	if workerID == "" || epoch == "" {
		return ""
	}
	return workerID + "@" + epoch
}

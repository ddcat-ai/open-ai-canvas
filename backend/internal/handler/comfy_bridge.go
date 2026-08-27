package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// Bridge 结果通常包含 base64 媒体；保持和 service 层相同的硬上限，避免请求体无限增长。
const maxComfyBridgeRequestBytes int64 = 64 << 20

// Bridge 心跳会携带本机工作流字段和拓扑，允许与 service 层一致的 4MB 上限。
const maxComfyBridgeCapabilitiesBytes int64 = 4 << 20

type comfyBridgeResultRequest struct {
	RequestID string         `json:"requestId"`
	ID        string         `json:"id,omitempty"`
	Status    string         `json:"status"`
	Result    map[string]any `json:"result,omitempty"`
	Error     string         `json:"error,omitempty"`
}

// RegisterComfyBridgeRoutes 同时注册用户管理接口和 Bridge 专用轮询接口。
// 两套接口使用不同认证方式：用户接口依赖登录 Cookie，Bridge 接口只接受专用 Header Token。
func RegisterComfyBridgeRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/comfy-bridges", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireWorkflowPluginForUser(user.ID, "comfyui-bridge-image"); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.CreateComfyBridgeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.CreateComfyBridge(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/comfy-bridges", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireWorkflowPluginForUser(user.ID, "comfyui-bridge-image"); err != nil {
			failService(c, err)
			return
		}
		bridges, err := svc.ComfyBridges(user.ID)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		ok(c, bridges)
	})
	revoke := func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RevokeComfyBridge(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"revoked": true})
	}
	r.DELETE("/comfy-bridges/:id", revoke)
	r.POST("/comfy-bridges/:id/revoke", revoke)

	r.GET("/comfy-bridge/poll", func(c *gin.Context) {
		bridge, err := authenticateComfyBridgeRequest(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		wait, err := comfyBridgeWait(c.Query("wait"))
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		request, err := svc.PollComfyBridgeRequest(c.Request.Context(), bridge, wait)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			failService(c, err)
			return
		}
		ok(c, gin.H{"request": request})
	})
	r.POST("/comfy-bridge/result", func(c *gin.Context) {
		bridge, err := authenticateComfyBridgeRequest(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if c.Request.ContentLength > maxComfyBridgeRequestBytes {
			fail(c, http.StatusRequestEntityTooLarge, errors.New("Bridge 结果请求体超过 64MB"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxComfyBridgeRequestBytes)
		var req comfyBridgeResultRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			var maxBytesErr *http.MaxBytesError
			if errors.As(err, &maxBytesErr) {
				fail(c, http.StatusRequestEntityTooLarge, errors.New("Bridge 结果请求体超过 64MB"))
				return
			}
			fail(c, http.StatusBadRequest, err)
			return
		}
		requestID := strings.TrimSpace(req.RequestID)
		if requestID == "" {
			requestID = strings.TrimSpace(req.ID)
		}
		err = svc.CompleteComfyBridgeRequest(bridge.ID, service.ComfyBridgeCompletion{
			RequestID: requestID,
			Status:    req.Status,
			Result:    req.Result,
			Error:     req.Error,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"accepted": true})
	})
	r.POST("/comfy-bridge/heartbeat", func(c *gin.Context) {
		bridge, err := authenticateComfyBridgeRequest(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			Capabilities map[string]any `json:"capabilities,omitempty"`
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxComfyBridgeCapabilitiesBytes)
		if c.Request.ContentLength != 0 {
			if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
				fail(c, http.StatusBadRequest, err)
				return
			}
		}
		if err := svc.TouchComfyBridgeHeartbeat(bridge.ID, req.Capabilities); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
}

func authenticateComfyBridgeRequest(c *gin.Context, svc *service.Service) (*model.ComfyBridge, error) {
	token := strings.TrimSpace(c.GetHeader("X-Canvas-Comfy-Bridge-Token"))
	if token == "" {
		token = strings.TrimSpace(c.GetHeader("X-Canvas-Bridge-Token"))
	}
	if token == "" {
		authorization := strings.TrimSpace(c.GetHeader("Authorization"))
		if len(authorization) >= 7 && strings.EqualFold(authorization[:7], "Bearer ") {
			token = strings.TrimSpace(authorization[7:])
		}
	}
	return svc.AuthenticateComfyBridge(token)
}

func comfyBridgeWait(raw string) (time.Duration, error) {
	if strings.TrimSpace(raw) == "" {
		return 20 * time.Second, nil
	}
	seconds, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || seconds < 0 || seconds > 60 {
		return 0, errors.New("wait 必须是 0 到 60 之间的整数秒")
	}
	return time.Duration(seconds) * time.Second, nil
}

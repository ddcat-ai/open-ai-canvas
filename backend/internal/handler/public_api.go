package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterPublicAPIRoutes exposes the platform-issued API key surface. It is
// deliberately separate from the browser session and custom-channel relay.
func RegisterPublicAPIRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/developer/api-keys", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.PublicAPIKeyCreateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		created, err := svc.CreatePublicAPIKey(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, created)
	})
	r.GET("/developer/api-keys", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		keys, err := svc.PublicAPIKeys(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"keys": keys})
	})
	r.DELETE("/developer/api-keys/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RevokePublicAPIKey(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"revoked": true})
	})

	r.GET("/v1/models", func(c *gin.Context) {
		key, ok := authenticatePublicAPI(c, svc)
		if !ok {
			return
		}
		models, err := svc.PublicGenerationModels(key)
		if err != nil {
			publicAPIError(c, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"object": "list", "data": models})
	})
	r.POST("/v1/generations", func(c *gin.Context) {
		key, ok := authenticatePublicAPI(c, svc)
		if !ok {
			return
		}
		idempotencyKey := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
		if idempotencyKey == "" || len(idempotencyKey) > 200 {
			publicAPIError(c, kernel.BadAuthRequest("必须提供长度不超过 200 个字符的 Idempotency-Key"))
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req service.PublicGenerationInput
		if err := c.ShouldBindJSON(&req); err != nil {
			publicAPIError(c, kernel.BadAuthRequest("请求 JSON 格式无效"))
			return
		}
		// A retry with the same key only reads the existing task. Check this
		// before the new-task limiter so network retries do not consume quota.
		if view, replay, err := svc.PublicGenerationReplay(key.UserID, key, req, "/v1/generations", idempotencyKey); err != nil {
			publicAPIError(c, err)
			return
		} else if replay {
			c.Header("X-Request-ID", RequestID(c))
			c.JSON(http.StatusAccepted, view)
			return
		}
		policy, err := svc.RuntimePolicy()
		if err != nil {
			publicAPIError(c, kernel.NewAppError(http.StatusServiceUnavailable, "请求协调服务暂时不可用"))
			return
		}
		if !enforcePublicAPIRateLimit(c, "public-generation-user:"+key.UserID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		view, err := svc.CreatePublicGeneration(key.UserID, key, req, "/v1/generations", idempotencyKey, TraceID(c), RequestID(c))
		if err != nil {
			publicAPIError(c, err)
			return
		}
		c.Header("X-Request-ID", RequestID(c))
		c.JSON(http.StatusAccepted, view)
	})
	r.GET("/v1/generations/:id", func(c *gin.Context) {
		key, ok := authenticatePublicAPI(c, svc)
		if !ok {
			return
		}
		view, err := svc.PublicGeneration(key.UserID, key.ID, c.Param("id"))
		if err != nil {
			publicAPIError(c, err)
			return
		}
		c.Header("X-Request-ID", RequestID(c))
		c.JSON(http.StatusOK, view)
	})
}

func enforcePublicAPIRateLimit(c *gin.Context, key string, limit int, window time.Duration) bool {
	if runtimeService == nil {
		publicAPIError(c, service.NewAppError(http.StatusServiceUnavailable, "请求协调服务暂时不可用"))
		return false
	}
	allowed, err := runtimeService.AllowRequest(c.Request.Context(), key, limit, window)
	if err != nil {
		publicAPIError(c, service.NewAppError(http.StatusServiceUnavailable, "请求协调服务暂时不可用"))
		return false
	}
	if allowed {
		return true
	}
	wait := runtimeService.RequestRetryAfter(c.Request.Context(), key, window)
	seconds := max(1, int((wait+time.Second-1)/time.Second))
	c.Header("Retry-After", strconv.Itoa(seconds))
	publicAPIError(c, service.RateLimited("请求次数已达上限，请在 "+strconv.Itoa(seconds)+" 秒后重试"))
	return false
}

func authenticatePublicAPI(c *gin.Context, svc *service.Service) (*model.PublicAPIKey, bool) {
	key, err := svc.AuthenticatePublicAPIKey(c.GetHeader("Authorization"))
	if err != nil {
		publicAPIError(c, err)
		return nil, false
	}
	// Keep the concrete key in the context without exposing it in a response.
	c.Set("public_api_key", key)
	return key, true
}

func publicAPIError(c *gin.Context, err error) {
	status := http.StatusInternalServerError
	code := status
	reason := service.ErrorReason(service.ReasonInternal)
	message := "系统处理失败，请稍后重试"
	var appErr *service.AppError
	if errors.As(err, &appErr) && appErr != nil && appErr.Status >= 400 && appErr.Status < 600 {
		status = appErr.Status
		code = appErr.Code
		if code == 0 {
			code = status
		}
		reason = appErr.Reason
		if reason == "" {
			reason = service.ReasonForStatus(status)
		}
		if strings.TrimSpace(appErr.Message) != "" {
			message = appErr.Message
		}
	}
	if status >= 500 {
		message = "系统处理失败，请稍后重试"
	}
	c.JSON(status, gin.H{"error": gin.H{"code": code, "type": string(reason), "message": message}})
}

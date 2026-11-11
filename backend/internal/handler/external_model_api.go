package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/model"
	"yingce/backend/internal/service"
)

func RegisterExternalModelAPIRoutes(r *gin.RouterGroup, svc *service.Service) {
	keys := r.Group("/api-keys")
	keys.Use(func(c *gin.Context) { c.Header("Cache-Control", "no-store") })
	keys.POST("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "api-key-create:"+user.ID, 30, time.Hour) {
			return
		}
		var req service.CreateAPIKeyRequest
		if !decodeExternalJSON(c, &req, 8<<10) {
			return
		}
		key, err := svc.CreateAPIKey(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		c.JSON(http.StatusCreated, gin.H{"code": 0, "data": key, "msg": "ok"})
	})
	keys.GET("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		keys, err := svc.APIKeys(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"keys": keys})
	})
	keys.DELETE("/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RevokeAPIKey(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"revoked": true})
	})
	external := r.Group("")
	external.Use(func(c *gin.Context) { c.Header("Cache-Control", "no-store") })
	external.GET("/model-calls/models", func(c *gin.Context) {
		// 目录允许站内会话读取；显式提供 Bearer 时不得回退 Cookie 鉴权。
		var user *model.User
		if c.GetHeader("Authorization") == "" {
			var err error
			user, err = currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
		} else {
			var okAuth bool
			user, okAuth = externalAPIUser(c, svc)
			if !okAuth {
				return
			}
		}
		items, err := svc.ModelCallCatalog(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"models": items})
	})
	external.POST("/model-calls", func(c *gin.Context) {
		user, okAuth := externalAPIUser(c, svc)
		if !okAuth {
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "tasks:"+user.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		var req service.CreateModelCallRequest
		if !decodeExternalJSON(c, &req, 1<<20) {
			return
		}
		req.TraceID = TraceID(c)
		req.RequestID = RequestID(c)
		call, err := svc.CreateModelCall(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Location", "/api/model-calls/"+call.ID)
		c.JSON(http.StatusAccepted, gin.H{"code": 0, "data": call, "msg": "ok"})
	})
	external.GET("/model-calls/:id", func(c *gin.Context) {
		user, okAuth := externalAPIUser(c, svc)
		if !okAuth {
			return
		}
		call, err := svc.ModelCall(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, call)
	})
	external.GET("/model-calls/:id/media/:resourceId", func(c *gin.Context) {
		user, okAuth := externalAPIUser(c, svc)
		if !okAuth {
			return
		}
		delivery, err := svc.PrepareModelCallMediaDelivery(user.ID, c.Param("id"), c.Param("resourceId"), resourceAccessOptions(c), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		serveResourceDelivery(c, delivery, "private, no-store", "")
	})
}

func externalAPIUser(c *gin.Context, svc *service.Service) (*model.User, bool) {
	if !enforceRateLimit(c, "external-auth:"+c.ClientIP(), 300, time.Minute) {
		return nil, false
	}
	header := c.GetHeader("Authorization")
	scheme, token, found := strings.Cut(header, " ")
	if !found || !strings.EqualFold(scheme, "Bearer") || strings.ContainsAny(token, " \t\r\n") {
		c.Header("WWW-Authenticate", "Bearer")
		fail(c, http.StatusUnauthorized, errors.New("需要 Bearer API Key"))
		return nil, false
	}
	user, err := svc.AuthenticateAPIKey(token)
	if err != nil {
		c.Header("WWW-Authenticate", "Bearer")
		failService(c, err)
		return nil, false
	}
	return user, true
}

func decodeExternalJSON(c *gin.Context, target any, limit int64) bool {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	err := decoder.Decode(target)
	if err == nil {
		var trailing any
		err = decoder.Decode(&trailing)
		if errors.Is(err, io.EOF) {
			return true
		}
		if err == nil {
			err = errors.New("multiple JSON values")
		}
	}
	var tooLarge *http.MaxBytesError
	if errors.As(err, &tooLarge) {
		fail(c, http.StatusRequestEntityTooLarge, errors.New("请求体过大"))
	} else {
		fail(c, http.StatusBadRequest, errors.New("请求 JSON 格式或字段无效"))
	}
	return false
}

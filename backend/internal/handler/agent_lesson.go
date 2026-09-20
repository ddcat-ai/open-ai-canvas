package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAgentMemoryRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/agent/memories", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, _ := strconv.Atoi(c.Query("limit"))
		memories, err := svc.UserAgentMemories(user.ID, strings.TrimSpace(c.Query("status")), limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"memories": memories})
	})
	r.POST("/agent/memories", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AgentMemoryRequest
		if err := decodeAgentJSON(c, &req, 64<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		view, err := svc.CreateUserAgentMemory(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.GET("/agent/memories/export", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		bundle, err := svc.ExportUserAgentMemories(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, bundle)
	})
	r.POST("/agent/memories/import", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var bundle service.AgentMemoryBundle
		if err := decodeAgentJSON(c, &bundle, 512<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ImportUserAgentMemories(user.ID, bundle)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/agent/memories/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.UserAgentMemoryCompact(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.PATCH("/agent/memories/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AgentMemorySettingRequest
		if err := decodeAgentJSON(c, &req, 8<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		view, err := svc.UpdateUserAgentMemorySetting(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.POST("/agent/memories/compact", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AgentMemoryCompactRequest
		if err := decodeAgentJSON(c, &req, 8<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		view, err := svc.CompactUserAgentMemories(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.PATCH("/agent/memories/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.AgentMemoryRequest
		if err := decodeAgentJSON(c, &req, 64<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		view, err := svc.UpdateUserAgentMemory(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	r.POST("/agent/memories/:id/decide", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request struct {
			Decision string `json:"decision"`
		}
		if err := decodeAgentJSON(c, &request, 4<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.DecideUserAgentMemory(user.ID, c.Param("id"), request.Decision); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id"), "decision": request.Decision})
	})
	r.DELETE("/agent/memories/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteUserAgentMemory(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
}

func RegisterAgentLessonAdminRoutes(r *gin.RouterGroup, svc *service.Service) {
	admin := r.Group("/admin/agent-lessons")

	admin.GET("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		limit, _ := strconv.Atoi(c.Query("limit"))
		lessons, err := svc.AdminAgentLessons(
			strings.TrimSpace(c.Query("status")),
			strings.TrimSpace(c.Query("userId")),
			strings.TrimSpace(c.Query("keyword")),
			limit,
		)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"lessons": lessons})
	})

	admin.DELETE("/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		if err := svc.AdminDeleteAgentLesson(c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
}

func decodeAgentJSON(c *gin.Context, dest any, maxBytes int64) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("请求必须只包含一个 JSON 对象")
	}
	return nil
}

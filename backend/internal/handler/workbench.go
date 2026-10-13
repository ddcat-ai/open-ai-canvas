package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterWorkbenchRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/workbench/tools", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		kind := c.Query("kind")
		tools, err := svc.PublicWorkbenchTools(kind)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"tools": tools})
	})
	r.GET("/workbench/tasks", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, err := parsePositiveQueryInt(c.Query("pageSize"), 50)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		tasks, err := svc.WorkbenchTasks(user.ID, c.Query("kind"), c.Query("activeOnly") == "true", limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, tasks)
	})
	r.POST("/workbench/tasks", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "tasks:"+user.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20)
		var req service.WorkbenchTaskInput
		if err := decodeWorkbenchJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		task, err := svc.CreateWorkbenchTask(user.ID, req, TraceID(c), RequestID(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, task)
	})
	admin := r.Group("/admin/workbench/tools")
	admin.GET("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.AdminWorkbenchTools(user, c.Query("kind"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"tools": items})
	})
	admin.POST("", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.WorkbenchToolInput
		if err := decodeWorkbenchJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.CreateWorkbenchTool(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"tool": item})
	})
	admin.PATCH("/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.WorkbenchToolInput
		if err := decodeWorkbenchJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.UpdateWorkbenchTool(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"tool": item})
	})
	admin.POST("/:id/publish", func(c *gin.Context) { setWorkbenchToolState(c, svc, true) })
	admin.POST("/:id/unpublish", func(c *gin.Context) { setWorkbenchToolState(c, svc, false) })
	admin.POST("/:id/presets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		var req service.WorkbenchPresetInput
		if err := decodeWorkbenchJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if req.ToolID != c.Param("id") {
			failService(c, service.BadAuthRequest("预设所属工具与路径不匹配"))
			return
		}
		item, err := svc.CreateWorkbenchPreset(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"preset": item})
	})
	admin.PATCH("/:id/presets/:presetId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.WorkbenchPresetInput
		if err := decodeWorkbenchJSON(c, &req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.UpdateWorkbenchPreset(user, c.Param("presetId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"preset": item})
	})
	admin.POST("/:id/presets/:presetId/publish", func(c *gin.Context) { setWorkbenchPresetState(c, svc, true) })
	admin.POST("/:id/presets/:presetId/unpublish", func(c *gin.Context) { setWorkbenchPresetState(c, svc, false) })
}

func setWorkbenchToolState(c *gin.Context, svc *service.Service, enabled bool) {
	user, err := currentUser(c, svc)
	if err != nil {
		failService(c, err)
		return
	}
	if err := svc.SetWorkbenchToolEnabled(user, c.Param("id"), enabled); err != nil {
		failService(c, err)
		return
	}
	ok(c, gin.H{"id": c.Param("id"), "enabled": enabled})
}
func setWorkbenchPresetState(c *gin.Context, svc *service.Service, enabled bool) {
	user, err := currentUser(c, svc)
	if err != nil {
		failService(c, err)
		return
	}
	if err := svc.SetWorkbenchPresetEnabled(user, c.Param("presetId"), enabled); err != nil {
		failService(c, err)
		return
	}
	ok(c, gin.H{"id": c.Param("presetId"), "enabled": enabled})
}

func decodeWorkbenchJSON(c *gin.Context, target any) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return errors.New("请求必须只包含一个 JSON 对象")
	}
	return nil
}

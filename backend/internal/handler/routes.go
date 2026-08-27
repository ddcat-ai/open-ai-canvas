package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterTaskRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/text-replay-stats", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		stats, err := svc.AdminTextReplayStats(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, stats)
	})
	r.POST("/tasks", func(c *gin.Context) {
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
		var req service.CreateTaskRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		req.TraceID = TraceID(c)
		req.RequestID = RequestID(c)
		task, err := svc.CreateTask(user.ID, req)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ok(c, task)
	})
	r.GET("/tasks", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		tasks, err := svc.TasksWithOptions(user.ID, service.TaskListOptions{
			Limit:      limit,
			ProjectID:  c.Query("projectId"),
			ActiveOnly: c.Query("activeOnly") == "true",
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, tasks)
	})
	r.GET("/tasks/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		task, err := svc.Task(user.ID, c.Param("id"))
		if err != nil {
			fail(c, http.StatusNotFound, err)
			return
		}
		ok(c, task)
	})
	r.POST("/tasks/:id/text-deltas", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			Content string `json:"content"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.AppendTaskTextDelta(user.ID, c.Param("id"), req.Content)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, item)
	})
	r.GET("/tasks/:id/text-deltas", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		after, _ := strconv.ParseInt(c.DefaultQuery("after", "0"), 10, 64)
		result, err := svc.TaskTextReplay(user.ID, c.Param("id"), after)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/tasks/:id/text-events", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		after, err := taskTextEventCursor(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		initial, err := svc.TaskTextReplay(user.ID, c.Param("id"), after)
		if err != nil {
			failService(c, err)
			return
		}
		streamTaskTextEvents(c, svc, user.ID, c.Param("id"), after, initial)
	})
	r.POST("/tasks/:id/retry", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		task, err := svc.RetryTask(user.ID, c.Param("id"))
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ok(c, task)
	})
	r.POST("/tasks/:id/query-provider", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.QueryFailedVideoTask(c.Request.Context(), user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/tasks/:id/cancel", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		task, err := svc.CancelTask(c.Request.Context(), user.ID, c.Param("id"))
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ok(c, task)
	})
	r.POST("/tasks/:id/text-replay-complete", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			Text string `json:"text"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		task, err := svc.CompleteTextReplayTask(user.ID, c.Param("id"), req.Text)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ok(c, task)
	})
	r.GET("/tasks/:id/logs", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		logs, err := svc.TaskLogs(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, logs)
	})
}

func taskTextEventCursor(c *gin.Context) (int64, error) {
	raw := c.Query("after")
	if raw == "" {
		raw = c.GetHeader("Last-Event-ID")
	}
	if raw == "" {
		return 0, nil
	}
	after, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || after < 0 {
		return 0, errors.New("after 或 Last-Event-ID 必须是非负整数")
	}
	return after, nil
}

func streamTaskTextEvents(c *gin.Context, svc *service.Service, userID string, taskID string, after int64, replay *service.TextReplayResult) {
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	if _, err := fmt.Fprint(c.Writer, ": connected\n\n"); err != nil {
		return
	}
	c.Writer.Flush()
	lastStatus := replay.Status
	lastStage := replay.Stage
	lastProgress := replay.Progress
	writeTaskTextSSE(c, "progress", 0, map[string]any{"status": replay.Status, "stage": replay.Stage, "progress": replay.Progress})

	pollTicker := time.NewTicker(750 * time.Millisecond)
	heartbeatTicker := time.NewTicker(15 * time.Second)
	defer pollTicker.Stop()
	defer heartbeatTicker.Stop()
	for {
		for _, delta := range replay.Deltas {
			writeTaskTextSSE(c, "delta", delta.Sequence, map[string]any{"sequence": delta.Sequence, "content": delta.Content})
			after = delta.Sequence
		}
		if replay.Complete {
			writeTaskTextSSE(c, "terminal", 0, replay)
			return
		}
		select {
		case <-c.Request.Context().Done():
			return
		case <-heartbeatTicker.C:
			if _, err := fmt.Fprint(c.Writer, ": heartbeat\n\n"); err != nil {
				return
			}
			c.Writer.Flush()
		case <-pollTicker.C:
		}
		next, err := svc.TaskTextReplay(userID, taskID, after)
		if err != nil {
			writeTaskTextSSE(c, "error", 0, map[string]string{"message": "任务文本流不可用"})
			return
		}
		if next.Status != lastStatus || next.Stage != lastStage || next.Progress != lastProgress {
			writeTaskTextSSE(c, "progress", 0, map[string]any{"status": next.Status, "stage": next.Stage, "progress": next.Progress})
			lastStatus, lastStage, lastProgress = next.Status, next.Stage, next.Progress
		}
		replay = next
	}
}

func writeTaskTextSSE(c *gin.Context, event string, id int64, value any) {
	data, err := json.Marshal(value)
	if err != nil {
		return
	}
	if id > 0 {
		_, _ = fmt.Fprintf(c.Writer, "id: %d\n", id)
	}
	_, _ = fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event, data)
	c.Writer.Flush()
}

func RegisterSessionRoutes(r *gin.RouterGroup, svc *service.Service) {
	createSession := func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "sessions:"+user.ID, policy.Request.SessionCreatePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20)
		var req service.CreateSessionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		req.TraceID = TraceID(c)
		req.RequestID = RequestID(c)
		detail, err := svc.CreateSession(user.ID, req)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ok(c, detail)
	}
	querySession := func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.SessionDetail(user.ID, c.Param("id"))
		if err != nil {
			fail(c, http.StatusNotFound, err)
			return
		}
		ok(c, detail)
	}
	uploadFile := func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "session-files:"+user.ID, policy.Request.SessionFilePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, (policy.Resource.SessionUploadMB<<20)+(1<<20))
		file, err := c.FormFile("file")
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.StoreUpload(user.ID, c.PostForm("sessionId"), file)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, item)
	}
	downloadResults := func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.SessionDetail(user.ID, c.Param("id"))
		if err != nil {
			fail(c, http.StatusNotFound, err)
			return
		}
		ok(c, detail.Results)
	}
	r.POST("/sessions", createSession)
	r.GET("/sessions/:id", querySession)
	r.POST("/files", uploadFile)
	r.GET("/sessions/:id/results", downloadResults)
}

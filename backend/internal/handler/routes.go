package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterTaskRoutes(r *gin.RouterGroup, svc *service.Service) {
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
			fail(c, http.StatusInternalServerError, err)
			return
		}
		ok(c, tasks)
	})
	r.POST("/tasks/recover", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req struct {
			SubmissionIDs []string `json:"submissionIds"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		tasks, err := svc.TasksForSubmissions(user.ID, req.SubmissionIDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, tasks)
	})
	r.GET("/tasks/:id/text-chunks", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		after, err := taskTextAfterCursor(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		stream, err := svc.TaskTextStream(user.ID, c.Param("id"), after)
		if err != nil {
			fail(c, http.StatusNotFound, err)
			return
		}
		ok(c, stream)
	})
	r.GET("/tasks/:id/text-events", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		after, err := taskTextAfterCursor(c)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		streamTaskTextEvents(c, svc, user.ID, c.Param("id"), after)
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
		task, err := svc.CancelTask(user.ID, c.Param("id"))
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
			fail(c, http.StatusInternalServerError, err)
			return
		}
		ok(c, logs)
	})
}

func taskTextAfterCursor(c *gin.Context) (int64, error) {
	raw := c.Query("after")
	if raw == "" {
		raw = c.GetHeader("Last-Event-ID")
	}
	if raw == "" {
		return 0, nil
	}
	after, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || after < 0 {
		return 0, fmt.Errorf("after 必须是非负整数")
	}
	return after, nil
}

func streamTaskTextEvents(c *gin.Context, svc *service.Service, userID string, taskID string, after int64) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache, no-transform")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Status(http.StatusOK)
	if _, err := fmt.Fprint(c.Writer, ": connected\n\n"); err != nil {
		return
	}
	c.Writer.Flush()
	ticker := time.NewTicker(750 * time.Millisecond)
	defer ticker.Stop()
	lastStatus := ""
	for {
		stream, err := svc.TaskTextStream(userID, taskID, after)
		if err != nil {
			writeTaskTextSSE(c, "error", 0, map[string]string{"message": "任务文本流不可用"})
			return
		}
		for _, chunk := range stream.Chunks {
			writeTaskTextSSE(c, "delta", chunk.Sequence, map[string]interface{}{"attempt": stream.Attempt, "sequence": chunk.Sequence, "delta": chunk.Delta})
			after = chunk.Sequence
		}
		statusKey := fmt.Sprintf("%s:%d:%s", stream.Task.Status, stream.Task.Progress, stream.Task.Stage)
		if statusKey != lastStatus {
			writeTaskTextSSE(c, "status", 0, map[string]interface{}{"attempt": stream.Attempt, "task": stream.Task})
			lastStatus = statusKey
		}
		if stream.Task.Status == "succeeded" || stream.Task.Status == "failed" || stream.Task.Status == "cancelled" {
			writeTaskTextSSE(c, "terminal", 0, map[string]interface{}{"attempt": stream.Attempt, "task": stream.Task})
			return
		}
		c.Writer.Flush()
		select {
		case <-c.Request.Context().Done():
			return
		case <-ticker.C:
		}
	}
}

func writeTaskTextSSE(c *gin.Context, event string, id int64, value interface{}) {
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
			fail(c, http.StatusInternalServerError, err)
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
	r.POST("/create_session", createSession)
	r.GET("/query_session/:id", querySession)
	r.POST("/upload_file", uploadFile)
	r.GET("/download_results/:id", downloadResults)
}

func ok(c *gin.Context, data any) {
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": data, "msg": "ok"})
}

func fail(c *gin.Context, status int, err error) {
	c.JSON(status, gin.H{"code": status, "data": nil, "msg": err.Error()})
}

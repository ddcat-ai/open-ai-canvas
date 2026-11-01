package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"yingce/backend/internal/app"
	"yingce/backend/internal/ecommerceagent"
	"yingce/backend/internal/service"
)

func ecommerceAgentFailure(c *gin.Context, err error) {
	var ae *app.EcommerceAgentError
	if errors.As(err, &ae) {
		status := http.StatusBadRequest
		if ae.Code == "INSUFFICIENT_CREDITS" {
			status = http.StatusPaymentRequired
		}
		if ae.Code == "UPSTREAM_ERROR" {
			status = http.StatusBadGateway
		}
		if ae.Code == "UNAVAILABLE" {
			status = http.StatusServiceUnavailable
		}
		c.JSON(status, gin.H{"code": status, "data": nil, "msg": ae.Message, "reason": ae.Code})
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		fail(c, http.StatusNotFound, errors.New("项目或任务不存在"))
		return
	}
	failService(c, err)
}

func RegisterEcommerceAgentRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/agent/quote", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req ecommerceagent.Request
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		quote, err := svc.QuoteEcommerceAgent(user.ID, req)
		if err != nil {
			ecommerceAgentFailure(c, err)
			return
		}
		ok(c, quote)
	})
	r.POST("/agent/analyze", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req ecommerceagent.Request
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.AnalyzeEcommerceAgent(c.Request.Context(), user.ID, req)
		if err != nil {
			ecommerceAgentFailure(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/agent/recommend", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req ecommerceagent.Request
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.AnalyzeEcommerceAgent(c.Request.Context(), user.ID, req)
		if err != nil {
			ecommerceAgentFailure(c, err)
			return
		}
		ok(c, gin.H{"brief": result.Brief, "recommendations": result.Recommendations, "styleLibrary": result.StyleLibrary})
	})
	r.POST("/agent/help-write", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req struct {
			Text     string `json:"text"`
			Platform string `json:"platform"`
			Language string `json:"language"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.HelpWriteEcommerceAgent(c.Request.Context(), user.ID, req.Text, req.Platform, req.Language)
		if err != nil {
			ecommerceAgentFailure(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/agent/generate", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req ecommerceagent.Request
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		view, err := svc.GenerateEcommerceAgent(c.Request.Context(), user.ID, req, func(ecommerceagent.Event) error { return nil })
		if err != nil {
			ecommerceAgentFailure(c, err)
			return
		}
		ok(c, view)
	})
	r.POST("/agent/generate/stream", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req ecommerceagent.Request
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		c.Header("Content-Type", "text/event-stream; charset=utf-8")
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")
		c.Status(http.StatusOK)
		var mu sync.Mutex
		started := false
		write := func(event ecommerceagent.Event) error {
			data, err := json.Marshal(event)
			if err != nil {
				return err
			}
			mu.Lock()
			defer mu.Unlock()
			if event.Event == "workflow_started" {
				started = true
			}
			if _, err = fmt.Fprintf(c.Writer, "data: %s\n\n", data); err != nil {
				return err
			}
			c.Writer.Flush()
			return nil
		}
		stop := make(chan struct{})
		defer close(stop)
		go func() {
			ticker := time.NewTicker(15 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-stop:
					return
				case <-c.Request.Context().Done():
					return
				case <-ticker.C:
					mu.Lock()
					ready := started
					if !ready {
						_, _ = fmt.Fprint(c.Writer, ": preparing\n\n")
						c.Writer.Flush()
					}
					mu.Unlock()
					if ready {
						_ = write(ecommerceagent.Event{Event: "PING"})
					}
				}
			}
		}()
		_, err = svc.GenerateEcommerceAgent(c.Request.Context(), user.ID, req, write)
		if err != nil {
			code := "UPSTREAM_ERROR"
			message := "生成失败"
			var ae *app.EcommerceAgentError
			if errors.As(err, &ae) {
				code, message = ae.Code, ae.Message
			}
			if errors.Is(err, c.Request.Context().Err()) {
				code, message = "CANCELLED", "任务已取消"
			}
			_ = write(ecommerceagent.Event{Event: "message", Answer: "ERROR: " + message, Data: gin.H{"done": true, "error": true, "code": code}})
		}
	})
	r.POST("/canvas/placeholder", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		var req struct {
			Count       int    `json:"count"`
			ImageCount  int    `json:"imageCount"`
			AspectRatio string `json:"aspectRatio"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		count := req.Count
		if count == 0 {
			count = req.ImageCount
		}
		if count < 1 || count > 15 {
			fail(c, http.StatusBadRequest, errors.New("占位页数须为 1 至 15"))
			return
		}
		if req.AspectRatio == "" {
			req.AspectRatio = "1:1"
		}
		ok(c, ecommerceagent.Placeholder(count, req.AspectRatio))
	})
	r.POST("/canvas/save", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req struct {
			ProjectID    string                      `json:"projectId"`
			PosterCanvas ecommerceagent.PosterCanvas `json:"posterCanvas"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		version, err := svc.SaveEcommerceAgentCanvas(user.ID, req.ProjectID, req.PosterCanvas)
		if err != nil {
			ecommerceAgentFailure(c, err)
			return
		}
		ok(c, version)
	})
	r.GET("/canvas/:projectId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.EcommerceAgentCanvas(user.ID, c.Param("projectId"))
		if err != nil {
			ecommerceAgentFailure(c, err)
			return
		}
		ok(c, view)
	})
	r.GET("/task/:taskId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.EcommerceAgentTask(user.ID, c.Param("taskId"))
		if err != nil {
			ecommerceAgentFailure(c, err)
			return
		}
		ok(c, view)
	})
	r.GET("/agent/projects/:projectId/task", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.LatestEcommerceAgentProjectTask(user.ID, c.Param("projectId"))
		if err != nil {
			ecommerceAgentFailure(c, err)
			return
		}
		ok(c, view)
	})
	r.POST("/task/:taskId/cancel", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.CancelEcommerceAgent(user.ID, c.Param("taskId"))
		if err != nil {
			ecommerceAgentFailure(c, err)
			return
		}
		ok(c, view)
	})
}

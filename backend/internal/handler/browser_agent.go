package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerBrowserAgentRoutes(r *gin.RouterGroup, svc *service.Service) {
	registerClientFailureRoutes(r, svc)
	r.GET("/agent/browser-runs", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		ids, err := svc.BrowserAgentRuns(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, ids)
	})
	r.GET("/agent/runs/:id/runtime/state", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		state, err := svc.BrowserAgentState(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, state)
	})
	for _, action := range []string{"claim", "heartbeat", "step"} {
		r.POST("/agent/runs/:id/runtime/"+action, func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			if !enforceRateLimit(c, "browser-agent:"+user.ID, 180, time.Minute) {
				return
			}
			var input service.BrowserAgentControl
			if err = decodeBrowserInput(c, &input, 4096); err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			var state *service.BrowserAgentState
			switch action {
			case "claim":
				state, err = svc.ClaimBrowserAgent(user.ID, c.Param("id"), input)
			case "heartbeat":
				state, err = svc.HeartbeatBrowserAgent(user.ID, c.Param("id"), input)
			case "step":
				state, err = svc.SubmitBrowserAgentStep(user.ID, c.Param("id"), input)
			}
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, state)
		})
	}
}

func decodeBrowserInput(c *gin.Context, input any, limit int64) error {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
	decoder := json.NewDecoder(c.Request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(input); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("请求必须只包含一个 JSON 对象")
	}
	return nil
}

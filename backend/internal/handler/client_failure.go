package handler

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerClientFailureRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/agent/client-failures", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "client-failure:"+user.ID, 12, time.Minute) {
			return
		}
		var input struct {
			Events []service.ClientFailureInput `json:"events"`
		}
		if err = decodeBrowserInput(c, &input, 64<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ids, err := svc.ReportClientFailures(user.ID, input.Events)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"acceptedEventIds": ids})
	})
	r.GET("/agent/client-failures", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		events, err := svc.OwnClientFailures(user.ID, c.Query("runId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, events)
	})
	r.GET("/admin/agent/client-failures", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		events, err := svc.AdminClientFailures(user, c.Query("userId"), c.Query("runId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, events)
	})
}

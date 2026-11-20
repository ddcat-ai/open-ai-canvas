package handler

import (
	"encoding/json"
	"io"
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterFeishuFeedbackRoutes exposes the unauthenticated Feishu callback and
// the authenticated administrator configuration/preview endpoints.
func RegisterFeishuFeedbackRoutes(api *gin.RouterGroup, svc *service.Service) {
	api.POST("/integrations/feishu/events", func(c *gin.Context) {
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20))
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		challenge, feedback, duplicate, err := svc.HandleFeishuCallback(body, c.Request.Header)
		if err != nil {
			failService(c, err)
			return
		}
		if challenge != "" {
			quoted, _ := json.Marshal(challenge)
			payload := append([]byte(`{"challenge":`), quoted...)
			payload = append(payload, '}')
			c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
			return
		}
		ok(c, gin.H{"received": true, "stored": feedback != nil, "duplicate": duplicate})
	})

	admin := api.Group("/admin/integrations/feishu")
	admin.GET("", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		view, err := svc.FeishuFeedbackSettings(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	admin.PUT("", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var input service.FeishuFeedbackSettingsInput
		if err := decodeAgentJSON(c, &input, 32<<10); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		view, err := svc.SaveFeishuFeedbackSettings(actor, input)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, view)
	})
	admin.POST("/digest", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		state, err := svc.RunFeishuFeedbackDigestNow(c.Request.Context(), actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, state)
	})
}

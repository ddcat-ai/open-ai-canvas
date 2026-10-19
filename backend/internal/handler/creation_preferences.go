package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func registerCreationPreferenceRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/settings/creation-preferences", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		preferences, err := svc.CreationPreferences(user, c.Query("userId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"preferences": preferences})
	})
	r.PATCH("/settings/creation-preferences", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			UserID  string         `json:"userId"`
			Changes map[string]any `json:"changes"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		preferences, err := svc.PatchCreationPreferences(user, req.UserID, req.Changes)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"preferences": preferences})
	})
}

package handler

import (
	"net/http"
	"time"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterDesktopAuthRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/auth/desktop/authorize", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "desktop-authorize:"+actor.ID, 20, 10*time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.DesktopAuthorizationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.AuthorizeDesktop(actor, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.POST("/auth/desktop/token", func(c *gin.Context) {
		if !enforceRateLimit(c, "desktop-token:"+c.ClientIP(), 30, 10*time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req service.DesktopTokenRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ExchangeDesktopAuthorizationCode(req, loginRequestContext(c))
		if err != nil {
			failService(c, err)
			return
		}
		// Deliberately return the opaque session only in the response body, never in a cookie or URL.
		ok(c, gin.H{"user": result.User, "session": result.Session, "expiresIn": result.MaxAgeSecs})
	})
}

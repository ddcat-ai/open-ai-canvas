package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterStyleProfileRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/style-profiles", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		profiles, err := svc.ListStyleProfiles(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"profiles": profiles})
	})
	r.POST("/style-profiles", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 320<<10)
		var req service.StyleProfileRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		profile, err := svc.CreateStyleProfile(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"profile": profile})
	})
	r.PATCH("/style-profiles/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 320<<10)
		var req service.StyleProfileRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		profile, err := svc.UpdateStyleProfile(user.ID, c.Param("id"), req)
		if service.IsProjectNotFound(err) {
			fail(c, http.StatusNotFound, err)
			return
		}
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"profile": profile})
	})
	r.PATCH("/style-profiles/:id/favorite", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.StyleProfileFavoriteRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.SetStyleProfileFavorite(user.ID, c.Param("id"), req.Favorite); service.IsProjectNotFound(err) {
			fail(c, http.StatusNotFound, err)
			return
		} else if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id"), "favorite": req.Favorite})
	})
	r.POST("/style-profiles/:id/use", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.TouchStyleProfile(user.ID, c.Param("id")); service.IsProjectNotFound(err) {
			fail(c, http.StatusNotFound, err)
			return
		} else if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
	r.DELETE("/style-profiles/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteStyleProfile(user.ID, c.Param("id")); service.IsProjectNotFound(err) {
			fail(c, http.StatusNotFound, err)
			return
		} else if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
}

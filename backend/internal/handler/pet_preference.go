package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"yingce/backend/internal/service"
)

func registerPetPreferenceRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/me/pet-preference", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		p, err := svc.PetPreference(user)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"preference": p})
	})
	r.PUT("/me/pet-preference", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
		var p service.PetPreference
		if err = c.ShouldBindJSON(&p); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.UpdatePetPreference(user, p)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"preference": result})
	})
}

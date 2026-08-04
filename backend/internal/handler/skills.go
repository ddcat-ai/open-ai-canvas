package handler

import (
	"strconv"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterSkillRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/skills", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
		result, err := svc.Skills(user.ID, service.SkillListRequest{
			Page: page, PageSize: pageSize, Scope: c.DefaultQuery("scope", "public"),
			Search: c.Query("search"), Tag: c.Query("tag"), Sort: c.DefaultQuery("sort", "popular"),
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/skills/added", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skills, err := svc.AddedSkills(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skills": skills})
	})

	r.GET("/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SkillDetail(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.POST("/skills", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SkillMutationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("技能数据格式无效"))
			return
		}
		skill, err := svc.CreateSkill(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.PUT("/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.SkillMutationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			failService(c, service.BadAuthRequest("技能数据格式无效"))
			return
		}
		skill, err := svc.UpdateSkill(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})

	r.DELETE("/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteSkill(user.ID, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})

	r.POST("/skills/:id/add", setSkillAdded(svc, true))
	r.DELETE("/skills/:id/add", setSkillAdded(svc, false))
	r.POST("/skills/:id/like", setSkillLiked(svc, true))
	r.DELETE("/skills/:id/like", setSkillLiked(svc, false))
}

func setSkillAdded(svc *service.Service, added bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SetSkillAdded(user.ID, c.Param("id"), added)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	}
}

func setSkillLiked(svc *service.Service, liked bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SetSkillLiked(user.ID, c.Param("id"), liked)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	}
}

package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func RegisterEcommerceRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/ecommerce/skills", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.EcommerceManagedSkills(user)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, gin.H{"skills": items})
	})
	r.PATCH("/admin/ecommerce/skills/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1024)
		var req struct {
			Enabled *bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if req.Enabled == nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("请指定 enabled"))
			return
		}
		if err := svc.SetEcommerceManagedSkillEnabled(user, c.Param("id"), *req.Enabled); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"enabled": *req.Enabled})
	})
	r.POST("/ecommerce/projects/:id/tasks", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "tasks:"+user.ID, policy.Request.TaskCreatePerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req service.CreateTaskRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		req.TraceID, req.RequestID = TraceID(c), RequestID(c)
		task, err := svc.CreateEcommercePlanningTask(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, task)
	})
	r.GET("/ecommerce/agent-setting", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.EcommerceAgentSetting()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, setting)
	})
	r.GET("/ecommerce/knowledge/orchestration", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		setting, err := svc.EcommerceOrchestrationSetting(user)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		ok(c, setting)
	})
	r.PUT("/ecommerce/knowledge/orchestration", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req service.EcommerceOrchestrationSetting
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		setting, err := svc.UpdateEcommerceOrchestrationSetting(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, setting)
	})
	r.POST("/ecommerce/creative-directions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.EcommerceCreativeDirectionsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		response, err := svc.RecommendEcommerceCreativeDirectionsContext(c.Request.Context(), user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, response)
	})
	r.POST("/ecommerce/creative-directions/:id/select", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req service.EcommerceStyleChoice
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		selection, err := svc.SelectEcommerceCreativeStyle(c.Request.Context(), user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, selection)
	})
	r.GET("/ecommerce/knowledge/stats", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		stats, err := svc.EcommerceKnowledgeStats()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, stats)
	})
	r.POST("/ecommerce/knowledge/sync", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.SyncEcommerceKnowledge(c.Request.Context(), user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.PATCH("/ecommerce/knowledge/sources/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req struct {
			Enabled *bool `json:"enabled"`
		}
		if err := c.ShouldBindJSON(&req); err != nil || req.Enabled == nil {
			fail(c, http.StatusBadRequest, errors.New("缺少知识源启用状态"))
			return
		}
		if err := svc.SetEcommerceKnowledgeSourceEnabled(user, c.Param("id"), *req.Enabled); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"enabled": *req.Enabled})
	})
	r.GET("/ecommerce/knowledge/entries", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageErr := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, limitErr := strconv.Atoi(c.DefaultQuery("limit", "20"))
		if pageErr != nil || limitErr != nil {
			fail(c, http.StatusBadRequest, errors.New("分页参数无效"))
			return
		}
		result, err := svc.EcommerceKnowledgeEntryPage(user, c.Query("keyword"), c.Query("status"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.PATCH("/ecommerce/knowledge/entries/:id/review", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req struct {
			Status string `json:"status"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.ReviewEcommerceKnowledgeEntry(user, c.Param("id"), req.Status); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"status": req.Status})
	})
	r.POST("/ecommerce/skills/prompt", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<10)
		var req struct {
			SkillIDs []string `json:"skillIds"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		prompt, err := svc.EcommerceSkillPrompt(user.ID, req.SkillIDs)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"prompt": prompt})
	})
	r.GET("/ecommerce/projects", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageErr := strconv.Atoi(c.DefaultQuery("page", "1"))
		pageSize, sizeErr := strconv.Atoi(c.DefaultQuery("pageSize", "100"))
		if pageErr != nil || sizeErr != nil || page < 1 || page > 100000 || (pageSize != 20 && pageSize != 50 && pageSize != 100) {
			fail(c, http.StatusBadRequest, errors.New("分页参数无效"))
			return
		}
		projects, total, err := svc.EcommerceProjectPage(user.ID, page, pageSize)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"projects": projects, "total": total, "page": page, "pageSize": pageSize})
	})
	r.DELETE("/ecommerce/projects", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 80<<10)
		var req service.DeleteEcommerceProjectsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		deleted, err := svc.DeleteEcommerceProjects(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": deleted})
	})
	r.POST("/ecommerce/projects", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		project, err := svc.CreateEcommerceProject(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, project)
	})
	r.GET("/ecommerce/projects/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		project, err := svc.EcommerceProject(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, project)
	})
	r.PUT("/ecommerce/projects/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.SaveEcommerceProjectRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		project, err := svc.SaveEcommerceProject(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, project)
	})
}

// 短剧项目接口：项目列表、创建、详情、概览、更新与删除。

package handler

import (
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func registerProjectCoreRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/projects", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		pageParam, hasPage := c.GetQuery("page")
		pageSizeParam, hasPageSize := c.GetQuery("pageSize")
		if !hasPage && !hasPageSize {
			projects, err := svc.ListProjects(user.ID)
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"projects": projects})
			return
		}
		page, err := parsePositiveQueryInt(pageParam, 1)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		pageSize, err := parsePositiveQueryInt(pageSizeParam, 50)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		projects, err := svc.ListProjectsPage(user.ID, page, pageSize)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, projects)
	})
	r.POST("/projects", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.CreateProjectRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		project, err := svc.CreateProject(user.ID, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"project": project})
	})
	r.GET("/projects/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.ProjectDetail(user.ID, c.Param("id"))
		if err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, detail)
	})
	r.GET("/projects/:id/core", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		core, err := svc.ProjectCore(user.ID, c.Param("id"))
		if err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, core)
	})
	r.GET("/projects/:id/overview", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		overview, err := svc.ProjectOverview(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, overview)
	})
	r.PATCH("/projects/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.UpdateProjectRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		project, err := svc.UpdateProject(user.ID, c.Param("id"), req)
		if err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, gin.H{"project": project})
	})
	r.DELETE("/projects/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteProject(user.ID, c.Param("id")); err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("id")})
	})
}

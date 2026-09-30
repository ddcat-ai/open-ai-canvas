// 项目分集（unit）与画布关联接口。

package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func registerProjectUnitRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/projects/:id/units", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req service.CreateProjectUnitRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		unit, err := svc.CreateProjectUnit(user.ID, c.Param("id"), req)
		if err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, gin.H{"unit": unit})
	})
	r.GET("/projects/:id/units", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		units, err := svc.ProjectUnitSummaries(user.ID, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, units)
	})
	r.GET("/projects/:id/units/:unitId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		unit, err := svc.GetProjectUnit(user.ID, c.Param("id"), c.Param("unitId"))
		if err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, gin.H{"unit": unit})
	})
	r.GET("/projects/:id/units/:unitId/workspace", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		workspace, err := svc.ProjectUnitWorkspace(user.ID, c.Param("id"), c.Param("unitId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, workspace)
	})
	r.POST("/projects/:id/units/import", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		// 长篇小说可能包含两千章以上，限制请求体防止滥用的同时为整本原子导入留足空间。
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<20)
		var req service.ImportProjectUnitsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		units, err := svc.ImportProjectUnits(user.ID, c.Param("id"), req)
		if err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		// 导入响应只需返回新章节标识与摘要，正文不再原样回传一次。
		for index := range units {
			units[index].SourceText = ""
		}
		ok(c, gin.H{"units": units})
	})
	r.PATCH("/projects/:id/units/reorder", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.ReorderProjectUnitsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.ReorderProjectUnits(user.ID, c.Param("id"), req); err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, gin.H{"unitIds": req.UnitIDs})
	})
	r.PATCH("/projects/:id/units/:unitId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req service.UpdateProjectUnitRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		unit, err := svc.UpdateProjectUnit(user.ID, c.Param("id"), c.Param("unitId"), req)
		if err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, gin.H{"unit": unit})
	})
	r.DELETE("/projects/:id/units/:unitId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteProjectUnit(user.ID, c.Param("id"), c.Param("unitId")); err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("unitId")})
	})
	r.POST("/projects/:id/canvas-links", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.LinkCanvasUnitRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		link, err := svc.LinkCanvasUnit(user.ID, c.Param("id"), req)
		if err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, gin.H{"link": link})
	})
	r.DELETE("/projects/:id/canvas-links/:canvasId/units/:unitId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.UnlinkCanvasUnit(user.ID, c.Param("id"), c.Param("canvasId"), c.Param("unitId")); err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, gin.H{"canvasId": c.Param("canvasId"), "unitId": c.Param("unitId")})
	})
	r.DELETE("/projects/:id/canvases/:canvasId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.UnlinkCanvasProject(user.ID, c.Param("id"), c.Param("canvasId")); err != nil {
			if service.IsProjectNotFound(err) {
				fail(c, http.StatusNotFound, err)
				return
			}
			failService(c, err)
			return
		}
		ok(c, gin.H{"canvasId": c.Param("canvasId")})
	})
	r.GET("/projects/:id/canvases", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, err := parsePositiveQueryInt(c.Query("page"), 1)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		pageSize, err := parsePositiveQueryInt(c.Query("pageSize"), 40)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ProjectCanvasesPage(user.ID, c.Param("id"), page, pageSize)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

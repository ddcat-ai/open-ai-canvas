package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterNovelWorkbenchRoutes 将长篇创作任务与通用项目工作台分开暴露。
// 作品正文仍可在现有项目章节页中编辑和进入后续制作流程。
func RegisterNovelWorkbenchRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/novel-workbench/runs", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		runs, err := svc.ListNovelWorkbenchRuns(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"runs": runs})
	})
	r.POST("/novel-workbench/runs", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512<<10)
		var req service.StartNovelWorkbenchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.StartNovelWorkbench(user.ID, req)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ok(c, result)
	})
	r.GET("/novel-workbench/runs/:projectId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		detail, err := svc.NovelWorkbenchRunDetail(user.ID, c.Param("projectId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, detail)
	})
	r.POST("/novel-workbench/runs/:projectId/pause", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		run, err := svc.PauseNovelWorkbench(c.Request.Context(), user.ID, c.Param("projectId"))
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ok(c, gin.H{"run": run})
	})
	r.POST("/novel-workbench/runs/:projectId/resume", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.ResumeNovelWorkbenchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		run, task, err := svc.ResumeNovelWorkbench(user.ID, c.Param("projectId"), req)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ok(c, gin.H{"run": run, "task": task})
	})
	r.POST("/novel-workbench/runs/:projectId/rebuild", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.RebuildNovelWorkbenchRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.RebuildNovelWorkbench(c.Request.Context(), user.ID, c.Param("projectId"), req)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		ok(c, result)
	})
}

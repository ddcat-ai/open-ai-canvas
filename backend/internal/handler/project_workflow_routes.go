// 项目工作流、镜头、镜头素材引用与素材候选接口。

package handler

import (
	"net/http"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func registerProjectWorkflowRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/projects/:id/workflows", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req struct {
			UnitID string `json:"unitId"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		workflow, err := svc.CreateUnitWorkflow(user.ID, c.Param("id"), req.UnitID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"workflow": workflow})
	})
	r.PATCH("/projects/:id/workflow-steps/:stepId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.UpdateWorkflowStepRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		step, err := svc.UpdateWorkflowStep(user.ID, c.Param("id"), c.Param("stepId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"step": step})
	})
	r.POST("/projects/:id/workflow-steps/:stepId/task-output", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.RegisterTaskOutputRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		step, err := svc.RegisterTaskOutput(user.ID, c.Param("id"), c.Param("stepId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"step": step})
	})
	r.POST("/projects/:id/shots", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.CreateProjectShotRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		shot, err := svc.CreateProjectShot(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"shot": shot})
	})
	r.PUT("/projects/:id/units/:unitId/shots", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req service.ReplaceProjectUnitShotsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		shots, err := svc.ReplaceProjectUnitShots(user.ID, c.Param("id"), c.Param("unitId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"shots": shots})
	})
	r.POST("/projects/:id/shots/:shotId/revisions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.ShotRevisionInput
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		shot, revision, err := svc.CreateShotRevision(user.ID, c.Param("id"), c.Param("shotId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"shot": shot, "revision": revision})
	})
	r.DELETE("/projects/:id/shots/:shotId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteProjectShot(user.ID, c.Param("id"), c.Param("shotId")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"deleted": true})
	})
	r.POST("/projects/:id/shots/:shotId/assets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.LinkShotAssetRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		reference, err := svc.LinkShotAsset(user.ID, c.Param("id"), c.Param("shotId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"reference": reference})
	})
	r.DELETE("/projects/:id/shots/:shotId/assets/:referenceId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.UnlinkShotAsset(user.ID, c.Param("id"), c.Param("shotId"), c.Param("referenceId")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"unlinked": true})
	})
	r.POST("/projects/:id/asset-candidates", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 512<<10)
		var req service.CreateAssetCandidatesRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		candidates, err := svc.CreateProjectAssetCandidates(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"candidates": candidates})
	})
	r.GET("/projects/:id/asset-candidates", func(c *gin.Context) {
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
		pageSize, err := parsePositiveQueryInt(c.Query("pageSize"), 100)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ProjectAssetCandidatesPage(user.ID, c.Param("id"), page, pageSize, c.Query("unitId"), c.Query("status"), c.Query("category"), c.Query("q"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/projects/:id/asset-candidates/:candidateId/confirm", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.ConfirmProjectAssetCandidateRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		asset, err := svc.ConfirmProjectAssetCandidate(user.ID, c.Param("id"), c.Param("candidateId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})
}

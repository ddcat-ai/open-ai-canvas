package handler

import (
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterProjectRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/voice-profiles", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		profiles, err := svc.ListVoiceProfiles(user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"profiles": profiles})
	})
	r.GET("/projects", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		projects, err := svc.ListProjects(user.ID)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		ok(c, gin.H{"projects": projects})
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
			fail(c, http.StatusInternalServerError, err)
			return
		}
		ok(c, detail)
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
	r.GET("/projects/:id/assets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		assets, err := svc.FilterProjectAssets(user.ID, c.Param("id"), service.ProjectAssetFilter{Category: c.Query("category"), MediaType: c.Query("mediaType"), Status: c.Query("status"), Usage: c.Query("usage")})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"assets": assets})
	})
	r.POST("/projects/:id/characters", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.CreateProjectCharacterRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		character, err := svc.CreateProjectCharacter(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, character)
	})
	r.GET("/projects/:id/characters/:assetId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		character, err := svc.ProjectCharacter(user.ID, c.Param("id"), c.Param("assetId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, character)
	})
	r.PATCH("/projects/:id/characters/:assetId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.UpdateProjectCharacterRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		character, err := svc.UpdateProjectCharacter(user.ID, c.Param("id"), c.Param("assetId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, character)
	})
	r.PUT("/projects/:id/characters/:assetId/representations", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128<<10)
		var req service.ReplaceCharacterRepresentationsRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		character, err := svc.ReplaceProjectCharacterRepresentations(user.ID, c.Param("id"), c.Param("assetId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, character)
	})
	r.PUT("/projects/:id/characters/:assetId/voice", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.BindCharacterVoiceRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		character, err := svc.BindProjectCharacterVoice(user.ID, c.Param("id"), c.Param("assetId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, character)
	})
	r.DELETE("/projects/:id/characters/:assetId/voice", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		character, err := svc.UnbindProjectCharacterVoice(user.ID, c.Param("id"), c.Param("assetId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, character)
	})
	r.POST("/projects/:id/assets", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.LinkProjectAssetRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		asset, err := svc.LinkProjectAsset(user.ID, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})
	r.DELETE("/projects/:id/assets/:assetId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.UnlinkProjectAsset(user.ID, c.Param("id"), c.Param("assetId")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"id": c.Param("assetId")})
	})
	r.PATCH("/projects/:id/assets/:assetId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var req service.UpdateProjectAssetCategoryRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		asset, err := svc.UpdateProjectAssetCategory(user.ID, c.Param("id"), c.Param("assetId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"asset": asset})
	})
	r.POST("/projects/:id/assets/:assetId/versions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.CreateAssetVersionRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		version, err := svc.CreateProjectAssetVersion(user.ID, c.Param("id"), c.Param("assetId"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"version": version})
	})
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

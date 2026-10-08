package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"yingce/backend/internal/service"
)

func RegisterCreationRoutes(r *gin.RouterGroup, svc *service.Service) {
	read := func(action string) gin.HandlerFunc {
		return func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			var value any
			switch action {
			case "list":
				value, err = svc.ListCreationRuns(user.ID)
			case "get":
				value, err = svc.GetCreationRun(user.ID, c.Param("id"))
			case "snapshot":
				value, err = svc.CreationCanvasSnapshot(user.ID, c.Param("id"))
			}
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, value)
		}
	}
	write := func(action string) gin.HandlerFunc {
		return func(c *gin.Context) {
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
			var req service.CreationRequest
			if err = c.ShouldBindJSON(&req); err != nil {
				fail(c, http.StatusBadRequest, err)
				return
			}
			var value any
			id := c.Param("id")
			switch action {
			case "create":
				value, err = svc.CreateCreationRun(user.ID, req)
			case "prepare":
				value, err = svc.PrepareCreationSubmission(user.ID, id, req)
			case "approve":
				value, err = svc.ApproveCreationSubmissions(user.ID, id, req)
			case "refresh-quote":
				value, err = svc.RefreshCreationSubmission(user.ID, id, req)
			case "execute":
				value, err = svc.ExecuteCreationSubmission(user.ID, id, req)
			case "canvas":
				value, err = svc.CreateRunCanvas(user.ID, id, req)
			case "commit":
				value, err = svc.CommitCreationCanvas(user.ID, id, req)
			default:
				value, err = svc.ChangeCreationRun(user.ID, id, action, req)
			}
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, value)
		}
	}
	r.GET("/creation-runs", read("list"))
	r.POST("/creation-runs", write("create"))
	r.GET("/creation-runs/:id", read("get"))
	r.PATCH("/creation-runs/:id", write("save"))
	for _, action := range []string{"claim", "heartbeat", "release", "proposal-approve", "proposal-invalidate"} {
		r.POST("/creation-runs/:id/"+action, write(action))
	}
	r.POST("/creation-runs/:id/submissions/prepare", write("prepare"))
	r.POST("/creation-runs/:id/submissions/approve", write("approve"))
	r.POST("/creation-runs/:id/submissions/refresh", write("refresh-quote"))
	r.POST("/creation-runs/:id/execute", write("execute"))
	r.POST("/creation-runs/:id/canvas", write("canvas"))
	r.GET("/creation-runs/:id/canvas-snapshot", read("snapshot"))
	r.POST("/creation-runs/:id/canvas-commit", write("commit"))
}

package handler

import (
	"errors"
	"net/http"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterLogicalModelRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/models", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		models, err := svc.PublicLogicalModels(nil)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"models": models})
	})
	r.POST("/models/available", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		var intent service.ModelRequestIntent
		if err := c.ShouldBindJSON(&intent); err != nil {
			fail(c, http.StatusBadRequest, errors.New("模型能力请求格式错误"))
			return
		}
		models, err := svc.PublicLogicalModels(&intent)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"models": models})
	})
	r.POST("/models/:id/quote", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		var intent service.ModelRequestIntent
		if err := c.ShouldBindJSON(&intent); err != nil {
			fail(c, http.StatusBadRequest, errors.New("模型报价请求格式错误"))
			return
		}
		quote, err := svc.QuoteLogicalModel(c.Param("id"), intent)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"quote": quote})
	})
	r.GET("/admin/logical-models", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		models, err := svc.AdminLogicalModels(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"models": models})
	})
	r.POST("/admin/logical-models", func(c *gin.Context) {
		saveAdminLogicalModel(c, svc, "")
	})
	r.PATCH("/admin/logical-models/:id", func(c *gin.Context) {
		saveAdminLogicalModel(c, svc, c.Param("id"))
	})
	r.DELETE("/admin/logical-models/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteAdminLogicalModel(actor, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
	r.POST("/admin/logical-models/:id/simulate", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var intent service.ModelRequestIntent
		if err := c.ShouldBindJSON(&intent); err != nil {
			fail(c, http.StatusBadRequest, errors.New("路由模拟请求格式错误"))
			return
		}
		result, err := svc.SimulateLogicalModelRoute(actor, c.Param("id"), intent)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

func saveAdminLogicalModel(c *gin.Context, svc *service.Service, id string) {
	actor, err := currentUser(c, svc)
	if err != nil {
		failService(c, err)
		return
	}
	var req service.LogicalModelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, errors.New("前台模型参数格式错误"))
		return
	}
	item, err := svc.SaveAdminLogicalModel(actor, id, req)
	if err != nil {
		failService(c, err)
		return
	}
	ok(c, gin.H{"model": item})
}

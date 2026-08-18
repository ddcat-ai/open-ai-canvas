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
	r.GET("/admin/logical-models/physical-variants", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.AdminPhysicalVariantsForChannelModel(actor, c.Query("channelModelId"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"variants": items})
	})
	r.POST("/admin/logical-models/physical-variants", func(c *gin.Context) {
		saveAdminPhysicalVariant(c, svc, "")
	})
	r.PATCH("/admin/logical-models/physical-variants/:id", func(c *gin.Context) {
		saveAdminPhysicalVariant(c, svc, c.Param("id"))
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

func saveAdminPhysicalVariant(c *gin.Context, svc *service.Service, id string) {
	actor, err := currentUser(c, svc)
	if err != nil {
		failService(c, err)
		return
	}
	var req service.PhysicalVariantRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, errors.New("可用配置参数格式错误"))
		return
	}
	item, err := svc.SaveAdminPhysicalVariant(actor, id, req)
	if err != nil {
		failService(c, err)
		return
	}
	ok(c, gin.H{"variant": item})
}

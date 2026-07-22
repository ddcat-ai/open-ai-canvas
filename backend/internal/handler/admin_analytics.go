package handler

import (
	"fmt"
	"net/http"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterAdminAnalyticsRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/analytics/overview", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminAnalytics(user, analyticsQuery(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/analytics/models", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminAnalytics(user, analyticsQuery(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"models": result.Models})
	})
	r.GET("/admin/analytics/users", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminAnalytics(user, analyticsQuery(c))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"users": result.Users, "dau": result.KPI.DAU, "wau": result.KPI.WAU, "mau": result.KPI.MAU})
	})
	r.GET("/admin/analytics/export.csv", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		data, err := svc.AdminAnalyticsCSV(user, analyticsQuery(c))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=usage-%s.csv", time.Now().UTC().Format("20060102-150405")))
		c.Data(http.StatusOK, "text/csv; charset=utf-8", data)
	})
	r.GET("/admin/model-pricings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.AdminModelPricings(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"pricings": items})
	})
	r.POST("/admin/model-pricings", func(c *gin.Context) {
		saveModelPricing(c, svc, "")
	})
	r.PATCH("/admin/model-pricings/:id", func(c *gin.Context) {
		saveModelPricing(c, svc, c.Param("id"))
	})
	r.DELETE("/admin/model-pricings/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.DeleteModelPricing(user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})
}

func saveModelPricing(c *gin.Context, svc *service.Service, id string) {
	user, err := currentUser(c, svc)
	if err != nil {
		failService(c, err)
		return
	}
	var req service.ModelPricingRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	pricing, err := svc.SaveModelPricing(user, id, req)
	if err != nil {
		failService(c, err)
		return
	}
	ok(c, gin.H{"pricing": pricing})
}

func analyticsQuery(c *gin.Context) service.AnalyticsQuery {
	return service.AnalyticsQuery{
		From: c.Query("from"), To: c.Query("to"), UserID: c.Query("userId"),
		Model: c.Query("model"), ChannelID: c.Query("channelId"), Capability: c.Query("capability"),
	}
}

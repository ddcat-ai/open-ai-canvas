package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterPaymentRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/recharge-products", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		products, err := svc.RechargeProducts()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"products": products})
	})
	r.GET("/payment-channels", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		channels, err := svc.RechargePaymentChannels()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channels": channels})
	})
	r.POST("/recharge-orders", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "recharge-create:"+user.ID, 20, time.Hour) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			ProductID string `json:"productId"`
			ChannelID string `json:"channelId"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		order, err := svc.CreateRechargeOrder(c.Request.Context(), user, req.ProductID, req.ChannelID, c.GetHeader("X-Idempotency-Key"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"order": order, "serverTime": time.Now()})
	})
	r.GET("/recharge-orders", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		result, err := svc.RechargeOrders(user, page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, result)
	})
	r.GET("/recharge-orders/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		order, err := svc.RechargeOrder(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"order": order, "serverTime": time.Now()})
	})
	r.POST("/recharge-orders/:id/sync", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "recharge-sync:"+user.ID+":"+c.Param("id"), 30, time.Minute) {
			return
		}
		order, err := svc.SyncRechargeOrder(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, gin.H{"order": order, "serverTime": time.Now()})
	})
	r.POST("/recharge-orders/:id/close", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		order, err := svc.CloseRechargeOrder(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order, "serverTime": time.Now()})
	})

	registerAdminPaymentRoutes(r, svc)
}

func RegisterPaymentNotifyRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/payment-notify/wechat/:channelVersionId", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		if err := svc.HandleWechatPaymentNotification(c.Request.Context(), c.Param("channelVersionId"), c.Request); err != nil {
			failService(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	})
}

func registerAdminPaymentRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/payment-channels", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		channels, err := svc.AdminPaymentChannels(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channels": channels})
	})
	r.POST("/admin/payment-channels", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.CreatePaymentChannelRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		channel, err := svc.CreateAdminPaymentChannel(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, channel)
	})
	r.GET("/admin/payment-channels/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		channel, err := svc.AdminPaymentChannel(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "no-store")
		ok(c, channel)
	})
	r.PATCH("/admin/payment-channels/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req service.UpdatePaymentChannelRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		channel, err := svc.UpdateAdminPaymentChannel(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, channel)
	})
	r.POST("/admin/payment-channels/:id/versions", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256<<10)
		var req service.PaymentChannelCredentialRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		channel, err := svc.RotateAdminPaymentChannelVersion(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, channel)
	})
	r.POST("/admin/payment-channels/:id/test", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "payment-channel-test:"+user.ID+":"+c.Param("id"), 5, time.Minute) {
			return
		}
		if err := svc.TestAdminPaymentChannel(c.Request.Context(), user, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"ok": true})
	})

	r.GET("/admin/recharge-products", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		products, err := svc.AdminRechargeProducts(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"products": products})
	})
	r.POST("/admin/recharge-products", func(c *gin.Context) { saveRechargeProduct(c, svc, "") })
	r.PATCH("/admin/recharge-products/:id", func(c *gin.Context) { saveRechargeProduct(c, svc, c.Param("id")) })

	r.GET("/admin/payment-orders", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		result, err := svc.AdminPaymentOrderPage(user, service.AdminListQuery{Keyword: c.Query("keyword"), Status: c.Query("status"), Page: page, Limit: limit})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/payment-orders/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		order, err := svc.AdminPaymentOrder(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})
	r.POST("/admin/payment-orders/:id/query", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		order, err := svc.AdminSyncPaymentOrder(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})
	r.POST("/admin/payment-orders/:id/close", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		order, err := svc.AdminClosePaymentOrder(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})

	r.GET("/admin/payment-reconciliations", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		result, err := svc.AdminPaymentReconciliationRuns(user, page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/payment-reconciliations/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminPaymentReconciliationDetail(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/payment-reconciliations/run", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "payment-reconciliation:"+user.ID, 10, time.Hour) {
			return
		}
		var req struct {
			ChannelID string `json:"channelId"`
			BillDate  string `json:"billDate"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.AdminRunPaymentReconciliation(c.Request.Context(), user, req.ChannelID, req.BillDate)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

func saveRechargeProduct(c *gin.Context, svc *service.Service, id string) {
	user, err := currentUser(c, svc)
	if err != nil {
		failService(c, err)
		return
	}
	var req service.RechargeProductRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	product, err := svc.SaveAdminRechargeProduct(user, strings.TrimSpace(id), req)
	if err != nil {
		failService(c, err)
		return
	}
	ok(c, gin.H{"product": product})
}

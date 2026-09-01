package handler

import (
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

const maxPaymentNotificationBytes = 64 << 10

func RegisterPaymentRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/credit-recharge/catalog", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		catalog, err := svc.RechargeCatalog(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, catalog)
	})
	r.POST("/credit-recharge/orders", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "credit-recharge-create:"+user.ID, 20, time.Hour) {
			return
		}
		var request service.CreateRechargeOrderRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		request.ClientIP = c.ClientIP()
		order, err := svc.CreateRechargeOrder(c.Request.Context(), user, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})
	r.GET("/credit-recharge/orders", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		result, err := svc.UserRechargeOrders(user, page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/credit-recharge/orders/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		order, err := svc.UserRechargeOrder(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})
	r.POST("/credit-recharge/orders/:id/sync", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "credit-recharge-sync:"+user.ID+":"+c.Param("id"), 30, time.Minute) {
			return
		}
		order, err := svc.SyncRechargeOrder(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})
	r.POST("/credit-recharge/orders/:id/close", func(c *gin.Context) {
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
		ok(c, gin.H{"order": order})
	})

	// Payment callbacks deliberately have no login or feature-flag guard. A
	// disabled recharge entry must not prevent an already-paid order crediting.
	r.POST("/payments/notifications/:provider/:channelId/:configVersionId", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxPaymentNotificationBytes)
		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			status := http.StatusBadRequest
			var maxBytesError *http.MaxBytesError
			if errors.As(err, &maxBytesError) {
				status = http.StatusRequestEntityTooLarge
			}
			c.JSON(status, gin.H{"code": "FAIL", "message": "invalid notification body"})
			return
		}
		if err := svc.HandlePaymentNotification(c.Request.Context(), c.Param("provider"), c.Param("channelId"), c.Param("configVersionId"), c.Request.Header, body); err != nil {
			var appError *service.AppError
			status := http.StatusInternalServerError
			if errors.As(err, &appError) && appError.Status >= 400 && appError.Status <= 599 {
				status = appError.Status
			}
			c.JSON(status, gin.H{"code": "FAIL", "message": "notification processing failed"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": "SUCCESS", "message": "成功"})
	})

	r.GET("/admin/payment-providers", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.PaymentProviderDescriptors(actor)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"providers": items})
	})
	r.GET("/admin/payment-channels", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.AdminPaymentChannels(actor, c.Query("includeArchived") == "true")
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channels": items})
	})
	r.POST("/admin/payment-channels", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.PaymentChannelRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.CreatePaymentChannel(actor, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channel": item})
	})
	r.PATCH("/admin/payment-channels/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.PaymentChannelRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.UpdatePaymentChannel(actor, c.Param("id"), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channel": item})
	})
	r.DELETE("/admin/payment-channels/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.ArchivePaymentChannel(actor, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"archived": true})
	})
	r.POST("/admin/payment-channels/:id/config-versions", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.PaymentChannelConfigRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		version, err := svc.SavePaymentChannelConfig(actor, c.Param("id"), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"configVersion": version})
	})
	r.POST("/admin/payment-channels/:id/test", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "payment-channel-test:"+actor.ID+":"+c.Param("id"), 10, time.Hour) {
			return
		}
		channel, err := svc.TestPaymentChannel(c.Request.Context(), actor, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channel": channel})
	})

	r.GET("/admin/credit-packages", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.AdminCreditPackages(actor, c.Query("includeArchived") == "true")
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"packages": items})
	})
	r.POST("/admin/credit-packages", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.CreditPackageRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.CreateCreditPackage(actor, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"package": item})
	})
	r.PATCH("/admin/credit-packages/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.CreditPackageRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		item, err := svc.UpdateCreditPackage(actor, c.Param("id"), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"package": item})
	})
	r.DELETE("/admin/credit-packages/:id", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.ArchiveCreditPackage(actor, c.Param("id")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"archived": true})
	})
	r.GET("/admin/recharge-orders", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		result, err := svc.AdminRechargeOrders(actor, c.Query("status"), c.Query("userId"), c.Query("channelId"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.POST("/admin/payment-reconciliation", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "payment-reconciliation:"+actor.ID, 10, time.Hour) {
			return
		}
		var request service.PaymentReconciliationRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ReconcilePaymentChannel(c.Request.Context(), actor, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/payment-reconciliation", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
		result, err := svc.PaymentReconciliationRuns(actor, c.Query("channelId"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/payment-reconciliation/:id/anomalies", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		items, err := svc.PaymentReconciliationAnomalies(actor, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"anomalies": items})
	})
	r.POST("/admin/payment-reconciliation/:id/anomalies/:anomalyId/resolve", func(c *gin.Context) {
		actor, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request struct {
			Note string `json:"note"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if err := svc.ResolvePaymentReconciliationAnomaly(actor, c.Param("id"), c.Param("anomalyId"), request.Note); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"resolved": true})
	})
}

package handler

import (
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

const paymentNotificationMaxBytes = 1 << 20

var paymentOrderIDPattern = regexp.MustCompile(`^[a-f0-9]{32}$`)

func RegisterPaymentRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/payments/providers", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		providers, err := svc.PaymentProviders(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"providers": providers})
	})
	r.GET("/payments/products", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		products, err := svc.TopupProducts(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"products": products})
	})
	r.POST("/payments/orders", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "payment-order:"+user.ID, 20, time.Hour) {
			return
		}
		var request service.CreatePaymentOrderRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		order, err := svc.CreatePaymentOrder(c.Request.Context(), user, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})
	r.GET("/payments/orders/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		order, err := svc.PaymentOrder(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})
	r.POST("/payments/orders/:id/query", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "payment-query:"+user.ID+":"+c.Param("id"), 30, time.Minute) {
			return
		}
		order, err := svc.QueryPaymentOrder(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})
	r.POST("/payments/orders/:id/close", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "payment-close:"+user.ID+":"+c.Param("id"), 10, time.Minute) {
			return
		}
		order, err := svc.ClosePaymentOrder(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})
	r.GET("/payments/orders/:id/checkout", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		target, err := svc.PaymentCheckout(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		c.Redirect(http.StatusFound, target)
	})
	r.POST("/payments/orders/:id/checkout/refresh", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "payment-checkout-refresh:"+user.ID+":"+c.Param("id"), 5, time.Hour) {
			return
		}
		order, err := svc.RefreshPaymentCheckout(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})

	// Provider callbacks are intentionally unauthenticated at the application
	// layer. Authenticity is established by the pinned provider config and raw
	// request signature before any durable event is accepted.
	r.POST("/payments/notify/:providerId/:configId", func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, paymentNotificationMaxBytes)
		rawBody, err := io.ReadAll(c.Request.Body)
		if err != nil {
			writePaymentNotificationFailure(c, svc, c.Param("providerId"), http.StatusBadRequest)
			return
		}
		err = svc.AcceptPaymentNotification(c.Request.Context(), c.Param("providerId"), c.Param("configId"), c.Request.Header.Clone(), rawBody)
		if err != nil {
			status := http.StatusInternalServerError
			var appErr *service.AppError
			if errors.As(err, &appErr) && appErr.Status < http.StatusInternalServerError {
				status = http.StatusBadRequest
			}
			writePaymentNotificationFailure(c, svc, c.Param("providerId"), status)
			return
		}
		status, contentType, body := svc.PaymentNotificationResponse(c.Param("providerId"), true)
		if body != "" {
			c.Data(status, contentType, []byte(body))
			return
		}
		c.Status(status)
	})
	r.GET("/payments/return/:providerId", func(c *gin.Context) {
		orderID := strings.ToLower(strings.TrimSpace(c.Query("orderId")))
		if !paymentOrderIDPattern.MatchString(orderID) {
			c.Redirect(http.StatusFound, "/wallet?payment=invalid")
			return
		}
		c.Redirect(http.StatusFound, "/wallet?paymentOrder="+url.QueryEscape(orderID))
	})

	admin := r.Group("/admin/payments")
	admin.GET("/providers", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		providers, err := svc.AdminPaymentProviders(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"providers": providers})
	})
	admin.PUT("/providers/:id/config", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.UpdatePaymentProviderConfigRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		provider, err := svc.UpdatePaymentProviderConfig(user, c.Param("id"), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"provider": provider})
	})
	admin.GET("/products", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		products, err := svc.AdminTopupProducts(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"products": products})
	})
	admin.POST("/products", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.TopupProductRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		product, err := svc.CreateTopupProduct(user, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"product": product})
	})
	admin.PUT("/products/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.TopupProductRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		product, err := svc.UpdateTopupProduct(user, c.Param("id"), request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"product": product})
	})
	admin.GET("/orders", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
		result, err := svc.AdminPaymentOrderPage(user, c.Query("status"), c.Query("keyword"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	admin.POST("/orders/:id/query", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		order, err := svc.AdminQueryPaymentOrder(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"order": order})
	})
	admin.POST("/orders/:id/close", func(c *gin.Context) {
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
	admin.POST("/reconciliations", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var request service.RunPaymentReconciliationRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		run, err := svc.RunPaymentReconciliation(c.Request.Context(), user, request)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"run": run})
	})
	admin.GET("/reconciliations", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "30"))
		result, err := svc.AdminPaymentReconciliationPage(user, c.Query("providerId"), c.Query("status"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	admin.GET("/reconciliations/:id/items", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "50"))
		result, err := svc.AdminPaymentReconciliationItems(user, c.Param("id"), c.Query("result"), page, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
}

func writePaymentNotificationFailure(c *gin.Context, svc *service.Service, providerID string, status int) {
	responseStatus, contentType, body := svc.PaymentNotificationFailureResponse(providerID, status)
	if body != "" {
		c.Data(responseStatus, contentType, []byte(body))
		return
	}
	c.JSON(responseStatus, gin.H{"code": "FAIL", "message": http.StatusText(responseStatus)})
}

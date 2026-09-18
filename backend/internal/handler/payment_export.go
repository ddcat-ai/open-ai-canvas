package handler

import (
	"net/http"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func paymentOrderQuery(c *gin.Context) service.PaymentOrderQuery {
	return service.PaymentOrderQuery{Status: c.Query("status"), Keyword: c.Query("keyword"), ProviderID: c.Query("providerId"), TimeField: c.Query("timeField"), From: c.Query("from"), To: c.Query("to")}
}

func paymentReconciliationQuery(c *gin.Context) service.PaymentReconciliationQuery {
	return service.PaymentReconciliationQuery{ProviderID: c.Query("providerId"), Status: c.Query("status"), From: c.Query("from"), To: c.Query("to")}
}

func registerPaymentExportRoutes(admin *gin.RouterGroup, svc *service.Service) {
	for _, spec := range []struct{ path, name string }{
		{"/orders/export.csv", "payment-orders"},
		{"/reconciliations/export.csv", "payment-reconciliations"},
		{"/reconciliations/:id/items/export.csv", "payment-reconciliation-items"},
	} {
		admin.GET(spec.path, func(c *gin.Context) {
			c.Header("Cache-Control", "no-store")
			user, err := currentUser(c, svc)
			if err != nil {
				failService(c, err)
				return
			}
			var data []byte
			switch spec.name {
			case "payment-orders":
				data, err = svc.AdminPaymentOrdersCSV(c.Request.Context(), user, paymentOrderQuery(c))
			case "payment-reconciliations":
				data, err = svc.AdminPaymentReconciliationsCSV(c.Request.Context(), user, paymentReconciliationQuery(c))
			default:
				data, err = svc.AdminPaymentReconciliationItemsCSV(c.Request.Context(), user, c.Param("id"), c.Query("result"))
			}
			if err != nil {
				failService(c, err)
				return
			}
			c.Header("Content-Disposition", "attachment; filename="+spec.name+"-"+time.Now().UTC().Format("20060102-150405")+".csv")
			c.Header("X-Content-Type-Options", "nosniff")
			c.Data(http.StatusOK, "text/csv; charset=utf-8", data)
		})
	}
}

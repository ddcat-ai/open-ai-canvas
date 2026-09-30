// 管理端上游调用日志接口：分页、详情、媒体预览、查询上游任务与 CSV 导出。

package handler

import (
	"net/http"

	"strings"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func registerAdminAPILogRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/api-logs", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, limit, err := parsePaginationQuery(c, 50)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		logs, err := svc.AdminAPICallLogs(user, service.APICallLogQuery{AnalyticsQuery: analyticsQuery(c), RecordType: c.Query("recordType"), Keyword: c.Query("keyword"), Status: c.Query("status"), Page: page, Limit: limit})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, logs)
	})
	r.GET("/admin/api-logs/:id/media", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		delivery, err := svc.PrepareAdminAPICallLogMediaDelivery(user, c.Param("id"), resourceAccessOptions(c), c.GetHeader("Range"))
		if err != nil {
			failService(c, err)
			return
		}
		var disposition string
		if c.Query("download") == "1" {
			disposition = "attachment"
		}
		serveResourceDelivery(c, delivery, "private, no-cache", disposition)
	})
	r.GET("/admin/api-logs/:id", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		log, err := svc.AdminAPICallLog(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"log": log})
	})
	r.POST("/admin/api-logs/:id/query-task", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminQueryFailedVideoTask(c.Request.Context(), user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/admin/api-logs-export.csv", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		selectedIDs := []string(nil)
		if value := strings.TrimSpace(c.Query("ids")); value != "" {
			selectedIDs = strings.Split(value, ",")
		}
		data, err := svc.AdminAPICallLogsCSV(user, service.APICallLogQuery{AnalyticsQuery: analyticsQuery(c), RecordType: c.Query("recordType"), Keyword: c.Query("keyword"), Status: c.Query("status"), IDs: selectedIDs})
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Content-Disposition", "attachment; filename=api-calls-"+time.Now().UTC().Format("20060102-150405")+".csv")
		c.Data(http.StatusOK, "text/csv; charset=utf-8", data)
	})
}

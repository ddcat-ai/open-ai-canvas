package handler

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// RegisterSupDanceI18nRoutes mounts the public and administrative HTTP endpoints
// for the SupDance multi-language plugin (supdance-i18n).
func RegisterSupDanceI18nRoutes(r *gin.RouterGroup, svc *service.Service) {
	// Public bundle endpoint (accessible before login so login/register/guest pages also get i18n).
	r.GET("/plugins/supdance-i18n/bundle", func(c *gin.Context) {
		bundle, err := svc.PublicSupDanceI18nBundle()
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, bundle)
	})

	adminGroup := r.Group("/admin/plugins/supdance-i18n")
	adminGroup.GET("/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		overview, err := svc.AdminSupDanceI18nOverview(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, overview)
	})

	adminGroup.PUT("/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
		var req service.SupDanceI18nSettings
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		overview, err := svc.UpdateAdminSupDanceI18nSettings(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, overview)
	})

	adminGroup.GET("/entries", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		pageSize, _ := strconv.Atoi(c.DefaultQuery("pageSize", "20"))
		result, err := svc.ListAdminSupDanceI18nEntries(user, service.SupDanceI18nEntryFilter{
			Namespace:     c.Query("namespace"),
			Origin:        c.Query("origin"),
			MissingLocale: c.Query("missingLocale"),
			Keyword:       c.Query("keyword"),
			Page:          page,
			PageSize:      pageSize,
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	adminGroup.PUT("/entries", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8<<20)
		var req struct {
			Entries []service.SupDanceI18nEntry `json:"entries"`
			Entry   *service.SupDanceI18nEntry  `json:"entry"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		updates := req.Entries
		if len(updates) == 0 && req.Entry != nil {
			updates = []service.SupDanceI18nEntry{*req.Entry}
		}
		overview, count, err := svc.UpsertAdminSupDanceI18nEntries(user, updates)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"overview": overview, "updatedCount": count})
	})

	adminGroup.DELETE("/entries", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		key := strings.TrimSpace(c.Query("key"))
		if key == "" {
			fail(c, http.StatusBadRequest, errors.New("请提供要重置或删除的词条 key"))
			return
		}
		overview, removed, err := svc.DeleteAdminSupDanceI18nEntry(user, key)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"overview": overview, "removed": removed})
	})

	adminGroup.GET("/export", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		payload, err := svc.ExportAdminSupDanceI18n(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, payload)
	})

	adminGroup.POST("/import", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<20)
		var req struct {
			ReplaceAll bool                            `json:"replaceAll"`
			Payload    service.SupDanceI18nExportPayload `json:"payload"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		overview, count, err := svc.ImportAdminSupDanceI18n(user, req.Payload, req.ReplaceAll)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"overview": overview, "importedCount": count})
	})
}

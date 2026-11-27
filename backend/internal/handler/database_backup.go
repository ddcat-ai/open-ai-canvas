package handler

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"time"
	"yingce/backend/internal/service"
)

func registerDatabaseBackupRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/admin/database-backups/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		settings, err := svc.AdminDatabaseBackupSettings(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"settings": settings})
	})
	r.PATCH("/admin/database-backups/settings", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err = svc.RequireAdmin(user); err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 32<<10)
		var req service.DatabaseBackupSettings
		if err = c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		settings, err := svc.UpdateDatabaseBackupSettings(user, req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"settings": settings})
	})
	r.GET("/admin/database-backups", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		records, err := svc.AdminDatabaseBackupRecords(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"records": records})
	})
	r.POST("/admin/database-backups", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "database-backup:"+user.ID, 3, time.Minute) {
			return
		}
		record, err := svc.StartDatabaseBackup(user)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"record": record})
	})
	r.POST("/admin/database-backups/:id/download", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		address, err := svc.DatabaseBackupDownload(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"url": address})
	})
}

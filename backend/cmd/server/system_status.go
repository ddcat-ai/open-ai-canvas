package main

import (
	"context"
	"net/http"
	"sync/atomic"

	"yingce/backend/internal/buildinfo"
	"yingce/backend/internal/database"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type systemStatus struct {
	db       *gorm.DB
	service  *service.Service
	started  atomic.Bool
	draining atomic.Bool
}

type systemStatusSnapshot struct {
	Status            string                `json:"status"`
	Ready             bool                  `json:"ready"`
	Started           bool                  `json:"started"`
	Draining          bool                  `json:"draining"`
	ActiveWorkerTasks int64                 `json:"activeWorkerTasks"`
	Build             buildinfo.Info        `json:"build"`
	Schema            database.SchemaStatus `json:"schema"`
	Checks            systemStatusChecks    `json:"checks"`
}

type systemStatusChecks struct {
	Database bool `json:"database"`
	Runtime  bool `json:"runtime"`
	Schema   bool `json:"schema"`
}

func newSystemStatus(db *gorm.DB, svc *service.Service) *systemStatus {
	return &systemStatus{db: db, service: svc}
}

func (s *systemStatus) markStarted() { s.started.Store(true) }

func (s *systemStatus) beginDrain() {
	s.draining.Store(true)
	if s.service != nil {
		s.service.BeginDrain()
	}
}

func (s *systemStatus) snapshot(ctx context.Context) systemStatusSnapshot {
	snapshot := systemStatusSnapshot{
		Started:  s.started.Load(),
		Draining: s.draining.Load(),
		Build:    buildinfo.Current(),
		Schema:   database.SchemaStatus{Expected: database.CurrentSchemaVersion},
	}
	if s.service != nil {
		snapshot.ActiveWorkerTasks = s.service.ActiveWorkerTasks()
		snapshot.Checks.Runtime = s.service.ValidateRuntime() == nil
	}
	if s.db != nil {
		snapshot.Checks.Database = s.db.WithContext(ctx).Exec("SELECT 1").Error == nil
		if schema, err := database.ReadSchemaStatus(s.db); err == nil {
			snapshot.Schema = schema
			snapshot.Checks.Schema = schema.Ready
		}
	}
	snapshot.Ready = snapshot.Started && !snapshot.Draining && snapshot.Checks.Database && snapshot.Checks.Runtime && snapshot.Checks.Schema
	switch {
	case snapshot.Draining:
		snapshot.Status = "draining"
	case snapshot.Ready:
		snapshot.Status = "ok"
	case !snapshot.Started:
		snapshot.Status = "starting"
	default:
		snapshot.Status = "unhealthy"
	}
	return snapshot
}

func registerSystemStatusRoutes(api *gin.RouterGroup, status *systemStatus) {
	api.GET("/health/live", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"status": "ok", "build": buildinfo.Current()}, "msg": "ok"})
	})
	startup := func(c *gin.Context) {
		snapshot := status.snapshot(c.Request.Context())
		if !snapshot.Started {
			c.JSON(http.StatusServiceUnavailable, gin.H{"code": http.StatusServiceUnavailable, "data": snapshot, "msg": "服务仍在启动"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": snapshot, "msg": "ok"})
	}
	ready := func(c *gin.Context) {
		snapshot := status.snapshot(c.Request.Context())
		if !snapshot.Ready {
			c.JSON(http.StatusServiceUnavailable, gin.H{"code": http.StatusServiceUnavailable, "data": snapshot, "msg": "服务暂未就绪"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": snapshot, "msg": "ok"})
	}
	api.GET("/health/startup", startup)
	api.GET("/health/ready", ready)
	api.GET("/health", ready)
	api.GET("/system/version", func(c *gin.Context) {
		snapshot := status.snapshot(c.Request.Context())
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"build": snapshot.Build, "schema": snapshot.Schema}, "msg": "ok"})
	})
}

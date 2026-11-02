package database

import (
	"testing"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// v83 only needs the execution table as a patching surface; agent tables are
// created in full here, and the same GORM models are idempotent on both sides.
func migrateInternalAgentWorkerForTest(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(t.TempDir()+"/internal-agent-migrate.db"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CloudAgentExecution{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CloudAgentExecution{ID: "legacy", UserID: "user-a", Status: "running", Revision: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	if err := migrateInternalAgentWorker(db); err != nil {
		t.Fatalf("v83 apply failed: %v", err)
	}
	return db
}

func TestInternalAgentWorkerMigrationCreatesLeaseFace(t *testing.T) {
	db := migrateInternalAgentWorkerForTest(t)

	for _, table := range []any{&model.AgentWorker{}, &model.AgentRuntimeInstance{}, &model.AgentSchedulerSetting{}, &model.AgentAdmissionCounter{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("v83 must create %T", table)
		}
	}
	for _, column := range []string{"engine", "lease_owner", "lease_expires_at", "lease_epoch", "runtime_phase", "next_recovery_at", "recovery_attempts", "recovery_started_at", "recovery_status", "recovery_last_epoch"} {
		if !db.Migrator().HasColumn(&model.CloudAgentExecution{}, column) {
			t.Fatalf("v83 must add column %s", column)
		}
	}
	indexChecks := []struct {
		model any
		name  string
	}{
		{&model.CloudAgentExecution{}, "idx_cloud_agent_executions_lease_expires_at"},
		{&model.CloudAgentExecution{}, "idx_cloud_agent_executions_next_recovery_at"},
		{&model.CloudAgentExecution{}, "idx_cloud_agent_executions_engine"},
		{&model.AgentRuntimeInstance{}, "idx_agent_runtime_instances_updated_at"},
		{&model.AgentWorker{}, "idx_agent_workers_user_id"},
	}
	for _, index := range indexChecks {
		if !db.Migrator().HasIndex(index.model, index.name) {
			t.Fatalf("v83 must create index %s", index.name)
		}
	}
	var legacy model.CloudAgentExecution
	if err := db.Where("id = ?", "legacy").First(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	if legacy.RuntimePhase != "ready" {
		t.Fatalf("existing runs must be backfilled to ready, got %q", legacy.RuntimePhase)
	}
	var counter model.AgentAdmissionCounter
	if err := db.First(&counter, 1).Error; err != nil {
		t.Fatal(err)
	}
	var setting model.AgentSchedulerSetting
	if err := db.First(&setting, 1).Error; err != nil {
		t.Fatal(err)
	}
	if setting.MaxResidentSessions != model.DefaultAgentSchedulerSetting().MaxResidentSessions {
		t.Fatalf("default seed must match the defaults, got %+v", setting)
	}

	// 重复应用幂等（迁移重试、并发启动都安全）。
	if err := migrateInternalAgentWorker(db); err != nil {
		t.Fatalf("re-applying v83 must be idempotent: %v", err)
	}
}

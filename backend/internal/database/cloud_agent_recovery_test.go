package database

import (
	"fmt"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestMigrateSchemaV14BackfillsRecoveryAcrossBatches(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:agent-recovery-migration?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CloudAgentExecution{}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 205; i++ {
		status := []string{"running", "waiting_approval", "failed", "cancelled", "completed"}[i%5]
		run := model.CloudAgentExecution{ID: fmt.Sprintf("run-%03d", i), UserID: "user", Status: status, Revision: 7, StateJSON: `{"request":{"canvasId":"canvas"},"activeTaskId":"child","mediaTaskId":"media"}`}
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Transaction(migrateSchemaV14); err != nil {
		t.Fatal(err)
	}
	var runs []model.CloudAgentExecution
	if err := db.Find(&runs).Error; err != nil {
		t.Fatal(err)
	}
	for _, run := range runs {
		if run.Status == "completed" {
			continue
		}
		if run.CanvasID != "canvas" || run.ActiveTaskID != "child" || run.MediaTaskID != "media" || run.Revision != 7 {
			t.Fatalf("missing recovery fields: %+v", run)
		}
		if run.CleanupPending != (run.Status == "failed" || run.Status == "cancelled") {
			t.Fatalf("incorrect cleanup flag: %+v", run)
		}
	}
}

func TestMigrateSchemaV14KeepsCorruptExecutionRecoverable(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:agent-corrupt-migration?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CloudAgentExecution{}); err != nil {
		t.Fatal(err)
	}
	for _, run := range []model.CloudAgentExecution{
		{ID: "a-valid", Status: "cancelled", StateJSON: `{"activeTaskId":"child"}`},
		{ID: "b-corrupt", Status: "failed", StateJSON: `{broken`},
	} {
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
	}
	err = db.Transaction(migrateSchemaV14)
	if err != nil {
		t.Fatal(err)
	}
	var valid model.CloudAgentExecution
	if err := db.First(&valid, "id = ?", "a-valid").Error; err != nil {
		t.Fatal(err)
	}
	if !valid.CleanupPending || valid.ActiveTaskID != "child" {
		t.Fatalf("valid cancelled execution is not recoverable: %+v", valid)
	}
	var corrupt model.CloudAgentExecution
	if err := db.First(&corrupt, "id = ?", "b-corrupt").Error; err != nil {
		t.Fatal(err)
	}
	if !corrupt.CleanupPending || corrupt.ActiveTaskID != "b-corrupt" || corrupt.FailureMessage == "" {
		t.Fatalf("corrupt execution was orphaned: %+v", corrupt)
	}
}

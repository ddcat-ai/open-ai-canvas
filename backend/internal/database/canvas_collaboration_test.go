package database

import (
	"reflect"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCanvasCollaborationUpgradeFrom56(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:canvas-collaboration-upgrade?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version > 56 {
			break
		}
		if err := item.apply(db); err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// Initial schema creation uses current models; restore the real v56 boundary.
	if err := db.Migrator().DropTable(&model.CanvasEditLease{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.Task{}, "AgentExecutionReady"); err != nil {
		t.Fatal(err)
	}
	var before []schemaMigration
	if err := db.Order("version").Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"existing-execution", "reservation", "other-owner"} {
		if err := db.Table("tasks").Create(map[string]any{"id": id, "user_id": "owner", "project_id": "canvas", "operation": "cloud_agent", "status": "text_replay", "prompt": "preserved"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for id, user := range map[string]string{"existing-execution": "owner", "other-owner": "someone-else"} {
		if err := db.Table("cloud_agent_executions").Create(map[string]any{"id": id, "user_id": user, "status": "completed", "state_json": "{}"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for range 2 {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var after []schemaMigration
	if err := db.Where("version <= ?", 56).Order("version").Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Fatal("existing migration ledger changed")
	}
	if !db.Migrator().HasTable(&model.CanvasEditLease{}) {
		t.Fatal("lease table missing")
	}
	for table, index := range map[string]string{"tasks": "idx_tasks_canvas_agent_reservation", "cloud_agent_executions": "idx_cloud_agent_canvas_active"} {
		if !db.Migrator().HasIndex(table, index) {
			t.Fatalf("missing index %s", index)
		}
	}
	var tasks []model.Task
	if err := db.Find(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 3 {
		t.Fatalf("lost tasks: %d", len(tasks))
	}
	for _, task := range tasks {
		if task.AgentExecutionReady != (task.ID == "existing-execution") {
			t.Fatalf("incorrect execution marker: %s", task.ID)
		}
		if task.Status != "text_replay" || task.Prompt != "preserved" {
			t.Fatalf("task contents changed: %s", task.ID)
		}
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != 57 {
		t.Fatalf("unexpected schema status: %+v %v", status, err)
	}
}

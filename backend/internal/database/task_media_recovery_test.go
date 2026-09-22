package database

import (
	"infinite-canvas/backend/internal/model"
	"testing"
)

func TestTaskMediaRecoveryMigrationPreservesHistoricalTasks(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.Exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, status TEXT, error TEXT)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO tasks VALUES ('old-task', 'failed', 'download failed')`).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := schemaMigrations[33].apply(db); err != nil {
			t.Fatal(err)
		}
	}
	var task model.Task
	if err := db.First(&task, "id = ?", "old-task").Error; err != nil {
		t.Fatal(err)
	}
	if task.Status != model.TaskStatusFailed || task.Error != "download failed" || task.MediaRecoveryJSON != "" || task.MediaStage != "" {
		t.Fatalf("migration rewrote historical task: %+v", task)
	}
	for _, field := range []string{"media_stage", "media_recovery_json"} {
		if !db.Migrator().HasColumn(&model.Task{}, field) {
			t.Fatalf("missing %s", field)
		}
	}
}

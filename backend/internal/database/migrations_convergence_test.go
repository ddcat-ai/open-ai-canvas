package database

import (
	"path/filepath"
	"testing"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func convergenceTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "schema.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}

func TestLocalVersion36KeepsOriginalApplyDefinition(t *testing.T) {
	db := convergenceTestDB(t)
	if err := db.Exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, user_id TEXT)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&schemaMigration{Version: 36, Name: "task_idempotency", Checksum: taskIdempotencyChecksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
		t.Fatal(err)
	}
	plan, err := migrationsForDatabase(db)
	if err != nil {
		t.Fatal(err)
	}
	if err := plan[35].apply(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn(&model.Task{}, "prompt") {
		t.Fatal("local v36 must retain its original full Task AutoMigrate definition")
	}
}

func TestMigrateSchemaConvergesLocalVersion36WithoutRewritingHistory(t *testing.T) {
	db := convergenceTestDB(t)
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version > ?", 36).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&schemaMigration{}).Where("version = ?", 36).Updates(map[string]any{
		"name": "task_idempotency", "checksum": "sha256:task-idempotency-v36-20260924",
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropTable(&model.CloudAgentGeminiCache{}); err != nil {
		t.Fatal(err)
	}
	key := "original-key"
	if err := db.Create(&model.Task{ID: "old-task", UserID: "owner", IdempotencyKey: &key, IdempotencyFingerprint: "original-fingerprint"}).Error; err != nil {
		t.Fatal(err)
	}
	var before schemaMigration
	if err := db.First(&before, "version = ?", 36).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var after schemaMigration
	if err := db.First(&after, "version = ?", 36).Error; err != nil {
		t.Fatal(err)
	}
	if after.Name != before.Name || after.Checksum != before.Checksum || !after.AppliedAt.Equal(before.AppliedAt) {
		t.Fatalf("historical v36 changed: before=%+v after=%+v", before, after)
	}
	if !db.Migrator().HasTable(&model.CloudAgentGeminiCache{}) {
		t.Fatal("v37 did not create missing Gemini cache table")
	}
	var task model.Task
	if err := db.First(&task, "id = ?", "old-task").Error; err != nil {
		t.Fatal(err)
	}
	if task.IdempotencyKey == nil || *task.IdempotencyKey != key || task.IdempotencyFingerprint != "original-fingerprint" {
		t.Fatalf("old task idempotency changed: %+v", task)
	}
	var final schemaMigration
	if err := db.First(&final, "version = ?", 44).Error; err != nil {
		t.Fatalf("missing convergence migration: %v", err)
	}
}

func TestMigrateSchemaConvergesUpstreamVersion36AndAddsTaskIdempotency(t *testing.T) {
	db := convergenceTestDB(t)
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Where("version > ?", 36).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropIndex(&model.Task{}, "idx_tasks_user_idempotency"); err != nil {
		t.Fatal(err)
	}
	for _, column := range []string{"idempotency_key", "idempotency_fingerprint"} {
		if err := db.Migrator().DropColumn(&model.Task{}, column); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Exec(`INSERT INTO tasks (id, user_id, status, prompt) VALUES ('before-idempotency', 'owner', 'succeeded', 'existing task')`).Error; err != nil {
		t.Fatal(err)
	}
	var before schemaMigration
	if err := db.First(&before, "version = ?", 36).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	var after schemaMigration
	if err := db.First(&after, "version = ?", 36).Error; err != nil {
		t.Fatal(err)
	}
	if before.Name != "cloud_agent_gemini_cache" || after.Name != before.Name || after.Checksum != before.Checksum || !after.AppliedAt.Equal(before.AppliedAt) {
		t.Fatalf("upstream v36 history changed: before=%+v after=%+v", before, after)
	}
	if !db.Migrator().HasColumn(&model.Task{}, "idempotency_key") || !db.Migrator().HasColumn(&model.Task{}, "idempotency_fingerprint") || !db.Migrator().HasIndex(&model.Task{}, "idx_tasks_user_idempotency") {
		t.Fatal("v44 did not add task idempotency schema")
	}
	var task model.Task
	if err := db.First(&task, "id = ?", "before-idempotency").Error; err != nil {
		t.Fatal(err)
	}
	if task.Prompt != "existing task" || task.IdempotencyKey != nil || task.IdempotencyFingerprint != "" {
		t.Fatalf("v44 changed existing task: %+v", task)
	}
}

func TestMigrateSchemaRejectsUnknownHistoryBeforeApplyingMissingMigration(t *testing.T) {
	for _, scenario := range []string{"unknown-v36", "missing-v39"} {
		t.Run(scenario, func(t *testing.T) {
			db := convergenceTestDB(t)
			if err := MigrateSchema(db); err != nil {
				t.Fatal(err)
			}
			if err := db.Where("version = ?", 44).Delete(&schemaMigration{}).Error; err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "unknown-v36":
				if err := db.Model(&schemaMigration{}).Where("version = ?", 36).Update("checksum", "unrecognized").Error; err != nil {
					t.Fatal(err)
				}
			case "missing-v39":
				if err := db.Where("version = ?", 39).Delete(&schemaMigration{}).Error; err != nil {
					t.Fatal(err)
				}
				if err := db.Migrator().DropTable(&model.SkillLibraryCategory{}); err != nil {
					t.Fatal(err)
				}
			}
			if err := MigrateSchema(db); err == nil {
				t.Fatal("unknown or gapped history was accepted")
			}
			if err := RequireSchemaVersion(db); err == nil {
				t.Fatal("read gate accepted unknown or gapped history")
			}
			if scenario == "missing-v39" && db.Migrator().HasTable(&model.SkillLibraryCategory{}) {
				t.Fatal("rejected history performed business DDL")
			}
			var latest schemaMigration
			if err := db.First(&latest, "version = ?", 44).Error; err == nil {
				t.Fatal("rejected history recorded convergence migration")
			}
		})
	}
}

func TestMigrateSchemaRejectsBusinessTablesWithoutHistory(t *testing.T) {
	db := convergenceTestDB(t)
	if err := db.Exec("CREATE TABLE tasks (id TEXT PRIMARY KEY, user_id TEXT)").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err == nil {
		t.Fatal("unregistered business table was treated as empty database")
	}
	if db.Migrator().HasTable(&model.Skill{}) {
		t.Fatal("rejected database ran baseline migration")
	}
}

func TestMigrateSchemaRejectsFutureHistory(t *testing.T) {
	db := convergenceTestDB(t)
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&schemaMigration{Version: CurrentSchemaVersion + 1, Name: "future", Checksum: "future", AppliedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err == nil {
		t.Fatal("future migration was accepted")
	}
	if err := RequireSchemaVersion(db); err == nil {
		t.Fatal("read gate accepted future migration")
	}
}

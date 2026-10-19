package database

import (
	"path/filepath"
	"reflect"
	"testing"

	"yingce/backend/internal/model"
)

func TestHomepageAgentMigrationUpgradesSchema57WithoutChangingExistingData(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "homepage.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: "owner", Username: "owner", PasswordHash: "unchanged", Role: "admin", Status: "active"}
	run := model.CloudAgentExecution{ID: "existing-run", UserID: user.ID, StateJSON: `{"legacy":true}`}
	resource := model.Resource{ID: "existing-resource", UserID: user.ID, Provider: "s3", ObjectKey: "existing.png", Status: model.ResourceStatusReady, Size: 123}
	task := model.Task{ID: "existing-task", UserID: user.ID}
	for _, row := range []any{&user, &run, &resource, &task} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	var originalHistory []schemaMigration
	if err := db.Where("version <= ?", 57).Order("version").Find(&originalHistory).Error; err != nil {
		t.Fatal(err)
	}
	for _, table := range []any{&model.AgentSession{}, &model.CloudAgentReceipt{}, &model.CreationPreferences{}, &model.ResourceTransfer{}} {
		if err := db.Migrator().DropTable(table); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Migrator().DropIndex(&model.Task{}, "idx_tasks_user_idempotency"); err != nil {
		t.Fatal(err)
	}
	fields := []struct {
		model any
		names []string
	}{
		{&model.CloudAgentExecution{}, []string{"SessionID", "Surface", "ContextSelectionJSON"}},
		{&model.Resource{}, []string{"SourceTaskID", "TransferPending", "BrowserDirect"}},
		{&model.Task{}, []string{"IdempotencyKey", "IdempotencyFingerprint"}},
	}
	for _, group := range fields {
		for _, name := range group.names {
			if err := db.Migrator().DropColumn(group.model, name); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := db.Where("version = ?", 58).Delete(&schemaMigration{}).Error; err != nil {
		t.Fatal(err)
	}
	if status, err := ReadSchemaStatus(db); err != nil || status.Current != 57 || status.Ready {
		t.Fatalf("old schema: %+v, %v", status, err)
	}
	for attempt := 0; attempt < 2; attempt++ {
		if err := MigrateSchema(db); err != nil {
			t.Fatal(err)
		}
	}
	if status, err := ReadSchemaStatus(db); err != nil || status.Current != 58 || !status.Ready {
		t.Fatalf("upgraded schema: %+v, %v", status, err)
	}
	var history []schemaMigration
	if err := db.Where("version <= ?", 57).Order("version").Find(&history).Error; err != nil || !reflect.DeepEqual(originalHistory, history) {
		t.Fatalf("existing migration history changed: %v", err)
	}
	var savedUser model.User
	var savedRun model.CloudAgentExecution
	var savedResource model.Resource
	var savedTask model.Task
	for _, record := range []struct {
		dst any
		id  string
	}{{&savedUser, user.ID}, {&savedRun, run.ID}, {&savedResource, resource.ID}, {&savedTask, task.ID}} {
		if err := db.First(record.dst, "id = ?", record.id).Error; err != nil {
			t.Fatal(err)
		}
	}
	if savedUser.PasswordHash != user.PasswordHash || savedRun.StateJSON != run.StateJSON || savedResource.ObjectKey != resource.ObjectKey || savedResource.Size != resource.Size || savedTask.UserID != task.UserID {
		t.Fatal("migration changed existing account, execution, resource or task data")
	}
	if savedResource.BrowserDirect || savedResource.TransferPending || savedTask.IdempotencyKey != nil {
		t.Fatal("existing records received unexpected new-field values")
	}
	for _, table := range []any{&model.AgentSession{}, &model.CloudAgentReceipt{}, &model.CreationPreferences{}, &model.ResourceTransfer{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("missing table: %T", table)
		}
	}
	for _, group := range fields {
		for _, name := range group.names {
			if !db.Migrator().HasColumn(group.model, name) {
				t.Fatalf("missing column: %T.%s", group.model, name)
			}
		}
	}
	key := "request-1"
	if err := db.Create(&model.Task{ID: "first", UserID: user.ID, IdempotencyKey: &key}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "duplicate", UserID: user.ID, IdempotencyKey: &key}).Error; err == nil {
		t.Fatal("same-account idempotency key accepted twice")
	}
	if err := db.Create(&model.Task{ID: "other-user", UserID: "other-owner", IdempotencyKey: &key}).Error; err != nil {
		t.Fatal("idempotency keys must be scoped to each account", err)
	}
}

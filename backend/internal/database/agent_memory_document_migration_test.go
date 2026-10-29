package database

import (
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// 早期构建执行 v76 时记忆表还没有 next_entry_seq / call_id，v76 记为完成后不会重跑；
// v77 必须补齐这两列，否则每次建 Agent 运行写记忆文件都会报 500。
func TestAgentMemoryDocumentColumnsMigrationRepairsEarlyV76Tables(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "migration.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	// 还原成早期 v76 的表结构：去掉后来加的两列，并假装 v77 还没执行。
	if err := db.Migrator().DropColumn(&model.AgentMemoryDocument{}, "NextEntrySeq"); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropIndex(&model.AgentMemoryDocumentRevision{}, "CallID"); err != nil {
		t.Fatal(err)
	}
	if err := db.Migrator().DropColumn(&model.AgentMemoryDocumentRevision{}, "CallID"); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO agent_memory_documents (user_id, entries_json, revision, hash, char_count, mode, capacity) VALUES ('early-user', '[]', 1, '', 0, 'auto', 5000)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("DELETE FROM schema_migrations WHERE version = 77").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn(&model.AgentMemoryDocument{}, "NextEntrySeq") || !db.Migrator().HasColumn(&model.AgentMemoryDocumentRevision{}, "CallID") {
		t.Fatal("v77 did not restore the memory document columns")
	}
	var doc model.AgentMemoryDocument
	if err := db.First(&doc, "user_id = ?", "early-user").Error; err != nil || doc.NextEntrySeq != 0 {
		t.Fatalf("existing document after repair: %+v %v", doc, err)
	}
	// 修复后可以按当前模型写入。
	if err := db.Create(&model.AgentMemoryDocument{UserID: "new-user", EntriesJSON: "[]", NextEntrySeq: 3, Revision: 1, Mode: "auto", Capacity: 5000}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AgentMemoryDocumentRevision{ID: "rev-1", UserID: "new-user", CallID: "call-1", Status: "applied"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal("migration is not repeatable", err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil || !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("schema status: %#v %v", status, err)
	}
}

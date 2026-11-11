package database

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestAPILogGenerationMigrationPreservesExistingLogsAndIsIdempotent(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: ":memory:"})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.Exec("CREATE TABLE api_call_logs (id TEXT PRIMARY KEY, request_body TEXT)").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("INSERT INTO api_call_logs (id, request_body) VALUES (?, ?)", "existing", `{"prompt":"historical"}`).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := migrateAPILogGenerationContent(db); err != nil {
			t.Fatal(err)
		}
	}
	if !db.Migrator().HasColumn(&model.ApiCallLog{}, "GenerationContentJSON") {
		t.Fatal("generation snapshot column missing")
	}
	var row struct {
		RequestBody           string
		GenerationContentJSON string
	}
	if err := db.Table("api_call_logs").Where("id = ?", "existing").Scan(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.RequestBody != `{"prompt":"historical"}` || row.GenerationContentJSON != "" {
		t.Fatalf("migration changed old log: %#v", row)
	}
}

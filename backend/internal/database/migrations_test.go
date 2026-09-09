package database

import (
	"errors"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func TestMigrateSchemaRecordsAndValidatesVersion(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-version?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	status, err := ReadSchemaStatus(db)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected schema status: %#v", status)
	}
	if !db.Migrator().HasIndex(&schemaMigration{}, "idx_schema_migrations_applied_at") {
		t.Fatal("schema migration v2 did not create the applied_at index")
	}
	if !db.Migrator().HasIndex(&model.ProjectAssetCandidate{}, "idx_project_asset_candidates_pending_identity") {
		t.Fatal("schema migration v3 did not create candidate identity index")
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatalf("migration should be idempotent: %v", err)
	}
}

func TestMigrateSchemaRejectsChecksumMismatch(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-checksum?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&schemaMigration{}).Where("version = ?", CurrentSchemaVersion).Update("checksum", "changed").Error; err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "校验和不一致") {
		t.Fatalf("expected checksum mismatch, got %v", err)
	}
	if err := RequireSchemaVersion(db); err == nil || !strings.Contains(err.Error(), "校验和不一致") {
		t.Fatalf("schema verification must reject checksum mismatch, got %v", err)
	}
}

func TestMigrateSchemaV3NormalizesLegacyAccessoryCategory(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-asset-taxonomy?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Asset{}, &model.ProjectAssetCandidate{}); err != nil {
		t.Fatal(err)
	}
	asset := model.Asset{ID: "asset-1", UserID: "user-1", Kind: "image", Category: model.AssetCategory("accessory"), Title: "旧配饰"}
	candidate := model.ProjectAssetCandidate{ID: "candidate-1", ProjectID: "project-1", Name: "旧配饰候选", Category: model.AssetCategory("accessory"), Status: "pending_confirmation"}
	if err := db.Create(&asset).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&candidate).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateSchemaV3(db); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&asset, "id = ?", asset.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&candidate, "id = ?", candidate.ID).Error; err != nil {
		t.Fatal(err)
	}
	if asset.Category != model.AssetCategoryProp || candidate.Category != model.AssetCategoryProp {
		t.Fatalf("legacy accessory categories = %q/%q, want prop/prop", asset.Category, candidate.Category)
	}
	if candidate.NameKey != model.AssetCandidateNameKey(candidate.Name) {
		t.Fatalf("candidate name key = %q", candidate.NameKey)
	}
}

func TestMigrateSchemaV4AddsResourceUploadKeyToExistingSchema(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-resource-upload-key?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE resources (id TEXT PRIMARY KEY, user_id TEXT NOT NULL)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations[:3] {
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("migrate existing schema: %v", err)
	}
	if !db.Migrator().HasColumn(&model.Resource{}, "upload_key") {
		t.Fatal("resource upload_key column was not added")
	}
	if !db.Migrator().HasIndex(&model.Resource{}, "idx_resources_user_upload_key") {
		t.Fatal("resource upload key index was not added")
	}
	var status SchemaStatus
	status, err = ReadSchemaStatus(db)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected schema status: %#v", status)
	}

	firstKey := "same-upload"
	if err := db.Exec(`INSERT INTO resources (id, user_id, upload_key) VALUES (?, ?, ?)`, "resource-1", "user-1", firstKey).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO resources (id, user_id, upload_key) VALUES (?, ?, ?)`, "resource-2", "user-1", firstKey).Error; err == nil {
		t.Fatal("duplicate resource upload key should be rejected")
	}
}

func TestMigrateSchemaV7AddsOnlineMCPToExistingSchema(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-online-mcp?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE canvas_projects (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		project_id TEXT,
		title TEXT,
		payload_json TEXT,
		created_at DATETIME,
		updated_at DATETIME
	)`).Error; err != nil {
		t.Fatal(err)
	}
	payload := `{"title":"旧画布","nodes":[],"connections":[]}`
	if err := db.Exec("INSERT INTO canvas_projects (id, user_id, title, payload_json) VALUES (?, ?, ?, ?)", "canvas-v6", "user-v6", "旧画布", payload).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version > 6 {
			break
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("migrate v6 database: %v", err)
	}
	if !db.Migrator().HasColumn(&model.CanvasProject{}, "revision") || !db.Migrator().HasColumn(&model.CanvasProject{}, "state_hash") {
		t.Fatal("online MCP migration did not add canvas revision columns")
	}
	for _, table := range []any{&model.MCPDeviceSession{}, &model.MCPToken{}, &model.MCPAuditEvent{}} {
		if !db.Migrator().HasTable(table) {
			t.Fatalf("online MCP migration did not create %T", table)
		}
	}
	wantHash, err := model.CanvasStateHash([]byte(payload))
	if err != nil {
		t.Fatal(err)
	}
	var project model.CanvasProject
	if err := db.First(&project, "id = ?", "canvas-v6").Error; err != nil {
		t.Fatal(err)
	}
	if project.Revision != 0 || project.StateHash != wantHash {
		t.Fatalf("legacy canvas version = %d/%q, want 0/%q", project.Revision, project.StateHash, wantHash)
	}
}

func TestMigrateSchemaV7KeepsInvalidLegacyCanvasSnapshots(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-online-mcp-invalid?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE canvas_projects (
		id TEXT PRIMARY KEY,
		user_id TEXT,
		project_id TEXT,
		title TEXT,
		payload_json TEXT,
		created_at DATETIME,
		updated_at DATETIME
	)`).Error; err != nil {
		t.Fatal(err)
	}
	rows := []struct {
		id      string
		payload string
	}{
		{id: "canvas-valid", payload: `{"title":"有效画布","nodes":[]}`},
		{id: "canvas-malformed", payload: `{malformed`},
		{id: "canvas-array", payload: `[]`},
		{id: "canvas-inline-media", payload: `{"image":"data:image/png;base64,AAAA"}`},
	}
	for _, row := range rows {
		if err := db.Exec("INSERT INTO canvas_projects (id, user_id, title, payload_json) VALUES (?, ?, ?, ?)", row.id, "user-invalid", row.id, row.payload).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations {
		if item.version > 6 {
			break
		}
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("migration should keep malformed legacy snapshots available: %v", err)
	}
	validHash, err := model.CanvasStateHash([]byte(rows[0].payload))
	if err != nil {
		t.Fatal(err)
	}
	var valid model.CanvasProject
	if err := db.First(&valid, "id = ?", "canvas-valid").Error; err != nil {
		t.Fatal(err)
	}
	if valid.StateHash != validHash {
		t.Fatalf("valid canvas state hash = %q, want %q", valid.StateHash, validHash)
	}
	for _, id := range []string{"canvas-malformed", "canvas-array", "canvas-inline-media"} {
		var project model.CanvasProject
		if err := db.First(&project, "id = ?", id).Error; err != nil {
			t.Fatal(err)
		}
		if project.StateHash != "" || project.PayloadJSON == "" {
			t.Fatalf("invalid canvas %s was rewritten: hash=%q payload=%q", id, project.StateHash, project.PayloadJSON)
		}
	}
}

func TestMigrateSchemaRollsBackFailedMigration(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-rollback?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := MigrateSchema(db); err != nil {
		t.Fatal(err)
	}

	original := schemaMigrations
	schemaMigrations = append(append([]migration(nil), original...), migration{
		version:  CurrentSchemaVersion + 1,
		name:     "rollback_probe",
		checksum: "sha256:rollback-probe",
		apply: func(tx *gorm.DB) error {
			if err := tx.Exec("CREATE TABLE migration_rollback_probe (id INTEGER PRIMARY KEY)").Error; err != nil {
				return err
			}
			return errors.New("forced migration failure")
		},
	})
	t.Cleanup(func() { schemaMigrations = original })

	if err := MigrateSchema(db); err == nil || !strings.Contains(err.Error(), "forced migration failure") {
		t.Fatalf("expected forced migration failure, got %v", err)
	}
	if db.Migrator().HasTable("migration_rollback_probe") {
		t.Fatal("failed migration left a partial table behind")
	}
	var count int64
	if err := db.Model(&schemaMigration{}).Where("version = ?", CurrentSchemaVersion+1).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("failed migration was recorded: %d", count)
	}
}

func TestRequireSchemaVersionRejectsUninitializedDatabase(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-uninitialized?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := RequireSchemaVersion(db); err == nil || !strings.Contains(err.Error(), "请先执行 migrate-schema up") {
		t.Fatalf("expected missing migration error, got %v", err)
	}
}

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

func TestMigrateSchemaV8AllowsReusingArchivedLogicalModelCode(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-logical-model-active-code?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE logical_models (id text PRIMARY KEY, code text NOT NULL, archived_at datetime)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE UNIQUE INDEX idx_logical_models_code ON logical_models(code)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO logical_models(id, code, archived_at) VALUES ('archived', 'gpt-image-2', CURRENT_TIMESTAMP)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := migrateSchemaV8(db); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO logical_models(id, code, archived_at) VALUES ('active', 'gpt-image-2', NULL)`).Error; err != nil {
		t.Fatalf("reusing archived code after migration: %v", err)
	}
	if err := db.Exec(`INSERT INTO logical_models(id, code, archived_at) VALUES ('duplicate', 'gpt-image-2', NULL)`).Error; err == nil {
		t.Fatal("active logical model code must remain unique")
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

func TestMigrateSchemaRepairsLegacyAssetFoldersMigrationOrder(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-legacy-v6-order?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Resource{}, &model.Asset{}, &model.AssetFolder{}); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&schemaMigration{}); err != nil {
		t.Fatal(err)
	}
	for _, item := range schemaMigrations[:5] {
		if err := db.Create(&schemaMigration{Version: item.version, Name: item.name, Checksum: item.checksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&schemaMigration{Version: 6, Name: "asset_library_folders", Checksum: assetLibraryFoldersChecksum, AppliedAt: time.Now().UTC()}).Error; err != nil {
		t.Fatal(err)
	}

	if err := MigrateSchema(db); err != nil {
		t.Fatalf("repair legacy migration order: %v", err)
	}
	if !db.Migrator().HasColumn(&model.Resource{}, "playback_status") || !db.Migrator().HasColumn(&model.Resource{}, "playback_object_key") || !db.Migrator().HasColumn(&model.Resource{}, "playback_error") {
		t.Fatal("legacy database did not receive resource playback columns")
	}
	status, err := ReadSchemaStatus(db)
	if err != nil {
		t.Fatal(err)
	}
	if !status.Ready || status.Current != CurrentSchemaVersion {
		t.Fatalf("unexpected repaired schema status: %#v", status)
	}
	var applied schemaMigration
	if err := db.First(&applied, "version = ?", 6).Error; err != nil {
		t.Fatal(err)
	}
	if applied.Name != "asset_library_folders" || applied.Checksum != assetLibraryFoldersChecksum {
		t.Fatalf("historical migration 6 must be preserved: %#v", applied)
	}
	var playback schemaMigration
	if err := db.First(&playback, "version = ?", 7).Error; err != nil {
		t.Fatal(err)
	}
	if playback.Name != "resource_playback_variant" || playback.Checksum != resourcePlaybackChecksum {
		t.Fatalf("migration 7 must supply playback schema: %#v", playback)
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

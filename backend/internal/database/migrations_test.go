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

func TestMigrateSchemaV5CreatesAgentRunTables(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-agent-run-v5-direct?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	// 直接调用 V5 迁移函数，避免 V4 的 PostgreSQL 专用语法在 SQLite 上失败
	if err := migrateSchemaV5(db); err != nil {
		t.Fatalf("migrateSchemaV5 error: %v", err)
	}
	if !db.Migrator().HasTable(&model.AgentRun{}) {
		t.Fatal("migration v5 did not create agent_runs table")
	}
	if !db.Migrator().HasTable(&model.AgentRunStep{}) {
		t.Fatal("migration v5 did not create agent_run_steps table")
	}
	// 验证可以插入和查询 AgentRun
	now := time.Now()
	run := model.AgentRun{
		ID:        "test-run-1",
		UserID:    "user-1",
		ProjectID: "project-1",
		AgentKind: "codex",
		Status:    "running",
		StartedAt: now,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatalf("insert agent_run: %v", err)
	}
	var fetched model.AgentRun
	if err := db.First(&fetched, "id = ?", "test-run-1").Error; err != nil {
		t.Fatalf("query agent_run: %v", err)
	}
	if fetched.UserID != "user-1" || fetched.ProjectID != "project-1" {
		t.Fatalf("fetched run = %#v", fetched)
	}
	// 验证 AgentRunStep 表可以插入
	step := model.AgentRunStep{
		ID:        "test-step-1",
		RunID:     "test-run-1",
		Sequence:  1,
		ToolName:  "canvas_apply_ops",
		Status:    "completed",
		StartedAt: now,
		CreatedAt: now,
	}
	if err := db.Create(&step).Error; err != nil {
		t.Fatalf("insert agent_run_step: %v", err)
	}
	var fetchedStep model.AgentRunStep
	if err := db.First(&fetchedStep, "id = ?", "test-step-1").Error; err != nil {
		t.Fatalf("query agent_run_step: %v", err)
	}
	if fetchedStep.ToolName != "canvas_apply_ops" {
		t.Fatalf("fetched step = %#v", fetchedStep)
	}
}

// 直接验证 V10：清理历史重复技能版本、建立 (skill_id, content_hash) 唯一索引，且可重复执行。
func TestMigrateSchemaV10DedupsSkillVersions(t *testing.T) {
	db, err := Open(Config{Driver: "sqlite", DSN: "file:migration-skill-v10-direct?mode=memory&cache=shared"})
	if err != nil {
		t.Fatal(err)
	}
	// 手动构造 V10 之前的旧表结构（不带唯一索引），以便塞入历史重复版本。
	for _, stmt := range []string{
		`CREATE TABLE skill_versions (id TEXT PRIMARY KEY, skill_id TEXT, content_hash TEXT, version_label TEXT, entry_path TEXT, package_key TEXT, file_count INTEGER, total_bytes INTEGER, source_commit TEXT, created_at DATETIME)`,
		`CREATE TABLE skill_files (id TEXT PRIMARY KEY, skill_version_id TEXT, path TEXT, kind TEXT, mime_type TEXT, size INTEGER, sha256 TEXT, created_at DATETIME)`,
	} {
		if err := db.Exec(stmt).Error; err != nil {
			t.Fatal(err)
		}
	}
	mustExec := func(stmt string, args ...interface{}) {
		t.Helper()
		if err := db.Exec(stmt, args...).Error; err != nil {
			t.Fatal(err)
		}
	}
	// 同一技能 S、相同内容哈希 H 有两个历史版本（v-old 更早，应保留；v-dup 更晚，应清理）。
	mustExec(`INSERT INTO skill_versions (id, skill_id, content_hash, version_label, entry_path, created_at) VALUES (?, ?, ?, ?, ?, ?)`, "v-old", "S", "H", "1", "SKILL.md", "2026-09-01 00:00:00")
	mustExec(`INSERT INTO skill_versions (id, skill_id, content_hash, version_label, entry_path, created_at) VALUES (?, ?, ?, ?, ?, ?)`, "v-dup", "S", "H", "2", "SKILL.md", "2026-09-02 00:00:00")
	mustExec(`INSERT INTO skill_versions (id, skill_id, content_hash, version_label, entry_path, created_at) VALUES (?, ?, ?, ?, ?, ?)`, "v-other", "S", "H2", "3", "SKILL.md", "2026-09-03 00:00:00")
	mustExec(`INSERT INTO skill_files (id, skill_version_id, path) VALUES (?, ?, ?)`, "f-old", "v-old", "SKILL.md")
	mustExec(`INSERT INTO skill_files (id, skill_version_id, path) VALUES (?, ?, ?)`, "f-dup", "v-dup", "SKILL.md")

	if err := migrateSchemaV10(db); err != nil {
		t.Fatalf("migrateSchemaV10: %v", err)
	}

	var versions int64
	if err := db.Model(&model.SkillVersion{}).Where("skill_id = ? AND content_hash = ?", "S", "H").Count(&versions).Error; err != nil {
		t.Fatal(err)
	}
	if versions != 1 {
		t.Fatalf("duplicate versions remain: %d", versions)
	}
	var kept model.SkillVersion
	if err := db.First(&kept, "skill_id = ? AND content_hash = ?", "S", "H").Error; err != nil {
		t.Fatal(err)
	}
	if kept.ID != "v-old" {
		t.Fatalf("expected earliest version kept, got %s", kept.ID)
	}
	var dupFiles int64
	if err := db.Model(&model.SkillFile{}).Where("skill_version_id = ?", "v-dup").Count(&dupFiles).Error; err != nil {
		t.Fatal(err)
	}
	if dupFiles != 0 {
		t.Fatalf("duplicate version files not cleaned: %d", dupFiles)
	}

	// 唯一索引建立后，再次插入相同 (skill_id, content_hash) 必须被拒绝。
	if err := db.Exec(`INSERT INTO skill_versions (id, skill_id, content_hash, entry_path, created_at) VALUES (?, ?, ?, ?, ?)`, "v-newdup", "S", "H", "SKILL.md", "2026-09-04 00:00:00").Error; err == nil {
		t.Fatal("unique index should reject duplicate (skill_id, content_hash)")
	}

	// 迁移必须幂等：再跑一次不报错。
	if err := migrateSchemaV10(db); err != nil {
		t.Fatalf("migrateSchemaV10 not idempotent: %v", err)
	}
}

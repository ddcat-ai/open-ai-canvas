package database_test

import (
	"fmt"
	"net/url"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

const arkBindingIdentityIndex = "idx_ark_private_asset_binding_resource_project"

func TestArkPrivateAssetBindingMigration(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			if driver == "postgres" && strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN")) == "" {
				t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
			}
			for _, scenario := range []string{"fresh", "missing-index", "missing-table", "duplicates", "non-unique-index", "wrong-column-index", "partial-index"} {
				t.Run(scenario, func(t *testing.T) {
					db := arkBindingTestDB(t, driver)
					if err := database.MigrateSchema(db); err != nil {
						t.Fatal(err)
					}
					repo := repository.New(db)
					original := model.ArkPrivateAssetBinding{
						ID: "binding-1", UserID: "owner", ResourceID: "resource-1", ProjectName: "project-1",
						AssetGroupID: "group-1", ArkAssetID: "asset-approved", Status: "active",
					}
					if created, err := repo.CreateArkPrivateAssetBinding(&original); err != nil || !created {
						t.Fatalf("first binding: created=%v err=%v", created, err)
					}
					before, err := repo.ArkPrivateAssetBinding(original.ResourceID, original.ProjectName)
					if err != nil {
						t.Fatal(err)
					}
					type migrationRecord struct {
						Version   int64
						Name      string
						Checksum  string
						AppliedAt time.Time
					}
					var history []migrationRecord
					if err := db.Table("schema_migrations").Where("version < ?", 95).Order("version").Find(&history).Error; err != nil {
						t.Fatal(err)
					}
					if scenario != "fresh" {
						// Recreate a v94 database whose baseline has already been recorded.
						if err := db.Exec("DELETE FROM schema_migrations WHERE version = ?", 95).Error; err != nil {
							t.Fatal(err)
						}
						if scenario == "missing-table" {
							if err := db.Migrator().DropTable(&model.ArkPrivateAssetBinding{}); err != nil {
								t.Fatal(err)
							}
						} else if err := db.Exec("DROP INDEX " + arkBindingIdentityIndex).Error; err != nil {
							t.Fatal(err)
						}
						if err := database.RequireSchemaVersion(db); err == nil {
							t.Fatal("v94 must require the new migration")
						}
						if scenario == "missing-index" {
							probe := original
							probe.ID = "before-repair"
							if created, err := repo.CreateArkPrivateAssetBinding(&probe); err == nil || created || !strings.Contains(err.Error(), "ON CONFLICT") {
								t.Fatalf("missing-index reproduction: created=%v err=%v", created, err)
							}
						}
					}
					expectedError := ""
					indexSQL := ""
					switch scenario {
					case "non-unique-index":
						indexSQL = "CREATE INDEX " + arkBindingIdentityIndex + " ON ark_private_asset_bindings(resource_id, project_name)"
					case "wrong-column-index":
						indexSQL = "CREATE UNIQUE INDEX " + arkBindingIdentityIndex + " ON ark_private_asset_bindings(resource_id, user_id)"
					case "partial-index":
						indexSQL = "CREATE UNIQUE INDEX " + arkBindingIdentityIndex + " ON ark_private_asset_bindings(resource_id, project_name) WHERE status = 'active'"
					}
					if indexSQL != "" {
						if err := db.Exec(indexSQL).Error; err != nil {
							t.Fatal(err)
						}
						expectedError = "索引 " + arkBindingIdentityIndex + " 定义不匹配"
					}
					if scenario == "duplicates" {
						expectedError = "重复的 (resource_id, project_name)"
						duplicate := original
						duplicate.ID, duplicate.ArkAssetID, duplicate.Status = "binding-2", "asset-review", "processing"
						if err := db.Create(&duplicate).Error; err != nil {
							t.Fatal(err)
						}
					}
					if expectedError != "" {
						var beforeRows, afterRows []model.ArkPrivateAssetBinding
						if err := db.Order("id").Find(&beforeRows).Error; err != nil {
							t.Fatal(err)
						}
						if err := database.MigrateSchema(db); err == nil || !strings.Contains(err.Error(), expectedError) {
							t.Fatalf("migration error = %v, want %q", err, expectedError)
						}
						if err := db.Order("id").Find(&afterRows).Error; err != nil {
							t.Fatal(err)
						}
						if !reflect.DeepEqual(beforeRows, afterRows) {
							t.Fatal("failed migration changed existing bindings")
						}
						var recorded int64
						if err := db.Table("schema_migrations").Where("version = ?", 95).Count(&recorded).Error; err != nil || recorded != 0 {
							t.Fatalf("failed migration was recorded: count=%d err=%v", recorded, err)
						}
						if exists := db.Migrator().HasIndex(&model.ArkPrivateAssetBinding{}, arkBindingIdentityIndex); exists != (indexSQL != "") {
							t.Fatal("failed migration changed whether the index exists")
						}
						return
					}
					for attempt := 0; attempt < 2; attempt++ {
						if err := database.MigrateSchema(db); err != nil {
							t.Fatalf("migration attempt %d: %v", attempt, err)
						}
						if err := database.RequireSchemaVersion(db); err != nil {
							t.Fatal(err)
						}
					}
					var afterHistory []migrationRecord
					if err := db.Table("schema_migrations").Where("version < ?", 95).Order("version").Find(&afterHistory).Error; err != nil {
						t.Fatal(err)
					}
					if !reflect.DeepEqual(history, afterHistory) {
						t.Fatal("upgrade rewrote historical migration records")
					}
					if !db.Migrator().HasIndex(&model.ArkPrivateAssetBinding{}, arkBindingIdentityIndex) {
						t.Fatal("binding identity index is missing")
					}
					if scenario == "missing-table" {
						if created, err := repo.CreateArkPrivateAssetBinding(&original); err != nil || !created {
							t.Fatalf("binding in repaired table: created=%v err=%v", created, err)
						}
					}
					duplicate := model.ArkPrivateAssetBinding{
						ID: "duplicate", UserID: "other-user", ResourceID: original.ResourceID,
						ProjectName: original.ProjectName, Status: "uploading", ArkAssetID: "replacement",
					}
					if created, err := repo.CreateArkPrivateAssetBinding(&duplicate); err != nil || created {
						t.Fatalf("ON CONFLICT must reuse existing binding: created=%v err=%v", created, err)
					}
					stored, err := repo.ArkPrivateAssetBinding(original.ResourceID, original.ProjectName)
					if err != nil || !reflect.DeepEqual(before, stored) {
						t.Fatalf("existing approval changed: before=%+v after=%+v err=%v", before, stored, err)
					}
					for _, item := range []model.ArkPrivateAssetBinding{
						{ID: "other-project", ResourceID: original.ResourceID, ProjectName: "project-2"},
						{ID: "other-resource", ResourceID: "resource-2", ProjectName: original.ProjectName},
					} {
						if created, err := repo.CreateArkPrivateAssetBinding(&item); err != nil || !created {
							t.Fatalf("different identity: created=%v err=%v", created, err)
						}
					}
					var count int64
					if err := db.Model(&model.ArkPrivateAssetBinding{}).Count(&count).Error; err != nil || count != 3 {
						t.Fatalf("binding count=%d err=%v, want 3", count, err)
					}
					primaryKeyConflict := model.ArkPrivateAssetBinding{ID: original.ID, ResourceID: "resource-3", ProjectName: "project-3"}
					if created, err := repo.CreateArkPrivateAssetBinding(&primaryKeyConflict); err == nil || created {
						t.Fatalf("unrelated primary key conflict must fail: created=%v err=%v", created, err)
					}
				})
			}
		})
	}
}

func arkBindingTestDB(t *testing.T, driver string) *gorm.DB {
	t.Helper()
	config := database.Config{Driver: driver, DSN: "file:" + t.Name() + "?mode=memory&cache=shared"}
	if driver == "postgres" {
		dsn := strings.TrimSpace(os.Getenv("CANVAS_TEST_POSTGRES_DSN"))
		base, err := database.Open(database.Config{Driver: driver, DSN: dsn})
		if err != nil {
			t.Fatal(err)
		}
		closeArkBindingTestDB(t, base)
		schemaName := fmt.Sprintf("ark_binding_migration_%d", time.Now().UnixNano())
		if err := base.Exec(`CREATE SCHEMA "` + schemaName + `"`).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := base.Exec(`DROP SCHEMA "` + schemaName + `" CASCADE`).Error; err != nil {
				t.Errorf("drop test schema: %v", err)
			}
		})
		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schemaName)
		parsed.RawQuery = query.Encode()
		config.DSN = parsed.String()
	}
	db, err := database.Open(config)
	if err != nil {
		t.Fatal(err)
	}
	closeArkBindingTestDB(t, db)
	return db
}

func closeArkBindingTestDB(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
}

package app

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// agentPermissionsDB 为权限测试创建数据库，只迁移真实画布表。
// CI 使用临时 SQLite；Windows 可提供 PostgreSQL DSN，数据只写入独立临时 schema。
func agentPermissionsDB(t *testing.T) *gorm.DB {
	t.Helper()
	options := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	var db *gorm.DB
	var err error
	if dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN"); dsn != "" {
		admin, openErr := gorm.Open(postgres.Open(dsn), options)
		if openErr != nil {
			t.Fatal(openErr)
		}
		adminSQL, sqlErr := admin.DB()
		if sqlErr != nil {
			t.Fatal(sqlErr)
		}
		t.Cleanup(func() { _ = adminSQL.Close() })
		schema := fmt.Sprintf("agent_permissions_%d", time.Now().UnixNano())
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
				t.Error(err)
			}
		})
		parsed, parseErr := url.Parse(dsn)
		if parseErr != nil {
			t.Fatal(parseErr)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		db, err = gorm.Open(postgres.Open(parsed.String()), options)
	} else {
		db, err = gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "permissions.db")), options)
	}
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestAgentPermissionsUseCanvasProjects(t *testing.T) {
	db := agentPermissionsDB(t)
	s := &Service{repo: repository.New(db)}
	for _, canvas := range []model.CanvasProject{
		{ID: "independent", UserID: "owner", PayloadJSON: `{}`},
		{ID: "associated", UserID: "owner", ProjectID: "domain-project", PayloadJSON: `{}`},
	} {
		if err := db.Create(&canvas).Error; err != nil {
			t.Fatal(err)
		}
	}
	if db.Migrator().HasTable("canvas") {
		t.Fatal("权限测试不能创建旧 canvas 表")
	}
	for _, tc := range []struct {
		user, canvas string
		allowed      bool
	}{
		{"owner", "independent", true}, {"owner", "associated", true},
		{"other", "independent", false}, {"other", "associated", false},
		{"owner", "missing", false}, {"owner", "domain-project", false},
	} {
		t.Run(tc.user+"/"+tc.canvas, func(t *testing.T) {
			permissions := s.buildPermissionsConfig(tc.user, CloudAgentRequest{CanvasID: tc.canvas, PermissionMode: "auto", ContextScope: []string{"canvas"}})
			for _, key := range []string{"canReadCanvas", "canWriteCanvas", "canCreateNodes", "canMoveNodes", "canManageRelations"} {
				if permissions[key] != tc.allowed {
					t.Errorf("%s=%v, want %t", key, permissions[key], tc.allowed)
				}
			}
		})
	}
	// 缺表模拟数据库读取故障，不能把读取失败当成只读或导出许可。
	if err := db.Migrator().DropTable(&model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	permissions := s.buildPermissionsConfig("owner", CloudAgentRequest{CanvasID: "independent", PermissionMode: "auto", ContextScope: []string{"canvas"}})
	for _, key := range []string{"canReadCanvas", "canWriteCanvas", "canExportCanvas"} {
		if permissions[key] != false {
			t.Errorf("数据库故障时 %s=%v", key, permissions[key])
		}
	}
}

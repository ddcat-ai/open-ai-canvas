package repository

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestCreateProjectReturnsConflictForDuplicateUserName(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) {
		db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "projects.db")), &gorm.Config{
			Logger: logger.Default.LogMode(logger.Silent),
		})
		if err != nil {
			t.Fatal(err)
		}
		closeTestDatabase(t, db)
		testCreateProjectNameConflict(t, db)
	})

	t.Run("postgres", func(t *testing.T) {
		dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
		if dsn == "" {
			t.Skip("set CANVAS_TEST_POSTGRES_DSN to an isolated test database")
		}
		config := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
		admin, err := gorm.Open(postgres.Open(dsn), config)
		if err != nil {
			t.Fatal(err)
		}
		closeTestDatabase(t, admin)

		schema := fmt.Sprintf("project_name_conflict_%d", time.Now().UnixNano())
		if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
				t.Errorf("drop test schema: %v", err)
			}
		})

		parsed, err := url.Parse(dsn)
		if err != nil {
			t.Fatal(err)
		}
		query := parsed.Query()
		query.Set("search_path", schema)
		parsed.RawQuery = query.Encode()
		db, err := gorm.Open(postgres.Open(parsed.String()), config)
		if err != nil {
			t.Fatal(err)
		}
		closeTestDatabase(t, db)
		testCreateProjectNameConflict(t, db)
	})
}

// testCreateProjectNameConflict 验证名称冲突按用户区分，且不误判项目 ID 冲突。
func testCreateProjectNameConflict(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.Project{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)

	first := model.Project{ID: "project-1", UserID: "user-1", Name: "短剧", Description: "原项目内容"}
	if err := repo.CreateProject(&first); err != nil {
		t.Fatal(err)
	}

	duplicate := model.Project{ID: "project-2", UserID: "user-1", Name: "短剧", Description: "重复请求的内容"}
	if err := repo.CreateProject(&duplicate); !errors.Is(err, ErrProjectNameConflict) {
		t.Fatalf("duplicate name error = %v, want ErrProjectNameConflict", err)
	}
	stored, err := repo.ProjectForUser(first.UserID, first.ID)
	if err != nil || stored.Description != first.Description {
		t.Fatalf("duplicate creation changed the original project: project=%#v, error=%v", stored, err)
	}

	sameNameForAnotherUser := model.Project{ID: "project-3", UserID: "user-2", Name: "短剧"}
	if err := repo.CreateProject(&sameNameForAnotherUser); err != nil {
		t.Fatalf("same name for another user: %v", err)
	}

	primaryKeyConflict := model.Project{ID: "project-1", UserID: "user-3", Name: "其他项目"}
	if err := repo.CreateProject(&primaryKeyConflict); err == nil || errors.Is(err, ErrProjectNameConflict) {
		t.Fatalf("primary key conflict error = %v, want a different database error", err)
	}
}

func closeTestDatabase(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := sqlDB.Close(); err != nil {
			t.Errorf("close test database: %v", err)
		}
	})
}

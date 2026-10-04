package app

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestCreateProjectReturnsStructuredConflictForDuplicateName(t *testing.T) {
	t.Run("sqlite", func(t *testing.T) {
		service, db := newProjectSettingsTestService(t)
		testStructuredProjectNameConflict(t, service, db)
	})
	t.Run("postgres", func(t *testing.T) {
		service, db := newProjectNameConflictPostgresService(t)
		testStructuredProjectNameConflict(t, service, db)
	})
}

// testStructuredProjectNameConflict 验证重名的结构化错误，以及原项目和工作流不会被重复创建请求覆盖。
func testStructuredProjectNameConflict(t *testing.T, service *Service, db *gorm.DB) {
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
	if err := db.AutoMigrate(&model.Project{}, &model.WorkflowTemplateVersion{}, &model.WorkflowInstance{}, &model.WorkflowStepInstance{}); err != nil {
		t.Fatal(err)
	}

	request := CreateProjectRequest{Name: "同名短剧", Description: "原项目内容"}
	first, err := service.CreateProject("user-1", request)
	if err != nil {
		t.Fatalf("create initial project: %v", err)
	}

	request.Description = "重复请求的内容"
	_, err = service.CreateProject("user-1", request)
	var conflict *AppError
	if !errors.As(err, &conflict) {
		t.Fatalf("duplicate project error = %v, want AppError", err)
	}
	if conflict.Status != http.StatusConflict || conflict.Reason != ReasonProjectNameConflict || conflict.Message != "项目名称已存在" {
		t.Fatalf("duplicate project conflict = %#v", conflict)
	}
	var stored model.Project
	if err := db.First(&stored, "id = ?", first.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Description != first.Description || stored.Revision != first.Revision {
		t.Fatal("duplicate creation changed the existing project")
	}
	var workflowCount int64
	if err := db.Model(&model.WorkflowInstance{}).Where("project_id = ?", first.ID).Count(&workflowCount).Error; err != nil || workflowCount != 1 {
		t.Fatalf("workflow count = %d, error = %v", workflowCount, err)
	}
	if _, err := service.CreateProject("user-2", request); err != nil {
		t.Fatalf("same name for another user: %v", err)
	}
	request.Name = "同名短剧（2）"
	if _, err := service.CreateProject("user-1", request); err != nil {
		t.Fatalf("retry with a new name: %v", err)
	}
}

// newProjectNameConflictPostgresService 只在独立测试 schema 中创建项目与工作流表，测试结束后删除该 schema。
func newProjectNameConflictPostgresService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	options := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	admin, err := gorm.Open(postgres.Open(dsn), options)
	if err != nil {
		t.Fatal(err)
	}
	adminSQL, err := admin.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = adminSQL.Close() })
	schema := fmt.Sprintf("project_name_conflict_app_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Error(err)
		}
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), options)
	if err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

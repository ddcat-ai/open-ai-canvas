package app

import (
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// 可选真实 PostgreSQL 验收：每个测试独立 schema，仅接受明确的 QA 数据库。
func deletionPostgresDB(t *testing.T) (*gorm.DB, error) {
	t.Helper()
	dsn := os.Getenv("CANVAS_DELETE_TEST_POSTGRES_DSN")
	if dsn == "" {
		return nil, nil
	}
	parsed, err := url.Parse(dsn)
	if err != nil || !strings.HasPrefix(strings.TrimPrefix(parsed.Path, "/"), "canvas_qa_") {
		return nil, fmt.Errorf("deletion tests require an isolated canvas_qa_ PostgreSQL database")
	}
	base, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, err
	}
	baseSQL, err := base.DB()
	if err != nil {
		return nil, err
	}
	schema := "qa_delete_" + newID()
	if err = base.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		baseSQL.Close()
		return nil, err
	}
	q := parsed.Query()
	q.Set("search_path", schema)
	parsed.RawQuery = q.Encode()
	isolated, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	if err != nil {
		base.Exec("DROP SCHEMA " + schema + " CASCADE")
		baseSQL.Close()
		return nil, err
	}
	t.Cleanup(func() {
		if sqlDB, e := isolated.DB(); e == nil {
			sqlDB.Close()
		}
		if e := base.Exec("DROP SCHEMA " + schema + " CASCADE").Error; e != nil {
			t.Error(e)
		}
		baseSQL.Close()
	})
	return isolated, nil
}

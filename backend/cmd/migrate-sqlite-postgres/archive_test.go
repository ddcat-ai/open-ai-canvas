package main

import (
	"bytes"
	"compress/gzip"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
)

func TestColdHistoryArchiveMigration(t *testing.T) {
	for _, driver := range []string{"sqlite", "postgres"} {
		t.Run(driver, func(t *testing.T) {
			targetCfg := database.Config{Driver: driver, DSN: filepath.Join(t.TempDir(), "target.db")}
			if driver == "postgres" {
				targetCfg.DSN = os.Getenv("CANVAS_TEST_POSTGRES_DSN")
				if targetCfg.DSN == "" {
					t.Skip("set CANVAS_TEST_POSTGRES_DSN to test PostgreSQL import")
				}
			}
			source, err := database.Open(database.Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "source.db")})
			if err != nil {
				t.Fatal(err)
			}
			target, err := database.Open(targetCfg)
			if err != nil {
				t.Fatal(err)
			}
			tx := target.Begin()
			if tx.Error != nil {
				t.Fatal(tx.Error)
			}
			defer tx.Rollback()
			if driver == "postgres" {
				schema := fmt.Sprintf("archive_migration_%d", time.Now().UnixNano())
				if err := tx.Exec("CREATE SCHEMA " + schema).Error; err != nil {
					t.Fatal(err)
				}
				if err := tx.Exec("SET LOCAL search_path TO " + schema).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := source.Migrator().CreateTable(&model.CloudAgentHistoryArchive{}); err != nil {
				t.Fatal(err)
			}
			if err := tx.Migrator().CreateTable(&model.CloudAgentHistoryArchive{}); err != nil {
				t.Fatal(err)
			}
			var out bytes.Buffer
			w := gzip.NewWriter(&out)
			raw := []byte("一段已完成的 Agent 会话")
			if _, err := w.Write(raw); err != nil {
				t.Fatal(err)
			}
			if err := w.Close(); err != nil {
				t.Fatal(err)
			}
			archive := model.CloudAgentHistoryArchive{RunID: "archived-run", UserID: "owner", OriginalBytes: int64(len(raw)), CompressedBytes: int64(out.Len()), PayloadGZIP: out.Bytes()}
			if err := source.Create(&archive).Error; err != nil {
				t.Fatal(err)
			}
			for _, m := range migrations() {
				if m.name != "cloud_agent_history_archives" {
					continue
				}
				for _, copyRows := range []bool{true, false} {
					if count, err := m.run(source, tx, copyRows); err != nil || count != 1 {
						t.Fatalf("copy=%v: count=%d err=%v", copyRows, count, err)
					}
				}
				var copied model.CloudAgentHistoryArchive
				if err := tx.First(&copied, "run_id = ?", archive.RunID).Error; err != nil {
					t.Fatal(err)
				}
				if copied.UserID != archive.UserID || copied.OriginalBytes != archive.OriginalBytes || copied.CompressedBytes != archive.CompressedBytes || !bytes.Equal(copied.PayloadGZIP, archive.PayloadGZIP) {
					t.Fatal("cold history archive changed during import")
				}
				copied.PayloadGZIP = []byte("changed")
				if err := tx.Save(&copied).Error; err != nil {
					t.Fatal(err)
				}
				if _, err := m.run(source, tx, false); err == nil {
					t.Fatal("changed archive passed verification")
				}
				return
			}
			t.Fatal("cold history archive is missing from the import list")
		})
	}
}

package app

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
	"yingce/backend/internal/backup"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/storage"
)

func TestDatabaseBackupUploadVerifyRetentionRestore(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	var mu sync.Mutex
	objects := map[string][]byte{}
	corrupt := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		switch r.Method {
		case http.MethodPut:
			data, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "read", 500)
				return
			}
			objects[r.URL.Path] = data
			w.Header().Set("ETag", `"test"`)
			w.WriteHeader(200)
		case http.MethodGet:
			data, ok := objects[r.URL.Path]
			if !ok {
				http.NotFound(w, r)
				return
			}
			if corrupt {
				data = []byte("corrupt")
			}
			_, _ = w.Write(data)
		case http.MethodDelete:
			delete(objects, r.URL.Path)
			w.WriteHeader(204)
		default:
			http.Error(w, "method", 405)
		}
	}))
	defer server.Close()
	db := newSQLiteTestDB(t)
	if err := db.AutoMigrate(&model.SystemSetting{}, &model.CreditAccount{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CreditAccount{UserID: "roundtrip", AvailableMicrocredits: 87654321}).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	cfg := DatabaseBackupSettings{RetainCount: 1, RecoveryPassword: "offline-recovery-password", Storage: storage.Settings{Enabled: true, Provider: "s3", Endpoint: server.URL, Region: "us-east-1", Bucket: "test", AccessKeyID: "test", AccessKeySecret: "test", PathPrefix: "backups", PathStyle: true}}
	for i := 0; i < 2; i++ {
		record, err := svc.claimDatabaseBackup(cfg, "manual")
		if err != nil {
			t.Fatal(err)
		}
		svc.executeDatabaseBackup(context.Background(), cfg, *record)
	}
	records, err := svc.databaseBackupRecords()
	if err != nil {
		t.Fatal(err)
	}
	if len(records) != 2 || records[0].Status != "completed" || records[1].Status != "expired" {
		t.Fatalf("records: %+v", records)
	}
	mu.Lock()
	if len(objects) != 1 {
		t.Errorf("retention kept %d objects", len(objects))
	}
	var encrypted []byte
	for _, data := range objects {
		encrypted = append([]byte(nil), data...)
	}
	mu.Unlock()
	var plain bytes.Buffer
	if err := backup.Decrypt(&plain, bytes.NewReader(encrypted), cfg.RecoveryPassword); err != nil {
		t.Fatal(err)
	}
	gz, err := gzip.NewReader(&plain)
	if err != nil {
		t.Fatal(err)
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	var snapshot, key []byte
	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(tr)
		if err != nil {
			t.Fatal(err)
		}
		if header.Name == "database.sqlite" {
			snapshot = data
		}
		if header.Name == "data/.settings-key" {
			key = data
		}
	}
	if len(key) != 32 {
		t.Fatal("configuration decryption key absent")
	}
	path := filepath.Join(t.TempDir(), "restored.sqlite")
	if err := os.WriteFile(path, snapshot, 0600); err != nil {
		t.Fatal(err)
	}
	restored, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := restored.DB()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlDB.Close()
	var account model.CreditAccount
	if err := restored.First(&account, "user_id = ?", "roundtrip").Error; err != nil || account.AvailableMicrocredits != 87654321 {
		t.Fatal("uploaded archive did not restore credit balance")
	}
	mu.Lock()
	corrupt = true
	mu.Unlock()
	record, err := svc.claimDatabaseBackup(cfg, "manual")
	if err != nil {
		t.Fatal(err)
	}
	svc.executeDatabaseBackup(context.Background(), cfg, *record)
	records, err = svc.databaseBackupRecords()
	if err != nil {
		t.Fatal(err)
	}
	if records[0].Status != "failed" || records[1].Status != "completed" {
		t.Fatal("corrupt upload removed last good backup")
	}
}

func TestDatabaseBackupSettingsAndRecords(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := db.AutoMigrate(&model.SystemSetting{}); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	cfg := DatabaseBackupSettings{DailyTime: "03:00", Timezone: "Asia/Shanghai", RetainCount: 14, RecoveryPassword: "test-recovery-password-123", Storage: storage.Settings{Provider: "s3", Endpoint: "https://s3.amazonaws.com", Region: "us-east-1", Bucket: "backup-test", AccessKeyID: "test-id", AccessKeySecret: "test-secret", PathPrefix: "backups"}}
	if _, err := svc.UpdateDatabaseBackupSettings(user, cfg); err == nil {
		t.Fatal("non-admin saved settings")
	}
	if _, err := svc.AdminDatabaseBackupSettings(user); err == nil {
		t.Fatal("non-admin read settings")
	}
	if _, err := svc.AdminDatabaseBackupRecords(user); err == nil {
		t.Fatal("non-admin read records")
	}
	if _, err := svc.StartDatabaseBackup(user); err == nil {
		t.Fatal("non-admin started backup")
	}
	if _, err := svc.DatabaseBackupDownload(user, "missing"); err == nil {
		t.Fatal("non-admin got download")
	}
	public, err := svc.UpdateDatabaseBackupSettings(admin, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if public.RecoveryPassword != "" || public.Storage.AccessKeySecret != "" || !public.HasRecoveryPassword || !public.HasStorageSecret {
		t.Fatal("public secrets not masked")
	}
	row, err := svc.repo.SystemSettingOptional(databaseBackupSettingKey)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(row.ValueJSON, cfg.RecoveryPassword) || strings.Contains(row.ValueJSON, cfg.Storage.AccessKeySecret) {
		t.Fatal("stored plaintext secret")
	}
	if _, err = svc.UpdateDatabaseBackupSettings(admin, public); err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.databaseBackupSettings()
	if err != nil || loaded.RecoveryPassword != cfg.RecoveryPassword || loaded.Storage.AccessKeySecret != cfg.Storage.AccessKeySecret {
		t.Fatal("blank secret update erased credentials")
	}
	for _, endpoint := range []string{"http://s3.amazonaws.com", "https://user:pass@s3.amazonaws.com", "https://s3.amazonaws.com/path", "https://s3.amazonaws.com?token=secret"} {
		invalid := cfg
		invalid.Storage.Endpoint = endpoint
		if _, err := svc.UpdateDatabaseBackupSettings(admin, invalid); err == nil {
			t.Fatalf("accepted invalid endpoint: %s", endpoint)
		}
	}
	now := time.Now().UTC()
	older := DatabaseBackupRecord{ID: "older", Status: "completed", StartedAt: now.Add(-time.Hour)}
	newer := DatabaseBackupRecord{ID: "newer", Status: "completed", StartedAt: now}
	for _, record := range []DatabaseBackupRecord{older, newer, older} {
		if err := svc.saveDatabaseBackupRecord(record); err != nil {
			t.Fatal(err)
		}
	}
	records, err := svc.databaseBackupRecords()
	if err != nil || len(records) != 2 || records[0].ID != "newer" {
		t.Fatal("record update corrupted retention order")
	}
	// A previously consumed daily slot must not create/delete another backup record.
	loaded.Enabled = true
	if _, err := svc.UpdateDatabaseBackupSettings(admin, loaded); err != nil {
		t.Fatal(err)
	}
	scheduled := time.Date(2026, 10, 28, 5, 0, 0, 0, time.UTC)
	if _, err := svc.repo.ClaimDatabaseBackupDay("2026-10-28"); err != nil {
		t.Fatal(err)
	}
	svc.scheduledDatabaseBackup(context.Background(), scheduled)
	records, err = svc.databaseBackupRecords()
	if err != nil || len(records) != 2 {
		t.Fatal("daily slot ran twice")
	}
}

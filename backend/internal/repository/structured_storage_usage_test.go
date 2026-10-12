package repository

import (
	"errors"
	"path/filepath"
	"testing"

	"yingce/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func TestUserStructuredStorageUsage(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "quota.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	// History tables are deliberately absent: canvas quota must not read them.
	if err := db.AutoMigrate(&model.Asset{}, &model.CanvasProject{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	assetPayload := `{"title":"素材 🎬"}`
	canvasPayload := `{"title":"画布","nodes":[]}`
	assets := []model.Asset{
		{ID: "asset", UserID: "owner", PayloadJSON: assetPayload},
		{ID: "empty", UserID: "owner"},
		{ID: "null", UserID: "owner"},
		{ID: "foreign-asset", UserID: "other", PayloadJSON: assetPayload},
	}
	canvases := []model.CanvasProject{
		{ID: "canvas", UserID: "owner", PayloadJSON: canvasPayload},
		{ID: "foreign-canvas", UserID: "other", PayloadJSON: canvasPayload},
	}
	if err := db.Create(&assets).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Asset{}).Where("id = ?", "null").UpdateColumn("payload_json", nil).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&canvases).Error; err != nil {
		t.Fatal(err)
	}
	want := UserStorageUsage{AssetCount: 3, AssetBytes: int64(len(assetPayload)), CanvasCount: 1, CanvasBytes: int64(len(canvasPayload))}
	assertUsage := func(repo *Repository, userID string, expected UserStorageUsage) {
		t.Helper()
		got, err := repo.UserStructuredStorageUsage(userID)
		if err != nil {
			t.Fatal(err)
		}
		if got != expected {
			t.Fatalf("usage for %s = %+v, want %+v", userID, got, expected)
		}
	}
	assertUsage(repo, "owner", want)
	assertUsage(repo, "missing", UserStorageUsage{})
	assertUsage(repo, "other", UserStorageUsage{AssetCount: 1, AssetBytes: int64(len(assetPayload)), CanvasCount: 1, CanvasBytes: int64(len(canvasPayload))})

	rollback := errors.New("rollback quota probe")
	err = repo.Transaction(func(tx *Repository) error {
		project := model.CanvasProject{ID: "uncommitted", UserID: "owner", PayloadJSON: canvasPayload}
		if err := tx.UpsertCanvasProject(&project); err != nil {
			return err
		}
		inside := want
		inside.CanvasCount++
		inside.CanvasBytes += int64(len(canvasPayload))
		assertUsage(tx, "owner", inside)
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatalf("transaction error = %v", err)
	}
	assertUsage(repo, "owner", want)
	if err := db.Migrator().DropTable(&model.Asset{}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.UserStructuredStorageUsage("owner"); err == nil {
		t.Fatal("database error must not become zero usage")
	}
}

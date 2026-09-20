package canvas

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func TestRepairAssetBytes(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	sqlDB.SetMaxOpenConns(1)
	testRepairAssetBytes(t, db)
}

func TestRepairAssetBytesPostgres(t *testing.T) {
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	defer sqlDB.Close()
	rollback := errors.New("rollback isolated test schema")
	err = db.Transaction(func(tx *gorm.DB) error {
		schema := fmt.Sprintf("repair_asset_bytes_%d", time.Now().UnixNano())
		if err := tx.Exec("CREATE SCHEMA " + schema).Error; err != nil {
			return err
		}
		if err := tx.Exec("SET LOCAL search_path TO " + schema).Error; err != nil {
			return err
		}
		testRepairAssetBytes(t, tx)
		return rollback
	})
	if !errors.Is(err, rollback) {
		t.Fatal(err)
	}
}

func testRepairAssetBytes(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.Asset{}, &model.Resource{}); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "resource-1", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Size: 12345}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	originals := map[string]string{}
	for i := 0; i < 106; i++ {
		id := fmt.Sprintf("asset-%03d", i)
		payload := testUserAssetPayload("image", nil)
		payload["id"] = id
		payload["customExactInteger"] = json.RawMessage("9007199254740993")
		data := payload["data"].(map[string]any)
		data["storageKey"] = "resource:resource-1"
		data["bytes"] = nil
		userID := "user-1"
		switch i {
		case 0:
			data["bytes"] = 55 // Valid values must remain untouched.
		case 1:
			userID = "another-user"
		case 2:
			delete(data, "storageKey")
		case 3:
			data["bytes"] = "123"
		case 4:
			delete(data, "bytes")
		case 5:
			data["bytes"] = -1
		}
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		originals[id] = string(raw)
		asset := model.Asset{ID: id, UserID: userID, Kind: "image", PayloadJSON: string(raw)}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
	}
	report, err := RepairAssetBytes(db, false)
	if err != nil || report.Scanned != 106 || report.Repairable != 103 || report.Repaired != 0 || len(report.Unresolved) != 2 {
		t.Fatalf("dry run: %+v, %v", report, err)
	}
	var before []model.Asset
	if err := db.Find(&before).Error; err != nil {
		t.Fatal(err)
	}
	for _, asset := range before {
		if asset.PayloadJSON != originals[asset.ID] {
			t.Fatal("dry run modified data")
		}
	}
	report, err = RepairAssetBytes(db, true)
	if err != nil || report.Repaired != 103 || len(report.Unresolved) != 2 {
		t.Fatalf("apply: %+v, %v", report, err)
	}
	var after []model.Asset
	if err := db.Find(&after).Error; err != nil {
		t.Fatal(err)
	}
	for _, asset := range after {
		if asset.ID <= "asset-002" {
			if asset.PayloadJSON != originals[asset.ID] {
				t.Fatal("valid or unresolved asset modified")
			}
			continue
		}
		var payload map[string]json.RawMessage
		var data map[string]json.RawMessage
		if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
			t.Fatal(err)
		}
		if err := json.Unmarshal(payload["data"], &data); err != nil {
			t.Fatal(err)
		}
		if string(data["bytes"]) != "12345" || string(payload["customExactInteger"]) != "9007199254740993" {
			t.Fatal("repair corrupted payload")
		}
		var stamp string
		_ = json.Unmarshal(payload["updatedAt"], &stamp)
		parsed, err := time.Parse(time.RFC3339Nano, stamp)
		// PostgreSQL stores microseconds; compare at that precision.
		if err != nil || parsed.Sub(asset.UpdatedAt).Abs() >= time.Microsecond {
			t.Fatal("timestamps disagree")
		}
	}
	report, err = RepairAssetBytes(db, true)
	if err != nil || report.Repairable != 0 || report.Repaired != 0 {
		t.Fatalf("not idempotent: %+v, %v", report, err)
	}
	for _, id := range []string{"asset-003", "asset-004"} {
		if err := db.Model(&model.Asset{}).Where("id = ?", id).Update("payload_json", originals[id]).Error; err != nil {
			t.Fatal(err)
		}
	}
	updates := 0
	const callback = "test:fail-second-asset-repair"
	if err := db.Callback().Update().Before("gorm:update").Register(callback, func(tx *gorm.DB) {
		updates++
		if updates == 2 {
			tx.AddError(errors.New("injected update failure"))
		}
	}); err != nil {
		t.Fatal(err)
	}
	report, err = RepairAssetBytes(db, true)
	if removeErr := db.Callback().Update().Remove(callback); removeErr != nil {
		t.Fatal(removeErr)
	}
	if err == nil || report.Repaired != 0 {
		t.Fatalf("failed repair reported success: %+v, %v", report, err)
	}
	for _, id := range []string{"asset-003", "asset-004"} {
		var asset model.Asset
		if err := db.First(&asset, "id = ?", id).Error; err != nil {
			t.Fatal(err)
		}
		if asset.PayloadJSON != originals[id] {
			t.Fatal("failed batch was not rolled back")
		}
	}
}

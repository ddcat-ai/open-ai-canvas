package repository

import (
	"errors"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestChannelModelBatchCASRejectsStaleSnapshot(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.ChannelModel{}, &model.ChannelModelPriceTier{}); err != nil {
		t.Fatal(err)
	}
	row := model.ChannelModel{ID: "batch", ChannelID: "channel", ModelKey: "batch", PriceVersion: 4, CapabilityVersion: 7, Description: "original"}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	for _, kind := range []string{"price", "capability", "timestamp", "channel"} {
		t.Run(kind, func(t *testing.T) {
			before := row
			switch kind {
			case "price":
				before.PriceVersion--
			case "capability":
				before.CapabilityVersion--
			case "timestamp":
				before.UpdatedAt = before.UpdatedAt.Add(-time.Microsecond)
			case "channel":
				before.ChannelID = "other"
			}
			after := before
			err := repo.Transaction(func(tx *Repository) error {
				return tx.UpdateChannelModelBatch(&before, &after, map[string]any{"description": "wrong"}, false, false)
			})
			if !errors.Is(err, ErrChannelModelPriceConflict) {
				t.Fatalf("err=%v", err)
			}
			var stored model.ChannelModel
			if err := db.First(&stored, "id = ?", row.ID).Error; err != nil {
				t.Fatal(err)
			}
			if stored.Description != "original" || !stored.UpdatedAt.Equal(row.UpdatedAt) {
				t.Fatal("stale mutation was written")
			}
		})
	}
}

func TestChannelModelEditorCannotResurrectDeletedModel(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ModelChannel{ID: "channel", Scope: model.ChannelScopeSystem}).Error; err != nil {
		t.Fatal(err)
	}
	row := model.ChannelModel{ID: "deleted", ChannelID: "channel", ModelKey: "deleted", PriceVersion: 1}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&model.ChannelModel{}, "id = ?", row.ID).Error; err != nil {
		t.Fatal(err)
	}
	row.PriceVersion++
	if err := New(db).SaveChannelModelWithPriceTiers(&row, nil); !errors.Is(err, ErrTaskStateConflict) {
		t.Fatalf("stale editor result=%v", err)
	}
	var active int64
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", row.ID).Count(&active).Error; err != nil || active != 0 {
		t.Fatalf("model resurrected: count=%d err=%v", active, err)
	}
}

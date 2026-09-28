package database

import (
	"math"
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

func prefixedIDTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := Open(Config{Driver: "sqlite", DSN: filepath.Join(t.TempDir(), "ids.db")})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.IDSequence{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestAllocatePrefixedIDReservesDeletedAndExistingIDs(t *testing.T) {
	db := prefixedIDTestDB(t)
	for _, id := range []string{"CHANNEL_000012", "CHANNEL_000030", "CHANNEL_bad", "OTHER_999999", "CHANNEL_999999999999999999999999"} {
		if err := db.Create(&model.ModelChannel{ID: id}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Delete(&model.ModelChannel{}, "id = ?", "CHANNEL_000030").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.IDSequence{Name: "id:CHANNEL", Value: 2}).Error; err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"CHANNEL_000031", "CHANNEL_000032"} {
		got, err := AllocatePrefixedID(db, " channel ")
		if err != nil || got != want {
			t.Fatalf("got %q, %v; want %q", got, err, want)
		}
	}
}

func TestReconcilePrefixedIDSequencesNeverRegresses(t *testing.T) {
	db := prefixedIDTestDB(t)
	if err := db.Create(&model.ModelChannel{ID: "CHANNEL_000030"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, want := range []int64{30, 30, 100, 100} {
		if want == 100 {
			if err := db.Model(&model.IDSequence{}).Where("name = ?", "id:CHANNEL").Update("value", want).Error; err != nil {
				t.Fatal(err)
			}
		}
		if err := ReconcilePrefixedIDSequences(db); err != nil {
			t.Fatal(err)
		}
		var sequence model.IDSequence
		if err := db.First(&sequence, "name = ?", "id:CHANNEL").Error; err != nil {
			t.Fatal(err)
		}
		if sequence.Value != want {
			t.Fatalf("got %d; want %d", sequence.Value, want)
		}
	}
}

func TestAllocatePrefixedIDRejectsOverflowWithoutMutation(t *testing.T) {
	db := prefixedIDTestDB(t)
	if err := db.Create(&model.IDSequence{Name: "id:CHANNEL", Value: math.MaxInt64}).Error; err != nil {
		t.Fatal(err)
	}
	got, err := AllocatePrefixedID(db, "CHANNEL")
	if err == nil || got != "" {
		t.Fatalf("expected no ID and overflow error, got %q, %v", got, err)
	}
	var sequence model.IDSequence
	if err := db.First(&sequence, "name = ?", "id:CHANNEL").Error; err != nil {
		t.Fatal(err)
	}
	if sequence.Value != math.MaxInt64 {
		t.Fatalf("overflow mutated sequence: %d", sequence.Value)
	}
}

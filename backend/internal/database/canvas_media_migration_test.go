package database

import (
	"path/filepath"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCanvasMediaMigrationBackfillsOwnedHistoryAndBranches(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "migration.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ := db.DB()
	t.Cleanup(func() { _ = conn.Close() })
	if err := db.AutoMigrate(&model.CanvasProject{}, &model.CanvasSnapshot{}, &model.Resource{}, &model.Asset{}, &model.CanvasBranch{}); err != nil {
		t.Fatal(err)
	}
	for _, record := range []any{
		&model.Resource{ID: "current", UserID: "owner", Status: model.ResourceStatusReady},
		&model.Resource{ID: "history", UserID: "owner", Status: model.ResourceStatusReady},
		&model.Resource{ID: "foreign", UserID: "stranger", Status: model.ResourceStatusReady},
		&model.Resource{ID: "unreferenced", UserID: "owner", Status: model.ResourceStatusReady},
		&model.Asset{ID: "asset", UserID: "owner", PayloadJSON: `{"data":{"storageKey":"resource:current"}}`},
		&model.CanvasProject{ID: "source", UserID: "owner", Revision: 7, PayloadJSON: `{"nodes":[{"metadata":{"assetId":"asset","storageKey":"resource:current","previewContent":"resource:foreign"}}]}`},
		&model.CanvasSnapshot{ID: "snapshot", CanvasID: "source", UserID: "owner", Revision: 6, PayloadJSON: `{"storageKey":"resource:history"}`},
		&model.CanvasProject{ID: "branch", UserID: "editor", Revision: 2, PayloadJSON: `{"assetId":"asset","storageKey":"resource:current","previewContent":"resource:foreign"}`},
		&model.CanvasBranch{ID: "branch-record", SourceCanvasID: "source", BranchCanvasID: "branch", CreatedAt: time.Now()},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 2; i++ {
		if err := db.Transaction(migrateCanvasMediaGrants); err != nil {
			t.Fatal(err)
		}
	}
	var grants []model.CanvasMediaGrant
	if err := db.Find(&grants).Error; err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{}
	for _, grant := range grants {
		got[grant.CanvasID+"/"+grant.Kind+"/"+grant.ObjectID] = grant.Current
	}
	want := map[string]bool{"source/resource/current": true, "source/resource/history": false, "source/asset/asset": true, "branch/resource/current": true, "branch/asset/asset": true}
	if len(got) != len(want) {
		t.Fatalf("grants = %#v", got)
	}
	for key, current := range want {
		if actual, ok := got[key]; !ok || actual != current {
			t.Fatalf("%s = %t, exists=%t", key, actual, ok)
		}
	}
	var source model.CanvasProject
	if err := db.First(&source, "id = ?", "source").Error; err != nil || source.Revision != 7 {
		t.Fatalf("source changed: %#v %v", source, err)
	}
}

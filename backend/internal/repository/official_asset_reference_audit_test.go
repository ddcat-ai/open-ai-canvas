package repository

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"reflect"
	"testing"
	"yingce/backend/internal/model"
)

func TestOfficialAssetResourceIDsIncludesAllCharacterMedia(t *testing.T) {
	asset := &model.OfficialAsset{ResourceID: "cover", CharacterSnapshotJSON: `{"images":[{"resourceId":"legacy"}],"representations":[{"resourceId":"view"},{"resourceId":"cover"}],"voice":{"profile":{"sampleResourceId":"voice"}}}`}
	ids, err := OfficialAssetResourceIDs(asset)
	if err != nil || !reflect.DeepEqual(ids, []string{"cover", "legacy", "view", "voice"}) {
		t.Fatalf("ids=%v err=%v", ids, err)
	}
	asset.CharacterSnapshotJSON = `{`
	if _, err := OfficialAssetResourceIDs(asset); err == nil {
		t.Fatal("malformed snapshot must fail closed")
	}
}

func TestOfficialAssetDocumentReferences(t *testing.T) {
	ids := map[string]struct{}{"image-1": {}}
	for _, tc := range []struct {
		raw           string
		want, invalid bool
	}{
		{`{"nodes":[{"metadata":{"officialAssetId":"official-1"}}]}`, true, false},
		{`{"nodes":[{"metadata":{"storageKey":"resource:image-1"}}]}`, true, false},
		{`{"custom":{"image":"/api/resources/image-1/file"}}`, true, false},
		{`{"custom":{"raw":"image-1"}}`, true, false},
		{`{"nodes":[{"metadata":{"officialAssetId":"other","storageKey":"resource:other"}}]}`, false, false},
		{`{"nodes":`, false, true},
	} {
		got, err := officialAssetDocumentReferences(tc.raw, "official-1", ids)
		if got != tc.want || (err != nil) != tc.invalid {
			t.Errorf("%s: got %v err %v", tc.raw, got, err)
		}
	}
}

func TestOfficialAssetHasReferencesAcrossSources(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&model.OfficialAssetImport{}, &model.CanvasProject{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}, &model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{}, &model.VoiceProfile{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	check := func(want bool) {
		t.Helper()
		got, err := repo.OfficialAssetHasReferences("official-1", []string{"image-1", "audio-1"})
		if err != nil || got != want {
			t.Fatalf("references = %v, %v; want %v", got, err, want)
		}
	}
	check(false)
	if err = db.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"metadata":{"officialAssetId":"official-1"}}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	check(true)
	db.Exec("DELETE FROM canvas_projects")
	if err = db.Create(&model.CanvasSnapshot{ID: "snapshot", CanvasID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Create(&model.CanvasSnapshotResource{SnapshotID: "snapshot", ResourceID: "image-1"}).Error; err != nil {
		t.Fatal(err)
	}
	check(true)
	db.Exec("DELETE FROM canvas_snapshot_resources")
	if err = db.Create(&model.Asset{ID: "personal", UserID: "user", PayloadJSON: `{"data":{"storageKey":"resource:image-1"}}`}).Error; err != nil {
		t.Fatal(err)
	}
	check(true)
	db.Exec("DELETE FROM assets")
	if err = db.Create(&model.AssetVersion{ID: "version", AssetID: "personal", DefinitionJSON: `{"imageUrl":"/api/resources/image-1/file"}`}).Error; err != nil {
		t.Fatal(err)
	}
	check(true)
	db.Exec("DELETE FROM asset_versions")
	if err = db.Create(&model.VoiceProfile{ID: "voice", UserID: "user", SampleResourceID: "audio-1"}).Error; err != nil {
		t.Fatal(err)
	}
	check(true)
}

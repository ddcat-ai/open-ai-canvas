package repository

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"testing"
	"yingce/backend/internal/model"
)

func TestUserCharacterReferencesResource(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{}, &model.CharacterVoiceBinding{}, &model.VoiceProfile{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.Asset{ID: "a", UserID: "owner", Kind: "entity", Category: model.AssetCategoryCharacter},
		&model.AssetVersion{ID: "v", AssetID: "a"},
		&model.AssetRepresentation{ID: "r", AssetVersionID: "v", ResourceID: "image", Role: "front"},
		&model.VoiceProfile{ID: "p", UserID: "owner", SampleResourceID: "audio"},
		&model.CharacterVoiceBinding{ID: "b", AssetVersionID: "v", VoiceProfileID: "p"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	repo := New(db)
	for _, tc := range []struct {
		user, resource string
		want           bool
	}{{"owner", "image", true}, {"owner", "audio", true}, {"other", "image", false}, {"other", "audio", false}, {"owner", "unknown", false}} {
		got, err := repo.UserCharacterReferencesResource(tc.user, tc.resource)
		if err != nil || got != tc.want {
			t.Errorf("%s %s: got %v, err %v", tc.user, tc.resource, got, err)
		}
	}
}

func TestOfficialCharacterCopyReusesVoiceAtomically(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err = db.AutoMigrate(&model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{}, &model.CharacterVoiceBinding{}, &model.VoiceProfile{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	for _, suffix := range []string{"1", "2"} {
		asset := &model.Asset{ID: "asset" + suffix, UserID: "owner", Kind: "entity", Category: model.AssetCategoryCharacter}
		version := &model.AssetVersion{ID: "version" + suffix, AssetID: asset.ID}
		profile := &model.VoiceProfile{ID: "profile" + suffix, UserID: "owner", Provider: "official_copy", VoiceKey: "original-key", SampleResourceID: "sample", Status: "active"}
		voice := &model.CharacterVoiceBinding{ID: "binding" + suffix, AssetVersionID: version.ID, VoiceProfileID: profile.ID}
		if err := repo.CreateOfficialCharacterCopy(asset, version, nil, profile, voice); err != nil {
			t.Fatal(err)
		}
	}
	var profiles int64
	db.Model(&model.VoiceProfile{}).Count(&profiles)
	if profiles != 1 {
		t.Fatalf("got %d profiles", profiles)
	}
	var bindings []model.CharacterVoiceBinding
	db.Find(&bindings)
	if len(bindings) != 2 || bindings[0].VoiceProfileID != bindings[1].VoiceProfileID {
		t.Fatalf("voice bindings: %+v", bindings)
	}
	asset := &model.Asset{ID: "bad", UserID: "owner", Kind: "entity", Category: model.AssetCategoryCharacter}
	version := &model.AssetVersion{ID: "bad-version", AssetID: asset.ID}
	profile := &model.VoiceProfile{ID: "bad-profile", UserID: "owner", Provider: "official_copy", VoiceKey: "original-key", SampleResourceID: "different", Status: "active"}
	voice := &model.CharacterVoiceBinding{ID: "bad-binding", AssetVersionID: version.ID, VoiceProfileID: profile.ID}
	if err := repo.CreateOfficialCharacterCopy(asset, version, nil, profile, voice); err == nil {
		t.Fatal("expected mismatched sample rejection")
	}
	var count int64
	db.Model(&model.Asset{}).Where("id = ?", "bad").Count(&count)
	if count != 0 {
		t.Fatal("failed copy was not rolled back")
	}
}

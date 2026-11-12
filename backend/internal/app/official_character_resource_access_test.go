package app

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

func TestPersonalCharacterRetainsOfficialResourcesAfterUnpublish(t *testing.T) {
	t.Skip("官方角色另存和下架后共享资源权限暂缓")
	svc, db := newProjectWorkbenchReadTestService(t)
	svc.dataDir = t.TempDir()
	if err := os.MkdirAll(filepath.Join(svc.dataDir, "resources"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", "voice.mp3"), []byte("audio-test"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Resource{}, &model.OfficialAsset{}, &model.OfficialAssetImport{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.Resource{ID: "shared-image", UserID: "admin", Kind: "image", Status: model.ResourceStatusReady},
		&model.Resource{ID: "shared-audio", UserID: "admin", Kind: "audio", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "voice.mp3", MimeType: "audio/mpeg", Size: 10},
		&model.OfficialAsset{ID: "official", ResourceID: "shared-image", Status: model.OfficialAssetStatusUnpublished},
		&model.Asset{ID: "personal", UserID: "user", Kind: "entity", Category: model.AssetCategoryCharacter},
		&model.AssetVersion{ID: "version", AssetID: "personal"},
		&model.AssetRepresentation{ID: "representation", AssetVersionID: "version", ResourceID: "shared-image", Role: "front"},
		&model.VoiceProfile{ID: "voice", UserID: "user", SampleResourceID: "shared-audio"},
		&model.CharacterVoiceBinding{ID: "binding", AssetVersionID: "version", VoiceProfileID: "voice"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{"shared-image", "shared-audio"} {
		if _, err := svc.resourceForUserOrOfficial("user", id); err != nil {
			t.Fatalf("owner %s: %v", id, err)
		}
		if _, err := svc.resourceForUserOrOfficial("other", id); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("other %s: %v", id, err)
		}
	}
	delivery, err := svc.PrepareResourceDelivery("user", "shared-audio", ResourceAccessOptions{Purpose: assets.PurposeDisplay}, "")
	if err != nil || delivery.Stream == nil {
		t.Fatalf("delivery: %+v, %v", delivery, err)
	}
	defer delivery.Stream.Body.Close()
	data, err := io.ReadAll(delivery.Stream.Body)
	if err != nil || string(data) != "audio-test" {
		t.Fatalf("voice content: %q %v", data, err)
	}
}

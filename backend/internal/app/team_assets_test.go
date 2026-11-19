package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func newTeamAssetTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	dir := t.TempDir()
	db, err := database.Open(database.Config{Driver: "sqlite", DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"owner", "member", "outside"} {
		if err := db.Create(&model.User{ID: id, Username: id, Status: model.UserStatusActive, Role: model.UserRoleUser}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{"team-a", "team-b"} {
		if err := db.Create(&model.Team{ID: id, OwnerUserID: "owner", Name: id, Status: model.TeamActive}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.TeamMembership{ID: id + "-owner", TeamID: id, UserID: "owner", Role: model.TeamOwner, Status: model.TeamActive}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.TeamMembership{ID: "team-a-member", TeamID: "team-a", UserID: "member", Role: model.TeamMember, Status: model.TeamActive}).Error; err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: dir}, db
}

func seedTeamSourceImage(t *testing.T, svc *Service, db *gorm.DB, assetID, ownerID string) []byte {
	t.Helper()
	picture := image.NewRGBA(image.Rect(0, 0, 2, 3))
	picture.Set(0, 0, color.RGBA{R: 200, G: 40, B: 20, A: 255})
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, picture); err != nil {
		t.Fatal(err)
	}
	key := assetID + ".png"
	if err := os.MkdirAll(filepath.Join(svc.dataDir, "resources"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(svc.dataDir, "resources", key), buffer.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "resource-" + assetID, UserID: ownerID, Provider: "local", ObjectKey: key, Kind: "image", MimeType: "image/png", Size: int64(buffer.Len()), Width: 2, Height: 3, Status: model.ResourceStatusReady}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	payload, err := json.Marshal(map[string]any{"data": map[string]any{"storageKey": "resource:" + resource.ID}, "arkAssetId": "private-provider-id", "metadata": map[string]any{"apiKey": "private-secret"}})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Asset{ID: assetID, UserID: ownerID, Kind: "image", Title: "团队参考图", PayloadJSON: string(payload)}).Error; err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestTeamPublicationUsesLibraryVersionsAndOwnedResources(t *testing.T) {
	svc, db := newTeamAssetTestService(t)
	want := seedTeamSourceImage(t, svc, db, "image", "member")
	publish := func(actor, key string, ids ...string) TeamAssetPublicationResult {
		t.Helper()
		result, err := svc.PublishTeamAssets(context.Background(), actor, "team-a", PublishTeamAssetsRequest{AssetIDs: ids, IdempotencyKey: key})
		if err != nil {
			t.Fatal(err)
		}
		return result.Results[0]
	}
	first := publish("member", "one", "image")
	if first.Error != nil || first.Asset == nil {
		t.Fatalf("publish: %+v", first.Error)
	}
	replay := publish("member", "one", "image")
	if replay.Asset == nil || *replay.Asset != *first.Asset {
		t.Fatal("idempotency lost")
	}
	if changed := publish("member", "one", "different"); changed.Error == nil {
		t.Fatal("accepted different batch")
	}
	if other := publish("owner", "other", "image"); other.Error == nil {
		t.Fatal("copied another user's asset")
	}
	second := publish("member", "two", "image")
	if second.Asset == nil || second.Asset.ID != first.Asset.ID || second.Asset.PrimaryVersionID == first.Asset.PrimaryVersionID {
		t.Fatal("missing second version")
	}
	version, err := svc.repo.AssetVersion(first.Asset.PrimaryVersionID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(version.DefinitionJSON, "private-secret") || strings.Contains(version.DefinitionJSON, "private-provider-id") {
		t.Fatal("private metadata crossed space")
	}
	var snapshot struct{ Data struct{ StorageKey string } }
	if err := json.Unmarshal([]byte(version.DefinitionJSON), &snapshot); err != nil {
		t.Fatal(err)
	}
	id := strings.TrimPrefix(snapshot.Data.StorageKey, "resource:")
	if id == "resource-image" {
		t.Fatal("shared personal resource")
	}
	canvas, err := json.Marshal(map[string]any{"id": "board", "nodes": []any{map[string]any{"id": "old", "type": "image", "metadata": map[string]string{"assetId": first.Asset.ID, "storageKey": snapshot.Data.StorageKey}}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.canvasDomain().ValidateCanvasMediaAssets(model.TeamContentKey("team-a"), canvas); err != nil {
		t.Fatal("previously bound media version no longer usable", err)
	}
	if err := os.Truncate(filepath.Join(svc.dataDir, "resources", "image.png"), int64(len(want)-1)); err != nil {
		t.Fatal(err)
	}
	failed := publish("member", "short", "image")
	if failed.Error == nil || failed.Asset != nil {
		t.Fatalf("short source published: %+v", failed)
	}
	var ready int64
	if err := db.Model(&model.TeamAssetPublication{}).Where("source_asset_id = ? AND status = ?", "image", model.TeamAssetReady).Count(&ready).Error; err != nil || ready != 2 {
		t.Fatalf("ready publications: %d, %v", ready, err)
	}
	if err := db.Model(&model.AssetVersion{}).Where("asset_id = ?", first.Asset.ID).Count(&ready).Error; err != nil || ready != 2 {
		t.Fatalf("visible versions: %d, %v", ready, err)
	}
	if err := os.Remove(filepath.Join(svc.dataDir, "resources", "image.png")); err != nil {
		t.Fatal(err)
	}
	_, stream, err := svc.OpenResource(model.TeamContentKey("team-a"), id)
	if err != nil {
		t.Fatal(err)
	}
	defer stream.Close()
	data, err := io.ReadAll(stream)
	if err != nil || !bytes.Equal(data, want) {
		t.Fatal("lost published bytes", err)
	}
	if _, err := svc.repo.AssetForUser(model.TeamContentKey("team-b"), first.Asset.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("second team can read asset", err)
	}
}

func TestTeamRepublishContinuesMigratedAsset(t *testing.T) {
	svc, db := newTeamAssetTestService(t)
	old := model.Asset{ID: "pre-migration-id", UserID: model.TeamContentKey("team-a"), CreatedBy: "member", Kind: "text", Title: "旧稿", PrimaryVersionID: "v4", Status: model.AssetVersionStatusConfirmed, PayloadJSON: `{"data":{"content":"旧稿"}}`}
	for _, row := range []any{&old, &model.AssetVersion{ID: "v4", AssetID: old.ID, Version: 4, DefinitionJSON: old.PayloadJSON}, &model.TeamAssetPublication{ID: "old-pub", TeamID: "team-a", PublishedBy: "member", SourceAssetID: "script", AssetID: old.ID, VersionID: "v4", Status: model.TeamAssetReady}, &model.Asset{ID: "script", UserID: "member", Kind: "text", Title: "新稿", PayloadJSON: `{"data":{"content":"新稿"}}`}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	result, err := svc.PublishTeamAssets(context.Background(), "member", "team-a", PublishTeamAssetsRequest{AssetIDs: []string{"script"}, IdempotencyKey: "after-upgrade"})
	if err != nil {
		t.Fatal(err)
	}
	item := result.Results[0]
	if item.Asset == nil || item.Asset.ID != old.ID {
		t.Fatalf("lost migrated asset: %+v", item)
	}
	version, err := svc.repo.AssetVersion(item.Asset.PrimaryVersionID)
	if err != nil || version.Version != 5 {
		t.Fatalf("new version: %+v, %v", version, err)
	}
}

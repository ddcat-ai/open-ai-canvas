package service

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestIsSupportedVoiceSampleMimeType(t *testing.T) {
	for _, mime := range []string{
		"audio/mpeg", "audio/mp3", "audio/x-mpeg", " AUDIO/MPEG ",
		"audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "audio/x-pn-wav",
		"audio/mp4", "audio/x-m4a", "audio/m4a", "audio/aac", "audio/aacp",
		"audio/flac", "audio/x-flac", "audio/ogg", "application/ogg", "audio/opus", "audio/webm",
		"audio/ogg; codecs=opus", "audio/webm;codecs=opus",
	} {
		if !isSupportedVoiceSampleMimeType(mime) {
			t.Fatalf("isSupportedVoiceSampleMimeType(%q) = false, want true", mime)
		}
	}
	for _, mime := range []string{"audio/aiff", "audio/amr", "audio/x-ms-wma", "video/mp4", "application/octet-stream", ""} {
		if isSupportedVoiceSampleMimeType(mime) {
			t.Fatalf("isSupportedVoiceSampleMimeType(%q) = true, want false", mime)
		}
	}
}

func TestBindProjectCharacterVoiceWithSampleResource(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Project{}, &model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{}, &model.ProjectAssetLink{},
		&model.CharacterVoiceBinding{}, &model.VoiceProfile{}, &model.Resource{}, &model.Shot{}, &model.ShotAssetReference{},
	); err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	project := model.Project{ID: "project-voice", UserID: "user-voice", Name: "声音绑定测试", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	asset := model.Asset{ID: "character-voice", UserID: project.UserID, Kind: "entity", Category: model.AssetCategoryCharacter, Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "character-voice-v1", Title: "张振天"}
	asset.PayloadJSON = `{"id":"character-voice","kind":"entity","category":"character","status":"confirmed","primaryVersionId":"character-voice-v1","title":"张振天","data":{"definition":{}}}`
	version := model.AssetVersion{ID: asset.PrimaryVersionID, AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{}`,
		CreatedAt: now, UpdatedAt: now}
	link := model.ProjectAssetLink{ID: "project-character-voice-link", ProjectID: project.ID, AssetID: asset.ID, CreatedAt: now}
	resource := model.Resource{ID: "voice-sample", UserID: project.UserID, Kind: "audio", Status: model.ResourceStatusReady, MimeType: "audio/wav", ObjectKey: "voice-sample.wav", CreatedAt: now, UpdatedAt: now}
	for _, value := range []any{&project, &asset, &version, &link, &resource} {
		if err := db.Create(value).Error; err != nil {
			t.Fatal(err)
		}
	}

	result, err := (&Service{repo: repository.New(db)}).BindProjectCharacterVoice(project.UserID, project.ID, asset.ID, BindCharacterVoiceRequest{SampleResourceID: resource.ID, VoiceName: "张振天原声"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Character.Voice == nil || result.Character.Voice.Profile.SampleResourceID != resource.ID {
		t.Fatalf("voice binding = %+v, want sample resource %q", result.Character, resource.ID)
	}
}

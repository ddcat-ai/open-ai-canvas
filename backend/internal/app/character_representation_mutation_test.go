package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestCharacterRepresentationMutationRetryAndConflict(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	for _, id := range []string{"base-image", "new-image"} {
		if err := db.Create(&model.Resource{ID: id, UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Size: 10}).Error; err != nil {
			t.Fatal(err)
		}
	}
	initial, err := svc.CreateCharacter("user", CreateCharacterRequest{Name: "人物", ImageResourceID: "base-image"})
	if err != nil {
		t.Fatal(err)
	}
	req := ReplaceCharacterRepresentationsRequest{
		ExpectedVersionID: initial.Character.VersionID, OperationID: "save-look-1",
		Definition:      map[string]any{"outfits": []any{map[string]any{"id": "new-look", "name": "新形象", "resourceId": "new-image"}}},
		Representations: []CharacterRepresentationInput{{Role: "primary", ResourceID: "new-image"}},
	}
	saved, err := svc.ReplaceCharacterRepresentations("user", initial.Asset.ID, req)
	if err != nil {
		t.Fatal(err)
	}
	retried, err := svc.ReplaceCharacterRepresentations("user", initial.Asset.ID, req)
	if err != nil || retried.Character.VersionID != saved.Character.VersionID {
		t.Fatalf("retry created another version: %#v, %v", retried, err)
	}
	req.OperationID = "save-look-2"
	if _, err = svc.ReplaceCharacterRepresentations("user", initial.Asset.ID, req); err == nil {
		t.Fatal("stale version accepted")
	}
	if _, err = svc.ReplaceCharacterRepresentations("another-user", initial.Asset.ID, req); err == nil {
		t.Fatal("foreign character accepted")
	}
}

func TestCharacterDressingSourceRequiresMatchingTaskOutput(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	if err := db.Create(&model.Resource{ID: "image", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"}).Error; err != nil {
		t.Fatal(err)
	}
	character, err := svc.CreateCharacter("user", CreateCharacterRequest{Name: "人物", ImageResourceID: "image"})
	if err != nil {
		t.Fatal(err)
	}
	input, _ := json.Marshal(map[string]any{"metadata": map[string]any{"source": "character-dressing-table", "dressing": map[string]any{"characterAssetId": character.Asset.ID}}})
	if err := db.Create(&model.Task{ID: "source-task", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: string(input), ResultJSON: `{"images":[{"storageKey":"resource:other-image"}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	req := ReplaceCharacterRepresentationsRequest{ExpectedVersionID: character.Character.VersionID, OperationID: "forged", Representations: []CharacterRepresentationInput{{Role: "primary", ResourceID: "image"}}, Definition: map[string]any{"outfits": []any{map[string]any{"id": "look", "name": "形象", "resourceId": "image", "source": map[string]any{"taskId": "source-task"}}}}}
	if _, err := svc.ReplaceCharacterRepresentations("user", character.Asset.ID, req); err == nil {
		t.Fatal("unrelated task output accepted")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", "source-task").Update("result_json", `{"images":[{"storageKey":"resource:image"}]}`).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ReplaceCharacterRepresentations("user", character.Asset.ID, req); err != nil {
		t.Fatal(err)
	}
}
